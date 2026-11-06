import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {macDesktopCapability} from './macos-desktop.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
function pulseLibrary(env){
  if(env.NATIVE_AUDIO_LIBPULSE)return fs.existsSync(env.NATIVE_AUDIO_LIBPULSE);
  for(const folder of ['/lib','/usr/lib','/usr/lib64','/lib64']){
    if(fs.existsSync(path.join(folder,'libpulse.so.0')))return true;
    try{for(const name of fs.readdirSync(folder))if(name.endsWith('-linux-gnu') && fs.existsSync(path.join(folder,name,'libpulse.so.0')))return true;}catch{}
  }
  return false;
}
export function nativeAudioCapability(env=process.env,platform=process.platform) {
  if(platform==='darwin'){const capability=macDesktopCapability(env);return {...capability,window:capability.available};}
  if(platform==='linux'){
    const helper=env.NATIVE_AUDIO_HELPER || path.join(root,'system/native/linux_audio.py');
    const available=fs.existsSync(helper) && pulseLibrary(env);
    return {available,window:available,helper,error:available?null:'Install Python 3 and libpulse0 (or your distribution’s libpulse package), with PulseAudio or pipewire-pulse running in your user session.'};
  }
  const helper=env.NATIVE_AUDIO_HELPER || path.join(root,'.local/tools/webrtc-pad-audio.exe');
  const available=platform==='win32' && fs.existsSync(helper);
  return {available,window:available && Number(os.release().split('.')[2])>=20348,helper,error:platform!=='win32'?'Native audio is unavailable on this platform. Use browser audio or another call.':!available?'Run native capture setup to install the audio helper.':null};
}
export function audioArguments(port) {
  if(!Number.isInteger(port) || port<1 || port>65535)throw new Error('Invalid native audio port');
  return ['-hide_banner','-nostdin','-loglevel','error','-f','s16le','-ar','48000','-ac','2','-probesize','32','-analyzeduration','0','-i','pipe:0','-c:a','libopus','-application','lowdelay','-frame_duration','10','-b:a','192000','-ar','48000','-ac','2','-flush_packets','1','-f','rtp','-payload_type','111',`rtp://127.0.0.1:${port}?pkt_size=1200`];
}
export async function startNativeAudio({ffmpeg,helper,pid=0,env=process.env,platform=process.platform,onFailure=()=>{}}) {
  if(!Number.isInteger(pid) || pid<0 || pid>0x7fffffff)throw new Error('Invalid audio application');
  const child=spawn(platform==='linux'?(env.PYTHON || 'python3'):helper,[...(platform==='linux'?['-B','-u',helper]:platform==='darwin'?['audio']:[]),'--pid',String(pid)],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,...env}});
  child.stdin.on('error',()=>{});
  let encoder,closed=false,stderr='';
  const close=()=>{if(closed)return;closed=true;child.stdout.unpipe();child.stdin.end();child.kill();encoder?.stdin.end();encoder?.kill();};
  try {
    await new Promise((resolve,reject)=>{
      let header='';const timer=setTimeout(()=>reject(new Error('Audio capture initialization timed out')),12000);
      const ready=buffer=>{header+=buffer.toString('utf8');if(header.length>2048){clearTimeout(timer);reject(new Error('Invalid audio helper response'));return;}if(!header.includes('\n'))return;
        child.stdout.off('data',ready);clearTimeout(timer);
        try {const value=JSON.parse(header.trim());if(value.format!=='s16le'||value.sampleRate!==48000||value.channels!==2)throw new Error('Unsupported native audio format');resolve();}catch(error){reject(error);}
      };
      child.stdout.on('data',ready);child.stderr.on('data',data=>{stderr=(stderr+data).slice(-2000);});
      child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error(stderr || 'Audio capture stopped before initialization'));});
    });
    return {async start(port){
      const args=audioArguments(port);args.splice(4,0,'-stats_period','0.1','-progress','pipe:1');
      encoder=spawn(ffmpeg,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,...env}});
      encoder.stderr.on('data',data=>{stderr=(stderr+data).slice(-2000);});
      const fail=error=>{if(!closed){close();onFailure(error);}};
      encoder.on('error',fail);encoder.stdin.on('error',fail);child.stdin.on('error',fail);
      encoder.on('exit',()=>fail(new Error(stderr || 'Native audio encoder stopped')));
      child.on('exit',()=>fail(new Error(stderr || 'Native audio capture stopped')));
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{const error=new Error('Native audio encoder did not produce packets');fail(error);reject(error);},8000);
        createInterface({input:encoder.stdout}).on('line',line=>{if(/^out_time_us=\d+/.test(line) && Number(line.split('=')[1])>0){clearTimeout(timer);resolve();}});
        encoder.once('error',error=>{clearTimeout(timer);reject(error);});encoder.once('exit',()=>{clearTimeout(timer);reject(new Error(stderr || 'Native audio encoder stopped'));});
        child.stdout.pipe(encoder.stdin);child.stdin.write('start\n');
      });
    },close};
  } catch(error){close();throw error;}
}
