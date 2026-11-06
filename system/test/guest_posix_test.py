"""Portable state/adapter tests. No real input device is opened or suppressed."""
import os
import json
from pathlib import Path
import signal
import struct
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
from guest_input_common import DeviceState, Snapshot, Session, normalize
from guest_input_linux import LinuxInput, bitmap
from guest_input_macos import MacInput

class Adapter:
    def __init__(self):self.selected=[];self.events=[];self.closed=0;self.fail=False
    def inventory(self):return [{'id':d,'available':True} for d in ('keyboard:1','keyboard:2','mouse:1','pad:1')],[]
    def open(self,ids):
        self.selected=[DeviceState(d,d,'gamepad' if d.startswith('pad') else d.split(':')[0]) for d in ids]
        if self.fail:raise OSError('second device denied')
        return self.selected
    def identify(self):pass
    def close(self):self.selected=[];self.closed+=1
    def poll(self):events,self.events=self.events,[];return events
    def apply(self,d,event,s):
        key,value=event
        if value:d.keys.add(key)
        else:d.keys.discard(key)
        return True

class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.now=100.;self.adapter=Adapter();self.messages=[]
        self.session=Session(self.adapter,self.messages.append,lambda:self.now)
        self.session.command({'type':'list'})
    def start(self,ids):self.session.command({'type':'start','devices':ids})
    def test_partial_start_and_invalid_selection_roll_back(self):
        for ids in ([],['unknown'],['keyboard:1','keyboard:1']):
            with self.assertRaises(ValueError):self.start(ids)
        self.adapter.fail=True
        with self.assertRaises(OSError):self.start(['keyboard:1','mouse:1'])
        self.assertEqual(self.session.selected,[]);self.assertEqual(self.adapter.selected,[])
    def test_lease_fast_keys_and_independent_keyboards(self):
        self.start(['keyboard:1','keyboard:2']);a,b=self.session.selected
        self.adapter.events=[(a,('KeyA',1)),(a,('KeyA',0)),(b,('KeyA',1))];self.session.step()
        states=[m['keys'] for m in self.messages if m['type']=='state'];self.assertEqual(states[:3],[['KeyA'],[],['KeyA']])
        self.now+=1;self.session.command({'type':'heartbeat'});self.now+=1;self.session.step();self.assertTrue(self.session.selected)
        self.now+=.6;self.session.step();self.assertEqual(self.session.selected,[]);self.assertEqual(self.messages[-1]['type'],'released')
    def test_emergency_releases_selected_devices(self):
        self.start(['keyboard:1']);a=self.session.selected[0]
        self.adapter.events=[(a,('ControlLeft',1)),(a,('AltRight',1)),(a,('Escape',1))];self.session.step()
        self.assertEqual(self.session.selected,[]);self.assertIn('Emergency',self.messages[-1]['reason'])
    def test_gamepad_sampling_targets_eight_milliseconds(self):
        self.start(['pad:1']);self.session.step()
        before=len([m for m in self.messages if m['type']=='state'])
        self.now+=.004;self.session.step()
        self.assertEqual(len([m for m in self.messages if m['type']=='state']),before)
        self.now+=.0041;self.session.step()
        self.assertEqual(len([m for m in self.messages if m['type']=='state']),before+1)
    def test_identification_does_not_seize_and_throttles_activity(self):
        self.session.command({'type':'identify'});d=DeviceState('mouse:1','mouse','mouse')
        self.adapter.events=[(d,('x',1))]*100;self.session.step()
        self.assertEqual(len([m for m in self.messages if m['type']=='activity']),1)
        self.now+=1.6;self.session.step();self.assertFalse(self.session.identifying)

class LinuxTests(unittest.TestCase):
    def setUp(self):
        self.api=LinuxInput.__new__(LinuxInput);self.api.opened={};self.api.records={}
        # Linux flags are absent when these adapter tests run on Windows.
        for name in ('O_NONBLOCK','O_CLOEXEC'):
            mocked=patch.object(os,name,getattr(os,name,0),create=True);mocked.start();self.addCleanup(mocked.stop)
    def test_standard_controller_normalization_and_hat(self):
        self.assertEqual(bitmap('1 0'),1<<64)
        d=DeviceState('pad:1','Pro','gamepad',standard=True,axes=[(0,(-32768,32767)),(2,(0,255)),(16,(-1,1)),(17,(-1,1))]);s=Snapshot()
        self.api.apply(d,(1,304,1),s);self.api.apply(d,(3,0,32767),s);self.api.apply(d,(3,2,255),s);self.api.apply(d,(3,17,-1),s)
        gp=d.gamepad(0);self.assertEqual(gp['axes'][0],1);self.assertEqual(gp['buttons'][6]['value'],1);self.assertTrue(gp['buttons'][0]['pressed']);self.assertTrue(gp['buttons'][12]['pressed'])
    def test_mouse_union_and_fast_key_repeat(self):
        a,b=DeviceState('mouse:1','a','mouse'),DeviceState('mouse:2','b','mouse');k=DeviceState('keyboard:1','k','keyboard');s=Snapshot()
        self.api.apply(a,(1,0x110,1),s);self.api.apply(b,(1,0x110,1),s);self.api.apply(a,(1,0x110,0),s)
        self.api.apply(b,(2,0,20),s);self.api.apply(b,(2,8,1),s);self.api.apply(k,(1,30,1),s);self.api.apply(k,(1,30,2),s)
        frame=s.take([a,b,k]);self.assertEqual(frame['mouse']['buttons'],[0]);self.assertEqual(frame['mouse']['dx'],20);self.assertEqual(frame['mouse']['wheelY'],-120);self.assertEqual(frame['repeats'],['KeyA']);self.assertEqual(s.take([a,b,k])['mouse']['dx'],0)
    def test_selected_grab_and_partial_failure_release(self):
        class Folder:
            def resolve(self):return '/device'
        info=type('Info',(),{'st_rdev':2,'st_ino':3})()
        self.api.records={d:{'path':d,'folder':Folder(),'fingerprint':('/device',2,3),'label':d,'profile':d,'kind':'keyboard','caps':{'abs':0,'key':0}} for d in ('a','b','untouched')}
        calls=[]
        def ioctl(fd,code,value):
            calls.append((fd,code,value))
            if fd==11 and value==1:raise OSError('busy')
        self.api.ioctl=ioctl;self.api.read_ioctl=lambda *args:bytes(96)
        with patch('guest_input_linux.os.open',side_effect=[10,11]) as opened,patch('guest_input_linux.os.fstat',return_value=info),patch('guest_input_linux.os.close') as closed:
            with self.assertRaises(OSError):self.api.open(['a','b'])
            self.assertEqual([c.args[0] for c in opened.call_args_list],['a','b']);self.assertEqual(self.api.opened,{})
            self.assertIn((10,0x40044590,0),calls);self.assertEqual({c.args[0] for c in closed.call_args_list},{10,11})
    def test_stale_device_is_never_grabbed(self):
        class Folder:
            def resolve(self):return '/changed'
        self.api.records={'a':{'path':'a','folder':Folder(),'fingerprint':('/old',2,3)}};self.api.ioctl=lambda *a:self.fail('must not grab')
        info=type('Info',(),{'st_rdev':2,'st_ino':4})()
        with patch('guest_input_linux.os.open',return_value=10),patch('guest_input_linux.os.fstat',return_value=info),patch('guest_input_linux.os.close'):
            with self.assertRaisesRegex(RuntimeError,'reconnected'):self.api.open(['a'])

def element(page,usage,low=0,high=1):return {'page':page,'usage':usage,'cookie':usage,'low':low,'high':high,'relative':False}
class HID:
    def __init__(self):
        self.records={};self.calls=[];self.events=[];self.fail=None;self.closed=0
        for kind,elements in [('keyboard',[element(7,4)]),('mouse',[element(9,1)]),('gamepad',[element(9,1),element(1,48,-127,127),element(1,57,0,7)])]:
            identity=('pad' if kind=='gamepad' else kind)+':1';self.records[identity]={'id':identity,'kind':kind,'label':kind,'available':True,'detail':'test','profile':kind,'elements':elements}
    def devices(self):return self.records,[]
    def open(self,record,exclusive):
        self.calls.append((record['id'],exclusive))
        if record['id']==self.fail:raise OSError('seize denied')
        return []
    def close(self):self.closed+=1
    def poll(self):events,self.events=self.events,[];return events
    def dispose(self):pass
class MacTests(unittest.TestCase):
    def setUp(self):self.hid=HID();self.api=MacInput(self.hid);self.api.inventory()
    def test_only_selected_seized_and_no_passthrough_fallback_on_denial(self):
        self.hid.fail='mouse:1'
        with self.assertRaises(OSError):self.api.open(['keyboard:1','mouse:1'])
        self.assertEqual(self.hid.calls,[('keyboard:1',True),('mouse:1',True)]);self.assertEqual(self.api.opened,{})
        self.hid.calls=[];self.hid.fail=None;self.api.identify();self.assertEqual(self.hid.calls,[('keyboard:1',False),('mouse:1',False)])
    def test_raw_pad_keyboard_mouse_and_removal(self):
        k,m,p=self.api.open(['keyboard:1','mouse:1','pad:1']);s=Snapshot()
        self.api.apply(k,(7,4,4,1,0,1,False),s);self.api.apply(m,(9,1,1,1,0,1,False),s);self.api.apply(m,(1,48,48,30,0,100,True),s)
        self.api.apply(p,(9,1,1,1,0,1,False),s);self.api.apply(p,(1,48,48,127,-127,127,False),s);self.api.apply(p,(1,57,57,0,0,7,False),s)
        frame=s.take([k,m,p]);self.assertEqual(frame['keys'],['KeyA']);self.assertEqual(frame['mouse']['buttons'],[0]);self.assertEqual(frame['mouse']['dx'],30)
        self.assertEqual(frame['gamepads'][0]['mapping'],'');self.assertEqual(frame['gamepads'][0]['axes'],[1]);self.assertTrue(frame['gamepads'][0]['buttons'][0]['pressed']);self.assertTrue(frame['gamepads'][0]['buttons'][1]['pressed'])
        self.hid.events=[('pad:1',None)]
        with self.assertRaisesRegex(RuntimeError,'disconnected'):self.api.poll()

@unittest.skipUnless(sys.platform in ('linux','darwin'),'POSIX process groups only')
class GuardianTests(unittest.TestCase):
    def test_native_reader_lists_and_exits_without_seizing_devices(self):
        helper=str(Path(__file__).resolve().parents[1]/'native/guest-input-posix.py')
        child=subprocess.run([sys.executable,'-B',helper],input='',text=True,capture_output=True,start_new_session=True,timeout=15)
        self.assertEqual(child.returncode,0,child.stderr+child.stdout)
        messages=[json.loads(line) for line in child.stdout.splitlines()]
        self.assertEqual(messages[0]['type'],'devices');self.assertEqual(messages[1]['type'],'ready')
        self.assertFalse(any(m['type']=='active' for m in messages))
    def test_stalled_reader_killed_but_healthy_reader_stays(self):
        common=str(Path(__file__).resolve().parents[1]/'native/guest_input_common.py')
        # A harmless private process group, no real device handles or captures.
        script='import subprocess,sys,os,time; p=subprocess.Popen([sys.executable,sys.argv[1],"--guard",str(os.getpid())],stdin=subprocess.PIPE); print("ready",flush=True); '+('p.stdin.write(b"ok\\n"); p.stdin.flush(); time.sleep(.2); '*12)+'time.sleep(10)'
        child=subprocess.Popen([sys.executable,'-c',script,common],start_new_session=True,stdout=subprocess.PIPE,text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(),'ready');time.sleep(2);self.assertIsNone(child.poll());child.wait(timeout=6);self.assertEqual(child.returncode,-signal.SIGKILL)
        finally:
            if child.poll() is None:os.killpg(child.pid,signal.SIGKILL);child.wait()
            child.stdout.close()

if __name__=='__main__':unittest.main()
