"""Exercise Linux device lifecycle with a recording uinput adapter, not kernel devices."""
import importlib.util
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time

if '--child' in sys.argv:
    spec=importlib.util.spec_from_file_location('gamepad',Path(__file__).resolve().parents[1]/'native/linux-gamepad.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    class Pad:
        def __init__(self,name):
            self.name=name;self.updated=0
            if name.endswith('p9'):raise PermissionError('Fixture device denied')
            self.apply({})
        def apply(self,state):print(json.dumps({'event':'state','slot':self.name,'state':state}),flush=True)
        def close(self):self.apply({});print(json.dumps({'event':'closed','slot':self.name}),flush=True)
    module.Pad=Pad;sys.argv=['helper','0'];module.main();sys.exit(0)

process=subprocess.Popen([sys.executable,__file__,'--child'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
messages=queue.Queue();events=[]
def read():
    for line in process.stdout:messages.put(line.strip())
threading.Thread(target=read,daemon=True).start()
def wait(predicate):
    end=time.monotonic()+4
    while time.monotonic()<end:
        value=messages.get(timeout=4)
        if value!='READY':value=json.loads(value);events.append(value)
        if predicate(value):return value
    raise RuntimeError('Protocol timed out')
def post(message):process.stdin.write(json.dumps(message)+'\n');process.stdin.flush()
try:
    wait(lambda v:v=='READY')
    post({'type':'add','slot':'p3','id':1});assert 'error' not in wait(lambda v:isinstance(v,dict) and v.get('id')==1)
    post({'slot':'p3','state':{'buttons':{'a':True}}});wait(lambda v:isinstance(v,dict) and v.get('state',{}).get('buttons',{}).get('a'))
    post({'type':'add','slot':'p9','id':2});assert 'denied' in wait(lambda v:isinstance(v,dict) and v.get('id')==2)['error']
    wait(lambda v:isinstance(v,dict) and v.get('slot')=='webrtc-pad-p3' and v.get('state')=={})
    post({'type':'add','slot':'p1','id':3});wait(lambda v:isinstance(v,dict) and v.get('id')==3)
    post({'type':'remove','slot':'p3','id':4});wait(lambda v:isinstance(v,dict) and v.get('id')==4)
    post({'slot':'p3','state':{'buttons':{'a':True}}})
    process.stdin.close();assert process.wait(timeout=3)==0,process.stderr.read()
    while not messages.empty():
        value=messages.get();events.append(json.loads(value))
    assert {v['slot'] for v in events if v.get('event')=='closed'}=={'webrtc-pad-p1','webrtc-pad-p3'}
    print('PASS: Linux helper dynamic add/remove acknowledgments, isolated creation failure, native watchdog, stale removed-slot rejection and EOF cleanup (recording uinput adapter)')
finally:
    if process.poll() is None:process.kill()
