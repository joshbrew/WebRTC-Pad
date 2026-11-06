"""Opt-in primary-desktop input. Standard-library OS APIs; 500 ms release watchdog."""
import ctypes as c
import json
import sys
import threading
import time

class Windows:
    def __init__(self):
        from windows_scope import WindowsScope
        self.scope=WindowsScope();self.mouse_down=set();self.key_down=set()
        from ctypes import wintypes as w
        self.user = c.WinDLL('user32', use_last_error=True)
        self.user.SetProcessDPIAware()
        class Mouse(c.Structure):
            _fields_ = [('dx', w.LONG), ('dy', w.LONG), ('mouseData', w.DWORD), ('dwFlags', w.DWORD), ('time', w.DWORD), ('extra', c.c_size_t)]
        class Keyboard(c.Structure):
            _fields_ = [('vk', w.WORD), ('scan', w.WORD), ('flags', w.DWORD), ('time', w.DWORD), ('extra', c.c_size_t)]
        class Payload(c.Union):
            _fields_ = [('mouse', Mouse), ('keyboard', Keyboard)]
        class Input(c.Structure):
            _anonymous_ = ('payload',)
            _fields_ = [('kind', w.DWORD), ('payload', Payload)]
        self.Mouse, self.Keyboard, self.Input = Mouse, Keyboard, Input
        self.user.SendInput.argtypes = [w.UINT, c.POINTER(Input), c.c_int]
        self.user.SendInput.restype = w.UINT
        self.width, self.height = self.user.GetSystemMetrics(0), self.user.GetSystemMetrics(1)
        self.keys = {**{f'Key{chr(i)}': i for i in range(65, 91)}, **{f'Digit{i}': 48+i for i in range(10)}, **{f'F{i}': 111+i for i in range(1,13)}}
        self.keys.update(dict(Space=32, Enter=13, Escape=27, Backspace=8, Tab=9, ArrowUp=38, ArrowDown=40, ArrowLeft=37, ArrowRight=39, Home=36, End=35, PageUp=33, PageDown=34, Insert=45, Delete=46, ShiftLeft=160, ShiftRight=161, ControlLeft=162, ControlRight=163, AltLeft=164, AltRight=165, MetaLeft=91, MetaRight=92, CapsLock=20, Minus=189, Equal=187, BracketLeft=219, BracketRight=221, Backslash=220, Semicolon=186, Quote=222, Backquote=192, Comma=188, Period=190, Slash=191))
    def send(self, value):
        if self.user.SendInput(1, c.byref(value), c.sizeof(value)) != 1:
            raise OSError('Windows blocked desktop input (for example, an elevated application).')
    def refresh(self):
        if self.scope.scope['kind']=='window' and self.scope.pid(int(self.scope.scope['id']))!=self.scope.scope.get('pid'):self.scope_lost=True
        rect=self.scope.bounds()
        if self.scope.scope['kind']=='window':
            if self.scope.scope.get('region') and not rect and self.scope.rect(int(self.scope.scope['id'])):self.scope_lost=True
            if not rect or not self.scope.pointer_allowed():
                for button in list(self.mouse_down):self.button(button,False)
            if not self.scope.key_allowed():
                for key in list(self.key_down):self.key(key,False,set())
        if rect:self.width,self.height=rect[2],rect[3]
    def set_scope(self,value):self.scope_lost=False;self.scope.set(value);self.refresh()
    def mouse(self, flags, data=0, x=0, y=0):
        value = self.Input(kind=0); value.mouse = self.Mouse(x, y, data & 0xffffffff, flags, 0, 0); self.send(value)
    def move(self, x, y):
        rect=self.scope.bounds()
        if not rect:
            for button in list(self.mouse_down):self.button(button,False)
            return
        left,top,width,height=rect
        px,py=left+round(x*(width-1)),top+round(y*(height-1))
        if not self.scope.hit(px,py):
            for button in list(self.mouse_down):self.button(button,False)
            return
        vx, vy, vw, vh = [self.user.GetSystemMetrics(i) for i in (76,77,78,79)]
        self.mouse(0x8000 | 0x4000 | 1, x=round((px-vx)*65535/max(1,vw-1)), y=round((py-vy)*65535/max(1,vh-1)))
    def button(self, button, down):
        if down and not self.scope.pointer_allowed():return
        if not down and button not in self.mouse_down:return
        self.mouse({0:(2,4), 1:(32,64), 2:(8,16)}[button][0 if down else 1])
        if down:self.mouse_down.add(button)
        else:self.mouse_down.discard(button)
    def relative(self,dx,dy):
        if not self.scope.pointer_allowed() or not self.scope.key_allowed():return
        point=c.wintypes.POINT();self.user.GetCursorPos(c.byref(point));rect=self.scope.bounds()
        if not rect:return
        left,top,width,height=rect;px=max(left,min(left+width-1,point.x+round(dx)));py=max(top,min(top+height-1,point.y+round(dy)))
        if self.scope.hit(px,py):self.mouse(1,x=px-point.x,y=py-point.y)
    def key(self, code, down, keys):
        if down and not self.scope.key_allowed(code,keys):return
        if not down and code not in self.key_down:return
        vk = self.keys.get(code)
        if vk is None: return
        scan = self.user.MapVirtualKeyW(vk, 0)
        extended = code in {'ControlRight','AltRight','MetaLeft','MetaRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Insert','Delete'}
        value = self.Input(kind=1); value.keyboard = self.Keyboard(0, scan, 8 | (0 if down else 2) | (1 if extended else 0), 0, 0); self.send(value)
        if down:self.key_down.add(code)
        else:self.key_down.discard(code)
    def wheel(self, dx, dy):
        if not self.scope.pointer_allowed():return
        if dy: self.mouse(0x0800, -round(dy))
        if dx: self.mouse(0x1000, round(dx))

class Linux:
    def __init__(self):
        from linux_scope import LinuxScope
        self.scope=LinuxScope();self.x=self.scope.x;self.display=self.scope.display
        self.t = c.CDLL('libXtst.so.6');self.mouse_down=set();self.key_down=set();self.scope_lost=False
        for name in ('XDefaultScreen','XFlush'): getattr(self.x,name).argtypes=[c.c_void_p]
        self.screen=self.x.XDefaultScreen(self.display)
        for name in ('XDisplayWidth','XDisplayHeight'): getattr(self.x,name).argtypes=[c.c_void_p,c.c_int]
        self.width=self.x.XDisplayWidth(self.display,self.screen); self.height=self.x.XDisplayHeight(self.display,self.screen)
        self.x.XStringToKeysym.argtypes=[c.c_char_p];self.x.XStringToKeysym.restype=c.c_ulong
        self.x.XKeysymToKeycode.argtypes=[c.c_void_p,c.c_ulong];self.x.XKeysymToKeycode.restype=c.c_uint
        self.t.XTestFakeKeyEvent.argtypes=[c.c_void_p,c.c_uint,c.c_int,c.c_ulong]
        self.t.XTestFakeButtonEvent.argtypes=[c.c_void_p,c.c_uint,c.c_int,c.c_ulong]
        self.t.XTestFakeMotionEvent.argtypes=[c.c_void_p,c.c_int,c.c_int,c.c_int,c.c_ulong]
        self.names=dict(Space='space',Enter='Return',Escape='Escape',Backspace='BackSpace',Tab='Tab',ArrowUp='Up',ArrowDown='Down',ArrowLeft='Left',ArrowRight='Right',Home='Home',End='End',PageUp='Prior',PageDown='Next',Insert='Insert',Delete='Delete',ShiftLeft='Shift_L',ShiftRight='Shift_R',ControlLeft='Control_L',ControlRight='Control_R',AltLeft='Alt_L',AltRight='Alt_R',MetaLeft='Super_L',MetaRight='Super_R',CapsLock='Caps_Lock',Minus='minus',Equal='equal',BracketLeft='bracketleft',BracketRight='bracketright',Backslash='backslash',Semicolon='semicolon',Quote='apostrophe',Backquote='grave',Comma='comma',Period='period',Slash='slash')
    def set_scope(self,value):self.scope.set(value);self.scope_lost=False;self.refresh()
    def move(self,x,y):
        with self.scope.locked():
            rect=self.scope.bounds()
            if rect:
                left,top,width,height=rect;px=left+round(x*(width-1));py=top+round(y*(height-1))
            if rect and self.scope.hit(px,py):self.t.XTestFakeMotionEvent(self.display,self.screen,px,py,0)
            else:
                for button in self.mouse_down:self.t.XTestFakeButtonEvent(self.display,button+1,0,0)
                self.mouse_down.clear()
    def refresh(self):
        rect=self.scope.bounds();self.scope_lost=self.scope.lost
        if rect:self.width,self.height=rect[2],rect[3]
        if not self.scope.pointer_allowed():
            for button in list(self.mouse_down):self.button(button,False)
        if not self.scope.key_allowed():
            for key in list(self.key_down):self.key(key,False,set())
    def button(self,button,down):
        if not down and button not in self.mouse_down:return
        with self.scope.locked():
            if down and not self.scope.pointer_allowed():return
            self.t.XTestFakeButtonEvent(self.display,button+1,int(down),0)
            if down:self.mouse_down.add(button)
            else:self.mouse_down.discard(button)
    def key(self,code,down,keys):
        if not down and code not in self.key_down:return
        name=code[3:].lower() if code.startswith('Key') else code[5:] if code.startswith('Digit') else self.names.get(code,code)
        symbol=self.x.XStringToKeysym(name.encode());key=self.x.XKeysymToKeycode(self.display,symbol)
        with self.scope.locked():
            if down and not self.scope.key_allowed():return
            if key:
                self.t.XTestFakeKeyEvent(self.display,key,int(down),0)
                if down:self.key_down.add(code)
                else:self.key_down.discard(code)
    def wheel(self,dx,dy):
        with self.scope.locked():
            if not self.scope.pointer_allowed():return
            for delta,negative,positive in ((dy,4,5),(dx,6,7)):
                for _ in range(min(10,max(1,round(abs(delta)/120))) if delta else 0):
                    button=negative if delta<0 else positive;self.t.XTestFakeButtonEvent(self.display,button,1,0);self.t.XTestFakeButtonEvent(self.display,button,0,0)
    def close(self):self.scope.close()
    def relative(self,dx,dy):
        with self.scope.locked():
            if self.scope.scope['kind']!='desktop' or not self.scope.pointer_allowed():return
            fn=self.t.XTestFakeRelativeMotionEvent;fn.argtypes=[c.c_void_p,c.c_int,c.c_int,c.c_ulong];fn(self.display,round(dx),round(dy),0)

class Mac:
    class Point(c.Structure): _fields_=[('x',c.c_double),('y',c.c_double)]
    def __init__(self):
        class Size(c.Structure): _fields_=[('width',c.c_double),('height',c.c_double)]
        class Rect(c.Structure): _fields_=[('origin',Mac.Point),('size',Size)]
        self.cg=c.CDLL('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
        self.cf=c.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
        self.cg.AXIsProcessTrusted.restype=c.c_bool
        if not self.cg.AXIsProcessTrusted():raise OSError('Enable Accessibility permission for the terminal/Python running this app in macOS settings.')
        self.cg.CGMainDisplayID.restype=c.c_uint32;display=self.cg.CGMainDisplayID();self.main=display
        self.cg.CGDisplayBounds.argtypes=[c.c_uint32];self.cg.CGDisplayBounds.restype=Rect;self.bounds=self.cg.CGDisplayBounds(display)
        for name in ('CGDisplayPixelsWide','CGDisplayPixelsHigh'):getattr(self.cg,name).argtypes=[c.c_uint32];getattr(self.cg,name).restype=c.c_size_t
        self.width=self.cg.CGDisplayPixelsWide(display);self.height=self.cg.CGDisplayPixelsHigh(display)
        self.cg.CGEventCreateMouseEvent.argtypes=[c.c_void_p,c.c_uint32,Mac.Point,c.c_uint32];self.cg.CGEventCreateMouseEvent.restype=c.c_void_p
        self.cg.CGEventCreateKeyboardEvent.argtypes=[c.c_void_p,c.c_uint16,c.c_bool];self.cg.CGEventCreateKeyboardEvent.restype=c.c_void_p
        self.cg.CGEventCreateScrollWheelEvent.argtypes=[c.c_void_p,c.c_uint32,c.c_uint32,c.c_int32,c.c_int32];self.cg.CGEventCreateScrollWheelEvent.restype=c.c_void_p
        self.cg.CGEventPost.argtypes=[c.c_uint32,c.c_void_p];self.cg.CGEventSetFlags.argtypes=[c.c_void_p,c.c_uint64];self.cf.CFRelease.argtypes=[c.c_void_p]
        self.point=Mac.Point(self.bounds.origin.x,self.bounds.origin.y);self.buttons=set()
        self.keys=dict(KeyA=0,KeyS=1,KeyD=2,KeyF=3,KeyH=4,KeyG=5,KeyZ=6,KeyX=7,KeyC=8,KeyV=9,KeyB=11,KeyQ=12,KeyW=13,KeyE=14,KeyR=15,KeyY=16,KeyT=17,Digit1=18,Digit2=19,Digit3=20,Digit4=21,Digit6=22,Digit5=23,Equal=24,Digit9=25,Digit7=26,Minus=27,Digit8=28,Digit0=29,BracketRight=30,KeyO=31,KeyU=32,BracketLeft=33,KeyI=34,KeyP=35,Enter=36,KeyL=37,KeyJ=38,Quote=39,KeyK=40,Semicolon=41,Backslash=42,Comma=43,Slash=44,KeyN=45,KeyM=46,Period=47,Tab=48,Space=49,Backquote=50,Backspace=51,Escape=53,MetaRight=54,MetaLeft=55,ShiftLeft=56,CapsLock=57,AltLeft=58,ControlLeft=59,ShiftRight=60,AltRight=61,ControlRight=62,F1=122,F2=120,F3=99,F4=118,F5=96,F6=97,F7=98,F8=100,F9=101,F10=109,F11=103,F12=111,Insert=114,Home=115,PageUp=116,Delete=117,End=119,PageDown=121,ArrowLeft=123,ArrowRight=124,ArrowDown=125,ArrowUp=126)
    def post(self,event):
        if not event:raise OSError('macOS could not create desktop input event.')
        self.cg.CGEventPost(0,event);self.cf.CFRelease(event)
    def refresh(self):
        self.bounds=self.cg.CGDisplayBounds(self.main);self.width=self.cg.CGDisplayPixelsWide(self.main);self.height=self.cg.CGDisplayPixelsHigh(self.main)
    def move(self,x,y):
        self.point=Mac.Point(self.bounds.origin.x+x*(self.bounds.size.width-1),self.bounds.origin.y+y*(self.bounds.size.height-1))
        kind=6 if 0 in self.buttons else 7 if 2 in self.buttons else 27 if 1 in self.buttons else 5
        self.post(self.cg.CGEventCreateMouseEvent(None,kind,self.point,0 if kind in (5,6) else 1 if kind==7 else 2))
    def button(self,button,down):
        native={0:0,1:2,2:1}[button];kind={0:(1,2),1:(25,26),2:(3,4)}[button][0 if down else 1]
        if down:self.buttons.add(button)
        else:self.buttons.discard(button)
        self.post(self.cg.CGEventCreateMouseEvent(None,kind,self.point,native))
    def key(self,code,down,keys):
        if code not in self.keys:return
        event=self.cg.CGEventCreateKeyboardEvent(None,self.keys[code],down)
        flags=sum(flag for names,flag in [(('ShiftLeft','ShiftRight'),1<<17),(('ControlLeft','ControlRight'),1<<18),(('AltLeft','AltRight'),1<<19),(('MetaLeft','MetaRight'),1<<20)] if any(k in keys for k in names))
        self.cg.CGEventSetFlags(event,flags);self.post(event)
    def wheel(self,dx,dy):self.post(self.cg.CGEventCreateScrollWheelEvent(None,0,2,-round(dy),-round(dx)))

def main(api=None):
    if api is None:
        import os
        if sys.platform=='linux' and (os.environ.get('XDG_SESSION_TYPE')=='wayland' or os.environ.get('WAYLAND_DISPLAY') and os.environ.get('XDG_SESSION_TYPE')!='x11'):
            from wayland_portal import PortalDesktop
            api=PortalDesktop()
        else:api=Windows() if sys.platform=='win32' else Mac() if sys.platform=='darwin' else Linux()
    keys=set();buttons=set();lock=threading.Lock();last=time.monotonic();stopping=threading.Event()
    def state(value):
        nonlocal keys,buttons,last
        new_keys={k for k in value.get('keys',[]) if isinstance(k,str)};new_buttons={b for b in value.get('buttons',[]) if b in (0,1,2)}
        if 'x' in value:api.move(max(0,min(1,float(value['x']))),max(0,min(1,float(value['y']))))
        modifier=lambda key:key.startswith(('Control','Shift','Alt','Meta'))
        for key in sorted(keys-new_keys,key=modifier):api.key(key,False,new_keys)
        for button in buttons-new_buttons:api.button(button,False)
        for key in sorted(new_keys-keys,key=lambda key:not modifier(key)):api.key(key,True,new_keys)
        for button in new_buttons-buttons:api.button(button,True)
        keys=new_keys;buttons=new_buttons;last=time.monotonic()
    def watchdog():
        next_display=time.monotonic()+1
        while not stopping.wait(.05):
            with lock:
                if (keys or buttons) and time.monotonic()-last>.5:state({})
                if (keys or buttons) and isinstance(api,Windows) and api.scope.scope['kind']=='window':api.refresh()
                if time.monotonic()>=next_display:
                    previous=(api.width,api.height);api.refresh();next_display=time.monotonic()+1
                    if getattr(api,'scope_lost',False):
                        state({});print(json.dumps({'event':'scope-lost'}),flush=True);return
                    if previous!=(api.width,api.height):
                        state({})
                        print(json.dumps({'event':'display','display':{'width':api.width,'height':api.height}}),flush=True)
    watcher=threading.Thread(target=watchdog,daemon=True);watcher.start()
    print(json.dumps({'ready':True,'relativeMouse':hasattr(api,'relative'),'display':{'width':api.width,'height':api.height}}),flush=True)
    try:
        for line in sys.stdin:
            value=json.loads(line)
            with lock:
                if value.get('type')=='state':state(value)
                elif value.get('type')=='scope':
                    state({})
                    try:
                        scope=value.get('scope',{})
                        if hasattr(api,'set_scope'):api.set_scope(scope)
                        elif scope.get('kind')!='desktop':raise ValueError('Window mouse scope is unavailable on this platform')
                        print(json.dumps({'event':'scope','requestId':value.get('requestId'),'display':{'width':api.width,'height':api.height}}),flush=True)
                    except Exception as error:print(json.dumps({'event':'scope','requestId':value.get('requestId'),'error':str(error)}),flush=True)
                elif value.get('type')=='event':
                    if value.get('event')=='move':api.move(max(0,min(1,float(value['x']))),max(0,min(1,float(value['y']))))
                    elif value.get('event')=='relative' and hasattr(api,'relative'):api.relative(max(-500,min(500,float(value.get('dx',0)))),max(-500,min(500,float(value.get('dy',0)))))
                    elif value.get('event')=='wheel':api.wheel(max(-1200,min(1200,float(value.get('dx',0)))),max(-1200,min(1200,float(value.get('dy',0)))))
                    elif value.get('event')=='repeat' and value.get('code') in keys:api.key(value['code'],True,keys)
    finally:
        stopping.set()
        with lock:state({})
        watcher.join(timeout=1)
        if hasattr(api,'close'):api.close()

if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'ready':False,'error':str(error)}),flush=True);sys.exit(1)
