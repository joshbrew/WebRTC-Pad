import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once,EventEmitter} from 'node:events';
import {WebSocket} from 'ws';
import {createApp} from '../src/server.js';
import {desktopCapabilities} from '../src/desktop-capabilities.js';
import {nativeAudioCapability} from '../src/native-audio.js';
import {nativeCapability,NativeMedia} from '../src/native-media.js';
import {nativeSourceHash} from '../scripts/native-version.mjs';
import {macPermissions} from '../src/macos-desktop.js';
const installed={NATIVE_MAC_HELPER:process.execPath,NATIVE_MEDIA_HELPER:process.execPath,FFMPEG_BIN:process.execPath};
test('Mac capabilities require the Mac helper; Windows and Linux do not inherit Mac gates',()=>{
  assert.equal(desktopCapabilities({NATIVE_MAC_HELPER:'/missing/mac/helper'},'darwin').windowMouse,false);
  assert.equal(desktopCapabilities(installed,'darwin').windowMouse,true);
  assert.equal(nativeAudioCapability(installed,'darwin').window,true);
  assert.equal(nativeAudioCapability(installed,'darwin').helper,process.execPath);
  assert.equal(nativeCapability(installed,'darwin').available,true);
  assert.equal(nativeCapability({...installed,NATIVE_MAC_HELPER:'/missing/mac/helper',NATIVE_SCREEN_DEVICE:'1'},'darwin').available,false,'Legacy screen indexes must not bypass native source binding');
  assert.equal(desktopCapabilities({NATIVE_MAC_HELPER:'/missing/mac/helper'},'win32').windowMouse,true);
  assert.equal(desktopCapabilities({...installed,WAYLAND_DISPLAY:'wayland-0'},'linux').windowMouse,false);
  assert.match(nativeSourceHash('darwin'),/^[a-f0-9]{64}$/);
});
test('Mac audio-only mode reserves audio without invoking the video or legacy AVFoundation encoder',async()=>{
  const engine=new NativeMedia({...installed,NATIVE_AUDIO_ONLY:'1'},'darwin');let videos=0;
  engine.startEncoder=async()=>videos++;
  engine.rpc=async(request,onSource)=>{if(request.type==='offer'){assert.equal(request.audio,true);assert.equal(request.audioOnly,true);const value={audioOnly:true,audioPort:5006};onSource(value);return value;}};
  await engine.offer('preview',{}, {iceServers:[]});assert.equal(videos,0);engine.close();
});
test('Mac encoder dispatch uses ScreenCaptureKit exclusively',async()=>{
  const engine=new NativeMedia(installed,'darwin');let called=false;
  const quality={frameRate:60,width:1920,height:1080,maxBitrate:8000000},profile={};
  engine.startMacEncoder=async(p,q,port)=>{assert.equal(p,profile);assert.equal(q,quality);assert.equal(port,5004);called=true;};
  engine.startEncoderWith=async()=>assert.fail('FFmpeg screen indexes must not replace selected Mac windows');
  await engine.startEncoder(profile,quality,5004);assert.equal(called,true);engine.close();
  await assert.rejects(macPermissions('other',installed),/Invalid/);
});
test('Mac permissions are read-only on load and prompts require a local same-origin POST',async t=>{
  const requests=[];
  const app=createApp({platform:'darwin',env:installed,getMacPermissions:async action=>{requests.push(action);return {screen:action==='screen',input:action==='input'};}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const config=await (await fetch(origin+'/config')).json();assert.equal(config.windowMouse,true);assert.deepEqual(requests,[]);
  assert.equal((await fetch(origin+'/mac-desktop')).status,200);assert.deepEqual(requests,[]);
  assert.equal((await fetch(origin+'/mac-permissions?action=screen')).status,200);assert.deepEqual(requests,['status']);
  for(const options of [{method:'POST'},{method:'POST',headers:{origin:'https://foreign.invalid'}}])assert.equal((await fetch(origin+'/mac-permissions?action=screen',options)).status,403);
  assert.deepEqual(requests,['status']);
  assert.equal((await fetch(origin+'/mac-permissions?action=invalid',{method:'POST',headers:{origin}})).status,400);
  const allowed=await fetch(origin+'/mac-permissions?action=screen',{method:'POST',headers:{origin}});assert.deepEqual(await allowed.json(),{screen:true,input:false});assert.deepEqual(requests,['status','screen']);
});
test('Mac routes pinned window identity to audio/input/overlay and rejects unknown or reused windows',async t=>{
  let start='100',desktop,overlayEnv,mediaEnv;const target=()=>({kind:'window',id:'200',pid:700,processStart:start,label:'Game',width:640,height:480});
  const app=createApp({platform:'darwin',env:installed,getCaptureTargets:async()=>[target()],
    encoderScanner:{peek:()=>null,scan:async()=>({selected:null})},createInjector:async()=>({setState(){},close(){}}),
    createDesktop:async()=>desktop=Object.assign(new EventEmitter(),{display:{width:640,height:480},async setScope(scope){this.scope=scope;},setState(){},close(){}}),
    createOverlay:async env=>{overlayEnv=env;return Object.assign(new EventEmitter(),{send(){},close(){}});},
    createNativeMedia:env=>{mediaEnv=env;return Object.assign(new EventEmitter(),{async offer(){return {};},async setAudio(){return {};},close(){}});}
  });
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`;
  const ws=new WebSocket(origin.replace('http','ws')+'/ws',{origin});await once(ws,'open');t.after(async()=>{ws.terminate();await app.close();});
  const messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));
  async function command(value,expected,predicate=()=>true){ws.send(JSON.stringify(value));const matches=m=>m.type==='error' || m.type===expected && (!value.requestId || m.requestId===value.requestId) && predicate(m);const end=Date.now()+4000;while(!messages.some(matches)){if(Date.now()>end)throw new Error('Missing '+expected);await new Promise(r=>setTimeout(r,10));}return messages.splice(messages.findIndex(matches),1)[0];}
  await command({type:'create',dynamicControllers:true},'created');
  const unknown=await command({type:'capture-source',kind:'native',id:'999',requestId:'unknown'},'native-result');assert.match(unknown.error,/unavailable/);
  await command({type:'capture-source',kind:'native',id:'200',audio:true,requestId:'source'},'native-result');
  const policy=await command({type:'input-policy',allowKeyboard:true,desktopMouse:true},'input-policy',m=>m.desktopMouse===true);assert.equal(policy.desktopScope,'window');assert.equal(desktop.scope.processStart,'100');
  await command({type:'cursor-overlay',enabled:true},'cursor-overlay',m=>m.enabled===true);assert.equal(overlayEnv.NATIVE_WINDOW_PID,'700');assert.equal(overlayEnv.NATIVE_WINDOW_START,'100');
  await command({type:'native-offer',peerId:'preview',quality:{frameRate:60,maxBitrate:8000000},requestId:'offer'},'native-result');assert.equal(mediaEnv.NATIVE_AUDIO_START,'100');
  start='101';const changed=await command({type:'native-audio',enabled:true,requestId:'audio'},'native-result');assert.match(changed.error,/changed/);
});
