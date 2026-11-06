import importlib.util
from pathlib import Path
import unittest
import os
import threading
import time
spec=importlib.util.spec_from_file_location('portal',Path(__file__).resolve().parent.parent/'native'/'wayland_portal.py')
portal=importlib.util.module_from_spec(spec);spec.loader.exec_module(portal)
class Fake:
    closed=False
    def __init__(self,denied=False):self.calls=[];self.denied=denied
    def request(self,interface,method,signature,values,options):
        self.calls.append((method,options))
        if method=='CreateSession':return {'session_handle':'/test/session'}
        if method=='Start':return {'devices':1 if self.denied else 3,'streams':[(14,{'size':(3840,2160),'logical_size':(1920,1080)})]}
        return {}
    def observe(self,session):self.session=session
    def notify(self,*args):self.calls.append(args)
    def close(self):self.closed=True
class Tests(unittest.TestCase):
    def test_granted_screen_coordinates_input_and_cleanup(self):
        fake=Fake();backend=portal.PortalDesktop(fake)
        self.assertEqual((backend.width,backend.height),(1920,1080))
        backend.move(.5,.5);self.assertFalse(any(c[0]=='NotifyPointerMotionAbsolute' for c in fake.calls))
        with self.assertRaises(RuntimeError):backend.set_scope({'kind':'window'})
        backend.set_scope({'kind':'desktop'});backend.move(1,1);self.assertEqual(fake.calls[-1],('NotifyPointerMotionAbsolute','(oa{sv}udd)',14,1919,1079))
        backend.relative(3,-4);self.assertEqual(fake.calls[-1][0],'NotifyPointerMotion')
        backend.key('KeyA',True,set());self.assertEqual(fake.calls[-1][-2:],(97,1))
        backend.key('KeyA',False,set());backend.button(2,True);self.assertEqual(fake.calls[-1][-2:],(273,1))
        fake.closed=True;backend.refresh();self.assertTrue(backend.scope_lost);backend.close()
    def test_partial_or_denied_grants_fail_closed(self):
        fake=Fake(True)
        with self.assertRaises(RuntimeError):portal.PortalDesktop(fake)
        self.assertTrue(fake.closed)
    @unittest.skipUnless(os.environ.get('PAD_TEST_PORTAL')=='1','Private D-Bus acceptance is opt-in; never connect a test portal to the desktop bus')
    def test_private_dbus_request_response_and_input_protocol(self):
        from gi.repository import Gio, GLib
        self.assertEqual(os.environ.get('PAD_PRIVATE_PORTAL'),'1','Run only inside a dedicated dbus-run-session')
        bus=Gio.DBusConnection.new_for_address_sync(os.environ['DBUS_SESSION_BUS_ADDRESS'],Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT|Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,None,None)
        bus.call_sync('org.freedesktop.DBus','/org/freedesktop/DBus','org.freedesktop.DBus','RequestName',GLib.Variant('(su)',(portal.DEST,0)),None,Gio.DBusCallFlags.NONE,1000,None)
        calls=[];session='/org/freedesktop/portal/desktop/session/test/pad'
        definitions={portal.REMOTE:{'CreateSession':['a{sv}'],'SelectDevices':['o','a{sv}'],'Start':['o','s','a{sv}'],'NotifyPointerMotionAbsolute':['o','a{sv}','u','d','d'],'NotifyPointerMotion':['o','a{sv}','d','d'],'NotifyPointerButton':['o','a{sv}','i','u'],'NotifyKeyboardKeysym':['o','a{sv}','i','u'],'NotifyPointerAxis':['o','a{sv}','d','d']},portal.SCREEN:{'SelectSources':['o','a{sv}']},'org.freedesktop.portal.Session':{'Close':[]}}
        registrations=[]
        def method(connection,sender,path,interface,name,parameters,invocation):
            values=parameters.unpack();calls.append((name,values))
            if name.startswith('Notify') or name=='Close':invocation.return_value(GLib.Variant('()',()));return
            token=values[-1]['handle_token'];handle='/org/freedesktop/portal/desktop/request/'+sender[1:].replace('.','_')+'/'+token
            invocation.return_value(GLib.Variant('(o)',(handle,)))
            reply={'session_handle':GLib.Variant('o',session)} if name=='CreateSession' else {'devices':GLib.Variant('u',3),'streams':GLib.Variant('a(ua{sv})',[(42,{'size':GLib.Variant('(ii)',(1920,1080))})])} if name=='Start' else {}
            def respond():connection.emit_signal(sender,handle,'org.freedesktop.portal.Request','Response',GLib.Variant('(ua{sv})',(0,reply)));return False
            GLib.idle_add(respond)
        for interface,methods in definitions.items():
            xml='<node><interface name="'+interface+'">'+''.join('<method name="'+name+'">'+''.join('<arg type="'+sig+'" direction="in"/>' for sig in args)+('' if name.startswith('Notify') or name=='Close' else '<arg type="o" direction="out"/>')+'</method>' for name,args in methods.items())+'</interface></node>'
            info=Gio.DBusNodeInfo.new_for_xml(xml).interfaces[0];registrations.append(bus.register_object(session if interface.endswith('Session') else portal.PATH,info,method,None,None))
        service_loop=GLib.MainLoop();thread=threading.Thread(target=service_loop.run,daemon=True);thread.start();backend=None
        try:
            backend=portal.PortalDesktop();backend.set_scope({'kind':'desktop'});backend.move(.5,.5);backend.relative(3,-2);backend.button(0,True);backend.button(0,False);backend.key('KeyA',True,set());backend.key('KeyA',False,set());backend.wheel(0,120)
            self.assertTrue(any(name=='NotifyPointerMotionAbsolute' and values[-2:]==(959.5,539.5) for name,values in calls))
            self.assertTrue(any(name=='NotifyKeyboardKeysym' and values[-2:]==(97,1) for name,values in calls))
            bus.emit_signal(None,session,'org.freedesktop.portal.Session','Closed',GLib.Variant('(a{sv})',({},)))
            deadline=time.time()+2
            while not backend.portal.closed and time.time()<deadline:time.sleep(.01)
            backend.refresh();self.assertTrue(backend.scope_lost)
        finally:
            if backend:backend.close()
            service_loop.quit()
            for registration in registrations:bus.unregister_object(registration)
            bus.close_sync(None)
if __name__=='__main__':unittest.main()
