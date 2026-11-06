"""PulseAudio/pipewire-pulse playback capture. Never records a microphone or reroutes audio."""
import array
import ctypes as c
import ctypes.util
import json
import os
from pathlib import Path
import sys
import threading
import time

class Spec(c.Structure):_fields_=[('format',c.c_int),('rate',c.c_uint32),('channels',c.c_uint8)]
class ChannelMap(c.Structure):_fields_=[('channels',c.c_uint8),('map',c.c_int*32)]
class Volume(c.Structure):_fields_=[('channels',c.c_uint8),('values',c.c_uint32*32)]
class ServerInfo(c.Structure):
    _fields_=[('user',c.c_char_p),('host',c.c_char_p),('version',c.c_char_p),('name',c.c_char_p),('spec',Spec),('sink',c.c_char_p)]
class SinkInfo(c.Structure):
    _fields_=[('name',c.c_char_p),('index',c.c_uint32),('description',c.c_char_p),('spec',Spec),('map',ChannelMap),('owner',c.c_uint32),('volume',Volume),('mute',c.c_int),('monitor',c.c_uint32),('monitor_name',c.c_char_p)]
class InputInfo(c.Structure):
    _fields_=[('index',c.c_uint32),('name',c.c_char_p),('owner',c.c_uint32),('client',c.c_uint32),('sink',c.c_uint32),('spec',Spec),('map',ChannelMap),('volume',Volume),('buffer_usec',c.c_uint64),('sink_usec',c.c_uint64),('resample',c.c_char_p),('driver',c.c_char_p),('mute',c.c_int),('props',c.c_void_p)]
class BufferAttr(c.Structure):_fields_=[(key,c.c_uint32) for key in ('maxlength','tlength','prebuf','minreq','fragsize')]

def process_identity(pid):
    try:
        folder=Path('/proc')/str(pid)
        if folder.stat().st_uid!=os.getuid():return None
        # comm may contain spaces and parentheses; fields after the final ')'
        fields=(folder/'stat').read_text().rsplit(')',1)[1].split()
        return int(fields[1]),int(fields[19])
    except (OSError,ValueError,IndexError):return None

def family(pid,identity,records=None):
    records=records if records is not None else {int(p.name):process_identity(int(p.name)) for p in Path('/proc').iterdir() if p.name.isdigit()}
    if records.get(pid)!=identity:raise RuntimeError('The selected audio application closed or changed. Select it again.')
    selected={pid}
    while True:
        children={p for p,value in records.items() if value and value[0] in selected}
        if children<=selected:return selected
        selected|=children

def mix(buffers,count=1920):
    """Mix 10 ms stereo PCM, preserving silence and clamping before s16 output."""
    samples=count//2
    total=[0]*samples
    for buffer in buffers:
        chunk=bytes(buffer[:count]);del buffer[:count]
        values=array.array('h');values.frombytes(chunk[:len(chunk)//4*4])
        if sys.byteorder!='little':values.byteswap()
        for i,value in enumerate(values):total[i]+=value
    result=array.array('h',(max(-32768,min(32767,value)) for value in total))
    if sys.byteorder!='little':result.byteswap()
    return result.tobytes()

class Pulse:
    def __init__(self,library=None):
        self.p=c.CDLL(library or os.environ.get('NATIVE_AUDIO_LIBPULSE') or ctypes.util.find_library('pulse') or 'libpulse.so.0')
        p=c.c_void_p;u=c.c_uint32
        def bind(name,args,result):fn=getattr(self.p,name);fn.argtypes=args;fn.restype=result
        for name,args,result in [
            ('pa_mainloop_new',[],p),('pa_mainloop_get_api',[p],p),('pa_mainloop_iterate',[p,c.c_int,c.POINTER(c.c_int)],c.c_int),('pa_mainloop_free',[p],None),
            ('pa_context_new',[p,c.c_char_p],p),('pa_context_connect',[p,c.c_char_p,c.c_int,p],c.c_int),('pa_context_get_state',[p],c.c_int),('pa_context_disconnect',[p],None),('pa_context_unref',[p],None),
            ('pa_context_get_server_info',[p,p,p],p),('pa_context_get_sink_info_by_name',[p,c.c_char_p,p,p],p),('pa_context_get_sink_info_by_index',[p,u,p,p],p),('pa_context_get_sink_input_info_list',[p,p,p],p),('pa_operation_get_state',[p],c.c_int),('pa_operation_unref',[p],None),
            ('pa_proplist_gets',[p,c.c_char_p],c.c_char_p),('pa_stream_new',[p,c.c_char_p,c.POINTER(Spec),p],p),('pa_stream_set_monitor_stream',[p,u],c.c_int),('pa_stream_connect_record',[p,c.c_char_p,c.POINTER(BufferAttr),c.c_int],c.c_int),
            ('pa_stream_get_state',[p],c.c_int),('pa_stream_get_device_name',[p],c.c_char_p),('pa_stream_set_read_callback',[p,p,p],None),('pa_stream_peek',[p,c.POINTER(p),c.POINTER(c.c_size_t)],c.c_int),('pa_stream_drop',[p],c.c_int),('pa_stream_disconnect',[p],c.c_int),('pa_stream_unref',[p],None)]:bind(name,args,result)
        self.loop=self.p.pa_mainloop_new();self.context=self.p.pa_context_new(self.p.pa_mainloop_get_api(self.loop),b'WebRTC Pad playback capture')
        self.streams={};self.failure=None;self.read_callback=c.CFUNCTYPE(None,p,c.c_size_t,p)(self.read)
        try:
            if self.p.pa_context_connect(self.context,None,0,None)<0:raise RuntimeError('Cannot connect to PulseAudio/pipewire-pulse.')
            self.wait(lambda:self.p.pa_context_get_state(self.context)==4)
        except BaseException:self.close();raise
    def step(self):
        if self.p.pa_mainloop_iterate(self.loop,0,None)<0 or self.p.pa_context_get_state(self.context) in (5,6):raise RuntimeError('The playback audio server disconnected.')
        if self.failure:raise RuntimeError(self.failure)
    def wait(self,condition,timeout=4):
        end=time.monotonic()+timeout
        while not condition():
            if time.monotonic()>end:raise RuntimeError('Playback audio server did not respond. Check your audio session.')
            self.step();time.sleep(.002)
    def operation(self,operation):
        if not operation:raise RuntimeError('Audio server refused a playback query.')
        try:self.wait(lambda:self.p.pa_operation_get_state(operation)!=0)
        finally:self.p.pa_operation_unref(operation)
    def default_monitor(self):
        result=[]
        @c.CFUNCTYPE(None,c.c_void_p,c.POINTER(ServerInfo),c.c_void_p)
        def server(_,info,__):
            if info and info.contents.sink:result.append(bytes(info.contents.sink))
        self.operation(self.p.pa_context_get_server_info(self.context,c.cast(server,c.c_void_p),None))
        if not result:raise RuntimeError('No default playback output was found. A microphone is never substituted.')
        return self.sink_monitor(result[0])
    def sink_monitor(self,name):
        result=[]
        @c.CFUNCTYPE(None,c.c_void_p,c.POINTER(SinkInfo),c.c_int,c.c_void_p)
        def sink(_,info,end,__):
            if not end and info and info.contents.monitor_name:result.append(bytes(info.contents.monitor_name))
        operation=self.p.pa_context_get_sink_info_by_index(self.context,name,c.cast(sink,c.c_void_p),None) if isinstance(name,int) else self.p.pa_context_get_sink_info_by_name(self.context,name,c.cast(sink,c.c_void_p),None)
        self.operation(operation)
        if not result:raise RuntimeError('The selected playback output has no monitor source.')
        return result[0]
    def inputs(self):
        result=[]
        @c.CFUNCTYPE(None,c.c_void_p,c.POINTER(InputInfo),c.c_int,c.c_void_p)
        def visit(_,info,end,__):
            if end or not info:return
            item=info.contents;pid=self.p.pa_proplist_gets(item.props,b'application.process.id')
            try:pid=int(pid or b'0')
            except ValueError:return
            result.append({'index':item.index,'sink':item.sink,'pid':pid,'client':item.client})
        self.operation(self.p.pa_context_get_sink_input_info_list(self.context,c.cast(visit,c.c_void_p),None))
        return result
    def add(self,key,source,index=None):
        spec=Spec(3,48000,2);stream=self.p.pa_stream_new(self.context,b'WebRTC Pad output monitor',c.byref(spec),None)
        if not stream:raise RuntimeError('Could not create playback monitor.')
        self.streams[key]={'stream':stream,'buffer':bytearray(),'source':source}
        try:
            # This filter must succeed BEFORE connecting to a playback monitor.
            # There is deliberately no unfiltered/system fallback for app audio.
            if index is not None and self.p.pa_stream_set_monitor_stream(stream,index)<0:raise RuntimeError('The audio server refused application-only capture.')
            self.p.pa_stream_set_read_callback(stream,c.cast(self.read_callback,c.c_void_p),None)
            attr=BufferAttr(19200,0xffffffff,0xffffffff,0xffffffff,1920)
            # DONT_MOVE prevents policy/UI rerouting this recording stream to
            # a microphone or an unapproved monitor. Also verify every read.
            if self.p.pa_stream_connect_record(stream,source,c.byref(attr),0x2200)<0:raise RuntimeError('Playback monitor could not start.')
            self.wait(lambda:self.p.pa_stream_get_state(stream) in (2,3,4))
            if self.p.pa_stream_get_state(stream)!=2:raise RuntimeError('Playback monitor was refused; no other audio was substituted.')
        except BaseException:self.remove(key);raise
    def read(self,stream,_,__):
        record=next((r for r in self.streams.values() if r['stream']==stream),None)
        if not record:return
        pointer=c.c_void_p();size=c.c_size_t()
        if self.p.pa_stream_peek(stream,c.byref(pointer),c.byref(size))<0:self.failure='Playback audio could not be read.';return
        if size.value:
            if self.p.pa_stream_get_device_name(stream)!=record['source']:self.failure='Audio routing changed. Capture stopped; select the audio source again.'
            elif size.value<=192000:record['buffer'].extend(c.string_at(pointer,size.value) if pointer else bytes(size.value))
            self.p.pa_stream_drop(stream)
            if len(record['buffer'])>19200:del record['buffer'][:(len(record['buffer'])-19200+3)//4*4]
    def remove(self,key):
        record=self.streams.pop(key,None)
        if record:
            self.p.pa_stream_set_read_callback(record['stream'],None,None);self.p.pa_stream_disconnect(record['stream']);self.p.pa_stream_unref(record['stream'])
    def close(self):
        for key in list(self.streams):self.remove(key)
        if self.context:self.p.pa_context_disconnect(self.context);self.p.pa_context_unref(self.context);self.context=None
        if self.loop:self.p.pa_mainloop_free(self.loop);self.loop=None

def run(pid=0):
    identity=process_identity(pid) if pid else None
    if pid and not identity:raise RuntimeError('The selected audio application is unavailable or belongs to another user.')
    if pid and os.environ.get('NATIVE_AUDIO_START') and str(identity[1])!=os.environ['NATIVE_AUDIO_START']:raise RuntimeError('The selected audio application changed. Select it again.')
    pulse=Pulse();stop=threading.Event();started=threading.Event()
    def commands():
        try:
            for line in sys.stdin:
                if line.strip()=='start':started.set()
        finally:stop.set()
    threading.Thread(target=commands,daemon=True).start()
    try:
        print(json.dumps({'format':'s16le','sampleRate':48000,'channels':2,'backend':'PulseAudio playback monitor'}),flush=True)
        next_query=next_frame=0
        while not stop.is_set():
            pulse.step()
            if not started.is_set():time.sleep(.005);continue
            now=time.monotonic()
            if now>=next_query:
                if pid:
                    selected=family(pid,identity);inputs=[i for i in pulse.inputs() if i['pid'] in selected]
                    desired={(i['index'],i['client'],i['pid'],i['sink']):i for i in inputs}
                else:desired={pulse.default_monitor():None}
                for key in list(pulse.streams):
                    if key not in desired or pulse.p.pa_stream_get_state(pulse.streams[key]['stream']) in (3,4):pulse.remove(key)
                for key,item in desired.items():
                    if key not in pulse.streams:
                        source=pulse.sink_monitor(item['sink']) if item else key
                        pulse.add(key,source,item['index'] if item else None)
                next_query=now+.25
            if now>=next_frame:
                sys.stdout.buffer.write(mix([r['buffer'] for r in pulse.streams.values()]));sys.stdout.buffer.flush()
                next_frame=max(next_frame+.01,now-.01)
            time.sleep(.001)
    finally:pulse.close()

if __name__=='__main__':
    try:
        if '--probe' in sys.argv:
            pulse=Pulse()
            try:pulse.default_monitor();print(json.dumps({'available':True,'window':True}),flush=True)
            finally:pulse.close()
        else:run(int(sys.argv[sys.argv.index('--pid')+1]) if '--pid' in sys.argv else 0)
    except (Exception,BrokenPipeError) as error:
        print(str(error),file=sys.stderr,flush=True);sys.exit(1)
