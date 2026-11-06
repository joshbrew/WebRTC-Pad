import fs from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {nativeCapability} from './native-media.js';
import {macDesktopCapability} from './macos-desktop.js';
const execute=promisify(execFile);
export async function sourceThumbnail(target,env=process.env,platform=process.platform,run=execute){
  if(!target || !['desktop','window'].includes(target.kind))throw Error('Invalid capture source');
  let command,args;
  if(platform==='win32'){
    command=env.NATIVE_THUMBNAIL_HELPER || fileURLToPath(new URL('../../.local/tools/webrtc-pad-thumbnail.exe',import.meta.url));
    if(!fs.existsSync(command))throw Error('Thumbnail helper needs an update');
    args=target.kind==='desktop'?['desktop']:[String(target.id),String(target.pid)];
  } else if(platform==='darwin'){
    command=macDesktopCapability(env).helper;if(!command)throw Error('Mac helper unavailable');
    args=['thumbnail'];
  } else if(platform==='linux'){
    if(!/^:[\d.]+$/.test(env.DISPLAY || '') || env.XDG_SESSION_TYPE==='wayland')throw Error('Thumbnails require X11');
    command=nativeCapability(env,platform).ffmpeg;if(!command)throw Error('FFmpeg unavailable');
    if(![target.width,target.height].every(n=>Number.isInteger(n)&&n>1&&n<=32768))throw Error('Unknown source size');
    args=['-hide_banner','-nostdin','-loglevel','error','-f','x11grab','-video_size',`${target.width}x${target.height}`,...(target.kind==='window'?['-window_id',String(target.id)]:[]),'-i',env.DISPLAY,'-frames:v','1','-vf','scale=320:180:force_original_aspect_ratio=decrease','-f','image2pipe','-c:v','png','pipe:1'];
  } else throw Error('Thumbnails unavailable');
  const {stdout}=await run(command,args,{encoding:'buffer',windowsHide:true,timeout:2200,maxBuffer:512*1024,env:{...process.env,...env,...(platform==='darwin'?{NATIVE_WINDOW_HANDLE:target.kind==='window'?String(target.id):'',NATIVE_WINDOW_PID:String(target.pid || 0),NATIVE_WINDOW_START:target.processStart || ''}:{})}});
  if(!Buffer.isBuffer(stdout) || stdout.length<8 || !stdout.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('No thumbnail available');
  return stdout;
}
