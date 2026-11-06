"""macOS guest HID reader. Uses per-device seize; never a global event tap."""
import ctypes as c
from collections import deque
from guest_input_common import DeviceState, HID_KEYS, normalize

class MacHID:
    def __init__(self):
        self.cf=c.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
        self.io=c.CDLL('/System/Library/Frameworks/IOKit.framework/IOKit')
        p,n,u=c.c_void_p,c.c_long,c.c_uint32
        def bind(lib,name,args,result):
            fn=getattr(lib,name);fn.argtypes=args;fn.restype=result;return fn
        for name,args,result in [
            ('CFStringCreateWithCString',[p,c.c_char_p,u],p),('CFStringGetCString',[p,p,n,u],c.c_bool),
            ('CFGetTypeID',[p],c.c_ulong),('CFStringGetTypeID',[],c.c_ulong),('CFNumberGetTypeID',[],c.c_ulong),
            ('CFBooleanGetTypeID',[],c.c_ulong),('CFBooleanGetValue',[p],c.c_bool),
            ('CFNumberGetValue',[p,c.c_int,p],c.c_bool),('CFSetGetCount',[p],n),('CFSetGetValues',[p,p],None),
            ('CFArrayGetCount',[p],n),('CFArrayGetValueAtIndex',[p,n],p),('CFRetain',[p],p),('CFRelease',[p],None),
            ('CFRunLoopGetCurrent',[],p),('CFRunLoopRunInMode',[p,c.c_double,c.c_bool],c.c_int)]:bind(self.cf,name,args,result)
        for name,args,result in [
            ('IOHIDManagerCreate',[p,u],p),('IOHIDManagerSetDeviceMatching',[p,p],None),('IOHIDManagerCopyDevices',[p],p),
            ('IOHIDDeviceGetProperty',[p,p],p),('IOHIDDeviceGetService',[p],u),
            ('IORegistryEntryGetRegistryEntryID',[u,c.POINTER(c.c_uint64)],c.c_int),
            ('IOHIDDeviceCopyMatchingElements',[p,p,u],p),('IOHIDElementGetType',[p],u),
            ('IOHIDElementGetUsagePage',[p],u),('IOHIDElementGetUsage',[p],u),('IOHIDElementGetCookie',[p],u),
            ('IOHIDElementGetLogicalMin',[p],n),('IOHIDElementGetLogicalMax',[p],n),('IOHIDElementIsRelative',[p],c.c_bool),
            ('IOHIDDeviceOpen',[p,u],c.c_int),('IOHIDDeviceClose',[p,u],c.c_int),
            ('IOHIDDeviceRegisterInputValueCallback',[p,p,p],None),('IOHIDDeviceRegisterRemovalCallback',[p,p,p],None),
            ('IOHIDDeviceScheduleWithRunLoop',[p,p,p],None),('IOHIDDeviceUnscheduleFromRunLoop',[p,p,p],None),
            ('IOHIDValueGetElement',[p],p),('IOHIDValueGetIntegerValue',[p],n),
            ('IOHIDDeviceGetValue',[p,p,c.POINTER(p)],c.c_int)]:bind(self.io,name,args,result)
        self.loop=self.cf.CFRunLoopGetCurrent()
        self.mode=self.cf.CFStringCreateWithCString(None,b'kCFRunLoopDefaultMode',0x08000100)
        self.manager=None;self.records={};self.opened={};self.queue=deque()
        self.value_cb=c.CFUNCTYPE(None,p,c.c_int,p,p)(self._value)
        self.remove_cb=c.CFUNCTYPE(None,p,c.c_int,p)(self._removed)

    def property(self,device,name,default=None):
        key=self.cf.CFStringCreateWithCString(None,name.encode(),0x08000100)
        try:value=self.io.IOHIDDeviceGetProperty(device,key)
        finally:self.cf.CFRelease(key)
        if not value:return default
        kind=self.cf.CFGetTypeID(value)
        if kind==self.cf.CFStringGetTypeID():
            data=c.create_string_buffer(4096)
            return data.value.decode('utf-8','replace') if self.cf.CFStringGetCString(value,data,len(data),0x08000100) else default
        if kind==self.cf.CFNumberGetTypeID():
            data=c.c_longlong()
            return data.value if self.cf.CFNumberGetValue(value,4,c.byref(data)) else default
        if kind==self.cf.CFBooleanGetTypeID():return self.cf.CFBooleanGetValue(value)
        return default

    def elements(self,device):
        array=self.io.IOHIDDeviceCopyMatchingElements(device,None,0)
        values=[]
        if array:
            for i in range(self.cf.CFArrayGetCount(array)):
                ref=self.cf.CFArrayGetValueAtIndex(array,i)
                if self.io.IOHIDElementGetType(ref) not in (1,2,3,4):continue
                values.append({'ref':ref,'page':self.io.IOHIDElementGetUsagePage(ref),'usage':self.io.IOHIDElementGetUsage(ref),
                    'cookie':self.io.IOHIDElementGetCookie(ref),'low':self.io.IOHIDElementGetLogicalMin(ref),
                    'high':self.io.IOHIDElementGetLogicalMax(ref),'relative':self.io.IOHIDElementIsRelative(ref)})
        return array,values

    def devices(self):
        self.reset_inventory()
        self.manager=self.io.IOHIDManagerCreate(None,0)
        if not self.manager:raise RuntimeError('macOS could not create the HID device list.')
        # Matching enumerates devices. Do not IOHIDManagerOpen: it opens every
        # matched device; exclusive mode must open only user-selected devices.
        self.io.IOHIDManagerSetDeviceMatching(self.manager,None)
        devices=self.io.IOHIDManagerCopyDevices(self.manager)
        access=True
        try:
            check=self.io.IOHIDCheckAccess;check.argtypes=[c.c_int];check.restype=c.c_int
            access=check(1)==0  # kIOHIDRequestTypeListenEvent
        except AttributeError:pass
        notes=['macOS may require Input Monitoring for the app launching Python. Built-in or protected devices may refuse exclusive access. Raw HID controllers need a saved button layout.']
        if not access:notes.append('Enable Input Monitoring for your terminal/Python launcher in System Settings → Privacy & Security, then reopen the app.')
        try:
            count=self.cf.CFSetGetCount(devices) if devices else 0
            refs=(c.c_void_p*count)()
            if count:self.cf.CFSetGetValues(devices,refs)
            for ref in refs:
                usage=self.property(ref,'PrimaryUsage',0)
                page=self.property(ref,'PrimaryUsagePage',0)
                name=self.property(ref,'Product','HID input device')
                if str(name).startswith('WebRTC Pad'):continue
                array,elements=self.elements(ref)
                keyboard=any(e['page']==7 for e in elements)
                mouse=page==1 and usage in (1,2) or any(e['page']==1 and e['usage'] in (48,49) and e['relative'] for e in elements)
                kind='keyboard' if keyboard else 'mouse' if mouse else 'gamepad' if page==1 and usage in (4,5,8) else None
                if not kind:
                    if array:self.cf.CFRelease(array)
                    continue
                registry=c.c_uint64()
                if self.io.IORegistryEntryGetRegistryEntryID(self.io.IOHIDDeviceGetService(ref),c.byref(registry))!=0:
                    if array:self.cf.CFRelease(array)
                    continue
                identity=('pad' if kind=='gamepad' else kind)+':'+str(registry.value)
                combo=keyboard and mouse
                vendor=self.property(ref,'VendorID',0);product=self.property(ref,'ProductID',0)
                self.records[identity]={'id':identity,'ref':ref,'array':array,'elements':elements,'kind':kind,'label':name,
                    'profile':f'{name} · {vendor:04x}:{product:04x}',
                    'available':not combo and (kind=='gamepad' or access),
                    'detail':'Combined keyboard/mouse interface cannot be isolated in parts' if combo else
                        'Input Monitoring permission needed' if kind!='gamepad' and not access else
                        'Raw HID · set button layout after joining' if kind=='gamepad' else 'Exclusive HID access; macOS permission may be required'}
                self.cf.CFRetain(ref)
        finally:
            if devices:self.cf.CFRelease(devices)
        return self.records,notes

    def _event(self,value):
        element=self.io.IOHIDValueGetElement(value)
        return (self.io.IOHIDElementGetUsagePage(element),self.io.IOHIDElementGetUsage(element),
                self.io.IOHIDElementGetCookie(element),self.io.IOHIDValueGetIntegerValue(value),
                self.io.IOHIDElementGetLogicalMin(element),self.io.IOHIDElementGetLogicalMax(element),
                self.io.IOHIDElementIsRelative(element))

    def _value(self,context,result,sender,value):
        if context not in self.opened:return
        identity=self.opened[context]['id']
        if result:self.queue.append((identity,None))
        elif value:self.queue.append((identity,self._event(value)))

    def _removed(self,context,result,sender):
        if context in self.opened:self.queue.append((self.opened[context]['id'],None))

    def open(self,record,exclusive):
        ref=record['ref'];options=1 if exclusive else 0
        result=self.io.IOHIDDeviceOpen(ref,options)
        if result:raise RuntimeError(f'macOS refused {"exclusive" if exclusive else "read"} access to {record["label"]} (0x{result & 0xffffffff:08x}). Check Input Monitoring and other device readers. This device was not shared.')
        self.opened[ref]={**record,'options':options}
        try:
            self.io.IOHIDDeviceRegisterInputValueCallback(ref,c.cast(self.value_cb,c.c_void_p),ref)
            self.io.IOHIDDeviceRegisterRemovalCallback(ref,c.cast(self.remove_cb,c.c_void_p),ref)
            self.io.IOHIDDeviceScheduleWithRunLoop(ref,self.loop,self.mode)
            values=[]
            for element in record['elements']:
                value=c.c_void_p()
                if self.io.IOHIDDeviceGetValue(ref,element['ref'],c.byref(value))==0 and value:values.append(self._event(value))
            return values
        except BaseException:
            self.close_one(ref)
            raise

    def poll(self):
        self.cf.CFRunLoopRunInMode(self.mode,.001,True)
        events=list(self.queue);self.queue.clear();return events

    def close_one(self,ref):
        record=self.opened.pop(ref,None)
        if record:
            self.io.IOHIDDeviceRegisterInputValueCallback(ref,None,None)
            self.io.IOHIDDeviceRegisterRemovalCallback(ref,None,None)
            self.io.IOHIDDeviceUnscheduleFromRunLoop(ref,self.loop,self.mode)
            self.io.IOHIDDeviceClose(ref,record['options'])

    def close(self):
        for ref in list(self.opened):self.close_one(ref)
        self.queue.clear()

    def reset_inventory(self):
        self.close()
        for record in self.records.values():
            if record['array']:self.cf.CFRelease(record['array'])
            self.cf.CFRelease(record['ref'])
        self.records.clear()
        if self.manager:self.cf.CFRelease(self.manager);self.manager=None

    def dispose(self):
        self.reset_inventory();self.cf.CFRelease(self.mode)

class MacInput:
    def __init__(self,api=None):self.api=api or MacHID();self.records={};self.opened={}
    def inventory(self):
        self.close();self.records,notes=self.api.devices()
        return [{key:record[key] for key in ('id','kind','label','available','detail')} for record in self.records.values()],notes
    def _open(self,identities,exclusive):
        self.close()
        try:
            for identity in identities:
                record=self.records[identity]
                buttons=sorted({e['usage'] for e in record['elements'] if e['page']==9})
                if any(e['page']==1 and e['usage']==57 for e in record['elements']):buttons += [0x10001,0x10002,0x10003,0x10004]
                axes=sorted({e['usage']:(e['low'],e['high']) for e in record['elements'] if e['page']==1 and 48<=e['usage']<=56 and not e['relative']}.items())
                device=DeviceState(identity,record['label'],record['kind'],profile=record['profile'],buttons=buttons,axes=axes)
                device.hid_keys={}
                # Save before native open so any subsequent failure rolls back
                # the selected subset. No non-exclusive fallback after denial.
                self.opened[identity]=device
                initial=self.api.open(record,exclusive)
                from guest_input_common import Snapshot
                for event in initial:self.apply(device,event,Snapshot())
                if exclusive and (device.keys or device.mouse_buttons or device.down):raise RuntimeError(f'Release buttons and keys on {device.label}, then try again.')
            return list(self.opened.values())
        except BaseException:self.close();raise
    def open(self,identities):return self._open(identities,True)
    def identify(self):self._open([key for key,record in self.records.items() if record['kind'] in ('keyboard','mouse') and record['available']],False)
    def poll(self):
        events=[]
        for identity,event in self.api.poll():
            if event is None:raise RuntimeError('A selected HID device disconnected or access was lost. Devices released; refresh before reconnecting.')
            if identity in self.opened:events.append((self.opened[identity],event))
        return events
    def apply(self,device,event,snapshot):
        page,usage,cookie,value,low,high,relative=event
        if device.kind=='keyboard' and page==7:
            previous=set(device.keys)
            if high>1 and usage not in range(224,232):device.hid_keys[cookie]=value if value in HID_KEYS else 0
            else:device.hid_keys[cookie]=usage if value else 0
            device.keys={HID_KEYS.get(code) for code in device.hid_keys.values()}-{None}
            if value and previous==device.keys:
                code=HID_KEYS.get(usage)
                if code:snapshot.repeats.append(code)
            return True
        if page==9:
            if value:device.down.add(usage)
            else:device.down.discard(usage)
            if device.kind=='mouse':device.mouse_buttons={button for code,button in ((1,0),(2,2),(3,1)) if code in device.down}
            return device.kind=='mouse'
        if device.kind=='mouse':
            if page==1 and usage in (48,49):
                if relative:setattr(snapshot,'dx' if usage==48 else 'dy',getattr(snapshot,'dx' if usage==48 else 'dy')+value)
                else:setattr(snapshot,'x' if usage==48 else 'y',normalize(value,(low,high),True));snapshot.absolute=True
            if page==1 and usage==56:snapshot.wheel_y-=120*value;return True
            if page==12 and usage==0x238:snapshot.wheel_x+=120*value;return True
        elif device.kind=='gamepad' and page==1:
            if usage==57:
                position=value-low if low<=value<=high else -1
                for button,positions in ((0x10001,(0,1,7)),(0x10002,(3,4,5)),(0x10003,(5,6,7)),(0x10004,(1,2,3))):
                    if position in positions:device.down.add(button)
                    else:device.down.discard(button)
            elif usage in device.axis_limits:device.values[usage]=value
        return False
    def close(self):self.api.close();self.opened.clear()
    def dispose(self):self.close();self.api.dispose()
