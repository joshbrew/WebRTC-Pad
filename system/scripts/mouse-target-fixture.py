"""Harmless local windows for real WebRTC mouse input acceptance checks."""
import tkinter as tk
import json
import os
import ctypes as c
from ctypes import wintypes as w
import threading
import queue
import sys
import time
u=c.WinDLL('user32');u.GetParent.argtypes=[w.HWND];u.GetParent.restype=w.HWND
u.ClientToScreen.argtypes=[w.HWND,c.POINTER(w.POINT)]
try:u.SetProcessDpiAwarenessContext.argtypes=[c.c_void_p];u.SetProcessDpiAwarenessContext(c.c_void_p(-4))
except AttributeError:pass
root=tk.Tk();root.title('WebRTC Mouse Test A');root.geometry('600x440+60+120');root.attributes('-topmost',True)
other=tk.Toplevel(root);other.title('WebRTC Mouse Test B');other.geometry('600x400+60+700');other.attributes('-topmost',True)
counts={'A':0,'B':0};windows={'A':root,'B':other};buttons={};labels={};commands=queue.Queue();last_command=None
def report(value):print(json.dumps(value),flush=True)
def clicked(name):
    counts[name]+=1;buttons[name].configure(text=f'{name}: {counts[name]} real OS clicks received');report({'event':'click','name':name,'count':counts[name]})
for name,win in windows.items():
    label=tk.Label(win,text='Safe test target · remote clicks only',font=('Segoe UI',16));label.pack(pady=20);labels[name]=label
    button=tk.Button(win,text=f'{name}: click to test',command=lambda name=name:clicked(name),font=('Segoe UI',20),bg='#c8f79c');button.pack(expand=True,fill='both',padx=60,pady=50);buttons[name]=button
def status():
    result={}
    for name,win in windows.items():
        win.update_idletasks();h=u.GetParent(win.winfo_id()) or win.winfo_id();point=w.POINT();u.ClientToScreen(h,c.byref(point));b=buttons[name]
        result[name]={'id':str(h),'pid':os.getpid(),'width':win.winfo_width(),'height':win.winfo_height(),'left':point.x,'top':point.y,'x':b.winfo_x()+b.winfo_width()/2,'y':b.winfo_y()+b.winfo_height()/2}
    report({'event':'ready','windows':result,'counts':counts,'command':last_command})
def reader():
    for line in sys.stdin:
        try:commands.put(json.loads(line))
        except ValueError:pass
    commands.put({'type':'close'})
threading.Thread(target=reader,daemon=True).start()
def tick():
    global last_command
    for label in labels.values():label.configure(text=f'Safe click target · {time.time():.2f}')
    while not commands.empty():
        value=commands.get()
        last_command=value.get('type')
        if value.get('type')=='close':root.destroy();return
        if value.get('type')=='move':root.geometry('560x400+180+180')
        if value.get('type')=='cover':other.deiconify();other.geometry(f'{root.winfo_width()}x{root.winfo_height()}+{root.winfo_x()}+{root.winfo_y()}');other.lift()
        if value.get('type')=='uncover':other.geometry('600x400+60+700')
        root.after(100,status)
    root.after(30,tick)
root.after(200,status);root.after(30,tick);root.mainloop()
