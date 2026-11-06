"""Linux guest evdev reader. Reads/seizes only explicitly selected event nodes."""
import hashlib
import os
from pathlib import Path
import select
import stat
import struct
import time
from guest_input_common import DeviceState, LINUX_KEYS, normalize

def bitmap(text):
    return sum(int(word,16) << (64*i) for i,word in enumerate(reversed(text.split())))

def has(bits,code):return bool(bits & (1<<code))
def ioctl_read(number,size):return (2<<30) | (size<<16) | (ord('E')<<8) | number

class LinuxInput:
    def __init__(self, root='/sys/class/input', dev='/dev/input'):
        import fcntl
        self.ioctl=fcntl.ioctl
        self.root,self.dev=Path(root),Path(dev)
        self.records={}
        self.opened={}
        self.event=struct.Struct('@llHHi')

    def inventory(self):
        self.close()
        self.records={}
        devices=[]
        for entry in sorted(self.root.glob('event*')):
            try:
                folder=entry/'device'
                name=(folder/'name').read_text().strip()
                if name.startswith('WebRTC Pad'):continue
                caps={key:bitmap((folder/'capabilities'/key).read_text()) for key in ('key','abs','rel')}
                keys=caps['key']
                keyboard=has(keys,30) and has(keys,57)
                mouse=has(keys,0x110) or has(keys,0x14a)
                combo=keyboard and mouse
                if keyboard:kind='keyboard'
                elif mouse:kind='mouse'
                elif any(has(keys,code) for code in range(0x120,0x140)):kind='gamepad'
                else:continue
                node=self.dev/entry.name
                info=node.stat()
                if not stat.S_ISCHR(info.st_mode):continue
                fingerprint=(str(folder.resolve()),info.st_rdev,info.st_ino)
                identity=hashlib.sha256(repr(fingerprint).encode()).hexdigest()[:24]
                identity=('pad' if kind=='gamepad' else kind)+':'+identity
                vendor=(folder/'id/vendor').read_text().strip()
                product=(folder/'id/product').read_text().strip()
                self.records[identity]={'path':node,'fingerprint':fingerprint,'folder':folder,'caps':caps,
                    'kind':kind,'label':name,'profile':f'{name} · {vendor}:{product}'}
                access=os.access(node,os.R_OK) and not combo
                devices.append({'id':identity,'kind':kind,'label':name,'available':access,
                    'detail':f'{node} · '+('Combined keyboard/mouse interface cannot be isolated in parts' if combo else 'Exclusive evdev access; no driver install needed' if access else 'Read permission needed for this selected device')})
            except (OSError,ValueError):continue
        notes=[]
        if any('Read permission needed' in d['detail'] for d in devices):notes.append('Grant your user read access only to the event devices you select. See the Linux input setup guide; do not run the browser or Node app as root.')
        if not devices:notes.append('No readable keyboard, mouse or controller event nodes found. Connect devices and check /dev/input permissions.')
        return devices,notes

    def read_ioctl(self,fd,number,size):
        data=bytearray(size);self.ioctl(fd,ioctl_read(number,size),data,True);return data

    def _open(self, identities, exclusive):
        self.close()
        try:
            for identity in identities:
                record=self.records[identity]
                fd=os.open(record['path'],os.O_RDONLY|os.O_NONBLOCK|os.O_CLOEXEC)
                try:
                    info=os.fstat(fd)
                    current=(str(record['folder'].resolve()),info.st_rdev,info.st_ino)
                    if current!=record['fingerprint']:raise RuntimeError('Device reconnected. Refresh and select it again.')
                    if exclusive and any(self.read_ioctl(fd,0x18,96)):
                        raise RuntimeError(f'Release buttons and keys on {record["label"]}, then try again.')
                    limits={}
                    values={}
                    for axis in range(64):
                        if has(record['caps']['abs'],axis):
                            value,lo,hi,_,_,_=struct.unpack('6i',self.read_ioctl(fd,0x40+axis,24))
                            limits[axis]=(lo,hi);values[axis]=value
                    standard=record['kind']=='gamepad' and has(record['caps']['key'],304) and has(record['caps']['key'],305)
                    buttons=[code for code in range(0x100,0x300) if has(record['caps']['key'],code)]
                    device=DeviceState(identity,record['label'],record['kind'],profile=record['profile'],
                        standard=standard,buttons=buttons,axes=sorted(limits.items()))
                    device.values.update(values)
                    if exclusive:self.ioctl(fd,0x40044590,1)  # EVIOCGRAB; the kernel releases on fd close.
                    self.opened[fd]=(device,exclusive)
                except BaseException:
                    os.close(fd)
                    raise
            return [device for device,_ in self.opened.values()]
        except BaseException:
            self.close()
            raise

    def open(self,identities):return self._open(identities,True)
    def identify(self):
        selected=[identity for identity,record in self.records.items() if record['kind'] in ('keyboard','mouse') and os.access(record['path'],os.R_OK)]
        self._open(selected,False)

    def poll(self):
        if not self.opened:return []
        ready,_,_=select.select(list(self.opened),[],[],0)
        events=[]
        for fd in ready:
            try:data=os.read(fd,self.event.size*128)
            except BlockingIOError:continue
            if not data:raise RuntimeError('A selected device disconnected. Devices released; refresh before reconnecting.')
            if len(data)%self.event.size:raise RuntimeError('Input packet was incomplete. Devices released.')
            device,_=self.opened[fd]
            for _,_,kind,code,value in self.event.iter_unpack(data):
                if kind==0 and code==3:raise RuntimeError('Input events were dropped. Devices released; select devices again.')
                events.append((device,(kind,code,value)))
        return events

    def apply(self,device,event,snapshot):
        kind,code,value=event
        if kind==1:
            if value:device.down.add(code)
            else:device.down.discard(code)
            if device.kind=='keyboard':
                device.keys={LINUX_KEYS[c] for c in device.down if c in LINUX_KEYS}
                if value==2 and code in LINUX_KEYS:snapshot.repeats.append(LINUX_KEYS[code])
            elif device.kind=='mouse':
                mapping={0x110:0,0x111:2,0x112:1}
                device.mouse_buttons={mapping[c] for c in device.down if c in mapping}
            return device.kind!='gamepad'
        if kind==3:
            device.values[code]=value
            if device.kind=='mouse' and code in (0,1) and code in device.axis_limits:
                setattr(snapshot,'x' if code==0 else 'y',normalize(value,device.axis_limits[code],True))
                snapshot.absolute=True
        if kind==2 and device.kind=='mouse':
            if code==0:snapshot.dx+=value
            if code==1:snapshot.dy+=value
            if code==8:snapshot.wheel_y-=120*value
            if code==6:snapshot.wheel_x+=120*value
            return code in (6,8)
        return False

    def close(self):
        for fd,(_,grabbed) in list(self.opened.items()):
            try:
                if grabbed:self.ioctl(fd,0x40044590,0)
            except OSError:pass
            finally:os.close(fd)
        self.opened.clear()

    def dispose(self):self.close()
