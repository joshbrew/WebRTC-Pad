import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export const encoderNames={h264_nvenc:'NVIDIA NVENC',h264_qsv:'Intel Quick Sync',h264_amf:'AMD AMF',h264_videotoolbox:'Apple VideoToolbox',libx264:'CPU software encoding'};
Object.assign(encoderNames,{hevc_nvenc:'NVIDIA NVENC (H.265)',hevc_qsv:'Intel Quick Sync (H.265)',hevc_amf:'AMD AMF (H.265)'});
export function encoderForCodec(encoder,codec='h264'){
  if(!['h264','h265'].includes(codec))throw new Error('Unsupported native video codec');
  if(codec==='h265'){
    if(!/^(?:h264|hevc)_(?:nvenc|qsv|amf)$/.test(encoder))throw new Error('H.265 requires a supported native hardware encoder. Use H.264 on this host.');
    return encoder.replace(/^h264_/, 'hevc_');
  }
  return encoder.replace(/^hevc_/,'h264_');
}
export function encoderCandidates(env={},platform=process.platform) {
  if(env.NATIVE_ENCODER)return [env.NATIVE_ENCODER];
  return platform==='win32'?['h264_nvenc','h264_qsv','h264_amf']:platform==='darwin'?['h264_videotoolbox']:['h264_nvenc'];
}
export function videoEncoderArguments(encoder,fps,bitrate,env={}) {
  if(!Object.hasOwn(encoderNames,encoder))throw new Error('Unsupported NATIVE_ENCODER');
  const args=['-an','-c:v',encoder];
  // NVENC's default asynchronous output queue still holds several frames even
  // with zerolatency enabled. Interactive streams must explicitly disable it.
  if(encoder.endsWith('_nvenc')){
    const preset=env.NATIVE_NVENC_PRESET || 'p1';
    if(!/^p[1-7]$/.test(preset))throw new Error('NATIVE_NVENC_PRESET must be p1–p7');
    args.push('-preset',preset,'-tune','ull','-rc','cbr','-rc-lookahead','0','-zerolatency','1','-delay','0','-forced-idr','1');
  }
  if(encoder.endsWith('_qsv')){
    // Quick Sync defaults to four asynchronous operations. Even with B frames
    // and lookahead disabled, that queues several captures before output.
    const depth=Number(env.NATIVE_QSV_ASYNC_DEPTH || 1);
    if(!Number.isInteger(depth) || depth<1 || depth>8)throw new Error('NATIVE_QSV_ASYNC_DEPTH must be 1–8');
    args.push('-preset','veryfast','-look_ahead','0','-async_depth',String(depth),'-forced_idr','1');
  }
  if(encoder.endsWith('_amf'))args.push('-usage','ultralowlatency','-quality','balanced','-rc','cbr','-forced_idr','1');
  if(encoder==='libx264')args.push('-preset','veryfast','-tune','zerolatency');
  const buffer=encoder.endsWith('_nvenc')?Math.max(1,Math.ceil(bitrate/fps)):Math.round(bitrate*.2);
  // Capture already supplies timestamps and a rate cap. Do not manufacture
  // duplicate frames or retime fresh captures to a constant-rate output clock.
  args.push('-profile:v',encoder.startsWith('hevc_')?'main':encoder==='h264_amf'?'constrained_baseline':'baseline','-bf','0','-g',String(fps),'-force_key_frames','expr:if(isnan(prev_forced_t),1,gte(t,prev_forced_t+1))','-b:v',String(bitrate),'-maxrate',String(bitrate),'-bufsize',String(buffer),'-fps_mode','passthrough');
  return args;
}
async function graphicsNames(platform,run,env) {
  try {
    let result;
    const options={windowsHide:true,timeout:8000,maxBuffer:256*1024,env:{...process.env,...env}};
    if(platform==='win32') {
      result=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress'],options);
      const names=JSON.parse(result.stdout.replace(/^\uFEFF/,'').trim() || '[]');
      return [...new Set([names].flat().filter(name=>typeof name==='string').map(name=>name.slice(0,160)))].slice(0,16);
    }
    if(platform==='linux') {
      result=await run('lspci',['-mm'],options);
      return result.stdout.split(/\r?\n/).filter(line=>/VGA compatible controller|3D controller|Display controller/i.test(line)).map(line=>line.slice(0,200)).slice(0,16);
    }
    if(platform==='darwin') {
      result=await run('/usr/sbin/system_profiler',['SPDisplaysDataType','-json'],options);
      return (JSON.parse(result.stdout).SPDisplaysDataType || []).map(device=>device.sppci_model || device._name).filter(name=>typeof name==='string').map(name=>name.slice(0,160)).slice(0,16);
    }
  } catch { /* Driver initialization is checked even if the OS inventory is unavailable. */ }
  return [];
}
function failureReason(error) {
  if(/^NATIVE_/.test(error.message || ''))return error.message.slice(0,240);
  if(error.killed || error.code==='ETIMEDOUT')return 'Encoder check timed out.';
  const lines=String(error.stderr || '').split(/\r?\n/).filter(line=>line.trim());
  return (lines.find(line=>/Cannot load|No capable|Unknown encoder|not supported|Error initializing|No device|Cannot open|Failed to|not found/i.test(line)) || 'Could not initialize this encoder with the installed hardware and drivers.').slice(0,240);
}
export function createEncoderScanner({ffmpeg,env={},platform=process.platform,run=execute,now=Date.now}={}) {
  let cached=null,pending=null;
  const scan=async(force=false)=>{
    if(pending)return pending;
    if(cached && now()-cached.checkedAt<(force?10000:5*60*1000))return cached;
    pending=(async()=>{
      if(!ffmpeg)return {checkedAt:now(),selected:null,configured:env.NATIVE_ENCODER || null,devices:[],encoders:[],error:'Install native capture tools first, then check again.'};
      const devicesPromise=graphicsNames(platform,run,env),encoders=[];
      for(const encoder of encoderCandidates(env,platform)) {
        if(!Object.hasOwn(encoderNames,encoder)){encoders.push({id:encoder,label:'Configured encoder',available:false,error:'Unsupported NATIVE_ENCODER setting.'});continue;}
        // Encode generated frames to a null sink. No screen, camera, microphone,
        // file output, or network stream is opened by this check.
        try {
          const args=['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i','color=c=black:s=640x360:r=30','-frames:v','2','-pix_fmt',encoder==='libx264'?'yuv420p':'nv12',...videoEncoderArguments(encoder,30,2000000,env),'-f','null','-'];
          await run(ffmpeg,args,{windowsHide:true,timeout:6000,maxBuffer:256*1024,env:{...process.env,...env}});encoders.push({id:encoder,label:encoderNames[encoder],available:true,hardware:encoder!=='libx264'});
        }
        catch(error){encoders.push({id:encoder,label:encoderNames[encoder],available:false,error:failureReason(error),hardware:encoder!=='libx264'});}
      }
      return {checkedAt:now(),selected:encoders.find(encoder=>encoder.available)?.id || null,configured:env.NATIVE_ENCODER || null,devices:await devicesPromise,encoders,error:encoders.some(encoder=>encoder.available)?null:env.NATIVE_ENCODER?'The configured encoder could not start. Check its drivers or remove NATIVE_ENCODER from your settings to use automatic selection.':'No working native hardware encoder was found. Check your graphics drivers, or use browser capture.'};
    })();
    try {cached=await pending;return cached;}finally{pending=null;}
  };
  return {scan,peek:()=>cached};
}
