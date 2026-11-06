// On-demand source chooser thumbnails. No input, audio or persistent files.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
class SourceThumbnail {
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect rect);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window,IntPtr dc,uint flags);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    static int Main(string[] args) {
        try {
            SetProcessDPIAware();
            bool desktop=args.Length==1 && args[0]=="desktop";IntPtr window=IntPtr.Zero;uint expected=0;
            Rect rect=new Rect();
            if(desktop){rect.Right=GetSystemMetrics(0);rect.Bottom=GetSystemMetrics(1);}
            else {
                long id;if(args.Length!=2 || !long.TryParse(args[0],out id) || id<=0 || !uint.TryParse(args[1],out expected) || expected==0)return 2;
                window=new IntPtr(id);uint pid;GetWindowThreadProcessId(window,out pid);
                // PrintWindow paints in the target's DPI context. Match its
                // coordinates so legacy emulators don't occupy one corner.
                try{SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(window));}catch(EntryPointNotFoundException){}
                if(pid!=expected || !IsWindowVisible(window) || IsIconic(window) || !GetWindowRect(window,out rect))return 3;
            }
            int width=rect.Right-rect.Left,height=rect.Bottom-rect.Top;
            if(width<2 || height<2 || (long)width*height>20000000)return 4;
            using(Bitmap source=new Bitmap(width,height,PixelFormat.Format32bppRgb)) {
                using(Graphics graphics=Graphics.FromImage(source)) {
                    if(desktop)graphics.CopyFromScreen(0,0,0,0,new Size(width,height));
                    else {IntPtr dc=graphics.GetHdc();try{if(!PrintWindow(window,dc,2))return 5;}finally{graphics.ReleaseHdc(dc);}}
                }
                if(!desktop){uint pid;GetWindowThreadProcessId(window,out pid);if(pid!=expected)return 3;}
                double scale=Math.Min(320.0/width,180.0/height);
                using(Bitmap small=new Bitmap(Math.Max(1,(int)(width*scale)),Math.Max(1,(int)(height*scale)))) {
                    using(Graphics graphics=Graphics.FromImage(small)){graphics.InterpolationMode=InterpolationMode.Bilinear;graphics.DrawImage(source,new Rectangle(0,0,small.Width,small.Height),new Rectangle(0,0,width,height),GraphicsUnit.Pixel);}
                    small.Save(Console.OpenStandardOutput(),ImageFormat.Png);
                }
            }
            return 0;
        }catch{return 1;}
    }
}
