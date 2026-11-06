#!/usr/bin/env python3
"""Configurable Linux uinput gamepads. Python standard library only."""
import fcntl
import json
import os
import select
import struct
import sys
import time

EV_SYN, EV_KEY, EV_ABS = 0, 1, 3
UI_DEV_CREATE, UI_DEV_DESTROY = 0x5501, 0x5502
def iow(number, size):
    return (1 << 30) | (size << 16) | (ord('U') << 8) | number
BUTTONS = {'a': 0x130, 'b': 0x131, 'x': 0x134, 'y': 0x133, 'lb': 0x136,
           'rb': 0x137, 'back': 0x13a, 'start': 0x13b, 'ls': 0x13d, 'rs': 0x13e, 'guide': 0x13c}
AXES = {'lx': 0, 'ly': 1, 'rx': 3, 'ry': 4, 'lt': 2, 'rt': 5}

class Pad:
    def __init__(self, name):
        nodes = [os.environ['UINPUT_DEVICE']] if os.environ.get('UINPUT_DEVICE') else ['/dev/uinput', '/dev/input/uinput']
        self.fd = None
        for node in nodes:
            try:
                self.fd = os.open(node, os.O_WRONLY | os.O_NONBLOCK)
                break
            except FileNotFoundError:
                continue
        if self.fd is None:
            raise FileNotFoundError('uinput is unavailable; load the uinput module first')
        try:
            for kind in (EV_KEY, EV_ABS):
                fcntl.ioctl(self.fd, iow(100, 4), kind)
            for code in BUTTONS.values():
                fcntl.ioctl(self.fd, iow(101, 4), code)
            for code in (*AXES.values(), 16, 17):
                fcntl.ioctl(self.fd, iow(103, 4), code)
                low, high = (-1, 1) if code in (16, 17) else (0, 255) if code in (2, 5) else (-32768, 32767)
                fcntl.ioctl(self.fd, iow(4, 28), struct.pack('H2xiiiiii', code, 0, low, high, 0, 0, 0))
            setup = struct.pack('HHHH80sI', 3, 0x045e, 0x028e, 0x0114, name.encode(), 0)
            fcntl.ioctl(self.fd, iow(3, 92), setup)
            fcntl.ioctl(self.fd, UI_DEV_CREATE)
            self.updated = 0
            self.apply({})
        except BaseException:
            os.close(self.fd)
            raise

    def apply(self, state):
        axes, buttons = state.get('axes', {}), state.get('buttons', {})
        events = []
        for key, code in AXES.items():
            value = axes.get(key, 0)
            value = round(value * (255 if key in ('lt', 'rt') else 32767))
            if key in ('ly', 'ry'):
                value = -value
            events.append((EV_ABS, code, value))
        events.extend([(EV_ABS, 16, int(bool(buttons.get('right'))) - int(bool(buttons.get('left')))),
                       (EV_ABS, 17, int(bool(buttons.get('down'))) - int(bool(buttons.get('up'))))])
        events.extend((EV_KEY, code, int(bool(buttons.get(key)))) for key, code in BUTTONS.items())
        events.append((EV_SYN, 0, 0))
        packet = b''.join(struct.pack('@llHHi', 0, 0, *event) for event in events)
        if os.write(self.fd, packet) != len(packet):
            raise OSError('Incomplete uinput report')

    def close(self):
        try:
            self.apply({})
        finally:
            try:
                fcntl.ioctl(self.fd, UI_DEV_DESTROY)
            finally:
                os.close(self.fd)

def main():
    pads = {}
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    if count < 0:
        raise ValueError('Initial player count must not be negative')
    try:
        for slot in (f'p{i + 1}' for i in range(count)):
            pads[slot] = Pad('webrtc-pad-' + slot)
        print('READY', flush=True)
        buffer = b''
        while True:
            readable, _, _ = select.select([sys.stdin.fileno()], [], [], 0.1)
            if readable:
                chunk = os.read(sys.stdin.fileno(), 4096)
                if not chunk:
                    break
                buffer += chunk
                if len(buffer) > 65536:
                    raise ValueError('Input buffer exceeded')
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    msg = json.loads(line)
                    slot = msg['slot']
                    if msg.get('type') in ('add','remove'):
                        try:
                            if not slot.startswith('p') or not slot[1:].isdigit() or int(slot[1:]) < 1:
                                raise ValueError('Invalid controller slot')
                            if msg['type']=='add' and slot not in pads:pads[slot]=Pad('webrtc-pad-'+slot)
                            if msg['type']=='remove' and slot in pads:pads.pop(slot).close()
                            print(json.dumps({'id':msg['id']}),flush=True)
                        except Exception as error:print(json.dumps({'id':msg['id'],'error':str(error)}),flush=True)
                        continue
                    if slot not in pads:continue
                    pad = pads[slot]
                    pad.apply(msg['state'])
                    pad.updated = time.monotonic()
            for pad in pads.values():
                if pad.updated and time.monotonic() - pad.updated > 0.5:
                    pad.apply({})
                    pad.updated = 0
    finally:
        failures = []
        for pad in pads.values():
            try:
                pad.close()
            except Exception as error:
                failures.append(error)
        if failures:
            raise failures[0]

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Linux controller unavailable: {error}. Load uinput and grant this user access to /dev/uinput; see README.md.', file=sys.stderr)
        sys.exit(1)
