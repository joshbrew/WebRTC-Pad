// WASAPI system/process loopback -> 48 kHz stereo PCM on stdout.
// No microphone, browser chooser, virtual audio driver, or recording file.
using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDevices {
    void EnumAudioEndpoints(int flow, int mask, out IntPtr collection);
    void GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDevice {
    void Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
}
[ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudio {
    void Initialize(int mode, uint flags, long duration, long periodicity, ref WaveFormat format, IntPtr session);
    void GetBufferSize(out uint frames);
    void GetStreamLatency(out long latency);
    void GetCurrentPadding(out uint frames);
    [PreserveSig] int IsFormatSupported(int mode, IntPtr format, out IntPtr closest);
    void GetMixFormat(out IntPtr format);
    void GetDevicePeriod(out long normal, out long minimum);
    void Start();
    void Stop();
    void Reset();
    void SetEventHandle(IntPtr handle);
    void GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
}
[ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ICapture {
    void GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong timestamp);
    void ReleaseBuffer(uint frames);
    void GetNextPacketSize(out uint frames);
}
[ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IActivationOperation {
    void GetActivateResult(out int result, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
}
[ComVisible(true), Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IActivationCallback { [PreserveSig] int ActivateCompleted(IActivationOperation operation); }
[ComVisible(true), Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAgileMarker { }
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class ActivationCallback : IActivationCallback, IAgileMarker {
    internal readonly ManualResetEvent Done = new ManualResetEvent(false);
    internal IAudio Audio;
    internal Exception Error;
    public int ActivateCompleted(IActivationOperation operation) {
        try {int result; object instance; operation.GetActivateResult(out result, out instance); Marshal.ThrowExceptionForHR(result); Audio=(IAudio)instance;}
        catch(Exception error){Error=error;}
        finally {Done.Set();}
        return 0;
    }
}
[StructLayout(LayoutKind.Sequential, Pack=2)]
public struct WaveFormat {
    public ushort Tag, Channels;
    public uint Rate, BytesPerSecond;
    public ushort BlockAlign, Bits, Extra;
}
class NativeAudio {
    [DllImport("Mmdevapi.dll", CharSet=CharSet.Unicode)]
    static extern int ActivateAudioInterfaceAsync(string path, ref Guid iid, IntPtr parameters, IActivationCallback callback, out IActivationOperation operation);
    static volatile bool running=true;
    static Process target;
    static IAudio Open(uint pid) {
        Guid iid=typeof(IAudio).GUID;
        if(pid==0) {
            IDevices devices=(IDevices)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
            IDevice device;devices.GetDefaultAudioEndpoint(0,0,out device);
            object instance;device.Activate(ref iid,23,IntPtr.Zero,out instance);
            Marshal.ReleaseComObject(device);Marshal.ReleaseComObject(devices);
            return (IAudio)instance;
        }
        // AUDIOCLIENT_ACTIVATION_PARAMS: process loopback, include target tree.
        IntPtr activation=Marshal.AllocHGlobal(12),variant=Marshal.AllocHGlobal(24);
        IActivationOperation operation=null;ActivationCallback callback=new ActivationCallback();
        try {
            for(int i=0;i<24;i++)Marshal.WriteByte(variant,i,0);
            Marshal.WriteInt32(activation,0,1);Marshal.WriteInt32(activation,4,checked((int)pid));Marshal.WriteInt32(activation,8,0);
            Marshal.WriteInt16(variant,0,65); // VT_BLOB
            Marshal.WriteInt32(variant,8,12);Marshal.WriteIntPtr(variant,16,activation);
            Marshal.ThrowExceptionForHR(ActivateAudioInterfaceAsync("VAD\\Process_Loopback",ref iid,variant,callback,out operation));
            if(!callback.Done.WaitOne(10000))throw new Exception("Application audio activation timed out.");
            if(callback.Error!=null)throw callback.Error;
            return callback.Audio;
        } finally {if(operation!=null)Marshal.ReleaseComObject(operation);Marshal.FreeHGlobal(variant);Marshal.FreeHGlobal(activation);GC.KeepAlive(callback);}
    }
    [MTAThread]
    static int Main(string[] args) {
        IAudio audio=null;ICapture capture=null;
        try {
            uint pid=0;if(args.Length!=2 || args[0]!="--pid" || !uint.TryParse(args[1],out pid))throw new Exception("Use --pid 0 for system audio, or a selected application's process ID.");
            if(pid!=0){target=Process.GetProcessById(checked((int)pid));if(target.HasExited)throw new Exception("Selected application has closed.");}
            audio=Open(pid);
            WaveFormat format=new WaveFormat{Tag=1,Channels=2,Rate=48000,BytesPerSecond=192000,BlockAlign=4,Bits=16,Extra=0};
            audio.Initialize(0,0x80020000,1000000,0,ref format,IntPtr.Zero); // loopback + PCM conversion
            Guid captureId=typeof(ICapture).GUID;object instance;audio.GetService(ref captureId,out instance);capture=(ICapture)instance;
            Console.Out.WriteLine("{\"format\":\"s16le\",\"sampleRate\":48000,\"channels\":2}");Console.Out.Flush();
            if(Console.ReadLine()!="start")return 0;
            Thread input=new Thread(delegate(){while(Console.ReadLine()!=null){} running=false;});input.IsBackground=true;input.Start();
            Stream output=Console.OpenStandardOutput();audio.Start();
            byte[] buffer=new byte[48000*4],silence=new byte[480*4];long lastProcessCheck=0,framesWritten=0;Stopwatch clock=Stopwatch.StartNew();
            while(running) {
                if(target!=null && clock.ElapsedMilliseconds-lastProcessCheck>500){if(target.HasExited)break;lastProcessCheck=clock.ElapsedMilliseconds;}
                uint frames;capture.GetNextPacketSize(out frames);
                if(frames==0){if(clock.ElapsedMilliseconds*48-framesWritten>960){output.Write(silence,0,silence.Length);framesWritten+=480;}Thread.Sleep(3);continue;}
                while(frames>0) {
                    IntPtr data;uint flags;ulong position,time;capture.GetBuffer(out data,out frames,out flags,out position,out time);
                    try {
                        int size=checked((int)frames*4);if(size>buffer.Length)buffer=new byte[size];
                        if((flags&2)!=0)Array.Clear(buffer,0,size);else Marshal.Copy(data,buffer,0,size);
                        output.Write(buffer,0,size);
                        framesWritten+=frames;
                    } finally {capture.ReleaseBuffer(frames);}
                    capture.GetNextPacketSize(out frames);
                }
            }
            return 0;
        } catch(Exception error) {Console.Error.WriteLine("Native audio: "+error.Message);return 1;}
        finally {if(audio!=null){try{audio.Stop();}catch{} }if(capture!=null)Marshal.ReleaseComObject(capture);if(audio!=null)Marshal.ReleaseComObject(audio);if(target!=null)target.Dispose();}
    }
}
