"""Small X11 cursor windows with empty input shapes. No focus or OS input injection."""
import colorsys
import ctypes as c
import json
import os
import queue
import re
import sys
import threading
import time
from linux_scope import LinuxScope, Rectangle

class Point(c.Structure):_fields_=[('x',c.c_short),('y',c.c_short)]
class WindowAttrs(c.Structure):
    _fields_=[('background_pixmap',c.c_ulong),('background_pixel',c.c_ulong),('border_pixmap',c.c_ulong),('border_pixel',c.c_ulong),('bit_gravity',c.c_int),('win_gravity',c.c_int),('backing_store',c.c_int),('backing_planes',c.c_ulong),('backing_pixel',c.c_ulong),('save_under',c.c_int),('event_mask',c.c_long),('do_not_propagate',c.c_long),('override_redirect',c.c_int),('colormap',c.c_ulong),('cursor',c.c_ulong)]
class Hints(c.Structure):
    _fields_=[('flags',c.c_long),('input',c.c_int),('state',c.c_int),('pixmap',c.c_ulong),('window',c.c_ulong),('x',c.c_int),('y',c.c_int),('mask',c.c_ulong),('group',c.c_ulong)]
class Color(c.Structure):_fields_=[('pixel',c.c_ulong),('red',c.c_ushort),('green',c.c_ushort),('blue',c.c_ushort),('flags',c.c_char),('pad',c.c_char)]

def color(value):
    hsl=re.fullmatch(r'hsl\((\d{1,3}) 85% 70%\)',value) if isinstance(value,str) else None
    if hsl:return '#'+''.join(f'{round(v*255):02x}' for v in colorsys.hls_to_rgb(int(hsl[1])%360/360,.70,.85))
    return value if isinstance(value,str) and re.fullmatch('#[0-9a-fA-F]{6}',value) else '#c8f79c'

class Overlay:
    def __init__(self):
        self.scope=LinuxScope();self.x=self.scope.x;self.display=self.scope.display;self.cursors={};self.colors={}
        p,u,i=c.c_void_p,c.c_ulong,c.c_int
        def bind(lib,name,args,result):fn=getattr(lib,name);fn.argtypes=args;fn.restype=result
        for name,args,result in [
            ('XCreateSimpleWindow',[p,u,i,i,c.c_uint,c.c_uint,c.c_uint,u,u],u),('XChangeWindowAttributes',[p,u,u,c.POINTER(WindowAttrs)],i),('XSetWMHints',[p,u,c.POINTER(Hints)],i),('XStoreName',[p,u,c.c_char_p],i),
            ('XChangeProperty',[p,u,u,u,i,i,p,i],i),('XMapRaised',[p,u],i),('XUnmapWindow',[p,u],i),('XDestroyWindow',[p,u],i),('XMoveResizeWindow',[p,u,i,i,c.c_uint,c.c_uint],i),
            ('XCreateGC',[p,u,u,p],p),('XFreeGC',[p,p],i),('XSetForeground',[p,p,u],i),('XSetWindowBackground',[p,u,u],i),('XClearWindow',[p,u],i),('XDrawLines',[p,u,p,c.POINTER(Point),i,i],i),('XDrawString',[p,u,p,i,i,c.c_char_p,i],i),
            ('XPolygonRegion',[c.POINTER(Point),i,i],p),('XCreateRegion',[],p),('XDestroyRegion',[p],i),('XUnionRectWithRegion',[c.POINTER(Rectangle),p,p],i),('XIntersectRegion',[p,p,p],i),
            ('XDefaultColormap',[p,i],u),('XAllocColor',[p,u,c.POINTER(Color)],i)]:bind(self.x,name,args,result)
        bind(self.scope.ext,'XShapeCombineRectangles',[p,u,i,i,i,c.POINTER(Rectangle),i,i,i],None)
        bind(self.scope.ext,'XShapeCombineRegion',[p,u,i,i,i,p,i],None)
        self.points=(Point*8)(*[Point(*point) for point in [(1,1),(1,24),(7,18),(13,29),(18,26),(12,17),(23,17),(1,1)]])
        self.colormap=self.x.XDefaultColormap(self.display,self.x.XDefaultScreen(self.display))
        target=os.environ.get('NATIVE_WINDOW_HANDLE')
        if target:self.scope.set({'kind':'window','id':target,'pid':int(os.environ.get('NATIVE_WINDOW_PID') or 0),'processStart':os.environ.get('NATIVE_WINDOW_START')})
        else:self.scope.set({'kind':'desktop'})
    def pixel(self,value):
        value=color(value)
        if value not in self.colors:
            rgb=Color(0,*[int(value[i:i+2],16)*257 for i in (1,3,5)],b'\x07',b'\x00')
            if not self.x.XAllocColor(self.display,self.colormap,c.byref(rgb)):raise RuntimeError('X11 could not allocate an overlay color.')
            self.colors[value]=rgb.pixel
        return self.colors[value]
    def create(self):
        window=self.x.XCreateSimpleWindow(self.display,self.scope.root,0,0,170,58,0,0,self.pixel('#c8f79c'))
        attrs=WindowAttrs();attrs.override_redirect=1;self.x.XChangeWindowAttributes(self.display,window,1<<9,c.byref(attrs))
        hints=Hints();hints.flags=1;hints.input=0;self.x.XSetWMHints(self.display,window,c.byref(hints));self.x.XStoreName(self.display,window,b'WebRTC Pad cursor overlay')
        atom=self.x.XInternAtom(self.display,b'_WEBRTC_PAD_OVERLAY',0);cardinal=self.x.XInternAtom(self.display,b'CARDINAL',0);one=c.c_ulong(1)
        self.x.XChangeProperty(self.display,window,atom,cardinal,32,0,c.byref(one),1)
        # Empty ShapeInput region: every click reaches the actual app below.
        self.scope.ext.XShapeCombineRectangles(self.display,window,2,0,0,None,0,0,0)
        return {'window':window,'gc':self.x.XCreateGC(self.display,window,0,None),'at':0,'visible':False,'shown':False,'last':None}
    def remove(self,identity):
        cursor=self.cursors.pop(identity,None)
        if cursor:self.x.XFreeGC(self.display,cursor['gc']);self.x.XDestroyWindow(self.display,cursor['window'])
    def command(self,value):
        kind=value.get('type');identity=value.get('id')
        if kind=='clear':
            for key in list(self.cursors):self.remove(key)
        elif kind=='remove':self.remove(identity)
        elif kind=='labels':
            for cursor in self.cursors.values():cursor['labels']=value.get('enabled') is True;cursor['last']=None
        elif kind=='cursor' and isinstance(identity,str) and len(identity)<=64:
            if not all(isinstance(n,(int,float)) and 0<=n<=1 for n in (value.get('x'),value.get('y'))):return
            if identity not in self.cursors:
                if len(self.cursors)>=128:return
                self.cursors[identity]=self.create()
            self.cursors[identity].update(value,at=time.monotonic())
        elif kind=='inspect':
            print(json.dumps({'event':'inspect','cursors':[{'id':key,'window':cursor['window'],'visible':cursor['shown'],'captureExcluded':False} for key,cursor in self.cursors.items()]}),flush=True)
    def tick(self):
        area=self.scope.bounds()
        if self.scope.lost:raise RuntimeError('The shared window closed. Cursor overlay stopped.')
        for cursor in self.cursors.values():
            visible=bool(area and cursor.get('visible',True) and time.monotonic()-cursor['at']<4)
            if not visible:
                if cursor['shown']:self.x.XUnmapWindow(self.display,cursor['window']);cursor['shown']=False
                continue
            left,top,width,height=area
            x=round(cursor['x']*max(0,width-1));y=round(cursor['y']*max(0,height-1))
            label=str(cursor.get('label',''))[:24].encode('ascii','replace') if cursor.get('labels') else b''
            state=(color(cursor.get('color')),cursor.get('pressed') is True,label,x,y,width,height)
            if state==cursor['last'] and cursor['shown']:continue
            shape=self.x.XPolygonRegion(self.points,8,0);clip=self.x.XCreateRegion()
            try:
                if label:
                    rect=Rectangle(27,3,min(143,len(label)*6+6),19);self.x.XUnionRectWithRegion(c.byref(rect),shape,shape)
                rect=Rectangle(0,0,max(1,min(170,width-x)),max(1,min(58,height-y)));self.x.XUnionRectWithRegion(c.byref(rect),clip,clip);self.x.XIntersectRegion(shape,clip,shape)
                self.scope.ext.XShapeCombineRegion(self.display,cursor['window'],0,0,0,shape,0)
            finally:self.x.XDestroyRegion(shape);self.x.XDestroyRegion(clip)
            self.x.XSetWindowBackground(self.display,cursor['window'],self.pixel(state[0]));self.x.XClearWindow(self.display,cursor['window'])
            self.x.XSetForeground(self.display,cursor['gc'],self.pixel('#ffffff' if state[1] else '#17251d'))
            self.x.XDrawLines(self.display,cursor['window'],cursor['gc'],self.points,8,0)
            if label:self.x.XDrawString(self.display,cursor['window'],cursor['gc'],30,17,label,len(label))
            self.x.XMoveResizeWindow(self.display,cursor['window'],left+x,top+y,170,58);self.x.XMapRaised(self.display,cursor['window']);cursor['last']=state;cursor['shown']=True
        self.x.XFlush(self.display)
    def close(self):
        for key in list(self.cursors):self.remove(key)
        self.scope.close()

def run():
    overlay=Overlay();messages=queue.Queue(maxsize=256);stopped=threading.Event()
    def read():
        try:
            for line in sys.stdin:
                if len(line)>4096:continue
                try:messages.put(json.loads(line),timeout=.1)
                except (ValueError,queue.Full):pass
        finally:stopped.set()
    threading.Thread(target=read,daemon=True).start()
    try:
        print(json.dumps({'ready':True,'platform':'linux','target':'window' if os.environ.get('NATIVE_WINDOW_HANDLE') else 'x11-desktop'}),flush=True)
        while not stopped.is_set():
            for _ in range(256):
                try:overlay.command(messages.get_nowait())
                except queue.Empty:break
            overlay.tick();stopped.wait(.033)
    finally:overlay.close()

if __name__=='__main__':
    try:run()
    except Exception as error:print(str(error),file=sys.stderr,flush=True);sys.exit(1)
