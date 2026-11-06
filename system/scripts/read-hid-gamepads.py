"""Independent WinMM reader for HID gamepad validation; no XInput dependency."""
import ctypes
import json
import sys
import time
class Caps(ctypes.Structure):
    _fields_ = [('mid',ctypes.c_ushort),('pid',ctypes.c_ushort),('name',ctypes.c_wchar*32)] + [(name,ctypes.c_uint) for name in ('xmin','xmax','ymin','ymax','zmin','zmax','numButtons','periodMin','periodMax','rmin','rmax','umin','umax','vmin','vmax','caps','maxAxes','numAxes','maxButtons')] + [('regKey',ctypes.c_wchar*32),('oem',ctypes.c_wchar*260)]
class State(ctypes.Structure):
    _fields_ = [(name,ctypes.c_uint) for name in ('size','flags','x','y','z','r','u','v','buttons','buttonNumber','pov','reserved1','reserved2')]

dll=ctypes.WinDLL('winmm.dll')
dll.joyGetDevCapsW.argtypes=[ctypes.c_size_t,ctypes.POINTER(Caps),ctypes.c_uint]
dll.joyGetPosEx.argtypes=[ctypes.c_uint,ctypes.POINTER(State)]
while True:
    results=[]
    for index in range(dll.joyGetNumDevs()):
        caps=Caps();state=State();state.size=ctypes.sizeof(state);state.flags=0xff
        try:
            if dll.joyGetDevCapsW(index,ctypes.byref(caps),ctypes.sizeof(caps)) or dll.joyGetPosEx(index,ctypes.byref(state)):
                continue
        except OSError:
            # The legacy WinMM cache can retain a removed HID handle during hot-unplug.
            continue
        results.append({'index':index,'vendor':caps.mid,'product':caps.pid,'name':caps.name,**{name:getattr(state,name) for name in ('x','y','z','r','u','v','buttons','pov')}})
    print(json.dumps(results),flush=True)
    if '--watch' not in sys.argv:break
    time.sleep(1/30)
