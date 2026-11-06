import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codecSupport} from '../public/codecs.js';
import {effectiveQuality} from '../public/quality.js';
import {streamSettings} from '../public/media.js';
import {encoderForCodec,videoEncoderArguments} from '../src/encoder-scan.js';
import {captureArguments,NativeMedia} from '../src/native-media.js';

test('HEVC requires both WebRTC negotiation and efficient smooth hardware decoding',async()=>{
  const api={RTCRtpReceiver:{getCapabilities:()=>({codecs:[{mimeType:'video/H265'}]})},navigator:{mediaCapabilities:{decodingInfo:async()=>({supported:true,powerEfficient:true,smooth:true})}}};
  assert.deepEqual((await codecSupport({},api)).codecs,['h264','h265']);
  api.navigator.mediaCapabilities.decodingInfo=async()=>({supported:true,powerEfficient:false,smooth:true});assert.deepEqual((await codecSupport({},api)).codecs,['h264']);
  api.navigator.mediaCapabilities.decodingInfo=async()=>{throw Error('unsupported');};assert.equal((await codecSupport({},api)).hevcAvailable,false);
  assert.equal((await codecSupport({},{})).hevcAvailable,false);
});
test('each guest chooses a compatible codec without increasing encoder work for matching peers',()=>{
  const host={...streamSettings('1080',60),codec:'h265',encoderPreset:'p1'};
  assert.equal(effectiveQuality(host,{codecs:['h264','h265']}).codec,'h265');
  assert.equal(effectiveQuality(host,{}).codec,'h264','Old guests remain compatible');
  assert.equal(effectiveQuality(host,{codec:'h264',codecs:['h264','h265']}).codec,'h264');
  assert.equal(effectiveQuality({...host,codec:'h264'},{codec:'h265',codecs:['h265']}).codec,'h264','Guest cannot force a host codec');
});
test('HEVC stays on hardware with no reordering or hidden output queue',()=>{
  assert.equal(encoderForCodec('h264_nvenc','h265'),'hevc_nvenc');assert.equal(encoderForCodec('hevc_qsv','h264'),'h264_qsv');
  assert.throws(()=>encoderForCodec('libx264','h265'),/hardware/);
  const args=videoEncoderArguments('hevc_nvenc',60,8000000);for(const name of ['-bf','-delay','-rc-lookahead'])assert.equal(args[args.indexOf(name)+1],'0');assert.equal(args[args.indexOf('-profile:v')+1],'main');
  const capture=captureArguments({...streamSettings('720',60),codec:'h265',encoderPreset:'p2'},5004,{NATIVE_WINDOWS_CAPTURE:'wgc',NATIVE_CAPTURE_SOURCE_SIZE:'1920x1080',NATIVE_GPU_SCALING:'1'},'win32');
  assert.equal(capture.encoder,'hevc_nvenc');assert.ok(!capture.args.includes('-vf'),'HEVC keeps the WGC GPU scaling path');assert.equal(capture.args[capture.args.indexOf('-preset')+1],'p2');
});
test('different codecs cannot share one native profile and matching HEVC viewers reuse it',async()=>{
  const engine=new NativeMedia({},'win32'),requests=[];
  engine.rpc=async request=>{requests.push(request);return {port:5004,codec:request.codec};};engine.startEncoder=async()=>{};
  const quality=streamSettings('720',60);await engine.offer('a',{...quality,codec:'h265'},{iceServers:[]});await engine.offer('b',{...quality,codec:'h265'},{iceServers:[]});
  assert.equal(engine.profiles.size,1);await engine.offer('c',{...quality,codec:'h264'},{iceServers:[]});assert.equal(engine.profiles.size,2);assert.notEqual(requests[0].profile,requests.find(request=>request.peerId===engine.transports.get('c').id).profile);engine.close();
});
