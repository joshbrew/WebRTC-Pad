import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once,EventEmitter} from 'node:events';
import {WebSocket} from 'ws';
import {desktopCapabilities,desktopSession} from '../src/desktop-capabilities.js';
import {nativeAudioCapability} from '../src/native-audio.js';
import {captureArguments,NativeMedia} from '../src/native-media.js';
import {createApp} from '../src/server.js';
test('Linux detects Wayland even when XWayland also exposes DISPLAY; Windows does not inherit Linux gates',()=>{
  assert.deepEqual(desktopCapabilities({DISPLAY:':0',WAYLAND_DISPLAY:'wayland-0',XDG_SESSION_TYPE:'wayland'},'linux'),{session:'wayland',windowMouse:false,cursorOverlay:false});
  assert.equal(desktopSession({DISPLAY:':0',WAYLAND_DISPLAY:'wayland-0'},'linux'),'wayland');
  assert.deepEqual(desktopCapabilities({DISPLAY:':99',XDG_SESSION_TYPE:'x11'},'linux'),{session:'x11',windowMouse:true,cursorOverlay:true});
  assert.equal(desktopCapabilities({WAYLAND_DISPLAY:'wayland-0'},'win32').windowMouse,true);
  assert.equal(desktopCapabilities({NATIVE_MAC_HELPER:'/missing/mac/helper'},'darwin').cursorOverlay,false);
});
test('Linux native window capture is explicitly bound to its XID and keeps requested FPS',()=>{
  const result=captureArguments({frameRate:60},5004,{DISPLAY:':99',NATIVE_SCREEN_SIZE:'640x480',NATIVE_WINDOW_HANDLE:'3145777'},'linux');
  assert.equal(result.args[result.args.indexOf('-window_id')+1],'3145777');assert.equal(result.args[result.args.indexOf('-framerate')+1],'60');
  assert.throws(()=>captureArguments({},5004,{DISPLAY:':99',NATIVE_SCREEN_SIZE:'640x480',NATIVE_WINDOW_HANDLE:'0'},'linux'));
  assert.throws(()=>captureArguments({},5004,{DISPLAY:':99',NATIVE_SCREEN_SIZE:'640x480',NATIVE_WINDOW_HANDLE:'3 -i desktop'},'linux'));
});
test('Linux audio capability is independent of X11/video and does not use the Windows helper',()=>{
  const capability=nativeAudioCapability({NATIVE_AUDIO_LIBPULSE:process.execPath,WAYLAND_DISPLAY:'wayland-0'},'linux');
  assert.equal(capability.available,true);assert.equal(capability.window,true);assert.ok(capability.helper.endsWith('linux_audio.py'));
});
test('Linux audio-only peers reserve sound on Wayland without starting video',async()=>{
  const engine=new NativeMedia({NATIVE_AUDIO_ONLY:'1',WAYLAND_DISPLAY:'wayland-0'},'linux');let videos=0;
  engine.startEncoder=async()=>videos++;engine.rpc=async(request,onSource)=>{if(request.type==='offer'){assert.equal(request.audio,true);assert.equal(request.audioOnly,true);const value={audioOnly:true,audioPort:5006};onSource(value);return value;}};
  await engine.offer('preview',{}, {iceServers:[]});assert.equal(videos,0);engine.close();
});
test('Linux routes verified window identity to audio, overlay and input; process reuse requires reselection',async t=>{
  let start='100',desktop,overlayEnv,mediaEnv;const target=()=>({kind:'window',id:'200',pid:700,processStart:start,label:'Game',width:640,height:480});
  const app=createApp({platform:'linux',env:{DISPLAY:':99',XDG_SESSION_TYPE:'x11',NATIVE_AUDIO_LIBPULSE:process.execPath},getCaptureTargets:async()=>[target()],
    createInjector:async()=>({setState(){},close(){}}),createDesktop:async()=>desktop=Object.assign(new EventEmitter(),{display:{width:640,height:480},async setScope(scope){this.scope=scope;},setState(){},close(){}}),
    createOverlay:async env=>{overlayEnv=env;return Object.assign(new EventEmitter(),{send(){},close(){}});},
    createNativeMedia:env=>{mediaEnv=env;return Object.assign(new EventEmitter(),{async offer(){return {};},async setAudio(){return {};},close(){}});}
  });
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`;
  const ws=new WebSocket(origin.replace('http','ws')+'/ws',{origin});await once(ws,'open');t.after(async()=>{ws.terminate();await app.close();});
  const messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));
  async function command(value,expected,predicate=()=>true){ws.send(JSON.stringify(value));const matches=m=>m.type==='error' || m.type===expected && (!value.requestId || m.requestId===value.requestId) && predicate(m);const end=Date.now()+4000;while(!messages.some(matches)){if(Date.now()>end)throw new Error('Missing '+expected);await new Promise(r=>setTimeout(r,10));}return messages.splice(messages.findIndex(matches),1)[0];}
  const config=await (await fetch(origin+'/config')).json();assert.equal(config.windowMouse,true);assert.equal(config.cursorOverlay,true);assert.equal(config.desktopSession,'x11');
  await command({type:'create',dynamicControllers:true},'created');
  await command({type:'capture-source',kind:'native',id:'200',audio:true,requestId:'source'},'native-result');
  const policy=await command({type:'input-policy',allowKeyboard:true,desktopMouse:true},'input-policy',m=>m.desktopMouse===true);assert.equal(policy.desktopScope,'window');assert.equal(desktop.scope.processStart,'100');
  await command({type:'cursor-overlay',enabled:true},'cursor-overlay',m=>m.enabled===true);assert.equal(overlayEnv.NATIVE_WINDOW_PID,'700');assert.equal(overlayEnv.NATIVE_WINDOW_START,'100');
  await command({type:'native-offer',peerId:'preview',quality:{frameRate:30,maxBitrate:8000000},requestId:'offer'},'native-result');assert.equal(mediaEnv.NATIVE_AUDIO_START,'100');
  start='101';const changed=await command({type:'native-audio',enabled:true,requestId:'audio'},'native-result');assert.match(changed.error,/changed/);
});
