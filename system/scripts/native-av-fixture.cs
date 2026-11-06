// Local developer fixture: animated harmless window and a quiet generated tone.
using System;
using System.IO;
using System.Media;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using System.Threading;
using System.Runtime.InteropServices;
class NativeAVFixture : Form {
    [DllImport("user32.dll")]static extern bool ShowWindow(IntPtr window,int command);
    SoundPlayer player;MemoryStream wave;int frame;double frequency;
    NativeAVFixture(double hz) {frequency=hz;Text="Native audio test "+hz+" Hz";ClientSize=new Size(640,360);BackColor=Color.FromArgb(16,28,35);DoubleBuffered=true;
      var timer=new System.Windows.Forms.Timer();timer.Interval=16;timer.Tick+=(s,e)=>{frame++;if(frame==1){ShowWindow(Handle,4);Console.WriteLine("{\"id\":\""+Handle.ToInt64()+"\",\"pid\":"+Process.GetCurrentProcess().Id+",\"kind\":\"window\",\"label\":\"Native audio test "+frequency+" Hz\"}");Console.Out.Flush();}Invalidate();};timer.Start();
      Shown+=(s,e)=>{byte[] pcm=new byte[48000*4];for(int n=0;n<48000;n++){short sample=(short)(Math.Sin(n*hz*2*Math.PI/48000)*900);Buffer.BlockCopy(BitConverter.GetBytes(sample),0,pcm,n*4,2);Buffer.BlockCopy(BitConverter.GetBytes(sample),0,pcm,n*4+2,2);}
        wave=new MemoryStream();var w=new BinaryWriter(wave);w.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));w.Write(36+pcm.Length);w.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt "));w.Write(16);w.Write((short)1);w.Write((short)2);w.Write(48000);w.Write(192000);w.Write((short)4);w.Write((short)16);w.Write(System.Text.Encoding.ASCII.GetBytes("data"));w.Write(pcm.Length);w.Write(pcm);w.Flush();wave.Position=0;player=new SoundPlayer(wave);player.PlayLooping();
        var input=new Thread(()=>{Console.ReadLine();try{BeginInvoke(new Action(Close));}catch{}});input.IsBackground=true;input.Start();};
    }
    protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);using(var font=new Font("Segoe UI",20)){e.Graphics.DrawString("Native audio + video test",font,Brushes.PaleGreen,20,25);e.Graphics.DrawString(frequency+" Hz  |  frame "+frame,font,Brushes.White,20,75);}e.Graphics.FillEllipse(Brushes.SkyBlue,20+(frame*3)%540,180,50,50);}
    protected override void OnFormClosed(FormClosedEventArgs e){if(player!=null){player.Stop();player.Dispose();}if(wave!=null)wave.Dispose();base.OnFormClosed(e);}
    [STAThread]static void Main(string[] args){Application.EnableVisualStyles();Application.Run(new NativeAVFixture(args.Length>0?double.Parse(args[0]):660));}
}
