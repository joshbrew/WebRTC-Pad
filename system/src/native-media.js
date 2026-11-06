import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import {encoderCandidates,videoEncoderArguments,encoderForCodec} from './encoder-scan.js';
import {nativeAudioCapability,startNativeAudio} from './native-audio.js';
import {desktopSession} from './desktop-capabilities.js';
import {macDesktopCapability} from './macos-desktop.js';
import {captureRegion} from './capture-region.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile);
function captureProfileKey(quality, source) {
  let width = quality.width, height = quality.height;
  if (source?.width && source?.height) {
    const scale = Math.min(1, (width || source.width) / source.width, (height || source.height) / source.height);
    width = Math.floor(source.width * scale / 2) * 2; height = Math.floor(source.height * scale / 2) * 2;
  }
  return `${width || 'native'}x${height || 'native'}-${quality.frameRate}-${quality.maxBitrate}-${quality.codec || 'h264'}-${quality.encoderPreset || 'default'}`;
}
function executable(command, env) {
  if (path.isAbsolute(command)) return fs.existsSync(command) ? command : null;
  for (const folder of (env.PATH || env.Path || '').split(path.delimiter)) for (const extension of process.platform === 'win32' ? ['', '.exe'] : ['']) {
    const candidate = path.join(folder, command + extension); if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
export function nativeCapability(env = process.env, platform = process.platform) {
  const helper = executable(env.NATIVE_MEDIA_HELPER || path.join(root, '.local/tools', `webrtc-pad-media${platform === 'win32' ? '.exe' : ''}`), env);
  let ffmpeg = executable(env.FFMPEG_BIN || 'ffmpeg', env);
  if (!ffmpeg && platform === 'win32') {
    const folder = path.join(root, '.local/tools/ffmpeg');
    try { for (const entry of fs.readdirSync(folder)) { const candidate = path.join(folder, entry, 'bin/ffmpeg.exe'); if (fs.existsSync(candidate)) { ffmpeg = candidate; break; } } } catch { /* Optional runtime. */ }
  }
  const supported = platform === 'win32' || platform === 'linux' && desktopSession(env,platform)==='x11' || platform === 'darwin' && macDesktopCapability(env).available;
  return { available: !!helper && !!ffmpeg && supported, helper, ffmpeg, platform, error: !supported ? platform==='linux'?'Native video needs an X11 login session. Use browser video in this session; native playback audio is separate.':platform==='darwin'?macDesktopCapability(env).error:'Native video is unavailable on this platform.' : !helper || !ffmpeg ? 'Run native capture setup first; see system/docs/native-capture.md.' : null };
}
export function captureArguments(quality, port, env = process.env, platform = process.platform) {
  const fps = Math.max(15, Math.min(120, Number(quality.frameRate) || 60));
  const bitrate = Math.max(500000, Math.min(60000000, Number(quality.maxBitrate) || 8000000));
  const encoder = encoderForCodec(env.NATIVE_ENCODER || (platform === 'win32' ? 'h264_nvenc' : platform === 'darwin' ? 'h264_videotoolbox' : 'h264_nvenc'),quality.codec || 'h264');
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'info', '-stats_period', '0.2', '-progress', 'pipe:1'];
  const display = Number(env.NATIVE_DISPLAY_INDEX || 0);
  if (!Number.isInteger(display) || display < 0 || display > 15) throw new Error('NATIVE_DISPLAY_INDEX must be 0–15');
  const capture = env.NATIVE_WINDOWS_CAPTURE || 'auto', handle = env.NATIVE_WINDOW_HANDLE || '';
  const source = /^(\d{1,5})x(\d{1,5})$/.exec(env.NATIVE_CAPTURE_SOURCE_SIZE || '');
  const sourceWidth=Number(source?.[1]),sourceHeight=Number(source?.[2]);
  const knownSize=sourceWidth>1 && sourceHeight>1 && sourceWidth<=32768 && sourceHeight<=32768;
  const area=captureRegion(env.NATIVE_CAPTURE_REGION,knownSize?{width:sourceWidth,height:sourceHeight}:undefined);
  const wgc=platform==='win32' && (capture==='wgc' || handle);
  if(area && wgc && !knownSize)throw new Error('Refresh the source list before selecting an area.');
  const cropOptions=area && wgc?`:crop_left=${area.x}:crop_top=${area.y}:crop_right=${sourceWidth-area.x-area.width}:crop_bottom=${sourceHeight-area.y-area.height}`:'';
  const gpuScale=platform==='win32' && (capture==='wgc' || handle) && encoder.endsWith('_nvenc') && quality.width && quality.height && knownSize && env.NATIVE_GPU_SCALING==='1';
  let captureScale='';
  if(gpuScale){
    const widthIn=area?.width || sourceWidth,heightIn=area?.height || sourceHeight;
    const ratio=Math.min(1,quality.width/widthIn,quality.height/heightIn);
    const width=Math.max(2,Math.floor(widthIn*ratio/2)*2),height=Math.max(2,Math.floor(heightIn*ratio/2)*2);
    captureScale=`:width=${width}:height=${height}:resize_mode=scale_aspect:scale_mode=bilinear:output_fmt=bgra`;
  }
  if (platform === 'win32') {
    if (!['auto','dda','wgc'].includes(capture)) throw new Error('NATIVE_WINDOWS_CAPTURE must be auto, dda or wgc');
    if (handle && (!/^\d{1,20}$/.test(handle) || BigInt(handle) <= 0n || BigInt(handle) > 18446744073709551615n)) throw new Error('NATIVE_WINDOW_HANDLE must be a positive decimal HWND');
    if (handle && capture === 'dda') throw new Error('Window capture requires auto or wgc');
    args.push('-f', 'lavfi', '-i', capture === 'wgc' || handle ? `gfxcapture=${handle ? 'hwnd=' + handle : 'monitor_idx=' + display}:max_framerate=${fps}:capture_cursor=1:display_border=1${cropOptions}${captureScale}` : `ddagrab=output_idx=${display}:framerate=${fps}:draw_mouse=1`);
  }
  else if (platform === 'darwin') {
    throw new Error('Mac video uses the ScreenCaptureKit helper, not FFmpeg screen device indexes.');
  } else {
    if (!/^:[\d.]+$/.test(env.DISPLAY || '')) throw new Error('Native Linux capture requires a local X11 DISPLAY');
    if (!/^\d{3,5}x\d{3,5}$/.test(env.NATIVE_SCREEN_SIZE || '')) throw new Error('Native Linux capture needs a detected X11 desktop size');
    if(handle && (!/^\d{1,10}$/.test(handle) || Number(handle)<=0 || Number(handle)>0xffffffff))throw new Error('Invalid X11 window identity');
    args.push('-f', 'x11grab', '-video_size', env.NATIVE_SCREEN_SIZE, '-framerate', String(fps),...(handle?['-window_id',handle]:[]), '-i', env.DISPLAY);
  }
  const filters = [];
  // WGC can resize on its own graphics device before passing the texture to
  // NVENC. Avoid a second D3D11 device/scaler and GPU -> CPU -> GPU copies.
  const direct = platform === 'win32' && encoder.endsWith('_nvenc') && !quality.width && !area;
  if (!direct && !gpuScale) {
    if (platform === 'win32') filters.push('hwdownload', 'format=bgra');
    if(area && !wgc)filters.push(`crop=${area.width}:${area.height}:${area.x}:${area.y}:exact=1`);
    if (quality.width && quality.height) filters.push(`scale=w='min(iw,${Math.floor(quality.width / 2) * 2})':h='min(ih,${Math.floor(quality.height / 2) * 2})':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear`);
    filters.push(encoder === 'libx264' ? 'format=yuv420p' : 'format=nv12');
    args.push('-vf', filters.join(','));
  }
  args.push(...videoEncoderArguments(encoder,fps,bitrate,{...env,...(quality.encoderPreset?{NATIVE_NVENC_PRESET:quality.encoderPreset}:{})}), '-f', 'rtp', '-payload_type', '96', `rtp://127.0.0.1:${port}?pkt_size=1200`);
  return { args, encoder, capture: platform === 'win32' ? capture === 'wgc' || handle ? 'Windows Graphics Capture' : 'DXGI desktop duplication' : 'X11', scaling: direct ? 'GPU texture → encoder' : gpuScale?'GPU scaling → hardware encoder':'Native scaling → hardware encoder' };
}
export class NativeMedia extends EventEmitter {
  constructor(env = process.env, platform = process.platform, preferredEncoder = null) {
    super(); this.env = env; this.platform = platform; this.capability = nativeCapability(env, platform); this.pending = new Map(); this.profiles = new Map(); this.peers = new Map(); this.sequence = 0; this.closed = false;
    this.preferredEncoder=preferredEncoder;this.audioGeneration=0;this.transports=new Map();this.transportSequence=0;
    const area=captureRegion(env.NATIVE_CAPTURE_REGION);if(area)this.sourceSize={width:area.width,height:area.height};
  }
  async start() {
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      if (!this.capability.available && !(this.env.NATIVE_AUDIO_ONLY==='1' && this.capability.helper && this.capability.ffmpeg)) { reject(new Error(this.capability.error)); return; }
      const child = spawn(this.capability.helper, [], { stdio: ['pipe', 'pipe', 'pipe'], env:{...process.env,...this.env}, windowsHide: true }); this.child = child;
      let ready = false, stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Native media helper startup timed out')); }, 10000);
      child.stderr.on('data', b => { stderr = (stderr + b).slice(-2000); });
      createInterface({ input: child.stdout }).on('line', line => {
        let message; try { message = JSON.parse(line); } catch { return; }
        if (message.event === 'ready') { ready = true; clearTimeout(timer); resolve(); }
        else if(message.event==='source-ready') {this.pending.get(message.requestId)?.onSource?.(message);}
        else if (message.id) {
          const pending = this.pending.get(message.id); if (!pending) return;
          this.pending.delete(message.id); clearTimeout(pending.timer);
          if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
        } else if (message.event) this.mediaStatus(message);
      });
      const fail = error => {
        clearTimeout(timer); if (!ready) reject(error);
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear();
        if (!this.closed) this.emit('status', { event: 'error', error: error.message });
      };
      child.on('error', fail); child.stdin.on('error', fail);
      child.on('exit', code => { fail(new Error(stderr || `Native media helper exited (${code})`)); for (const profile of this.profiles.values()) profile.child?.kill();this.stopAudio(); });
    });
    return this.starting;
  }
  async rpc(message,onSource) {
    await this.start(); if (this.closed) throw new Error('Native media is closed');
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Native media request timed out')); }, 35000);
      this.pending.set(id, { resolve, reject, timer,onSource });
      this.child.stdin.write(JSON.stringify({ ...message, id }) + '\n');
    });
  }
  mediaStatus(message) {
    const entry=[...this.transports].find(([,value])=>value.id===message.peerId);
    if(entry && message.event==='state' && message.state==='connected' && (entry[0]==='preview' || this.env.NATIVE_AUDIO_ONLY==='1' || !entry[1].previous))this.retirePrevious(entry[1]);
    this.emit('status',entry?{...message,peerId:entry[0]}:message);
  }
  retirePrevious(transport) {
    clearTimeout(transport.timer);
    const previous=transport.previous;transport.previous=null;
    if(previous)this.releaseTransport(previous).catch(()=>{});
  }
  ready(peerId) {const transport=this.transports.get(peerId);if(transport){transport.confirmed=true;this.retirePrevious(transport);}}
  expireHandover(peerId,transport) {
    if(this.transports.get(peerId)!==transport || !transport.previous)return;
    // A timeout is not proof of presentation. Restore the last working
    // encoder instead of destroying it while a replacement is still black.
    let parent=transport,previous=transport.previous;
    while(previous.previous && !previous.confirmed){parent=previous;previous=previous.previous;}
    parent.previous=null;clearTimeout(previous.timer);
    this.transports.set(peerId,previous);this.peers.set(peerId,previous.key);
    this.releaseTransport(transport).catch(()=>{});
    this.emit('status',{event:'handover-timeout',peerId,restored:true});
  }
  async releaseTransport(transport) {
    if(!transport || transport.closed)return;
    transport.closed=true;clearTimeout(transport.timer);
    const profile=this.profiles.get(transport.key);
    if(profile && --profile.refs<=0){profile.child?.kill();this.profiles.delete(transport.key);}
    await Promise.all([this.closed?null:this.rpc({type:'close',peerId:transport.id}).catch(()=>{}),this.releaseTransport(transport.previous)]);
  }
  async offer(peerId, quality, ice,{videoOnly=false}={}) {
    const audioOnly=this.env.NATIVE_AUDIO_ONLY==='1';
    const desired = audioOnly?'audio-only':captureProfileKey(quality, this.sourceSize);
    // Preview may have started before the source's aspect ratio was known.
    // Reuse its actual output even when the client's fitted dimensions differ
    // from the original 16:9 bounding box.
    const key = [...this.profiles].find(([, profile]) => captureProfileKey(profile.quality, this.sourceSize) === desired)?.[0] || desired;
    const maximum = Number(this.env.NATIVE_MAX_PROFILES || 4);
    const previous = this.profiles.get(this.peers.get(peerId));
    if (!this.profiles.has(key) && this.profiles.size >= maximum && previous?.refs !== 1) throw new Error('Native encoder profile limit reached. Choose a quality already used by another friend.');
    // Keep the old transport and encoder alive while ICE gathers and the new
    // quality connects. Auto-throttling must not blank a working guest picture.
    const previousTransport=this.transports.get(peerId);
    // Browsers allow a single URL string; Pion's JSON API requires arrays.
    const nativeIce = { ...ice, iceServers: (ice.iceServers || []).map(server => ({ ...server, urls: Array.isArray(server.urls) ? server.urls : [server.urls] })) };
    // Reserve an audio track without capturing sound. Toggling audio later can
    // then reuse every existing peer connection and video encoder.
    let profile=this.profiles.get(key);
    if(!profile){profile={refs:0,quality:{...quality}};this.profiles.set(key,profile);}
    profile.refs++;this.peers.set(peerId,key);
    const transport={id:`${peerId}:${++this.transportSequence}`,key,previous:previousTransport};
    this.transports.set(peerId,transport);
    transport.timer=setTimeout(()=>{
      if(this.transports.get(peerId)!==transport)return;
      this.expireHandover(peerId,transport);
    },45000);transport.timer.unref();
    let preparing;
    const prepare=value=>{
      if(preparing)return;
      this.audioPort=value.audioPort || this.audioPort;
      profile.starting ||= audioOnly?Promise.resolve():this.startEncoder(profile,quality,value.port);
      preparing=Promise.all([profile.starting,videoOnly?null:this.ensureAudio()]);
      preparing.catch(()=>{});
    };
    try {
      // Begin encoding as soon as RTP ports exist, while ICE gathers routes.
      const value=await this.rpc({type:'offer',peerId:transport.id,profile:key,codec:quality.codec || 'h264',ice:nativeIce,audioOnly,audio:!videoOnly && (['win32','linux','darwin'].includes(this.platform) || this.env.NATIVE_AUDIO==='1')},prepare);
      if(!audioOnly && quality.codec==='h265' && value.codec!=='h265')throw new Error('Run native capture setup to update H.265 support.');
      if(audioOnly && value.audioOnly!==true)throw new Error('Run native capture setup to update audio-only streaming.');
      prepare(value);await preparing;
      if(this.transports.get(peerId)!==transport || this.closed)throw new Error('Native video request was superseded');
      return {...value,ice,quality,sourceSize:this.sourceSize,encoder:profile.encoder,scaling:profile.scaling,capture:profile.capture,audioAvailable:!videoOnly && !!this.audio,audioError:videoOnly?'':this.audioError};
    } catch(error){
      if(this.transports.get(peerId)===transport){
        if(previousTransport && !previousTransport.closed){this.transports.set(peerId,previousTransport);this.peers.set(peerId,previousTransport.key);transport.previous=null;}
        else {this.transports.delete(peerId);this.peers.delete(peerId);}
      }
      await this.releaseTransport(transport);throw error;
    }
  }
  stopAudio() {
    this.audioGeneration++;this.audio?.close();this.audio=null;this.audioStarting=null;
  }
  async setAudio(enabled,pid=0) {
    if(this.env.NATIVE_AUDIO===(enabled?'1':'0') && Number(this.env.NATIVE_AUDIO_PID || 0)===pid && !this.audioError && (!enabled || this.audio))return {audioAvailable:!!this.audio};
    this.env={...this.env,NATIVE_AUDIO:enabled?'1':'0',NATIVE_AUDIO_PID:String(pid)};
    this.stopAudio();this.audioError=null;
    await this.ensureAudio();
    return {audioAvailable:!!this.audio,audioError:this.audioError};
  }
  async ensureAudio() {
    if(this.closed || this.env.NATIVE_AUDIO!=='1' || !this.audioPort || this.audioError)return;
    if(this.audioStarting)return this.audioStarting;
    if(this.audio)return;
    const generation=this.audioGeneration,port=this.audioPort;
    this.audioStarting=(async()=>{
      try {
        const capability=nativeAudioCapability(this.env,this.platform);
        if(!capability.available)throw new Error(capability.error);
        const pid=Number(this.env.NATIVE_AUDIO_PID || 0);
        if(pid && !capability.window)throw new Error('Application-only audio is unavailable. System audio is never substituted.');
        const failed=error=>{if(this.closed || generation!==this.audioGeneration)return;this.audioError=error.message;this.audio=null;this.emit('status',{event:'audio-error',error:error.message});};
        const audio=await startNativeAudio({ffmpeg:this.capability.ffmpeg,helper:capability.helper,pid,env:this.env,platform:this.platform,onFailure:failed});
        if(this.closed || generation!==this.audioGeneration){audio.close();return;}
        this.audio=audio;await audio.start(port);
      } catch(error){if(!this.closed && generation===this.audioGeneration){this.audioError=error.message;this.audio=null;this.emit('status',{event:'audio-error',error:error.message});}}
    })();
    return this.audioStarting;
  }
  async startEncoder(profile, quality, port) {
    if(this.platform==='darwin'){if(quality.codec==='h265')throw new Error('Mac native capture currently uses H.264.');return this.startMacEncoder(profile,quality,port);}
    if (this.platform === 'linux' && !this.captureEnv) {
      let size = this.env.NATIVE_SCREEN_SIZE;
      if(this.env.NATIVE_WINDOW_HANDLE){const {captureTargets}=await import('./desktop-input.js');const target=(await captureTargets(this.env,'linux')).find(t=>t.id===this.env.NATIVE_WINDOW_HANDLE && t.pid===Number(this.env.NATIVE_WINDOW_PID) && t.processStart===this.env.NATIVE_WINDOW_START);if(!target)throw new Error('Selected X11 window closed or changed. Choose it again.');size=`${target.width}x${target.height}`;}
      if (!size) { const result = await execute('xrandr', ['--current'], { env: { ...process.env, ...this.env }, timeout: 5000 }); const match = result.stdout.match(/current\s+(\d+)\s+x\s+(\d+)/); if (match) size = `${match[1]}x${match[2]}`; }
      if (!/^\d{3,5}x\d{3,5}$/.test(size || '')) throw new Error('Could not detect X11 screen size. Install xrandr or set NATIVE_SCREEN_SIZE=WIDTHxHEIGHT.');
      this.captureEnv = { ...this.env, NATIVE_SCREEN_SIZE: size, NATIVE_CAPTURE_SOURCE_SIZE:size }; const [width,height] = size.split('x').map(Number); if(!this.env.NATIVE_CAPTURE_REGION)this.sourceSize = { width,height };
    }
    const candidates = encoderCandidates(this.env,this.platform).map(encoder=>encoderForCodec(encoder,quality.codec || 'h264'));
    if(candidates.includes(this.preferredEncoder))candidates.sort((a,b)=>Number(b===this.preferredEncoder)-Number(a===this.preferredEncoder));
    const requested = this.env.NATIVE_WINDOWS_CAPTURE || 'auto';
    const captures = this.platform !== 'win32' ? [undefined] : this.env.NATIVE_WINDOW_HANDLE ? ['wgc'] : requested === 'auto' ? this.preferredCapture === 'wgc' ? ['wgc','dda'] : ['dda','wgc'] : [requested];
    let lastError;
    for (const capture of captures) for (const encoder of candidates) {
      try { await this.startEncoderWith(profile, quality, port, encoder, capture); this.preferredCapture = capture; this.preferredEncoder=encoder; return; }
      catch (error) { lastError = error; if (/Selected output not supported|Desktop duplication access denied|Failed duplicating output/.test(error.message)) break; }
    }
    throw lastError;
  }
  async startMacEncoder(profile,quality,port){
    const capability=macDesktopCapability(this.env);if(!capability.available)throw new Error(capability.error);
    if(!Number.isInteger(port) || port<1 || port>65535)throw new Error('Invalid native video port');
    profile.encoder='h264_videotoolbox';profile.capture='ScreenCaptureKit';profile.scaling='ScreenCaptureKit GPU scaling → VideoToolbox';
    const args=['video','--port',String(port),'--fps',String(quality.frameRate || 60),'--bitrate',String(quality.maxBitrate || 8000000)];
    if(quality.width && quality.height)args.push('--width',String(quality.width),'--height',String(quality.height));
    const child=spawn(capability.helper,args,{stdio:['pipe','pipe','pipe'],env:{...process.env,...this.env},windowsHide:true});profile.child=child;
    child.stdin.on('error',()=>{});
    await new Promise((resolve,reject)=>{
      let ready=false,stderr='';const timer=setTimeout(()=>{child.kill();reject(new Error('Mac capture did not produce frames. Check Screen Recording permission.'));},12000);
      child.stderr.on('data',data=>{stderr=(stderr+data).slice(-3000);});
      createInterface({input:child.stdout}).on('line',line=>{try{const value=JSON.parse(line);if(value.event==='source' && [value.sourceSize?.width,value.sourceSize?.height].every(n=>Number.isInteger(n)&&n>0&&n<=32768)){this.sourceSize=value.sourceSize;profile.scaling=value.hardware?'ScreenCaptureKit GPU scaling → hardware VideoToolbox':'ScreenCaptureKit scaling → software VideoToolbox';}if(value.event==='frame' && !ready){ready=true;clearTimeout(timer);resolve();}}catch{}});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);if(!ready)reject(new Error(stderr || `Mac capture stopped (${code})`));else if(!this.closed && profile.refs>0)this.emit('status',{event:'error',error:stderr || `Mac capture stopped (${code})`});});
    });
  }
  async startEncoderWith(profile, quality, port, selectedEncoder, selectedCapture) {
    if(!this.sourceSize){const size=/^(\d{1,5})x(\d{1,5})$/.exec(this.env.NATIVE_CAPTURE_SOURCE_SIZE || '');if(size && size.slice(1).every(n=>Number(n)>1 && Number(n)<=32768))this.sourceSize={width:Number(size[1]),height:Number(size[2])};}
    if(this.platform==='win32' && selectedCapture==='wgc' && selectedEncoder.endsWith('_nvenc') && quality.width && quality.height && this.sourceSize && this.env.NATIVE_GPU_SCALING!=='0' && this.preferredGPUScale!==false) {
      try {await this.startEncoderPipeline(profile,quality,port,selectedEncoder,selectedCapture,true);this.preferredGPUScale=true;return;}
      catch(error) {profile.child?.kill();this.preferredGPUScale=false;this.gpuScaleError=error.message;}
    }
    return this.startEncoderPipeline(profile,quality,port,selectedEncoder,selectedCapture,false);
  }
  async startEncoderPipeline(profile, quality, port, selectedEncoder, selectedCapture, gpuScale) {
    const { args, encoder, scaling, capture } = captureArguments(quality, port, { ...(this.captureEnv || this.env),...(this.sourceSize && !this.env.NATIVE_CAPTURE_REGION?{NATIVE_CAPTURE_SOURCE_SIZE:`${this.sourceSize.width}x${this.sourceSize.height}`} : {}),NATIVE_GPU_SCALING:gpuScale?'1':'0', NATIVE_ENCODER: selectedEncoder, ...(selectedCapture ? { NATIVE_WINDOWS_CAPTURE: selectedCapture } : {}) }, this.platform);
    profile.encoder = encoder; profile.scaling = scaling; profile.capture = capture;
    const child = spawn(this.capability.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); profile.child = child;
    await new Promise((resolve, reject) => {
      let ready = false, stderr = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Native encoder did not produce frames')); }, 12000);
      child.stderr.on('data', b => {
        stderr = (stderr + b).slice(-4000);
        const match = String(b).match(/Video: wrapped_avframe, d3d11, (\d+)x(\d+)/);
        if (match && !gpuScale && !this.env.NATIVE_CAPTURE_REGION) this.sourceSize = { width: Number(match[1]), height: Number(match[2]) };
        if (this.platform === 'darwin' && !this.sourceSize) { const input = stderr.split('Output #')[0].match(/Video: rawvideo[^\n]*?\b(\d{3,5})x(\d{3,5})\b/); if (input) this.sourceSize = { width: Number(input[1]), height: Number(input[2]) }; }
      });
      createInterface({ input: child.stdout }).on('line', line => { if (!ready && /^frame=\s*[1-9]/.test(line)) { ready = true; clearTimeout(timer); resolve(); } });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', code => {
        clearTimeout(timer);
        if (!ready) reject(new Error(`Native encoder could not start. ${stderr.slice(-1200)}`));
        else if (!this.closed && profile.refs > 0) this.emit('status', { event: 'error', error: `Native encoder stopped (${code})` });
      });
    });
  }
  async answer(peerId, sdp) { const transport=this.transports.get(peerId);if(!transport)throw new Error('Native video ended');return this.rpc({ type: 'answer', peerId:transport.id, sdp }); }
  async ice(peerId,candidate) {const transport=this.transports.get(peerId);if(!transport)return;return this.rpc({type:'ice',peerId:transport.id,candidate});}
  async closePeer(peerId) {
    const key = this.peers.get(peerId); if (!key) return;
    this.peers.delete(peerId);const transport=this.transports.get(peerId);this.transports.delete(peerId);
    if(!this.peers.size){this.stopAudio();this.audioPort=null;}
    await this.releaseTransport(transport);
  }
  async closeGuest(peerId){await Promise.all([this.closePeer(peerId),...[...this.peers.keys()].filter(id=>id.startsWith(`${peerId}:view:`)).map(id=>this.closePeer(id))]);}
  close() {
    if (this.closed) return; this.closed = true;
    this.stopAudio();
    for(const transport of this.transports.values())this.releaseTransport(transport).catch(()=>{});this.transports.clear();
    for (const profile of this.profiles.values()) profile.child?.kill(); this.profiles.clear(); this.peers.clear();
    this.child?.stdin.end();
    if (this.child) { const timer = setTimeout(() => this.child?.kill(), 1000); timer.unref(); this.child.once('exit', () => clearTimeout(timer)); }
  }
}
