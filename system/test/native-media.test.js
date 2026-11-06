import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureArguments, NativeMedia } from '../src/native-media.js';
import { streamSettings } from '../public/media.js';
test('native full-size capture retains GPU frames, downscaled clients use native scaling and encoded RTP', () => {
  const full = captureArguments(streamSettings('native', 60), 5004, {}, 'win32');
  assert.ok(!full.args.includes('-vf')); assert.equal(full.encoder, 'h264_nvenc');
  assert.equal(full.args[full.args.indexOf('-delay')+1],'0','NVENC must not queue additional completed frames');
  assert.equal(full.args[full.args.indexOf('-bufsize')+1],String(Math.ceil(streamSettings('native',60).maxBitrate/60)),'Interactive NVENC uses a one-frame bitrate reservoir');
  assert.equal(full.args[full.args.indexOf('-fps_mode')+1],'passthrough','Do not delay or duplicate fresh capture frames for a second output clock');
  const small = captureArguments(streamSettings('720', 30), 5004, {}, 'win32');
  assert.match(small.args[small.args.indexOf('-vf') + 1], /hwdownload.*min\(iw,1280\).*min\(ih,720\)/);
  assert.ok(small.args.at(-1).startsWith('rtp://127.0.0.1:5004'));
  assert.throws(() => captureArguments({}, 5004, { NATIVE_ENCODER: 'arbitrary' }, 'win32'));
});
test('native Windows capture supports WGC windows and rejects malformed source settings', () => {
  const window = captureArguments(streamSettings('native',60),5004,{NATIVE_WINDOW_HANDLE:'1377616'},'win32');
  assert.ok(window.args.some(arg=>arg.includes('gfxcapture=hwnd=1377616:max_framerate=60')));
  assert.equal(window.capture,'Windows Graphics Capture');assert.ok(!window.args.includes('-vf'));
  assert.throws(()=>captureArguments({},5004,{NATIVE_WINDOW_HANDLE:'123:monitor_idx=1'},'win32'));
  assert.throws(()=>captureArguments({},5004,{NATIVE_WINDOWS_CAPTURE:'unknown'},'win32'));
  assert.throws(()=>captureArguments({},5004,{NATIVE_WINDOW_HANDLE:'123',NATIVE_WINDOWS_CAPTURE:'dda'},'win32'));
});
test('Windows GPU scaling keeps pixels on the graphics device and preserves aspect ratio within host limits',()=>{
  const env={NATIVE_WINDOWS_CAPTURE:'wgc',NATIVE_GPU_SCALING:'1',NATIVE_CAPTURE_SOURCE_SIZE:'2560x1600'};
  const result=captureArguments(streamSettings('1080',60),5004,env,'win32');
  assert.ok(result.args.some(arg=>arg.includes('width=1728:height=1080:resize_mode=scale_aspect')));assert.ok(!result.args.includes('-vf'));
  const small=captureArguments(streamSettings('1080',60),5004,{...env,NATIVE_CAPTURE_SOURCE_SIZE:'641x361'},'win32');
  assert.ok(small.args.some(arg=>arg.includes('width=640:height=360:')),'Never enlarge a small or odd-sized source');
  const unknown=captureArguments(streamSettings('1080',60),5004,{...env,NATIVE_CAPTURE_SOURCE_SIZE:''},'win32');
  assert.ok(unknown.args.includes('-vf'),'Unknown source dimensions must still enforce quality bounds');
});
test('GPU scaling rejection falls back to compatible scaling and remembers it without killing other profiles',async()=>{
  const engine=new NativeMedia({NATIVE_CAPTURE_SOURCE_SIZE:'2560x1600'},'win32'),attempts=[];let killed=0;
  engine.startEncoderPipeline=async(profile,q,port,e,c,gpu)=>{attempts.push(gpu);if(gpu){profile.child={kill(){killed++;}};throw new Error('GPU scaler unavailable');}};
  await engine.startEncoderWith({},streamSettings('720',60),5004,'h264_nvenc','wgc');
  await engine.startEncoderWith({},streamSettings('1080',60),5006,'h264_nvenc','wgc');
  assert.deepEqual(attempts,[true,false,false]);assert.equal(killed,1);engine.close();
});
test('unsupported DXGI output switches to WGC without changing the requested encoder or quality',async()=>{
  const engine=new NativeMedia({},'win32'), attempts=[];
  engine.startEncoderWith=async(profile,quality,port,encoder,capture)=>{attempts.push({encoder,capture,quality});if(capture==='dda')throw new Error('Selected output not supported');profile.capture='Windows Graphics Capture';};
  const quality=streamSettings('720',60);
  await engine.startEncoder({},quality,5004);
  assert.deepEqual(attempts.map(a=>[a.capture,a.encoder]),[['dda','h264_nvenc'],['wgc','h264_nvenc']]);
  assert.equal(attempts[1].quality,quality);attempts.length=0;
  await engine.startEncoder({},quality,5004);assert.equal(attempts[0].capture,'wgc');engine.close();
});
test('AMD AMF and Intel QSV use their own hardware settings rather than NVIDIA options', () => {
  const amd = captureArguments(streamSettings('1080', 60), 5004, { NATIVE_ENCODER: 'h264_amf' }, 'win32');
  assert.equal(amd.args[amd.args.indexOf('-profile:v') + 1], 'constrained_baseline');
  assert.ok(amd.args.includes('ultralowlatency')); assert.ok(!amd.args.includes('-zerolatency'));
  const intel = captureArguments(streamSettings('1080', 60), 5004, { NATIVE_ENCODER: 'h264_qsv' }, 'win32');
  assert.ok(intel.args.includes('-look_ahead')); assert.ok(!intel.args.includes('p4'));
  assert.equal(intel.args[intel.args.indexOf('-async_depth')+1],'1');
  const tuned=captureArguments(streamSettings('720',60),5004,{NATIVE_NVENC_PRESET:'p2'},'win32');
  assert.equal(tuned.args[tuned.args.indexOf('-preset')+1],'p2');
});
test('native media normalizes browser ICE URL strings for Pion and shares matching profiles', async () => {
  const engine = new NativeMedia({}, 'win32'), requests = [];
  engine.rpc = async value => { requests.push(value); return { port: 5004 }; };
  engine.startEncoder = async profile => { profile.encoder = 'test'; };
  const ice = { iceServers: [{ urls: 'stun:example.com:3478' }, { urls: ['turn:example.com'], username: 'test', credential: 'test' }] };
  await engine.offer('one', streamSettings('720', 30), ice);
  await engine.offer('two', streamSettings('720', 30), ice);
  assert.deepEqual(requests[0].ice.iceServers[0].urls, ['stun:example.com:3478']);
  assert.equal(engine.profiles.size, 1); assert.equal([...engine.profiles.values()][0].refs, 2);
  await engine.closePeer('one'); assert.equal(engine.profiles.size, 1);
  await engine.closePeer('two'); assert.equal(engine.profiles.size, 0); engine.close();
});

test('native quality replacement keeps the old guest picture and audio alive until the new transport connects',async()=>{
  const engine=new NativeMedia({},'win32'),commands=[],killed=[];
  engine.rpc=async value=>{commands.push(value);return {port:5004,audioPort:5006};};
  engine.startEncoder=async(profile,q)=>{profile.child={kill(){killed.push(q.height);}};};
  await engine.offer('guest',streamSettings('1080',60),{iceServers:[]});
  const first=engine.transports.get('guest');engine.audio={close(){throw Error('Audio must remain alive');}};
  await engine.offer('guest',streamSettings('720',60),{iceServers:[]});
  const second=engine.transports.get('guest');
  assert.notEqual(second.id,first.id);assert.equal(second.previous,first);assert.deepEqual(killed,[]);
  assert.equal(commands.some(c=>c.type==='close'),false,'ICE gathering cannot retire working media');
  await engine.answer('guest',{type:'answer',sdp:'fixture'});
  assert.equal(commands.at(-1).peerId,second.id);assert.deepEqual(killed,[]);
  engine.mediaStatus({event:'state',peerId:second.id,state:'connected'});
  assert.deepEqual(killed,[],'A connected socket may still be waiting for its first decodable frame');
  engine.ready('guest');
  assert.deepEqual(killed,[1080]);assert.equal(second.previous,null);assert.equal(engine.profiles.size,1);
  engine.audio=null;await engine.closePeer('guest');assert.deepEqual(killed,[1080,720]);engine.close();
});

test('a failed native quality replacement restores its working transport and cancels new resources',async()=>{
  const engine=new NativeMedia({},'win32'),killed=[];
  engine.rpc=async value=>{if(value.type==='offer' && value.profile.startsWith('1280x720'))throw Error('Encoder unavailable');return {port:5004};};
  engine.startEncoder=async(profile,q)=>{profile.child={kill(){killed.push(q.height);}};};
  await engine.offer('guest',streamSettings('1080',60),{iceServers:[]});const first=engine.transports.get('guest');
  await assert.rejects(engine.offer('guest',streamSettings('720',60),{iceServers:[]}),/Encoder unavailable/);
  assert.equal(engine.transports.get('guest'),first);assert.equal(engine.peers.get('guest'),first.key);assert.equal(engine.profiles.size,1);assert.deepEqual(killed,[]);
  engine.close();assert.deepEqual(killed,[1080]);
});

for(const platform of ['win32','linux','darwin'])test(`${platform}: an unpresented quality change times out to working media, including rapid replacement failures`,async()=>{
  const engine=new NativeMedia({},platform),killed=[],events=[];
  engine.on('status',event=>events.push(event));
  engine.rpc=async()=>({port:5004});
  engine.startEncoder=async(profile,q)=>{profile.child={kill(){killed.push(q.height);}};};
  try {
    await engine.offer('guest',streamSettings('1080',60),{iceServers:[]});engine.ready('guest');
    const working=engine.transports.get('guest');
    await engine.offer('guest',streamSettings('720',60),{iceServers:[]});const stale=engine.transports.get('guest');
    await engine.offer('guest',streamSettings('480',60),{iceServers:[]});const pending=engine.transports.get('guest');
    engine.expireHandover('guest',stale);assert.equal(engine.transports.get('guest'),pending,'A stale timeout cannot undo a newer offer');
    engine.expireHandover('guest',pending);
    assert.equal(engine.transports.get('guest'),working);assert.equal(engine.peers.get('guest'),working.key);
    assert.equal(working.closed,undefined);assert.deepEqual(killed.sort(),[480,720]);
    assert.equal(engine.profiles.size,1);assert.deepEqual(events,[{event:'handover-timeout',peerId:'guest',restored:true}]);
    engine.ready('guest');engine.expireHandover('guest',pending);assert.equal(engine.transports.get('guest'),working);
  }finally{engine.close();}
});
test('a non-16:9 source shares its preview encoder with an equivalently fitted client',async()=>{
  const engine=new NativeMedia({},'win32'),requests=[];
  engine.rpc=async value=>{requests.push(value);return {port:5004};};
  engine.startEncoder=async()=>{engine.sourceSize={width:2560,height:1600};};
  const quality=streamSettings('1080',30);
  await engine.offer('preview',quality,{iceServers:[]});
  await engine.offer('guest',{...quality,width:1728},{iceServers:[]});
  assert.equal(engine.profiles.size,1);assert.equal(requests[0].profile,requests[1].profile);engine.close();
});


test('native encoding starts during ICE gathering and sound toggles preserve video peers and encoders',async()=>{
  const engine=new NativeMedia({},'win32');let encoding=false,killed=false,closedAudio=false;
  engine.startEncoder=async profile=>{encoding=true;profile.child={kill(){killed=true;}};};
  const commands=[];
  engine.rpc=async (request,onSource)=>{
    commands.push(request);
    if(request.type==='offer'){
      onSource({port:5004,audioPort:5006});
      assert.equal(encoding,true,'Capture must start before the ICE offer is finished');
      return {port:5004,audioPort:5006};
    }
  };
  await engine.offer('guest',streamSettings('720',30),{iceServers:[]});
  assert.equal(commands[0].audio,true,'Reserve audio without starting capture');assert.equal(engine.audio,undefined);
  const profile=[...engine.profiles.values()][0];
  engine.audio={close(){closedAudio=true;}};
  await engine.setAudio(false);
  assert.equal(closedAudio,true);assert.equal(killed,false);assert.equal(engine.peers.size,1);
  assert.equal([...engine.profiles.values()][0],profile);assert.equal(commands.length,1);
  engine.close();assert.equal(killed,true);
});


test('audio-only media shares encoded audio without starting a screen encoder',async()=>{
  const engine=new NativeMedia({NATIVE_AUDIO_ONLY:'1'},'win32');let videos=0;
  engine.startEncoder=async()=>{videos++;};
  engine.rpc=async (request,onSource)=>{if(request.type==='offer'){assert.equal(request.audioOnly,true);assert.equal(request.audio,true);const value={port:0,audioPort:5006,audioOnly:true};onSource(value);return value;}};
  await engine.offer('preview',{}, {iceServers:[]});await engine.offer('guest',{}, {iceServers:[]});
  assert.equal(videos,0);assert.equal(engine.profiles.size,1);assert.equal(engine.peers.size,2);engine.close();
});
