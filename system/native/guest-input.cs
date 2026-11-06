// Optional Windows guest reader. No hooks, host injection or global input lock.
// SDL3 reads controllers; HidHide isolates selected controller collections.
// Interception filters only explicitly selected keyboard/mouse device handles.
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

class GuestInput {
    static JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 131072 };
    static object OutputLock = new object();
    static volatile bool Quit;
    static long Heartbeat = Clock();
    static long Clock() { return (long)(Stopwatch.GetTimestamp()*(1000.0/Stopwatch.Frequency)); }
    static long Age(long then) { return Math.Max(0,Clock()-then); }
    [DllImport("winmm.dll")]static extern uint timeBeginPeriod(uint period);
    [DllImport("winmm.dll")]static extern uint timeEndPeriod(uint period);
    sealed class InputTiming : IDisposable {
        bool active=timeBeginPeriod(1)==0;
        public void Dispose(){if(active){active=false;timeEndPeriod(1);}}
    }
    static void Emit(object value) { lock(OutputLock) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); } }
    static string ErrorText(Exception error) { return error is DllNotFoundException ? "Optional native input libraries are missing. Run windows/shortcuts/09-Guest-Exclusive-Setup.cmd." : error.Message; }
    [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string name,uint access,uint sharing,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32",SetLastError=true)] static extern bool DeviceIoControl(IntPtr handle,uint code,byte[] input,int inputSize,byte[] output,int outputSize,out int returned,IntPtr overlapped);
    [DllImport("kernel32")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32",CharSet=CharSet.Unicode)] static extern uint QueryDosDevice(string name,StringBuilder target,int length);
    [DllImport("user32")] static extern short GetAsyncKeyState(int key);
    [DllImport("cfgmgr32",CharSet=CharSet.Unicode)] static extern uint CM_Get_Device_Interface_PropertyW(string path,ref DevKey key,out uint type,byte[] buffer,ref uint size,uint flags);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate uint Notify(IntPtr notification,IntPtr context,uint action,IntPtr data,uint size);
    [DllImport("cfgmgr32")] static extern uint CM_Register_Notification(byte[] filter,IntPtr context,Notify callback,out IntPtr notification);
    [DllImport("cfgmgr32")] static extern uint CM_Unregister_Notification(IntPtr notification);
    static int TopologyChanged;
    static uint NotifyDevices(IntPtr notification,IntPtr context,uint action,IntPtr data,uint size) {
        int flags=1;
        if(data!=IntPtr.Zero && size>=24 && Marshal.ReadInt32(data)==0){
            Guid kind=(Guid)Marshal.PtrToStructure(IntPtr.Add(data,8),typeof(Guid));
            if(kind==new Guid("884b96c3-56ef-11d1-bc8c-00a0c91405dd") || kind==new Guid("378de44c-56ef-11d1-bc8c-00a0c91405dd"))flags|=2;
        }
        int old;do{old=Interlocked.CompareExchange(ref TopologyChanged,0,0);}while(Interlocked.CompareExchange(ref TopologyChanged,old|flags,old)!=old);return 0;
    }
    [StructLayout(LayoutKind.Sequential)] struct DevKey { public Guid guid; public uint id; }
    [DllImport("cfgmgr32",CharSet=CharSet.Unicode)] static extern uint CM_Get_DevNode_PropertyW(uint node,ref DevKey key,out uint type,byte[] data,ref uint size,uint flags);
    [DllImport("cfgmgr32",CharSet=CharSet.Unicode)] static extern uint CM_Locate_DevNodeW(out uint node,string id,uint flags);
    [DllImport("cfgmgr32")] static extern uint CM_Get_Parent(out uint parent,uint node,uint flags);
    [DllImport("cfgmgr32",CharSet=CharSet.Unicode)] static extern uint CM_Get_Device_IDW(uint node,StringBuilder id,int count,uint flags);
    [DllImport("cfgmgr32",CharSet=CharSet.Unicode)] static extern uint CM_Get_Device_Interface_List_SizeW(out uint length,ref Guid kind,string instance,uint flags);
    [DllImport("cfgmgr32",CharSet=CharSet.Unicode)] static extern uint CM_Get_Device_Interface_ListW(ref Guid kind,string instance,char[] data,uint length,uint flags);
    static bool XusbInterface(string instance) {
        Guid kind=new Guid("ec87f1e3-c13b-4100-b5f7-8b84d54260cb");uint length;
        if(CM_Get_Device_Interface_List_SizeW(out length,ref kind,instance,0)!=0 || length<2 || length>32768)return false;
        char[] data=new char[length];return CM_Get_Device_Interface_ListW(ref kind,instance,data,length,0)==0 && data[0]!='\0';
    }
    static string XusbAncestor(string instance) {
        uint node;if(instance==null || CM_Locate_DevNodeW(out node,instance,0)!=0)return null;
        for(int i=0;i<16;i++){StringBuilder id=new StringBuilder(1024);if(CM_Get_Device_IDW(node,id,id.Capacity,0)!=0)break;if(XusbInterface(id.ToString()))return id.ToString();uint parent;if(CM_Get_Parent(out parent,node,0)!=0)break;node=parent;}return null;
    }
    static string[] ControllerHidePaths(string instance,string xusb) {
        if(String.IsNullOrEmpty(instance))return new string[0];
        bool hid=instance.StartsWith("HID\\",StringComparison.OrdinalIgnoreCase);
        // XInput's HID child alone does not block the XUSB access path. Do
        // not guess by controller name/VID or hide a generic USB parent.
        if(xusb==null && (!hid || instance.IndexOf("&IG_",StringComparison.OrdinalIgnoreCase)>=0))return new string[0];
        return new[]{instance,xusb}.Where(p=>!String.IsNullOrEmpty(p)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }
    static bool VirtualOutput(string instance){uint node;if(instance==null || CM_Locate_DevNodeW(out node,instance,0)!=0)return false;for(int i=0;i<16;i++){StringBuilder id=new StringBuilder(1024);if(CM_Get_Device_IDW(node,id,id.Capacity,0)!=0)break;if(id.ToString().StartsWith("ROOT\\VIGEMBUS",StringComparison.OrdinalIgnoreCase))return true;DevKey hardware=new DevKey{guid=new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"),id=3};byte[] bytes=new byte[8192];uint size=(uint)bytes.Length,type;if(CM_Get_DevNode_PropertyW(node,ref hardware,out type,bytes,ref size,0)==0 && Encoding.Unicode.GetString(bytes,0,(int)size).Split(new char[]{'\0'},StringSplitOptions.RemoveEmptyEntries).Any(value=>value.Equals("ROOT\\VIGEMBUS",StringComparison.OrdinalIgnoreCase) || value.Equals("Nefarius\\ViGEmBus\\Gen1",StringComparison.OrdinalIgnoreCase)))return true;uint parent;if(CM_Get_Parent(out parent,node,0)!=0)break;node=parent;}return false;}
    static string Instance(string path) {
        if(String.IsNullOrEmpty(path)) return null;
        DevKey key = new DevKey { guid = new Guid("78c34fc8-104a-4aca-9ea4-524d52996e57"), id=256 };
        byte[] data=new byte[8192];uint size=(uint)data.Length,type;
        return CM_Get_Device_Interface_PropertyW(path,ref key,out type,data,ref size,0)==0 ? Encoding.Unicode.GetString(data,0,(int)size).TrimEnd('\0') : null;
    }
    static bool HasHideFilter(string instance) {
        uint node;if(String.IsNullOrEmpty(instance) || CM_Locate_DevNodeW(out node,instance,0)!=0)return false;
        // DEVPKEY_Device_Stack from the Windows SDK. A registered/running
        // driver alone does not mean it attached to an already-connected pad.
        DevKey key=new DevKey{guid=new Guid("540b947e-8b40-45bc-a8a2-6a0b894cbda2"),id=14};
        byte[] data=new byte[32768];uint size=(uint)data.Length,type;
        return CM_Get_DevNode_PropertyW(node,ref key,out type,data,ref size,0)==0 && Encoding.Unicode.GetString(data,0,(int)size).Split(new char[]{'\0'},StringSplitOptions.RemoveEmptyEntries).Any(driver=>driver.Equals(@"\Driver\HidHide",StringComparison.OrdinalIgnoreCase));
    }
    static string Text(IntPtr pointer) {
        if(pointer==IntPtr.Zero)return null;int count=0;while(Marshal.ReadByte(pointer,count)!=0 && count<8192)count++;
        byte[] bytes=new byte[count];Marshal.Copy(pointer,bytes,0,count);return Encoding.UTF8.GetString(bytes);
    }
    static uint Ioctl(int function) { return (32769u<<16) | (1u<<14) | ((uint)function<<2); }
    static byte[] ReadHideValue(int function,Func<byte[],Tuple<bool,int,int>> query) {
        int length=1;
        if(function!=2052 && function!=2054){
            var size=query(null);if(!size.Item1)throw new System.ComponentModel.Win32Exception(size.Item3,"Cannot read HidHide configuration size");
            length=size.Item2;
            // HidHide passes this buffer to Windows' bounded WCHAR string
            // functions. Oversized fixed buffers fail for nonempty lists.
            if(length<0 || length>65534 || length%2!=0)throw new InvalidDataException("HidHide returned an invalid configuration size.");
            if(length==0)return new byte[0];
        }
        byte[] data=new byte[length];var result=query(data);
        if(!result.Item1)throw new System.ComponentModel.Win32Exception(result.Item3,"Cannot read HidHide configuration");
        if(result.Item2<0 || result.Item2>length)throw new InvalidDataException("HidHide returned too much configuration data.");
        return data.Take(result.Item2).ToArray();
    }
    sealed class Hide : IDisposable {
        IntPtr handle;
        public Hide() { handle=CreateFile(@"\\.\HidHide",0x80000000,0,IntPtr.Zero,3,0,IntPtr.Zero);if(handle==new IntPtr(-1) && Marshal.GetLastWin32Error()==32)throw new Exception("Close HidHide Configuration Client or another exclusive controller session and retry.");if(handle==new IntPtr(-1))throw new Exception("HidHide is not available. Install it with windows/shortcuts/09-Guest-Exclusive-Setup.cmd, then restart Windows if requested."); }
        byte[] Get(int function) { return ReadHideValue(function,data=>{int returned;bool success=DeviceIoControl(handle,Ioctl(function),null,0,data,data==null?0:data.Length,out returned,IntPtr.Zero);return Tuple.Create(success,returned,success?0:Marshal.GetLastWin32Error());}); }
        public string[] List(int function) { return Encoding.Unicode.GetString(Get(function)).Split(new char[]{'\0'},StringSplitOptions.RemoveEmptyEntries); }
        public bool Flag(int function) { byte[] data=Get(function);return data.Length>0 && data[0]!=0; }
        public void Set(int function,byte[] data) { int result;if(!DeviceIoControl(handle,Ioctl(function),data,data.Length,null,0,out result,IntPtr.Zero))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),"Cannot configure HidHide"); }
        public void ListSet(int function,IEnumerable<string> values) { Set(function,Encoding.Unicode.GetBytes(String.Join("\0",values.ToArray())+"\0\0")); }
        public void Dispose() { if(handle!=IntPtr.Zero){CloseHandle(handle);handle=IntPtr.Zero;} }
    }
    static string Journal = Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"guest-hide-recovery.json");
    static string ImagePath() { string path=Process.GetCurrentProcess().MainModule.FileName;StringBuilder target=new StringBuilder(32768);if(QueryDosDevice(path.Substring(0,2),target,target.Capacity)==0)throw new Exception("Cannot resolve the input reader executable");return target.ToString()+path.Substring(2); }
    static bool Alive(int pid,long started) { try { using(Process p=Process.GetProcessById(pid))return !p.HasExited && p.StartTime.ToUniversalTime().Ticks==started; }catch{return false;} }
    static void WatchOwner(int owner) {
        Emit(new {type="ready"});Heartbeat=Clock();
        Thread reader=new Thread(()=>{try{while(Console.ReadLine()!=null)Heartbeat=Clock();}catch{}Quit=true;});reader.IsBackground=true;reader.Start();
        // Hold this exact process handle, so a reused PID cannot identify an
        // unrelated application after the original reader exits.
        using(Process process=Process.GetProcessById(owner)){
            IntPtr ownerHandle=process.Handle;
            while(!Quit && !process.HasExited && Age(Heartbeat)<1500)Thread.Sleep(30);
            if(!Quit && Age(Heartbeat)>=1500 && !process.HasExited)try{process.Kill();}catch{}
            GC.KeepAlive(ownerHandle);
        }
    }
    static void Recover(Hide hide) {
        if(!File.Exists(Journal))return;
        Dictionary<string,object> record=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Journal));
        int guard=Convert.ToInt32(record["guard"]);if(guard!=Process.GetCurrentProcess().Id && record.ContainsKey("guardStart") && Alive(guard,Convert.ToInt64(record["guardStart"])))throw new Exception("Another exclusive input session is already running.");
        string[] owned=((System.Collections.IEnumerable)record["owned"]).Cast<object>().Select(Convert.ToString).ToArray();
        string[] remaining=hide.List(2050).Where(p=>!owned.Contains(p,StringComparer.OrdinalIgnoreCase)).ToArray();hide.ListSet(2051,remaining);
        if(Convert.ToBoolean(record["allowAdded"]))hide.ListSet(2049,hide.List(2048).Where(p=>!String.Equals(p,Convert.ToString(record["image"]),StringComparison.OrdinalIgnoreCase)));
        if(!Convert.ToBoolean(record["active"]) && remaining.Length==0)hide.Set(2053,new byte[]{0});
        File.Delete(Journal);
    }
    static int Guard(int owner) {
        using(Mutex mutex=new Mutex(false,"Local\\WebRTCPadGuestHide")) {
            bool locked=false;
            try {
                try { locked=mutex.WaitOne(0); }catch(AbandonedMutexException){locked=true;}
                if(!locked)throw new Exception("Another exclusive input session is running.");
                Dictionary<string,object> request=Json.Deserialize<Dictionary<string,object>>(Console.ReadLine());
                string[] paths=((System.Collections.IEnumerable)request["paths"]).Cast<object>().Select(Convert.ToString).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                // Keyboard/mouse-only sessions still need an independent hung-
                // reader watchdog, but do not need or modify HidHide.
                if(paths.Length==0){WatchOwner(owner);return 0;}
                using(Hide hide=new Hide()) {
                    Recover(hide);
                    if(paths.Length==0 || paths.Any(p=>p.Length>1024 || !HasHideFilter(p) || !p.StartsWith("HID\\",StringComparison.OrdinalIgnoreCase) && !XusbInterface(p)))throw new Exception("Controller has no supported filtered HID / XInput identity. It was not hidden.");
                    string[] before=hide.List(2050),allow=hide.List(2048);bool active=hide.Flag(2052);
                    if(hide.Flag(2054))throw new Exception("HidHide is using inverted application filtering. Restore its normal mode before using exclusive input.");
                    if(!active && before.Length>0)throw new Exception("HidHide has inactive saved device rules. Enable or clear those rules in HidHide first; this app will not activate unrelated devices.");
                    string image=ImagePath();bool added=!allow.Contains(image,StringComparer.OrdinalIgnoreCase);
                    string[] owned=paths.Where(p=>!before.Contains(p,StringComparer.OrdinalIgnoreCase)).ToArray();
                    // Persist the rollback before any driver mutation. A separate process
                    // owns this journal and monitors the reader, including reader crashes.
                    File.WriteAllText(Journal,Json.Serialize(new {guard=Process.GetCurrentProcess().Id,guardStart=Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks,owned=owned,image=image,allowAdded=added,active=active}));
                    try {
                        if(added)hide.ListSet(2049,allow.Concat(new[]{image}));
                        hide.ListSet(2051,before.Concat(owned));hide.Set(2053,new byte[]{1});
                        if(!hide.Flag(2052) || hide.Flag(2054) || paths.Any(path=>!hide.List(2050).Contains(path,StringComparer.OrdinalIgnoreCase)) || !hide.List(2048).Contains(image,StringComparer.OrdinalIgnoreCase))throw new Exception("Windows did not confirm controller input blocking. Devices were released.");
                        WatchOwner(owner);
                    } finally {Recover(hide);}
                }
                return 0;
            }catch(Exception error){Emit(new {type="error",error=ErrorText(error)});return 1;}
            finally {if(locked)mutex.ReleaseMutex();}
        }
    }
    static class SDL {
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SDL_Init(uint flags);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern void SDL_Quit();
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern void SDL_PumpEvents();
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr SDL_GetJoysticks(out int count);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern void SDL_free(IntPtr memory);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr SDL_GetJoystickNameForID(uint id);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr SDL_GetJoystickPathForID(uint id);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SDL_IsJoystickVirtual(uint id);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SDL_IsGamepad(uint id);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr SDL_OpenGamepad(uint id);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr SDL_OpenJoystick(uint id);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern void SDL_CloseGamepad(IntPtr pad);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern void SDL_CloseJoystick(IntPtr pad);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SDL_RumbleGamepad(IntPtr pad,ushort low,ushort high,uint duration);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SDL_RumbleJoystick(IntPtr pad,ushort low,ushort high,uint duration);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SDL_GamepadConnected(IntPtr pad);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SDL_JoystickConnected(IntPtr pad);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern short SDL_GetGamepadAxis(IntPtr pad,int axis);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SDL_GetGamepadButton(IntPtr pad,int button);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern int SDL_GetNumJoystickAxes(IntPtr pad);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern int SDL_GetNumJoystickButtons(IntPtr pad);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern short SDL_GetJoystickAxis(IntPtr pad,int axis);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SDL_GetJoystickButton(IntPtr pad,int button);
        [DllImport("SDL3",CallingConvention=CallingConvention.Cdecl)] public static extern byte SDL_GetJoystickHat(IntPtr pad,int hat);
    }
    static class Filter {
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int Predicate(int device);
        [DllImport("interception",CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr interception_create_context();
        [DllImport("interception",CallingConvention=CallingConvention.Cdecl)] public static extern void interception_destroy_context(IntPtr context);
        [DllImport("interception",CallingConvention=CallingConvention.Cdecl)] public static extern uint interception_get_hardware_id(IntPtr context,int device,byte[] bytes,uint size);
        [DllImport("interception",CallingConvention=CallingConvention.Cdecl)] public static extern void interception_set_filter(IntPtr context,Predicate test,ushort filter);
        [DllImport("interception",CallingConvention=CallingConvention.Cdecl)] public static extern ushort interception_get_filter(IntPtr context,int device);
        [DllImport("interception",CallingConvention=CallingConvention.Cdecl)] public static extern int interception_wait_with_timeout(IntPtr context,uint timeout);
        [DllImport("interception",CallingConvention=CallingConvention.Cdecl)] public static extern int interception_receive(IntPtr context,int device,byte[] bytes,uint count);
        [DllImport("interception",CallingConvention=CallingConvention.Cdecl)] public static extern int interception_send(IntPtr context,int device,byte[] bytes,uint count);
    }
    sealed class Pad : IDisposable {
        public string Id,Name,Path;public string[] HidePaths;public uint NativeId;public bool Standard;public IntPtr Handle;
        public Pad(uint id) { NativeId=id;Id="pad:"+id;Name=Text(SDL.SDL_GetJoystickNameForID(id))??"Game controller";Path=Instance(Text(SDL.SDL_GetJoystickPathForID(id)));HidePaths=ControllerHidePaths(Path,XusbAncestor(Path));Standard=SDL.SDL_IsGamepad(id); }
        public void Open(){Handle=Standard?SDL.SDL_OpenGamepad(NativeId):SDL.SDL_OpenJoystick(NativeId);if(Handle==IntPtr.Zero)throw new Exception("Cannot read "+Name);}
        public void RequireReleased(){int count=Standard?21:Math.Min(128,SDL.SDL_GetNumJoystickButtons(Handle));for(int b=0;b<count;b++)if(Standard?SDL.SDL_GetGamepadButton(Handle,b):SDL.SDL_GetJoystickButton(Handle,b))throw new Exception("Release buttons on "+Name+", then try again.");if(Standard && (SDL.SDL_GetGamepadAxis(Handle,4)>3276 || SDL.SDL_GetGamepadAxis(Handle,5)>3276))throw new Exception("Release triggers on "+Name+", then try again.");}
        public object Snapshot(int index) {
            if(!(Standard?SDL.SDL_GamepadConnected(Handle):SDL.SDL_JoystickConnected(Handle)))throw new Exception("A selected controller disconnected. Devices were released. Refresh devices to reconnect.");
            List<double> axes=new List<double>();List<object> buttons=new List<object>();
            if(Standard) {
                for(int a=0;a<4;a++)axes.Add(Math.Max(-1,SDL.SDL_GetGamepadAxis(Handle,a)/32767.0));
                // SDL's gamepad order differs from the browser standard order.
                int[] order={0,1,2,3,9,10,-1,-2,4,6,7,8,11,12,13,14,5};
                foreach(int b in order){double value=b<0?Math.Max(0,SDL.SDL_GetGamepadAxis(Handle,b==-1?4:5)/32767.0):(SDL.SDL_GetGamepadButton(Handle,b)?1:0);buttons.Add(new {pressed=value>.5,value=value});}
            } else {
                for(int a=0;a<Math.Min(32,SDL.SDL_GetNumJoystickAxes(Handle));a++)axes.Add(Math.Max(-1,SDL.SDL_GetJoystickAxis(Handle,a)/32767.0));
                for(int b=0;b<Math.Min(128,SDL.SDL_GetNumJoystickButtons(Handle));b++){bool down=SDL.SDL_GetJoystickButton(Handle,b);buttons.Add(new {pressed=down,value=down?1:0});}
            }
            return new {id=Id+" · "+Name,index=index,connected=true,mapping=Standard?"standard":"",axes=axes,buttons=buttons};
        }
        public void Dispose(){if(Handle!=IntPtr.Zero){if(Standard)SDL.SDL_CloseGamepad(Handle);else SDL.SDL_CloseJoystick(Handle);Handle=IntPtr.Zero;}}
    }
    static Dictionary<int,string> ScanCodes = new Dictionary<int,string>();
    static void KeyMap() {
        string[] basic={"Escape","Digit1","Digit2","Digit3","Digit4","Digit5","Digit6","Digit7","Digit8","Digit9","Digit0","Minus","Equal","Backspace","Tab","KeyQ","KeyW","KeyE","KeyR","KeyT","KeyY","KeyU","KeyI","KeyO","KeyP","BracketLeft","BracketRight","Enter","ControlLeft","KeyA","KeyS","KeyD","KeyF","KeyG","KeyH","KeyJ","KeyK","KeyL","Semicolon","Quote","Backquote","ShiftLeft","Backslash","KeyZ","KeyX","KeyC","KeyV","KeyB","KeyN","KeyM","Comma","Period","Slash","ShiftRight"};
        for(int i=0;i<basic.Length;i++)ScanCodes[i+1]=basic[i];ScanCodes[56]="AltLeft";ScanCodes[57]="Space";ScanCodes[58]="CapsLock";
        for(int i=0;i<10;i++)ScanCodes[59+i]="F"+(i+1);ScanCodes[87]="F11";ScanCodes[88]="F12";
        int[] extended={28,29,56,71,72,73,75,77,79,80,81,82,83,91,92};string[] names={"Enter","ControlRight","AltRight","Home","ArrowUp","PageUp","ArrowLeft","ArrowRight","End","ArrowDown","PageDown","Insert","Delete","MetaLeft","MetaRight"};
        for(int i=0;i<extended.Length;i++)ScanCodes[256+extended[i]]=names[i];
    }
    static Process StartGuard(string[] paths) {
        Process p=Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"--guard "+Process.GetCurrentProcess().Id) { UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true });
        p.StandardInput.WriteLine(Json.Serialize(new {paths=paths}));p.StandardInput.Flush();
        var task=p.StandardOutput.ReadLineAsync();if(!task.Wait(4000)){p.Kill();throw new Exception("Controller isolation did not start in time.");}
        var reply=Json.Deserialize<Dictionary<string,object>>(task.Result??"{}");if(!reply.ContainsKey("type") || Convert.ToString(reply["type"])!="ready"){p.WaitForExit(2000);throw new Exception(reply.ContainsKey("error")?Convert.ToString(reply["error"]):"Controller isolation failed");}return p;
    }
    static void Main(string[] args) {
        Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
        if(args.Length==1 && args[0]=="--hidhide-buffer-selftest"){
            byte[] value=Encoding.Unicode.GetBytes("HID\\selected-controller\0\0");int calls=0;
            byte[] read=ReadHideValue(2050,data=>{calls++;if(data==null)return Tuple.Create(true,value.Length,0);if(data.Length!=value.Length)throw new Exception("List buffer was not sized exactly.");Array.Copy(value,data,value.Length);return Tuple.Create(true,value.Length,0);});
            if(calls!=2 || !read.SequenceEqual(value))throw new Exception("Nonempty list read failed.");
            if(ReadHideValue(2052,data=>{if(data==null || data.Length!=1)throw new Exception("Invalid boolean buffer.");data[0]=1;return Tuple.Create(true,1,0);})[0]!=1)throw new Exception("Boolean read failed.");
            bool refused=false;try{ReadHideValue(2050,data=>Tuple.Create(true,131072,0));}catch(InvalidDataException){refused=true;}if(!refused)throw new Exception("Oversized configuration accepted.");
            Emit(new{type="hidhide-buffer-selftest",passed=true});return;
        }
        if(args.Length==1 && args[0]=="--controller-path-selftest"){
            string hid=@"HID\VID_045E&PID_028E&IG_00\pad",usb=@"USB\VID_045E&PID_028E\pad",generic=@"HID\VID_1234&PID_5678\pad";
            if(!ControllerHidePaths(generic,null).SequenceEqual(new[]{generic}))throw new Exception("Generic HID must hide only its collection.");
            if(!ControllerHidePaths(hid,usb).SequenceEqual(new[]{hid,usb}))throw new Exception("XInput must include HID and XUSB identities.");
            if(ControllerHidePaths(hid,null).Length!=0 || ControllerHidePaths(usb,null).Length!=0 || ControllerHidePaths(null,null).Length!=0)throw new Exception("Incomplete identities must not claim blocking.");
            if(!ControllerHidePaths(usb,usb).SequenceEqual(new[]{usb}))throw new Exception("Duplicate XUSB identities.");
            Emit(new{type="controller-path-selftest",passed=true});return;
        }
        if(args.Length==1 && args[0]=="--timing-selftest"){
            // Exercise only the sampling clock: never open or isolate a device.
            using(var timing=new InputTiming()){var gaps=new List<long>();for(int i=0;i<80;i++){long start=Clock();while(Age(start)<8)Thread.Sleep(1);gaps.Add(Age(start));}gaps.Sort();Emit(new {type="timing",medianMs=gaps[40],p95Ms=gaps[76]});}return;
        }
        if(args.Length==2 && args[0]=="--guard"){Environment.ExitCode=Guard(int.Parse(args[1]));return;}
        if(args.Length==1 && args[0]=="--recover"){try{using(Hide h=new Hide())Recover(h);}catch(Exception error){Emit(new {type="error",error=ErrorText(error)});Environment.ExitCode=1;}return;}
        Environment.SetEnvironmentVariable("SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS","1");
        Dictionary<string,Pad> pads=new Dictionary<string,Pad>();Dictionary<string,int> deviceSlots=new Dictionary<string,int>();Dictionary<int,string> hardware=new Dictionary<int,string>();
        IntPtr context=IntPtr.Zero,notification=IntPtr.Zero;Process guard=null;InputTiming inputTiming=null;bool sdl=false,active=false,identify=false;long identifyAt=0,lastSample=0,lastGuard=0;
        Notify notify=NotifyDevices;
        HashSet<string> selected=new HashSet<string>(),keys=new HashSet<string>();HashSet<int> buttons=new HashSet<int>();
        Dictionary<int,HashSet<string>> perKeyboard=new Dictionary<int,HashSet<string>>();Dictionary<int,HashSet<int>> perMouse=new Dictionary<int,HashSet<int>>();
        double x=.5,y=.5,dx=0,dy=0;bool absolute=false,urgent=false;List<string> repeats=new List<string>();int wheelX=0,wheelY=0;
        Queue<Dictionary<string,object>> commands=new Queue<Dictionary<string,object>>();object gate=new object();
        Filter.Predicate filter=(device)=>identify || selected.Contains((device<=10?"keyboard:":"mouse:")+device)?1:0;
        try {
            KeyMap();
            // Release on topology changes instead of reusing a keyboard/mouse
            // driver index for a newly plugged-in device of the same model.
            byte[] notificationFilter=new byte[416];Array.Copy(BitConverter.GetBytes(416),notificationFilter,4);Array.Copy(BitConverter.GetBytes(1),0,notificationFilter,4,4);
            if(CM_Register_Notification(notificationFilter,IntPtr.Zero,notify,out notification)!=0)throw new Exception("Cannot monitor device reconnections safely. Native input was not enabled.");
            List<string> notes=new List<string>();
            try{sdl=SDL.SDL_Init(0x2000u|0x200u);if(!sdl)notes.Add("SDL controller reader could not start.");}catch(Exception e){notes.Add(ErrorText(e));}
            bool hideReady=false;try{using(Hide hide=new Hide()){Recover(hide);hideReady=!hide.Flag(2054);}}catch(Exception e){notes.Add(ErrorText(e));}
            try{context=Filter.interception_create_context();if(context==IntPtr.Zero)notes.Add("Keyboard/mouse isolation needs the Interception driver and a Windows restart.");}catch{notes.Add("Keyboard/mouse isolation libraries are missing. Run windows/shortcuts/09-Guest-Exclusive-Setup.cmd.");}
            Action list=()=>{
                foreach(Pad pad in pads.Values)pad.Dispose();pads.Clear();hardware.Clear();List<object> devices=new List<object>();
                if(sdl){SDL.SDL_PumpEvents();int count;IntPtr ids=SDL.SDL_GetJoysticks(out count);try{for(int i=0;i<count;i++){uint id=(uint)Marshal.ReadInt32(ids,4*i);if(SDL.SDL_IsJoystickVirtual(id))continue;Pad pad=new Pad(id);if(VirtualOutput(pad.Path))continue;pads[pad.Id]=pad;devices.Add(new {id=pad.Id,label=pad.Name,kind="gamepad",available=hideReady && pad.HidePaths.Length>0 && pad.HidePaths.All(HasHideFilter),reason=hideReady && pad.HidePaths.Length>0 && !pad.HidePaths.All(HasHideFilter)?"reconnect-required":null,detail=pad.HidePaths.Length==0?"No complete isolatable HID / XInput identity was reported. Local blocking is unavailable for this connection.":hideReady && !pad.HidePaths.All(HasHideFilter)?"Reconnect this controller after installing HidHide, or restart Windows, then refresh.":pad.Standard?"Recognized SDL layout":"Custom button layout needed"});}}finally{if(ids!=IntPtr.Zero)SDL.SDL_free(ids);}}
                if(context!=IntPtr.Zero)for(int i=1;i<=20;i++){byte[] bytes=new byte[8192];uint size=Filter.interception_get_hardware_id(context,i,bytes,(uint)bytes.Length);if(size==0)continue;string identity=Encoding.Unicode.GetString(bytes,0,(int)Math.Min(size,(uint)bytes.Length)).TrimEnd('\0');hardware[i]=identity;devices.Add(new {id=(i<=10?"keyboard:":"mouse:")+i,label=(i<=10?"Keyboard "+i:"Mouse "+(i-10)),kind=i<=10?"keyboard":"mouse",available=true,detail=identity.Split('\0')[0]});}
                Interlocked.Exchange(ref TopologyChanged,0);Emit(new {type="devices",devices=devices,notes=notes});
            };
            Action<string> stop=(reason)=>{
                if(inputTiming!=null){inputTiming.Dispose();inputTiming=null;}
                active=false;identify=false;
                if(context!=IntPtr.Zero){Filter.Predicate all=(d)=>1;Filter.interception_set_filter(context,all,0);GC.KeepAlive(all);}
                if(guard!=null){try{guard.StandardInput.Close();if(!guard.WaitForExit(2500)){guard.Kill();guard.WaitForExit(1000);}}catch{}guard.Dispose();guard=null;if(File.Exists(Journal)){using(Process recovery=Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"--recover"){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true})){if(!recovery.WaitForExit(2500) || recovery.ExitCode!=0)throw new Exception("Controller release needs recovery. Close HidHide Configuration Client, then run the native reader with --recover.");}}}
                foreach(Pad pad in pads.Values)pad.Dispose();selected.Clear();keys.Clear();buttons.Clear();perKeyboard.Clear();perMouse.Clear();repeats.Clear();urgent=false;dx=dy=0;wheelX=wheelY=0;
                if(reason!="Preparing selected devices.")Emit(new {type="released",reason=reason});
            };
            Thread input=new Thread(()=>{try{string line;while((line=Console.ReadLine())!=null){if(line.Length>32768)break;var value=Json.Deserialize<Dictionary<string,object>>(line);if(Convert.ToString(value["type"])=="heartbeat")Heartbeat=Clock();else lock(gate)commands.Enqueue(value);}}catch{}Quit=true;});input.IsBackground=true;input.Start();
            list();Emit(new {type="ready"});
            while(!Quit){
                Dictionary<string,object> command=null;lock(gate){if(commands.Count>0)command=commands.Dequeue();}
                if(command!=null){string type=Convert.ToString(command["type"]);try{
                    if(type=="stop")stop("Devices released.");
                    if(type=="rumble"){string id=Convert.ToString(command["device"]);if(active && selected.Contains(id) && pads.ContainsKey(id) && pads[id].Handle!=IntPtr.Zero){ushort low=(ushort)(Math.Max(0,Math.Min(1,Convert.ToDouble(command["large"])))*65535),high=(ushort)(Math.Max(0,Math.Min(1,Convert.ToDouble(command["small"])))*65535);if(pads[id].Standard)SDL.SDL_RumbleGamepad(pads[id].Handle,low,high,180);else SDL.SDL_RumbleJoystick(pads[id].Handle,low,high,180);}}
                    if(type=="list"){stop("Device list refreshed.");list();}
                    if(type=="identify"){stop("Identifying devices; local input remains active.");identify=true;identifyAt=Clock();Heartbeat=Clock();if(context!=IntPtr.Zero){Filter.interception_set_filter(context,filter,65535);}}
                    if(type=="start"){
                        stop("Preparing selected devices.");
                        if(Interlocked.CompareExchange(ref TopologyChanged,0,0)!=0)throw new Exception("Devices changed. Refresh the device list before starting.");
                        var wanted=((System.Collections.IEnumerable)command["devices"]).Cast<object>().Select(Convert.ToString).ToArray();if(wanted.Length==0 || wanted.Distinct().Count()!=wanted.Length)throw new Exception("Select at least one device.");
                        foreach(string id in wanted){int slot;if(id.StartsWith("pad:")){if(!pads.ContainsKey(id) || pads[id].HidePaths.Length==0 || !hideReady)throw new Exception("The selected controller cannot be isolated.");if(!pads[id].HidePaths.All(HasHideFilter))throw new Exception("Reconnect the selected controller or restart Windows to finish HidHide setup, then refresh devices. Local input blocking was not enabled.");}else if(!int.TryParse(id.Split(':').Last(),out slot) || !hardware.ContainsKey(slot) || id!=(slot<=10?"keyboard:":"mouse:")+slot)throw new Exception("The selected input device is no longer available.");}
                        // Reserving controllers never captures the local keyboard
                        // or mouse, so their held state must not prevent it.
                        if(wanted.Any(id=>!id.StartsWith("pad:")))for(int vk=1;vk<256;vk++)if((GetAsyncKeyState(vk)&0x8000)!=0)throw new Exception("Release local keys and mouse buttons, then try again.");
                        foreach(string id in wanted.Where(id=>id.StartsWith("pad:"))){pads[id].Open();pads[id].RequireReleased();}
                        guard=StartGuard(wanted.Where(id=>id.StartsWith("pad:")).SelectMany(id=>pads[id].HidePaths).ToArray());
                        selected=new HashSet<string>(wanted);deviceSlots.Clear();int index=0;foreach(string id in wanted.Where(id=>id.StartsWith("pad:")))deviceSlots[id]=index++;
                        if(context!=IntPtr.Zero){Filter.interception_set_filter(context,filter,65535);foreach(int device in hardware.Keys)if(selected.Contains((device<=10?"keyboard:":"mouse:")+device) && Filter.interception_get_filter(context,device)!=65535)throw new Exception("Windows did not enable the selected device filter.");}
                        inputTiming=new InputTiming();active=true;Heartbeat=Clock();x=y=.5;Emit(new {type="active",devices=wanted});
                    }
                }catch(Exception error){stop("Devices released after setup failed.");Emit(new {type="error",error=ErrorText(error)});}}
                if((active || identify) && Age(Heartbeat)>1500)stop("Connection stopped responding. Devices released.");
                // Gamepad output creation at a local host must not release a
                // guest's mouse/keyboard. Watch keyboard/mouse interface changes
                // separately; selected controller liveness is checked below.
                if(active && (Interlocked.Exchange(ref TopologyChanged,0)&2)!=0 && selected.Any(id=>!id.StartsWith("pad:")))stop("A keyboard or mouse connected or disconnected. Devices released; refresh before reconnecting.");
                if(active && (GetAsyncKeyState(0x11)&0x8000)!=0 && (GetAsyncKeyState(0x12)&0x8000)!=0 && (GetAsyncKeyState(0x1b)&0x8000)!=0)stop("Emergency release: Ctrl + Alt + Esc.");
                if(identify && Age(identifyAt)>10000)stop("Identification finished.");
                if(guard!=null){if(guard.HasExited)throw new Exception("Controller isolation stopped. All devices were released.");if(Age(lastGuard)>250){guard.StandardInput.WriteLine("alive");guard.StandardInput.Flush();lastGuard=Clock();}}
                if(sdl)SDL.SDL_PumpEvents();
                if(context!=IntPtr.Zero && (active || identify)){
                    int device=Filter.interception_wait_with_timeout(context,1);
                    if(device!=0){byte[] stroke=new byte[20];if(Filter.interception_receive(context,device,stroke,1)==1){string id=(device<=10?"keyboard:":"mouse:")+device;
                        if(identify || !selected.Contains(id)){if(Filter.interception_send(context,device,stroke,1)!=1)throw new Exception("Could not pass through local input.");if(identify)Emit(new {type="activity",device=id});}
                        else if(device<=10){urgent=true;if(!perKeyboard.ContainsKey(device))perKeyboard[device]=new HashSet<string>();var deviceKeys=perKeyboard[device];int scan=BitConverter.ToUInt16(stroke,0),flags=BitConverter.ToUInt16(stroke,2);string code;if(ScanCodes.TryGetValue(scan+((flags&2)!=0?256:0),out code)){if((flags&1)!=0)deviceKeys.Remove(code);else {if(deviceKeys.Contains(code))repeats.Add(code);deviceKeys.Add(code);}keys=new HashSet<string>(perKeyboard.Values.SelectMany(v=>v));}
                            if((keys.Contains("ControlLeft") || keys.Contains("ControlRight")) && (keys.Contains("AltLeft") || keys.Contains("AltRight")) && keys.Contains("Escape")){stop("Emergency release: Ctrl + Alt + Esc.");continue;}}
                        else {if(!perMouse.ContainsKey(device))perMouse[device]=new HashSet<int>();var deviceButtons=perMouse[device];int state=BitConverter.ToUInt16(stroke,0),flags=BitConverter.ToUInt16(stroke,2);if(state!=0)urgent=true;int[] down={1,16,4},up={2,32,8};for(int b=0;b<3;b++){if((state&down[b])!=0)deviceButtons.Add(b);if((state&up[b])!=0)deviceButtons.Remove(b);}buttons=new HashSet<int>(perMouse.Values.SelectMany(v=>v));if((flags&1)==0){dx+=BitConverter.ToInt32(stroke,8);dy+=BitConverter.ToInt32(stroke,12);}else{absolute=true;x=Math.Max(0,Math.Min(1,BitConverter.ToInt32(stroke,8)/65535.0));y=Math.Max(0,Math.Min(1,BitConverter.ToInt32(stroke,12)/65535.0));}if((state&1024)!=0)wheelY-=BitConverter.ToInt16(stroke,4);if((state&2048)!=0)wheelX+=BitConverter.ToInt16(stroke,4);}
                    }}
                }else Thread.Sleep(2);
                if(active && (urgent || Age(lastSample)>=8)){
                    List<object> snapshots=new List<object>();foreach(string id in selected.Where(id=>id.StartsWith("pad:")))snapshots.Add(pads[id].Snapshot(deviceSlots[id]));
                    Emit(new {type="state",gamepads=snapshots,keys=keys.Take(32).ToArray(),repeats=repeats.Where(code=>keys.Contains(code)).Take(32).ToArray(),mouse=new {buttons=buttons.ToArray(),absolute=absolute,x=x,y=y,dx=dx,dy=dy,wheelX=wheelX,wheelY=wheelY}});dx=dy=0;wheelX=wheelY=0;absolute=false;urgent=false;repeats.Clear();lastSample=Clock();
                }
            }
            stop("Input reader closed.");
        }catch(Exception error){Emit(new {type="error",error=ErrorText(error)});Environment.ExitCode=1;}
        finally{
            if(inputTiming!=null)inputTiming.Dispose();
            if(notification!=IntPtr.Zero)CM_Unregister_Notification(notification);
            if(context!=IntPtr.Zero)Filter.interception_destroy_context(context);
            foreach(Pad pad in pads.Values)pad.Dispose();if(sdl)SDL.SDL_Quit();
            if(guard!=null){try{guard.StandardInput.Close();guard.WaitForExit(2500);}catch{}}
            if(File.Exists(Journal))try{using(Process recovery=Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"--recover"){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true})){recovery.WaitForExit(2500);}}catch{}
        }
        GC.KeepAlive(filter);
        GC.KeepAlive(notify);
    }
}
