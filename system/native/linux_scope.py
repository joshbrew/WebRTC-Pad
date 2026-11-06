"""X11 window enumeration and live client-area input boundaries. No Wayland fallback."""
import ctypes as c
from contextlib import contextmanager
import json
import os
from pathlib import Path

# Xlib retains only a C function pointer. Keep one callback alive for the whole
# process and route errors by Display, rather than retaining a closed instance.
_scopes={}
def _on_error(display,_):
    owner=_scopes.get(display)
    if owner:owner.last_error=True
    return 0
_error_handler=c.CFUNCTYPE(c.c_int,c.c_void_p,c.c_void_p)(_on_error)

class Attributes(c.Structure):
    _fields_=[(n,t) for n,t in [('x',c.c_int),('y',c.c_int),('width',c.c_int),('height',c.c_int),('border',c.c_int),('depth',c.c_int),('visual',c.c_void_p),('root',c.c_ulong),('kind',c.c_int),('bit_gravity',c.c_int),('win_gravity',c.c_int),('backing_store',c.c_int),('backing_planes',c.c_ulong),('backing_pixel',c.c_ulong),('save_under',c.c_int),('colormap',c.c_ulong),('map_installed',c.c_int),('map_state',c.c_int),('all_events',c.c_long),('your_events',c.c_long),('propagate',c.c_long),('override',c.c_int),('screen',c.c_void_p)]]
class Rectangle(c.Structure):_fields_=[('x',c.c_short),('y',c.c_short),('width',c.c_ushort),('height',c.c_ushort)]

def require_x11():
    if os.environ.get('XDG_SESSION_TYPE')=='wayland' or os.environ.get('WAYLAND_DISPLAY') and os.environ.get('XDG_SESSION_TYPE')!='x11':
        raise RuntimeError('Window-only input and desktop overlays require an X11 login session. Wayland/XWayland is not granted whole-desktop access.')
    if not os.environ.get('DISPLAY'):raise RuntimeError('No local X11 display is available.')

def process_start(pid):
    try:return (Path('/proc')/str(pid)/'stat').read_text().rsplit(')',1)[1].split()[19]
    except (OSError,IndexError):return None

class LinuxScope:
    def __init__(self):
        require_x11();self.x=c.CDLL('libX11.so.6');self.ext=c.CDLL('libXext.so.6')
        p,u,i=c.c_void_p,c.c_ulong,c.c_int
        def bind(lib,name,args,result):fn=getattr(lib,name);fn.argtypes=args;fn.restype=result
        for name,args,result in [
            ('XInitThreads',[],i),('XOpenDisplay',[c.c_char_p],p),('XCloseDisplay',[p],i),('XDefaultRootWindow',[p],u),('XDefaultScreen',[p],i),('XFree',[p],i),('XSync',[p,i],i),('XFlush',[p],i),
            ('XInternAtom',[p,c.c_char_p,i],u),('XGetWindowProperty',[p,u,u,c.c_long,c.c_long,i,u,c.POINTER(u),c.POINTER(i),c.POINTER(u),c.POINTER(u),c.POINTER(p)],i),
            ('XGetWindowAttributes',[p,u,c.POINTER(Attributes)],i),('XTranslateCoordinates',[p,u,u,i,i,c.POINTER(i),c.POINTER(i),c.POINTER(u)],i),
            ('XQueryTree',[p,u,c.POINTER(u),c.POINTER(u),c.POINTER(p),c.POINTER(c.c_uint)],i),('XQueryPointer',[p,u,c.POINTER(u),c.POINTER(u),c.POINTER(i),c.POINTER(i),c.POINTER(i),c.POINTER(i),c.POINTER(c.c_uint)],i),
            ('XGetInputFocus',[p,c.POINTER(u),c.POINTER(i)],i),('XSelectInput',[p,u,c.c_long],i),('XCheckTypedWindowEvent',[p,u,i,p],i),('XGrabServer',[p],i),('XUngrabServer',[p],i),('XSetErrorHandler',[p],p),
            ('XQueryExtension',[p,c.c_char_p,c.POINTER(i),c.POINTER(i),c.POINTER(i)],i)]:bind(self.x,name,args,result)
        bind(self.ext,'XShapeGetRectangles',[p,u,i,c.POINTER(i),c.POINTER(i)],p)
        bind(self.ext,'XShapeQueryExtension',[p,c.POINTER(i),c.POINTER(i)],i)
        bind(self.ext,'XShapeQueryVersion',[p,c.POINTER(i),c.POINTER(i)],i)
        self.x.XInitThreads()
        self.last_error=False
        self.x.XSetErrorHandler(c.cast(_error_handler,p))
        self.display=self.x.XOpenDisplay(None)
        if not self.display:raise RuntimeError('Cannot open the local X11 display.')
        _scopes[self.display]=self
        opcode,event,error=i(),i(),i()
        major,minor=i(),i()
        if not self.ext.XShapeQueryExtension(self.display,c.byref(event),c.byref(error)) or not self.ext.XShapeQueryVersion(self.display,c.byref(major),c.byref(minor)) or (major.value,minor.value)<(1,1):
            self.close();raise RuntimeError('This X11 server needs Shape 1.1 input regions for safe window control and click-through cursors.')
        if self.x.XQueryExtension(self.display,b'XWAYLAND',c.byref(opcode),c.byref(event),c.byref(error)):
            self.close();raise RuntimeError('This is XWayland. Window-only input and desktop overlays need a full X11 session.')
        self.root=self.x.XDefaultRootWindow(self.display);self.scope={'kind':'none'};self.lost=False
    def property(self,window,name,text=False):
        atom=self.x.XInternAtom(self.display,name.encode(),1)
        if not atom:return '' if text else []
        actual=c.c_ulong();fmt=c.c_int();count=c.c_ulong();after=c.c_ulong();data=c.c_void_p()
        result=self.x.XGetWindowProperty(self.display,window,atom,0,16384,0,0,c.byref(actual),c.byref(fmt),c.byref(count),c.byref(after),c.byref(data))
        try:
            if result or not data:return '' if text else []
            if text:return c.string_at(data,min(count.value,4096)).decode('utf-8','replace') if fmt.value==8 else ''
            return list(c.cast(data,c.POINTER(c.c_ulong))[:count.value]) if fmt.value==32 and count.value<=16384 else []
        finally:
            if data:self.x.XFree(data)
    def attributes(self,window):
        value=Attributes()
        return value if self.x.XGetWindowAttributes(self.display,window,c.byref(value)) else None
    def rect(self,window):
        a=self.attributes(window)
        if not a or a.map_state!=2 or a.width<=0 or a.height<=0:return None
        x,y,child=c.c_int(),c.c_int(),c.c_ulong()
        if not self.x.XTranslateCoordinates(self.display,window,self.root,0,0,c.byref(x),c.byref(y),c.byref(child)):return None
        return x.value,y.value,a.width,a.height
    def pid(self,window):return next(iter(self.property(window,'_NET_WM_PID')),0)
    def tree(self,window):
        root,parent=c.c_ulong(),c.c_ulong();children=c.c_void_p();count=c.c_uint()
        result=self.x.XQueryTree(self.display,window,c.byref(root),c.byref(parent),c.byref(children),c.byref(count))
        try:return (parent.value,list(c.cast(children,c.POINTER(c.c_ulong))[:min(count.value,16384)])) if result else (0,[])
        finally:
            if children:self.x.XFree(children)
    def targets(self):
        rect=self.rect(self.root)
        result=[{'kind':'desktop','id':'desktop','label':'Entire X11 desktop','width':rect[2],'height':rect[3]}] if rect else []
        for window in self.property(self.root,'_NET_CLIENT_LIST_STACKING') or self.property(self.root,'_NET_CLIENT_LIST'):
            rect=self.rect(window);pid=self.pid(window);start=process_start(pid)
            name=self.property(window,'_NET_WM_NAME',True) or self.property(window,'WM_NAME',True)
            if rect and pid and start and name and not self.property(window,'_WEBRTC_PAD_OVERLAY'):
                result.append({'kind':'window','id':str(window),'pid':pid,'processStart':start,'label':name[:200],'width':rect[2],'height':rect[3]})
        return result
    def set(self,value):
        if value.get('kind') not in ('none','desktop','window'):raise ValueError('Invalid mouse scope')
        with self.locked():
            if value['kind']=='window':
                window=int(value.get('id','0'));pid=value.get('pid')
                if window<=0 or self.pid(window)!=pid or not value.get('processStart') or process_start(pid)!=str(value['processStart']) or not self.rect(window):raise ValueError('Shared window closed or changed. Select it again.')
                event=(c.c_long*24)()
                # An explicit fresh selection can discard a prior window's
                # destruction event. Other clients cannot recycle the XID
                # between validation and subscribing while this grab is held.
                while self.x.XCheckTypedWindowEvent(self.display,window,17,c.byref(event)):pass
                self.x.XSelectInput(self.display,window,1<<17)
            self.scope=dict(value);self.lost=False
    def bounds(self):
        if self.scope['kind']!='window':return self.rect(self.root)
        window=int(self.scope['id']);event=(c.c_long*24)()
        if self.x.XCheckTypedWindowEvent(self.display,window,17,c.byref(event)):self.lost=True
        if self.lost or self.pid(window)!=self.scope['pid'] or process_start(self.scope['pid'])!=str(self.scope['processStart']):self.lost=True;return None
        return self.rect(window)
    def descendant(self,window,target):
        seen=set()
        while window and window not in seen and len(seen)<128:
            if window==target:return True
            seen.add(window);window,_=self.tree(window)
        return False
    def shaped_hit(self,window,x,y,rect):
        count,order=c.c_int(),c.c_int()
        self.last_error=False
        pointer=self.ext.XShapeGetRectangles(self.display,window,2,c.byref(count),c.byref(order))
        try:
            if self.last_error:return True  # Unknown shape blocks access; never click through it.
            if not pointer:return False
            shapes=c.cast(pointer,c.POINTER(Rectangle))
            return any(r.x<=x-rect[0]<r.x+r.width and r.y<=y-rect[1]<r.y+r.height for r in shapes[:min(count.value,16384)])
        finally:
            if pointer:self.x.XFree(pointer)
    def top_at(self,window,x,y,depth=0):
        if depth>64:return window
        _,children=self.tree(window)
        for child in reversed(children):
            rect=self.rect(child)
            if rect and rect[0]<=x<rect[0]+rect[2] and rect[1]<=y<rect[1]+rect[3] and self.shaped_hit(child,x,y,rect):return self.top_at(child,x,y,depth+1)
        return window
    def hit(self,x,y):
        if self.scope['kind']=='none':return False
        if self.scope['kind']=='desktop':return True
        rect=self.bounds()
        return bool(rect and rect[0]<=x<rect[0]+rect[2] and rect[1]<=y<rect[1]+rect[3] and self.descendant(self.top_at(self.root,x,y),int(self.scope['id'])))
    def pointer(self):
        root,child=c.c_ulong(),c.c_ulong();rx,ry,x,y=c.c_int(),c.c_int(),c.c_int(),c.c_int();mask=c.c_uint()
        if not self.x.XQueryPointer(self.display,self.root,c.byref(root),c.byref(child),c.byref(rx),c.byref(ry),c.byref(x),c.byref(y),c.byref(mask)):return None
        return rx.value,ry.value
    def pointer_allowed(self):
        point=self.pointer();return bool(point and self.hit(*point))
    def key_allowed(self):
        if self.scope['kind']=='desktop':return True
        window,revert=c.c_ulong(),c.c_int();self.x.XGetInputFocus(self.display,c.byref(window),c.byref(revert))
        return bool(self.scope['kind']=='window' and self.bounds() and self.descendant(window.value,int(self.scope['id'])))
    @contextmanager
    def locked(self):
        self.x.XGrabServer(self.display)
        try:yield
        finally:self.x.XSync(self.display,0);self.x.XUngrabServer(self.display);self.x.XFlush(self.display)
    def close(self):
        if getattr(self,'display',None):
            self.x.XCloseDisplay(self.display);_scopes.pop(self.display,None);self.display=None

if __name__=='__main__':
    scope=LinuxScope()
    try:print(json.dumps(scope.targets()),flush=True)
    finally:scope.close()
