"""Read Windows XInput state independently of the injector (test utility)."""
import ctypes
import json
import sys
import time

class Gamepad(ctypes.Structure):
    _fields_ = [('buttons', ctypes.c_uint16), ('lt', ctypes.c_uint8), ('rt', ctypes.c_uint8),
                ('lx', ctypes.c_int16), ('ly', ctypes.c_int16), ('rx', ctypes.c_int16), ('ry', ctypes.c_int16)]
class State(ctypes.Structure):
    _fields_ = [('packet', ctypes.c_uint32), ('pad', Gamepad)]

dll = ctypes.WinDLL('xinput1_4.dll')
dll.XInputGetState.argtypes = [ctypes.c_uint32, ctypes.POINTER(State)]
dll.XInputGetState.restype = ctypes.c_uint32
while True:
    results = []
    for index in range(4):
        state = State()
        if dll.XInputGetState(index, ctypes.byref(state)) == 0:
            results.append({'index': index, **{name: getattr(state.pad, name) for name, _ in Gamepad._fields_}})
    print(json.dumps(results), flush=True)
    if '--watch' not in sys.argv:
        break
    time.sleep(1 / 30)
