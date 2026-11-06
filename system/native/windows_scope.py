"""Window identity, capture targets and mouse boundaries for the Windows host."""
import ctypes as c
from ctypes import wintypes as w
import json

class WindowsScope:
    def __init__(self):
        self.u=c.WinDLL('user32',use_last_error=True)
        try:
            self.u.SetProcessDpiAwarenessContext.argtypes=[c.c_void_p];self.u.SetProcessDpiAwarenessContext(c.c_void_p(-4))
        except AttributeError:self.u.SetProcessDPIAware()
        self.u.GetWindowThreadProcessId.argtypes=[w.HWND,c.POINTER(w.DWORD)]
        self.u.GetClientRect.argtypes=[w.HWND,c.POINTER(w.RECT)]
        self.u.GetWindowRect.argtypes=[w.HWND,c.POINTER(w.RECT)]
        self.u.ClientToScreen.argtypes=[w.HWND,c.POINTER(w.POINT)]
        self.u.IsWindowVisible.argtypes=[w.HWND];self.u.IsIconic.argtypes=[w.HWND]
        self.u.GetWindowTextLengthW.argtypes=[w.HWND]
        self.u.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,c.c_int]
        self.u.GetWindowLongW.argtypes=[w.HWND,c.c_int]
        self.u.GetForegroundWindow.restype=w.HWND
        self.u.GetAncestor.argtypes=[w.HWND,w.UINT];self.u.GetAncestor.restype=w.HWND
        self.u.GetCursorPos.argtypes=[c.POINTER(w.POINT)]
        self.dwm=c.WinDLL('dwmapi');self.dwm.DwmGetWindowAttribute.argtypes=[w.HWND,w.DWORD,c.c_void_p,w.DWORD]
        self.callback=c.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
        self.u.EnumWindows.argtypes=[self.callback,w.LPARAM]
        self.scope={'kind':'none'}
    def pid(self,handle):
        pid=w.DWORD();self.u.GetWindowThreadProcessId(handle,c.byref(pid));return pid.value
    def rect(self,handle,client=True):
        rect=w.RECT();point=w.POINT()
        cloaked=w.DWORD()
        if self.dwm.DwmGetWindowAttribute(handle,14,c.byref(cloaked),c.sizeof(cloaked))==0 and cloaked.value:return None
        if not self.u.IsWindowVisible(handle) or self.u.IsIconic(handle):return None
        if client:
            if not self.u.GetClientRect(handle,c.byref(rect)) or not self.u.ClientToScreen(handle,c.byref(point)):return None
            result=(point.x,point.y,rect.right,rect.bottom)
        else:
            if not self.u.GetWindowRect(handle,c.byref(rect)):return None
            result=(rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top)
        return result if result[2]>0 and result[3]>0 else None
    def targets(self):
        result=[{'kind':'desktop','id':'desktop','label':'Entire primary screen','width':self.u.GetSystemMetrics(0),'height':self.u.GetSystemMetrics(1)}]
        @self.callback
        def visit(handle,_):
            size=self.u.GetWindowTextLengthW(handle);rect=self.rect(handle)
            if size and rect and not self.u.GetWindowLongW(handle,-20)&0x20:
                title=c.create_unicode_buffer(size+1);self.u.GetWindowTextW(handle,title,len(title))
                result.append({'kind':'window','id':str(handle),'pid':self.pid(handle),'label':title.value[:200],'width':rect[2],'height':rect[3]})
            return True
        self.u.EnumWindows(visit,0);return result
    def set(self,value):
        kind=value.get('kind')
        if kind not in ('none','desktop','window'):raise ValueError('Invalid mouse scope')
        if kind=='window':
            handle=int(value.get('id','0'))
            if not handle or self.pid(handle)!=value.get('pid') or not self.rect(handle):raise ValueError('Shared window closed or changed; select it again')
        region=value.get('region')
        if region is not None:
            if kind!='window' or not isinstance(region,dict) or any(type(region.get(k)) is not int for k in ('x','y','width','height')):raise ValueError('Invalid window area')
            rect=self.rect(handle)
            if region['x']<0 or region['y']<0 or region['width']<2 or region['height']<2 or region['x']+region['width']>rect[2] or region['y']+region['height']>rect[3]:raise ValueError('Selected area is outside the window')
        self.region_size=rect[2:] if region is not None else None
        self.scope=dict(value)
    def bounds(self):
        if self.scope['kind']=='window':
            handle=int(self.scope['id'])
            rect=self.rect(handle) if self.pid(handle)==self.scope.get('pid') else None
            region=self.scope.get('region')
            if rect and region:
                if getattr(self,'region_size',None) and rect[2:]!=self.region_size:return None
                if region['x']+region['width']>rect[2] or region['y']+region['height']>rect[3]:return None
                return (rect[0]+region['x'],rect[1]+region['y'],region['width'],region['height'])
            return rect
        return (0,0,self.u.GetSystemMetrics(0),self.u.GetSystemMetrics(1))
    def hit(self,x,y):
        if self.scope['kind']=='none':return False
        if self.scope['kind']=='desktop':return True
        bounds=self.bounds()
        if not bounds or not (bounds[0]<=x<bounds[0]+bounds[2] and bounds[1]<=y<bounds[1]+bounds[3]):return False
        target=int(self.scope['id']);found=[]
        @self.callback
        def visit(handle,_):
            if self.u.GetWindowLongW(handle,-20)&0x20:return True
            rect=self.rect(handle,False)
            if rect and rect[0]<=x<rect[0]+rect[2] and rect[1]<=y<rect[1]+rect[3]:found.append(handle);return False
            return True
        self.u.EnumWindows(visit,0)
        return bool(found and found[0]==target and self.pid(target)==self.scope.get('pid'))
    def pointer_allowed(self):
        point=w.POINT();self.u.GetCursorPos(c.byref(point));return self.hit(point.x,point.y)
    def key_allowed(self,code=None,keys=None):
        if self.scope['kind']=='window' and code:
            keys=keys or set()
            alt=bool(keys & {'AltLeft','AltRight'})
            control=bool(keys & {'ControlLeft','ControlRight'})
            if code.startswith('Meta') or alt and code in ('Tab','Escape') or control and code=='Escape' or control and alt and code=='Delete':return False
        return self.scope['kind']=='desktop' or self.scope['kind']=='window' and bool(self.bounds()) and self.pid(int(self.scope['id']))==self.scope.get('pid') and self.u.GetAncestor(self.u.GetForegroundWindow(),2)==int(self.scope['id'])

if __name__=='__main__':print(json.dumps(WindowsScope().targets()),flush=True)
