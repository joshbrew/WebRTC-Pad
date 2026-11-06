"""Shared POSIX guest state and lease protocol; adapters own OS device handles."""
import json
import os
import queue
import select
import signal
import subprocess
import sys
import threading
import time

LINUX_KEYS = dict(enumerate([
    'Escape','Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0',
    'Minus','Equal','Backspace','Tab','KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP',
    'BracketLeft','BracketRight','Enter','ControlLeft','KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK',
    'KeyL','Semicolon','Quote','Backquote','ShiftLeft','Backslash','KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN',
    'KeyM','Comma','Period','Slash','ShiftRight'], 1))
LINUX_KEYS.update({56:'AltLeft',57:'Space',58:'CapsLock',87:'F11',88:'F12',96:'Enter',97:'ControlRight',
                   100:'AltRight',102:'Home',103:'ArrowUp',104:'PageUp',105:'ArrowLeft',106:'ArrowRight',
                   107:'End',108:'ArrowDown',109:'PageDown',110:'Insert',111:'Delete',125:'MetaLeft',126:'MetaRight'})
LINUX_KEYS.update({59+i:f'F{i+1}' for i in range(10)})
HID_KEYS = {4+i:f'Key{chr(65+i)}' for i in range(26)}
HID_KEYS.update({30+i:f'Digit{(i+1)%10}' for i in range(10)})
HID_KEYS.update({58+i:f'F{i+1}' for i in range(12)})
HID_KEYS.update(dict(enumerate(['Enter','Escape','Backspace','Tab','Space','Minus','Equal','BracketLeft',
    'BracketRight','Backslash',None,'Semicolon','Quote','Backquote','Comma','Period','Slash','CapsLock'],40)))
HID_KEYS.update({73:'Insert',74:'Home',75:'PageUp',76:'Delete',77:'End',78:'PageDown',79:'ArrowRight',
                80:'ArrowLeft',81:'ArrowDown',82:'ArrowUp',224:'ControlLeft',225:'ShiftLeft',226:'AltLeft',
                227:'MetaLeft',228:'ControlRight',229:'ShiftRight',230:'AltRight',231:'MetaRight'})

def normalize(value, limits, trigger=False):
    low, high = limits
    if high <= low:
        return 0.0
    unit = max(0., min(1., (value-low)/(high-low)))
    return unit if trigger else unit*2-1

class DeviceState:
    def __init__(self, identity, label, kind, *, profile=None, standard=False, buttons=(), axes=()):
        self.id, self.label, self.kind = identity, label, kind
        self.profile = profile or label
        self.standard = standard
        self.button_codes = list(buttons)
        self.axis_limits = dict(axes)
        self.values = {code:(lo if code in (2,5) and standard else (lo+hi)/2)
                       for code,(lo,hi) in self.axis_limits.items()}
        self.down = set()
        self.keys = set()
        self.mouse_buttons = set()

    def gamepad(self, index):
        if self.standard:
            mapping = [304,305,308,307,310,311,312,313,314,315,317,318,544,545,546,547,316]
            buttons = [{'pressed':code in self.down,'value':int(code in self.down)} for code in mapping]
            for button,axis in ((6,2),(7,5)):
                if axis in self.axis_limits:
                    value=normalize(self.values.get(axis,0),self.axis_limits[axis],True)
                    buttons[button]={'pressed':value>.5,'value':value}
            for button,axis,direction in ((12,17,-1),(13,17,1),(14,16,-1),(15,16,1)):
                if axis in self.axis_limits and self.values.get(axis)==direction:
                    buttons[button]={'pressed':True,'value':1}
            axes=[normalize(self.values.get(code,0),self.axis_limits[code]) if code in self.axis_limits else 0 for code in (0,1,3,4)]
        else:
            buttons=[{'pressed':code in self.down,'value':int(code in self.down)} for code in self.button_codes]
            axes=[normalize(self.values.get(code,0),limits) for code,limits in self.axis_limits.items()]
        return {'id':self.profile,'index':index,'connected':True,'mapping':'standard' if self.standard else '',
                'axes':axes,'buttons':buttons}

class Snapshot:
    def __init__(self):
        self.dx=self.dy=self.wheel_x=self.wheel_y=0
        self.x=self.y=.5
        self.absolute=False
        self.repeats=[]

    def take(self, devices):
        pads=[device.gamepad(i) for i,device in enumerate(d for d in devices if d.kind=='gamepad')]
        keys=set().union(*(d.keys for d in devices))
        buttons=set().union(*(d.mouse_buttons for d in devices))
        result={'type':'state','gamepads':pads,'keys':sorted(keys)[:32],
                'repeats':[code for code in self.repeats if code in keys][:32],
                'mouse':{'buttons':sorted(buttons),'dx':self.dx,'dy':self.dy,'x':self.x,'y':self.y,
                         'absolute':self.absolute,'wheelX':self.wheel_x,'wheelY':self.wheel_y}}
        self.dx=self.dy=self.wheel_x=self.wheel_y=0
        self.repeats=[]
        self.absolute=False
        return result

def emergency(devices):
    keys=set().union(*(d.keys for d in devices))
    return bool(keys & {'ControlLeft','ControlRight'} and keys & {'AltLeft','AltRight'} and 'Escape' in keys)

class Session:
    def __init__(self, adapter, emit, clock=time.monotonic):
        self.adapter,self.emit,self.clock=adapter,emit,clock
        self.inventory={}
        self.selected=[]
        self.identifying=False
        self.deadline=0
        self.identify_end=0
        self.snapshot=Snapshot()
        self.last_sample=0
        self.last_activity={}

    def release(self, reason='Devices released.', notify=True):
        self.adapter.close()
        self.selected=[]
        self.identifying=False
        self.snapshot=Snapshot()
        if notify:self.emit({'type':'released','reason':reason})

    def command(self, value):
        kind=value.get('type')
        if kind=='heartbeat':
            self.deadline=self.clock()+1.5
        elif kind=='list':
            self.release(notify=False)
            devices,notes=self.adapter.inventory()
            self.inventory={d['id']:d for d in devices}
            self.emit({'type':'devices','devices':devices,'notes':notes})
        elif kind=='stop':
            self.release()
        elif kind=='identify':
            self.release(notify=False)
            self.adapter.identify()
            self.identifying=True
            self.identify_end=self.clock()+10
            self.deadline=self.clock()+1.5
        elif kind=='start':
            self.release(notify=False)
            chosen=value.get('devices')
            if not isinstance(chosen,list) or not chosen or len(chosen)!=len(set(chosen)) or any(not self.inventory.get(d,{}).get('available') for d in chosen):
                raise ValueError('Refresh devices and select available devices before sharing.')
            try:
                self.selected=self.adapter.open(chosen)
                self.deadline=self.clock()+1.5
                self.emit({'type':'active','devices':chosen})
            except BaseException:
                self.release(notify=False)
                raise

    def step(self):
        if not self.selected and not self.identifying:return
        if self.clock()>self.deadline:
            self.release('Connection stopped responding. Devices released.')
            return
        if self.identifying and self.clock()>self.identify_end:
            self.release('Identification finished.')
            return
        for device,event in self.adapter.poll():
            if self.identifying:
                if self.clock()-self.last_activity.get(device.id,-1)>.1:
                    self.emit({'type':'activity','device':device.id})
                    self.last_activity[device.id]=self.clock()
                continue
            urgent=self.adapter.apply(device,event,self.snapshot)
            if emergency(self.selected):
                self.release('Emergency release: Ctrl + Alt + Esc.')
                return
            # Preserve fast key taps and mouse clicks, even within one poll.
            if urgent:self.emit(self.snapshot.take(self.selected))
        if self.selected and self.clock()-self.last_sample>=.008:
            self.emit(self.snapshot.take(self.selected))
            self.last_sample=self.clock()

def guardian(owner):
    # The reader starts in a private session. Keeping this group alive reserves
    # its identity; expiry can never target an unrelated reused process ID.
    if os.getsid(0)!=owner or os.getpgrp()!=owner:
        return 1
    while True:
        ready,_,_=select.select([sys.stdin.buffer],[],[],1.5)
        if not ready:
            os.killpg(owner,signal.SIGKILL)
        if not os.read(0,4096):return 0

def run(adapter):
    if os.getsid(0)!=os.getpid():
        try:os.setsid()
        except OSError:raise RuntimeError('Start native guest input through the local Node app.')
    guard=subprocess.Popen([sys.executable,__file__,'--guard',str(os.getpid())],stdin=subprocess.PIPE,
                           stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    commands=queue.Queue(maxsize=128)
    quit_event=threading.Event()
    def read():
        try:
            for line in sys.stdin:
                if len(line)>32768:break
                commands.put(json.loads(line),timeout=.1)
        except (ValueError,queue.Full):pass
        finally:quit_event.set()
    threading.Thread(target=read,daemon=True).start()
    def emit(value):print(json.dumps(value,separators=(',',':')),flush=True)
    session=Session(adapter,emit)
    try:
        session.command({'type':'list'})
        emit({'type':'ready'})
        last_guard=0
        while not quit_event.is_set():
            try:
                while True:session.command(commands.get_nowait())
            except queue.Empty:pass
            except Exception as error:
                session.release(notify=False)
                emit({'type':'error','error':str(error)})
            try:session.step()
            except Exception as error:
                session.release(notify=False)
                emit({'type':'released','reason':str(error)})
            if time.monotonic()-last_guard>.25:
                guard.stdin.write(b'alive\n');guard.stdin.flush();last_guard=time.monotonic()
            time.sleep(.002)
    finally:
        session.release(notify=False)
        adapter.dispose()
        guard.stdin.close()
        try:guard.wait(timeout=2)
        except subprocess.TimeoutExpired:guard.kill()

if __name__=='__main__' and len(sys.argv)==3 and sys.argv[1]=='--guard':
    sys.exit(guardian(int(sys.argv[2])))
