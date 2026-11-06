"""User-approved Wayland input through XDG RemoteDesktop/ScreenCast portals.

No saved grants, XWayland bypass, root access, window-enforcement claims or
global overlay. Browser/PipeWire sharing continues to supply the picture.
"""
import os
import threading
import uuid

REMOTE = 'org.freedesktop.portal.RemoteDesktop'
SCREEN = 'org.freedesktop.portal.ScreenCast'
PATH = '/org/freedesktop/portal/desktop'
DEST = 'org.freedesktop.portal.Desktop'

class GioPortal:
    def __init__(self):
        from gi.repository import Gio, GLib
        self.Gio, self.GLib = Gio, GLib
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.loop = GLib.MainLoop()
        self.thread = threading.Thread(target=self.loop.run, daemon=True)
        self.thread.start()
        self.session = None
        self.closed = False
    def call(self, interface, method, signature, values, path=PATH):
        return self.bus.call_sync(DEST, path, interface, method, self.GLib.Variant(signature, values), None, self.Gio.DBusCallFlags.NONE, 5000, None)
    def request(self, interface, method, signature, values, options):
        token = 'pad_' + uuid.uuid4().hex
        handle = '/org/freedesktop/portal/desktop/request/' + self.bus.get_unique_name()[1:].replace('.', '_') + '/' + token
        result, ready = [], threading.Event()
        def response(*args):
            result.append(args[5].unpack())
            ready.set()
        subscription = self.bus.signal_subscribe(DEST, 'org.freedesktop.portal.Request', 'Response', handle, None, self.Gio.DBusSignalFlags.NONE, response)
        try:
            data = {key:self.GLib.Variant(kind, value) for key, (kind, value) in options.items()}
            data['handle_token'] = self.GLib.Variant('s', token)
            self.call(interface, method, signature, (*values, data))
            if not ready.wait(45):
                try:self.call('org.freedesktop.portal.Request', 'Close', '()', (), path=handle)
                except Exception:pass
                raise RuntimeError('Desktop permission timed out. Try again and approve the system dialog.')
            code, reply = result[0]
            if code != 0:raise RuntimeError('Desktop access was cancelled or denied by the system.')
            return reply
        finally:self.bus.signal_unsubscribe(subscription)
    def observe(self, session):
        self.session = session
        self.subscription = self.bus.signal_subscribe(DEST, 'org.freedesktop.portal.Session', 'Closed', session, None, self.Gio.DBusSignalFlags.NONE, lambda *args:setattr(self,'closed',True))
    def notify(self, method, signature, *values):
        if self.closed:raise RuntimeError('The system ended desktop access.')
        return self.call(REMOTE, method, signature, (self.session, {}, *values))
    def close(self):
        if self.session:
            try:self.call('org.freedesktop.portal.Session', 'Close', '()', (), path=self.session)
            except Exception:pass
            self.session = None
        self.closed = True
        self.loop.quit()

class PortalDesktop:
    def __init__(self, portal=None):
        self.portal = portal or GioPortal()
        self.scope_lost = False
        self.mouse_down, self.key_down = set(), set()
        self.enabled = False
        try:
            reply = self.portal.request(REMOTE, 'CreateSession', '(a{sv})', (), {'session_handle_token':('s','pad_' + uuid.uuid4().hex)})
            session = reply['session_handle']
            self.portal.observe(session)
            self.portal.request(REMOTE, 'SelectDevices', '(oa{sv})', (session,), {'types':('u',3)})
            self.portal.request(SCREEN, 'SelectSources', '(oa{sv})', (session,), {'types':('u',1),'multiple':('b',False)})
            reply = self.portal.request(REMOTE, 'Start', '(osa{sv})', (session,''), {})
            if int(reply.get('devices',0)) & 3 != 3:raise RuntimeError('The portal did not approve mouse and keyboard access.')
            streams = reply.get('streams',[])
            if len(streams) != 1:raise RuntimeError('Choose exactly one screen in the system dialog.')
            self.stream, properties = streams[0]
            self.width, self.height = properties.get('logical_size', properties.get('size',(0,0)))
            if not (0 < self.width <= 32768 and 0 < self.height <= 32768):raise RuntimeError('The portal did not report usable screen dimensions.')
        except BaseException:
            self.portal.close()
            raise
    def set_scope(self, scope):
        if scope.get('kind') != 'desktop':raise RuntimeError('Wayland control requires explicit access to the screen approved in the system dialog. Window-only control is unavailable.')
        self.enabled = True
    def refresh(self):self.scope_lost = self.portal.closed
    def move(self,x,y):
        if self.enabled:self.portal.notify('NotifyPointerMotionAbsolute','(oa{sv}udd)',self.stream,x*(self.width-1),y*(self.height-1))
    def relative(self,dx,dy):
        if self.enabled:self.portal.notify('NotifyPointerMotion','(oa{sv}dd)',float(dx),float(dy))
    def button(self,button,down):
        if not self.enabled or not down and button not in self.mouse_down:return
        self.portal.notify('NotifyPointerButton','(oa{sv}iu)',{0:272,1:274,2:273}[button],int(down))
        if down:self.mouse_down.add(button)
        else:self.mouse_down.discard(button)
    def key(self,code,down,keys):
        symbols={'Space':32,'Enter':0xff0d,'Escape':0xff1b,'Tab':0xff09,'Backspace':0xff08,'Delete':0xffff,'Insert':0xff63,'Home':0xff50,'End':0xff57,'PageUp':0xff55,'PageDown':0xff56,'ArrowLeft':0xff51,'ArrowUp':0xff52,'ArrowRight':0xff53,'ArrowDown':0xff54,'ShiftLeft':0xffe1,'ShiftRight':0xffe2,'ControlLeft':0xffe3,'ControlRight':0xffe4,'AltLeft':0xffe9,'AltRight':0xffea,'MetaLeft':0xffeb,'MetaRight':0xffec,'CapsLock':0xffe5,'Minus':45,'Equal':61,'BracketLeft':91,'BracketRight':93,'Backslash':92,'Semicolon':59,'Quote':39,'Backquote':96,'Comma':44,'Period':46,'Slash':47}
        symbol = ord(code[3:].lower()) if code.startswith('Key') and len(code)==4 else ord(code[5:]) if code.startswith('Digit') and len(code)==6 else 0xffbd+int(code[1:]) if code.startswith('F') and code[1:].isdigit() and 1<=int(code[1:])<=12 else symbols.get(code)
        if symbol is None or not self.enabled or not down and code not in self.key_down:return
        self.portal.notify('NotifyKeyboardKeysym','(oa{sv}iu)',symbol,int(down))
        if down:self.key_down.add(code)
        else:self.key_down.discard(code)
    def wheel(self,dx,dy):
        if self.enabled:self.portal.notify('NotifyPointerAxis','(oa{sv}dd)',float(dx),float(dy))
    def close(self):self.enabled=False;self.portal.close()

def available():
    if not os.environ.get('DBUS_SESSION_BUS_ADDRESS'):return False
    from gi.repository import Gio, GLib
    bus=Gio.bus_get_sync(Gio.BusType.SESSION,None)
    result=bus.call_sync(DEST,PATH,'org.freedesktop.DBus.Properties','Get',GLib.Variant('(ss)',(REMOTE,'AvailableDeviceTypes')),None,Gio.DBusCallFlags.NONE,1500,None)
    return int(result.unpack()[0]) & 3 == 3

if __name__ == '__main__':
    import sys
    try:sys.exit(0 if available() else 1)
    except Exception:sys.exit(1)
