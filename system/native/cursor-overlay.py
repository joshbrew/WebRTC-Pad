"""Windows guest cursors. Tiny click-through windows; never inject input or take focus."""
import ctypes
import colorsys
from ctypes import wintypes as W
import json
import os
import queue
import re
import sys
import threading
import time
import tkinter as tk

if sys.platform != 'win32':
    raise RuntimeError('Desktop cursor overlays currently require Windows. In-app cursors work on all platforms.')
u = ctypes.WinDLL('user32', use_last_error=True)
u.GetParent.argtypes = [W.HWND]; u.GetParent.restype = W.HWND
u.GetWindowLongW.argtypes = [W.HWND, ctypes.c_int]; u.GetWindowLongW.restype = ctypes.c_long
u.SetWindowLongW.argtypes = [W.HWND, ctypes.c_int, ctypes.c_long]; u.SetWindowLongW.restype = ctypes.c_long
u.SetWindowPos.argtypes = [W.HWND, W.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.UINT]
u.SetWindowDisplayAffinity.argtypes = [W.HWND, W.DWORD]
u.GetClientRect.argtypes = [W.HWND, ctypes.POINTER(W.RECT)]
u.ClientToScreen.argtypes = [W.HWND, ctypes.POINTER(W.POINT)]
u.IsWindowVisible.argtypes = [W.HWND]; u.IsIconic.argtypes = [W.HWND]
u.GetForegroundWindow.restype = W.HWND
try:
    u.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    u.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
except AttributeError:
    u.SetProcessDPIAware()
root = tk.Tk(); root.withdraw()
original_focus = u.GetForegroundWindow()
messages = queue.Queue(maxsize=512)
stopped = threading.Event()
cursors = {}
target = int(os.environ.get('NATIVE_WINDOW_HANDLE') or '0')
def read():
    try:
        for line in sys.stdin:
            if len(line) > 4096: continue
            try: messages.put(json.loads(line), timeout=.1)
            except (ValueError, queue.Full): continue
    finally: stopped.set()
threading.Thread(target=read, daemon=True).start()

def bounds():
    if target:
        rect, point = W.RECT(), W.POINT()
        if not u.IsWindowVisible(target) or u.IsIconic(target) or not u.GetClientRect(target, ctypes.byref(rect)) or not u.ClientToScreen(target, ctypes.byref(point)): return None
        return point.x, point.y, rect.right, rect.bottom
    return 0, 0, u.GetSystemMetrics(0), u.GetSystemMetrics(1)

def make():
    win = tk.Toplevel(root); win.withdraw(); win.overrideredirect(True)
    win.configure(bg='#010101'); win.attributes('-transparentcolor', '#010101'); win.attributes('-topmost', True)
    canvas = tk.Canvas(win, width=170, height=58, bg='#010101', highlightthickness=0)
    canvas.pack(); win.update_idletasks()
    hwnd = u.GetParent(win.winfo_id()) or win.winfo_id()
    style = u.GetWindowLongW(hwnd, -20) | 0x80000 | 0x20 | 0x80 | 0x8000000
    u.SetWindowLongW(hwnd, -20, style)  # layered, click-through, tool window, no activation
    excluded = bool(u.SetWindowDisplayAffinity(hwnd, 0x11))
    return {'window': win, 'canvas': canvas, 'hwnd': hwnd, 'excluded': excluded, 'at': 0, 'visible': False, 'last': None}

def tick():
    if stopped.is_set(): root.destroy(); return
    for _ in range(512):
        try: msg = messages.get_nowait()
        except queue.Empty: break
        ident = msg.get('id')
        if msg.get('type') == 'clear':
            for c in cursors.values(): c['window'].destroy()
            cursors.clear()
        elif msg.get('type') == 'remove':
            c = cursors.pop(ident, None)
            if c: c['window'].destroy()
        elif msg.get('type') == 'cursor' and isinstance(ident, str) and len(ident) <= 64:
            x, y = msg.get('x'), msg.get('y')
            if not all(isinstance(n, (int,float)) and 0 <= n <= 1 for n in (x,y)): continue
            if ident not in cursors:
                if len(cursors) >= 128: continue
                cursors[ident] = make()
            cursors[ident].update(msg, at=time.monotonic())
        elif msg.get('type') == 'labels':
            for c in cursors.values(): c['labels'] = msg.get('enabled') is True; c['last'] = None
        elif msg.get('type') == 'inspect':
            print(json.dumps({'event':'inspect','focusUnchanged':u.GetForegroundWindow()==original_focus,'cursors':[{'id':i,'visible':bool(u.IsWindowVisible(c['hwnd'])),'items':len(c['canvas'].find_all()),'style':u.GetWindowLongW(c['hwnd'],-20),'captureExcluded':c['excluded']} for i,c in cursors.items()]}), flush=True)
    area = bounds()
    for c in cursors.values():
        visible = bool(area and c.get('visible', True) and time.monotonic()-c['at'] < 4)
        if not visible: c['window'].withdraw(); continue
        left, top, width, height = area
        color = c.get('color', '#c8f79c')
        hsl = re.fullmatch(r'hsl\((\d{1,3}) 85% 70%\)', color) if isinstance(color,str) else None
        if hsl:
            rgb = colorsys.hls_to_rgb(int(hsl[1]) % 360 / 360, .70, .85)
            color = '#' + ''.join(f'{round(v*255):02x}' for v in rgb)
        if not isinstance(color,str) or len(color)!=7 or color[0]!='#' or any(v not in '0123456789abcdefABCDEF' for v in color[1:]): color='#c8f79c'
        drawing = (color, c.get('pressed') is True, c.get('label','') if c.get('labels') else '')
        if drawing != c['last']:
            cv=c['canvas']; cv.delete('all')
            cv.create_polygon(2,2,2,25,8,19,14,30,19,27,13,17,23,17, fill=color, outline='white' if drawing[1] else '#17251d', width=2)
            if drawing[2]: cv.create_text(28,12,text=str(drawing[2])[:32],anchor='w',fill=color,font=('Segoe UI',11,'bold'))
            c['last']=drawing
        x=left+round(c['x']*max(0,width-1)); y=top+round(c['y']*max(0,height-1))
        if c.get('position') != (x,y) or not u.IsWindowVisible(c['hwnd']):
            c['window'].geometry(f'170x58{x:+d}{y:+d}')
            c['window'].deiconify()
            u.SetWindowPos(c['hwnd'], W.HWND(-1), x, y, 170, 58, 0x10 | 0x40)
            c['position'] = (x,y)
    root.after(33, tick)

print(json.dumps({'ready':True,'platform':'win32','target':'window' if target else 'primary-display'}), flush=True)
root.after(0,tick)
root.mainloop()
