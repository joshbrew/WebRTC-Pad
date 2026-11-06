import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEncoderScanner,videoEncoderArguments} from '../src/encoder-scan.js';
import {NativeMedia} from '../src/native-media.js';
import {createApp} from '../src/server.js';
import {once} from 'node:events';
import http from 'node:http';

test('Quick Sync defaults to a single in-flight frame and bounded tuning is shared by the scan',async()=>{
  const args=videoEncoderArguments('h264_qsv',60,8000000);
  assert.equal(args[args.indexOf('-async_depth')+1],'1');
  assert.equal(args[args.indexOf('-bufsize')+1],'1600000','Queue fix must preserve rate control and quality');
  for(const depth of ['0','9','1.5','bad'])assert.throws(()=>videoEncoderArguments('h264_qsv',60,8000000,{NATIVE_QSV_ASYNC_DEPTH:depth}),/ASYNC_DEPTH/);
  assert.throws(()=>videoEncoderArguments('h264_nvenc',60,8000000,{NATIVE_NVENC_PRESET:'p8'}),/PRESET/);
  let checked=false;
  const scanner=createEncoderScanner({ffmpeg:'test',platform:'linux',env:{NATIVE_ENCODER:'h264_qsv',NATIVE_QSV_ASYNC_DEPTH:'2'},run:async(command,args)=>{
    if(command==='test'){assert.equal(args[args.indexOf('-async_depth')+1],'2');checked=true;}return {stdout:''};
  }});
  assert.equal((await scanner.scan()).selected,'h264_qsv');assert.equal(checked,true);
  const invalid=createEncoderScanner({ffmpeg:'test',env:{NATIVE_ENCODER:'h264_nvenc',NATIVE_NVENC_PRESET:'invalid'},run:async()=>({stdout:'[]'})});
  assert.equal((await invalid.scan()).encoders[0].available,false,'Bad settings must be reported as a failed check');
});

test('scan verifies encoder startup, chooses a working encoder, and caches concurrent checks',async()=>{
  const calls=[];let clock=100000;
  const scanner=createEncoderScanner({ffmpeg:'test-ffmpeg',platform:'win32',now:()=>clock,run:async(command,args)=>{
    calls.push({command,args});
    if(command==='powershell.exe')return {stdout:JSON.stringify(['AMD Radeon Test','Intel Graphics Test'])};
    const encoder=args[args.indexOf('-c:v')+1];
    if(encoder!=='h264_amf')throw Object.assign(new Error('Unavailable'),{stderr:'Cannot load encoder driver'});
    assert.ok(args.includes('color=c=black:s=640x360:r=30'));assert.equal(args.at(-2),'null');
    assert.ok(!args.some(arg=>/ddagrab|gfxcapture|x11grab|avfoundation|rtp:/.test(arg)));
    return {stdout:''};
  }});
  const [first,second]=await Promise.all([scanner.scan(),scanner.scan()]);
  assert.equal(first,second);assert.equal(first.selected,'h264_amf');assert.equal(first.encoders.filter(encoder=>encoder.available).length,1);
  assert.deepEqual(first.devices,['AMD Radeon Test','Intel Graphics Test']);assert.equal(calls.length,4);
  await scanner.scan(true);assert.equal(calls.length,4,'Repeated clicks reuse a recent check');
  clock+=11000;await scanner.scan(true);assert.equal(calls.length,8);
});
test('explicit encoder failures remain visible, while CPU encoding is only checked when explicitly configured',async()=>{
  const failed=createEncoderScanner({ffmpeg:'test',platform:'win32',env:{NATIVE_ENCODER:'h264_amf'},run:async()=>{throw new Error('Unavailable');}});
  const value=await failed.scan();assert.equal(value.selected,null);assert.deepEqual(value.encoders.map(encoder=>encoder.id),['h264_amf']);assert.match(value.error,/configured encoder/);
  const cpu=createEncoderScanner({ffmpeg:'test',platform:'win32',env:{NATIVE_ENCODER:'libx264'},run:async()=>({stdout:'[]'})});
  const result=await cpu.scan();assert.equal(result.selected,'libx264');assert.equal(result.encoders[0].hardware,false);
  const absent=await createEncoderScanner().scan();assert.equal(absent.selected,null);assert.match(absent.error,/Install native/);
});
test('native capture tries the checked encoder first and retains fallback if capture startup fails',async()=>{
  const engine=new NativeMedia({},'win32','h264_amf'),attempts=[];
  engine.startEncoderWith=async(profile,quality,port,encoder)=>{attempts.push(encoder);if(encoder==='h264_amf')throw new Error('Capture initialization failed');};
  await engine.startEncoder({}, {frameRate:30},5004);
  assert.deepEqual(attempts,['h264_amf','h264_nvenc']);assert.equal(engine.preferredEncoder,'h264_nvenc');engine.close();
});
test('encoder scan endpoint is local only, accepts GET, and does not expose runtime paths',async t=>{
  let scans=0;
  const app=createApp({env:{},encoderScanner:{peek:()=>null,scan:async()=>{scans++;return {selected:'h264_amf',encoders:[],devices:['AMD Test']};}}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const url=`http://127.0.0.1:${app.server.address().port}/encoder-check`;
  assert.equal((await fetch(url,{method:'POST'})).status,405);
  const denied=await new Promise((resolve,reject)=>{const request=http.get(url,{headers:{Host:'other.example'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
  assert.equal(denied,403);
  const result=await (await fetch(url)).json();assert.equal(result.selected,'h264_amf');assert.equal(scans,1);
  assert.equal('ffmpeg' in result,false);
});


test('static window updates can recover without waiting for a full second of new captured frames',()=>{
  for(const encoder of ['h264_nvenc','h264_qsv','h264_amf','libx264']){
    const args=videoEncoderArguments(encoder,60,8000000);
    assert.equal(args[args.indexOf('-force_key_frames')+1],'expr:if(isnan(prev_forced_t),1,gte(t,prev_forced_t+1))');
    assert.equal(args[args.indexOf('-fps_mode')+1],'passthrough','Do not fill a quiet window with duplicated video frames');
  }
});
