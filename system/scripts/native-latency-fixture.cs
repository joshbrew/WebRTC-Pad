// Harmless animated window. Its pixels encode the wall clock so an actual
// decoded WebRTC frame can be timed without OCR or synchronized remote clocks.
using System;
using System.Drawing;
using System.Windows.Forms;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.IO;
using System.Media;
class NativeLatencyFixture : Form {
    SoundPlayer player;MemoryStream wave;
    [DllImport("winmm.dll")]static extern uint timeBeginPeriod(uint period);
    [DllImport("winmm.dll")]static extern uint timeEndPeriod(uint period);
    [DllImport("user32.dll")]static extern bool ShowWindow(IntPtr window,int command);
    NativeLatencyFixture(bool audio){
        Text="Local preview latency test";ClientSize=new Size(640,360);DoubleBuffered=true;BackColor=Color.FromArgb(16,28,35);
        timeBeginPeriod(1);
        bool shown=false;var timer=new System.Windows.Forms.Timer();timer.Interval=15;timer.Tick+=(s,e)=>{if(!shown){ShowWindow(Handle,4);shown=true;}Invalidate();};timer.Start();
        Shown+=(s,e)=>{if(audio){wave=new MemoryStream();var writer=new BinaryWriter(wave);writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));writer.Write(36+192000);writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt "));writer.Write(16);writer.Write((short)1);writer.Write((short)2);writer.Write(48000);writer.Write(192000);writer.Write((short)4);writer.Write((short)16);writer.Write(System.Text.Encoding.ASCII.GetBytes("data"));writer.Write(192000);writer.Write(new byte[192000]);writer.Flush();wave.Position=0;player=new SoundPlayer(wave);player.PlayLooping();}Console.WriteLine("{\"id\":\""+Handle.ToInt64()+"\",\"pid\":"+Process.GetCurrentProcess().Id+"}");Console.Out.Flush();var reader=new Thread(()=>{Console.ReadLine();try{BeginInvoke(new Action(Close));}catch{}});reader.IsBackground=true;reader.Start();};
    }
    protected override void OnPaint(PaintEventArgs e){
        base.OnPaint(e);long now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        using(var font=new Font("Segoe UI",18)){e.Graphics.DrawString("Local preview latency test",font,Brushes.PaleGreen,24,24);e.Graphics.DrawString("Generated pixels only",font,Brushes.White,24,68);}
        e.Graphics.FillRectangle(Brushes.Magenta,24,120,32,16);
        for(int bit=0;bit<24;bit++)e.Graphics.FillRectangle(((now>>bit)&1)==1?Brushes.White:Brushes.Black,56+bit*16,120,16,16);
        e.Graphics.FillRectangle(Brushes.Cyan,440,120,16,16);
        e.Graphics.FillEllipse(Brushes.SkyBlue,24+(int)(now/4%540),220,48,48);
    }
    protected override void OnFormClosed(FormClosedEventArgs e){if(player!=null){player.Stop();player.Dispose();wave.Dispose();}timeEndPeriod(1);base.OnFormClosed(e);}
    [STAThread]static void Main(string[] args){Application.EnableVisualStyles();Application.Run(new NativeLatencyFixture(args.Length>0));}
}
