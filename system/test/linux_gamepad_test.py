"""Exercise uinput encoding/cleanup using fake descriptors, never OS devices."""
import errno
import io
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

sys.modules.setdefault('fcntl', types.SimpleNamespace(ioctl=lambda *_: 0))
spec = importlib.util.spec_from_file_location('pad_linux', Path(__file__).parents[1] / 'native/linux-gamepad.py')
pad = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pad)

class LinuxGamepadTests(unittest.TestCase):
    def setUp(self):
        # Windows runners have no POSIX open flag; all file access is mocked.
        flag = patch.object(pad.os, 'O_NONBLOCK', 0x800, create=True)
        flag.start()
        self.addCleanup(flag.stop)

    def test_fallback_and_complete_report(self):
        with patch.dict(pad.os.environ, {}, clear=True), patch.object(pad.os, 'open', side_effect=[FileNotFoundError(errno.ENOENT, 'missing'), 42]) as opened, patch.object(pad.fcntl, 'ioctl'), patch.object(pad.os, 'write', side_effect=lambda _, data: len(data)) as wrote, patch.object(pad.os, 'close') as closed:
            device = pad.Pad('fixture')
            self.assertEqual(opened.call_args_list[1].args[0], '/dev/input/uinput')
            device.apply({'buttons': {'a': True, 'up': True}, 'axes': {'lx': .7, 'lt': 1}})
            packet = wrote.call_args.args[1]
            size = pad.struct.calcsize('@llHHi')
            events = [pad.struct.unpack('@llHHi', packet[i:i+size])[2:] for i in range(0, len(packet), size)]
            self.assertIn((pad.EV_KEY, pad.BUTTONS['a'], 1), events)
            self.assertIn((pad.EV_ABS, pad.AXES['lt'], 255), events)
            self.assertEqual(events[-1], (pad.EV_SYN, 0, 0))
            device.close()
            closed.assert_called_once_with(42)

    def test_permission_denial_does_not_try_another_device(self):
        with patch.dict(pad.os.environ, {}, clear=True), patch.object(pad.os, 'open', side_effect=PermissionError('permission needed')) as opened:
            with self.assertRaises(PermissionError): pad.Pad('fixture')
            self.assertEqual(opened.call_count, 1)

    def test_initial_report_failure_closes_descriptor(self):
        with patch.dict(pad.os.environ, {'UINPUT_DEVICE': '/test/uinput'}, clear=True), patch.object(pad.os, 'open', return_value=43), patch.object(pad.fcntl, 'ioctl'), patch.object(pad.os, 'write', return_value=0), patch.object(pad.os, 'close') as closed:
            with self.assertRaises(OSError): pad.Pad('fixture')
            closed.assert_called_once_with(43)

    def test_cleanup_continues_after_one_device_fails(self):
        closed = []
        def broken():
            closed.append('first')
            raise OSError('device vanished')
        devices = [types.SimpleNamespace(close=broken), types.SimpleNamespace(close=lambda: closed.append('second'))]
        with patch.object(pad, 'Pad', side_effect=devices), patch.object(pad.sys, 'argv', ['fixture', '2']), patch.object(pad.sys, 'stdin', types.SimpleNamespace(fileno=lambda: 0)), patch.object(pad.sys, 'stdout', io.StringIO()), patch.object(pad.select, 'select', return_value=([0], [], [])), patch.object(pad.os, 'read', return_value=b''):
            with self.assertRaisesRegex(OSError, 'device vanished'): pad.main()
        self.assertEqual(closed, ['first', 'second'])

if __name__ == '__main__': unittest.main()
