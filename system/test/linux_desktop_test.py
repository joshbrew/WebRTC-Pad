"""Portable policy/mixer checks plus opt-in isolated native X11/Pulse acceptance."""
import array
import ctypes as c
import importlib.util
import json
import math
import os
from pathlib import Path
import select
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
native=Path(__file__).resolve().parents[1]/'native';sys.path.insert(0,str(native))
from linux_audio import family,mix,Pulse,Spec,BufferAttr
from linux_scope import LinuxScope,process_start,require_x11
from unittest.mock import patch

class Portable(unittest.TestCase):
    def test_family_is_pinned_and_does_not_include_siblings(self):
        records={10:(1,100),11:(10,101),12:(11,102),20:(1,200),21:(20,201)}
        self.assertEqual(family(10,(1,100),records),{10,11,12})
        with self.assertRaisesRegex(RuntimeError,'changed'):family(10,(1,99),records)
    def test_mixer_clamps_without_wrapping_and_consumes_each_stream(self):
        buffers=[bytearray(b'\xff\x7f'*4),bytearray(b'\xff\x7f'*4)]
        self.assertEqual(mix(buffers,8),b'\xff\x7f'*4);self.assertTrue(all(not b for b in buffers))
        self.assertEqual(mix([],8),bytes(8))
    def test_xwayland_does_not_gain_desktop_permission(self):
        for env in [{'DISPLAY':':0','WAYLAND_DISPLAY':'wayland-0'},{'DISPLAY':':0','XDG_SESSION_TYPE':'wayland'}]:
            with patch.dict(os.environ,env,clear=True),self.assertRaisesRegex(RuntimeError,'Wayland'):require_x11()

def wait(predicate,label,timeout=8):
    end=time.monotonic()+timeout
    while not predicate():
        if time.monotonic()>end:raise RuntimeError(label)
        time.sleep(.02)

@unittest.skipUnless(os.environ.get('PAD_TEST_X11')=='1' and sys.platform=='linux','isolated X11 display required')
class NativeX11(unittest.TestCase):
    def setUp(self):
        self.s=LinuxScope();self.x=self.s.x;self.d=self.s.display
        p,u,i=c.c_void_p,c.c_ulong,c.c_int
        def bind(name,args,result):fn=getattr(self.x,name);fn.argtypes=args;fn.restype=result
        for name,args,result in [('XCreateSimpleWindow',[p,u,i,i,c.c_uint,c.c_uint,c.c_uint,u,u],u),('XMapWindow',[p,u],i),('XRaiseWindow',[p,u],i),('XDestroyWindow',[p,u],i),('XMoveResizeWindow',[p,u,i,i,c.c_uint,c.c_uint],i),('XSetInputFocus',[p,u,i,u],i),('XChangeProperty',[p,u,u,u,i,i,p,i],i)]:bind(name,args,result)
        self.windows=[]
        self.a=self.window(60,50,320,240,'Shared game');self.b=self.window(500,50,220,180,'Other app')
        module=importlib.util.spec_from_file_location('desktop_input',native/'desktop-input.py');loaded=importlib.util.module_from_spec(module);module.loader.exec_module(loaded)
        self.api=loaded.Linux();self.api.set_scope(self.target())
        self.focus(self.a);self.flush()
    def tearDown(self):
        for key in list(self.api.key_down):self.api.key(key,False,set())
        for button in list(self.api.mouse_down):self.api.button(button,False)
        self.api.close()
        for w in self.windows:self.x.XDestroyWindow(self.d,w)
        self.flush();self.s.close()
    def flush(self):self.x.XSync(self.d,0)
    def property(self,w,name,value,text=False):
        atom=self.x.XInternAtom(self.d,name.encode(),0);kind=self.x.XInternAtom(self.d,b'UTF8_STRING' if text else b'CARDINAL',0)
        data=c.create_string_buffer(value.encode()) if text else (c.c_ulong*len(value))(*value)
        self.x.XChangeProperty(self.d,w,atom,kind,8 if text else 32,0,data,len(value))
    def window(self,x,y,w,h,name):
        window=self.x.XCreateSimpleWindow(self.d,self.s.root,x,y,w,h,0,0,0x203040);self.windows.append(window)
        self.property(window,'_NET_WM_PID',[os.getpid()]);self.property(window,'_NET_WM_NAME',name,True)
        self.x.XSelectInput(self.d,window,1|2|4|8);self.x.XMapWindow(self.d,window)
        self.property(self.s.root,'_NET_CLIENT_LIST_STACKING',self.windows);self.flush();return window
    def target(self):return {'kind':'window','id':str(self.a),'pid':os.getpid(),'processStart':process_start(os.getpid())}
    def focus(self,w):self.x.XSetInputFocus(self.d,w,2,0);self.flush()
    def count(self,w,event=4):
        self.flush();value=(c.c_long*24)();count=0
        while self.x.XCheckTypedWindowEvent(self.d,w,event,c.byref(value)):count+=1
        return count
    def click(self):self.api.move(.5,.5);self.api.button(0,True);self.api.button(0,False);self.flush()
    def test_real_window_click_resize_occlusion_focus_and_close(self):
        self.assertTrue(any(t['id']==str(self.a) for t in self.s.targets()))
        self.click();self.assertEqual(self.count(self.a),1);self.assertEqual(self.count(self.b),0)
        self.x.XMoveResizeWindow(self.d,self.a,80,80,400,300);self.flush();self.api.refresh();self.assertEqual((self.api.width,self.api.height),(400,300));self.click();self.assertEqual(self.count(self.a),1)
        self.x.XMoveResizeWindow(self.d,self.b,150,130,220,180);self.x.XRaiseWindow(self.d,self.b);self.flush()
        self.click();self.assertEqual(self.count(self.a),0);self.assertEqual(self.count(self.b),0,'A covered shared window must not click the covering app')
        self.focus(self.b);self.api.key('KeyA',True,{'KeyA'});self.assertEqual(self.count(self.b,2),0)
        self.x.XDestroyWindow(self.d,self.a);self.windows.remove(self.a);self.flush();self.api.refresh();self.assertTrue(self.api.scope_lost)
    def test_native_overlay_is_click_through_non_focusing_clipped_and_reappears(self):
        from linux_overlay import Overlay
        env={'NATIVE_WINDOW_HANDLE':str(self.a),'NATIVE_WINDOW_PID':str(os.getpid()),'NATIVE_WINDOW_START':process_start(os.getpid())}
        with patch.dict(os.environ,env):overlay=Overlay()
        try:
            overlay.command({'type':'cursor','id':'one','x':.5,'y':.5,'visible':True,'color':'#c8f79c'});overlay.tick();overlay.x.XSync(overlay.display,0)
            cursor=overlay.cursors['one'];self.assertTrue(cursor['shown']);self.assertTrue(self.s.attributes(cursor['window']).override)
            self.assertTrue(self.api.scope.key_allowed(),'Showing overlay must not take keyboard focus')
            self.click();self.assertEqual(self.count(self.a),1,'Actual OS click must pass through cursor overlay')
            cursor['at']=time.monotonic()-5;overlay.tick();self.assertFalse(cursor['shown'])
            overlay.command({'type':'cursor','id':'one','x':.5,'y':.5,'visible':True});overlay.tick();self.assertTrue(cursor['shown'])
            overlay.command({'type':'cursor','id':'one','x':1,'y':1,'visible':True,'labels':True,'label':'Player 1'});overlay.tick()
            overlay.x.XSync(overlay.display,0)
            rect=self.s.rect(cursor['window']);self.assertEqual(rect[:2],(379,289))
        finally:overlay.close()

def tone(freq):
    pulse=Pulse();p=pulse.p;pointer=c.c_void_p
    p.pa_stream_connect_playback.argtypes=[pointer,c.c_char_p,c.POINTER(BufferAttr),c.c_int,pointer,pointer];p.pa_stream_connect_playback.restype=c.c_int
    p.pa_stream_write.argtypes=[pointer,pointer,c.c_size_t,pointer,c.c_int64,c.c_int];p.pa_stream_write.restype=c.c_int
    spec=Spec(3,48000,2);stream=p.pa_stream_new(pulse.context,b'Harmless test tone',c.byref(spec),None);attr=BufferAttr(192000,38400,19200,1920,0xffffffff)
    if p.pa_stream_connect_playback(stream,None,c.byref(attr),0x2000,None,None)<0:raise RuntimeError('Test playback failed')
    pulse.wait(lambda:p.pa_stream_get_state(stream) in (2,3,4))
    if p.pa_stream_get_state(stream)!=2:raise RuntimeError('Test playback stream was refused')
    index=0;next_at=time.monotonic()
    try:
        print('ready',flush=True)
        while True:
            pulse.step();now=time.monotonic()
            if now>=next_at:
                samples=array.array('h',(int(2500*math.sin(2*math.pi*freq*(index+i)/48000)) for i in range(480) for _ in range(2)));index+=480
                data=samples.tobytes()
                if p.pa_stream_write(stream,data,len(data),None,0,0)<0:raise RuntimeError('Test playback write failed')
                next_at+=.01
            time.sleep(.001)
    finally:p.pa_stream_disconnect(stream);p.pa_stream_unref(stream);pulse.close()

@unittest.skipUnless(os.environ.get('PAD_TEST_AUDIO')=='1' and sys.platform=='linux','private PulseAudio server required')
class NativeAudio(unittest.TestCase):
    def test_application_monitor_excludes_unrelated_playback_and_cleans_up(self):
        with tempfile.TemporaryDirectory(prefix='pad-pulse-') as temp:
            folder=Path(temp);socket=folder/'server';script=folder/'pulse.pa'
            script.write_text(f'load-module module-native-protocol-unix socket={socket} auth-anonymous=1\nload-module module-null-sink sink_name=qa rate=48000 channels=2\nload-module module-null-sink sink_name=unapproved rate=48000 channels=2\nset-default-sink qa\nset-default-source qa.monitor\n')
            env={**os.environ,'PULSE_SERVER':'unix:'+str(socket),'PULSE_RUNTIME_PATH':temp};log=open(folder/'server.log','w+')
            modules=['--dl-search-path='+env['PAD_TEST_PULSE_MODULES']] if env.get('PAD_TEST_PULSE_MODULES') else []
            server=subprocess.Popen(['pulseaudio','-n','--daemonize=no','--exit-idle-time=-1','--use-pid-file=no','--log-target=stderr','--file='+str(script),*modules],env=env,stdout=log,stderr=log)
            children=[]
            try:
                try:wait(lambda:socket.exists() or server.poll() is not None,'Private audio server did not start',timeout=12)
                except RuntimeError:
                    log.flush();log.seek(0);raise RuntimeError(log.read()[-4000:])
                if server.poll() is not None:log.seek(0);self.fail(log.read())
                for freq in (440,880):
                    child=subprocess.Popen([sys.executable,'-B',__file__,'--tone',str(freq)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);children.append(child)
                    self.assertEqual(child.stdout.readline().strip(),'ready')
                with patch.dict(os.environ,env):
                    probe=Pulse()
                    try:
                        wait(lambda:len(probe.inputs())>=2,'Test playback streams did not appear')
                        self.assertTrue({children[0].pid,children[1].pid}<={item['pid'] for item in probe.inputs()},str(probe.inputs()))
                    finally:probe.close()
                # Null sinks may start with a large scheduling quantum even
                # when the capture client requests small fragments.
                time.sleep(2.2)
                metadata=json.loads(subprocess.run(['pactl','-f','json','list','sink-inputs'],env=env,capture_output=True,text=True,check=True).stdout)
                self.assertTrue(all(not v.get('corked') for v in metadata))
                def capture(pid):
                    child=subprocess.Popen([sys.executable,'-B',str(native/'linux_audio.py'),'--pid',str(pid)],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE);children.append(child)
                    header=json.loads(child.stdout.readline());self.assertEqual(header['sampleRate'],48000)
                    data=bytearray()
                    def read():
                        while True:
                            chunk=child.stdout.read(1920)
                            if not chunk:return
                            data.extend(chunk)
                    thread=threading.Thread(target=read,daemon=True);thread.start();child.stdin.write(b'start\n');child.stdin.flush()
                    wait(lambda:len(data)>=1920,'Native capture did not start')
                    outputs=subprocess.run(['pactl','list','short','source-outputs'],env=env,text=True,capture_output=True,check=True).stdout.splitlines();self.assertEqual(len(outputs),1)
                    moved=subprocess.run(['pactl','move-source-output',outputs[0].split()[0],'unapproved.monitor'],env=env,capture_output=True);self.assertNotEqual(moved.returncode,0,'Capture must refuse a move to an unapproved audio source')
                    time.sleep(1.3);child.stdin.close();child.wait(timeout=6);thread.join(timeout=2)
                    detail=child.stderr.read().decode();self.assertEqual(child.returncode,0,detail);self.assertGreater(len(data),48000)
                    samples=array.array('h');samples.frombytes(bytes(data[-19200:]));return samples[::2]
                def power(samples,freq):return abs(sum(value*complex(math.cos(2*math.pi*freq*i/48000),math.sin(2*math.pi*freq*i/48000)) for i,value in enumerate(samples)))
                app=capture(children[0].pid);system=capture(0)
                self.assertGreater(power(app,440),8*power(app,880),'App capture leaked the unrelated application')
                self.assertGreater(power(system,440),10000);self.assertGreater(power(system,880),10000)
                result=subprocess.run(['pactl','list','short','source-outputs'],env=env,text=True,capture_output=True);self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout.strip(),'','Capture handles must disappear after helper exit')
            finally:
                for child in reversed(children):
                    if child.poll() is None:child.terminate()
                    try:child.wait(timeout=3)
                    except subprocess.TimeoutExpired:child.kill();child.wait()
                    for pipe in (child.stdin,child.stdout,child.stderr):
                        if pipe and not pipe.closed:pipe.close()
                server.terminate();server.wait(timeout=5);log.close()

if __name__=='__main__':
    if '--tone' in sys.argv:tone(int(sys.argv[-1]))
    else:unittest.main()
