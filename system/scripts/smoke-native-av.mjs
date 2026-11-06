import {launchTestBrowser} from './browser-fixture.mjs';
// Windows hardware acceptance: generated test-app tones, real window/screen
// capture, WASAPI, Opus, native H.264, and browser decoding. No real OS input.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {NativeMedia} from '../src/native-media.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
const enginesAPI=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),browserType=enginesAPI[process.env.BROWSER_ENGINE || 'chromium'];
const fixtures=[],engines=[],writes=[];let browser,app,injectors=0,sourceLists=0;
async function fixture(hz) {
  const child=spawn(`.local/tools/native-av-fixture-${process.pid}.exe`,[String(hz)],{windowsHide:true,stdio:['pipe','pipe','pipe']});fixtures.push(child);
  if(process.env.NATIVE_AV_TRACE)child.on('exit',code=>console.log('Fixture exit:',hz,code));
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Fixture timed out')),10000);child.stderr.on('data',data=>process.stderr.write(data));createInterface({input:child.stdout}).once('line',line=>{clearTimeout(timer);resolve(JSON.parse(line));});child.on('error',reject);});
}
const spectrum=async(page,id)=>{
  await page.waitForFunction(id=>id==='#hostPreview'?window.nativeAVPeers?.some(pc=>pc.connectionState==='connected'&&pc.getReceivers().some(r=>r.track.kind==='audio'&&!r.track.muted)):document.querySelector(id==='#clientVideo'?'#clientAudio':id).srcObject?.getAudioTracks().some(track=>!track.muted),id,{timeout:10000});
  return page.evaluate(async id=>{
  // Probe host audio separately: the muted confidence video deliberately does
  // not consume audio, which would turn on A/V synchronization buffering.
  const receiver=id==='#hostPreview'?window.nativeAVPeers?.filter(pc=>pc.connectionState==='connected').flatMap(pc=>pc.getReceivers()).find(r=>r.track.kind==='audio'&&!r.track.muted):null;
  const stream=receiver?new MediaStream([receiver.track]):document.querySelector(id==='#clientVideo'?'#clientAudio':id).srcObject;
  if(!stream?.getAudioTracks().length)throw new Error('No native audio track');
  const probe=receiver?document.createElement('audio'):null;
  if(probe){probe.muted=true;probe.srcObject=stream;await probe.play();}
  const context=new AudioContext({sampleRate:48000});await context.resume();
  const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser(),mute=context.createGain();
  analyser.fftSize=32768;mute.gain.value=0;source.connect(analyser);analyser.connect(mute);mute.connect(context.destination);
  await new Promise(resolve=>setTimeout(resolve,1200));
  const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);
  const level=hz=>{let a=0,b=0;for(let n=0;n<samples.length;n++){a+=samples[n]*Math.sin(2*Math.PI*hz*n/context.sampleRate);b+=samples[n]*Math.cos(2*Math.PI*hz*n/context.sampleRate);}return 2*Math.hypot(a,b)/samples.length;};
  const result={app:level(660),other:level(1320),browser:level(2200)};await context.close();if(probe){probe.pause();probe.srcObject=null;}return result;
},id);};
try {
  if(process.platform!=='win32')throw new Error('This hardware acceptance test requires Windows.');
  await fs.mkdir('.local/tools',{recursive:true});
  await promisify(execFile)(path.join(process.env.WINDIR || 'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:exe','/platform:x64','/r:System.Windows.Forms.dll','/r:System.Drawing.dll',`/out:${path.resolve(`.local/tools/native-av-fixture-${process.pid}.exe`)}`,path.resolve('system/scripts/native-av-fixture.cs')],{windowsHide:true});
  const a=await fixture(660),b=await fixture(1320);
  app=createApp({env:{...(process.env.NATIVE_MEDIA_HELPER?{NATIVE_MEDIA_HELPER:process.env.NATIVE_MEDIA_HELPER}:{})},getCaptureTargets:async()=>{sourceLists++;return [{id:'desktop',kind:'desktop',label:'Entire primary screen'},a,b];},
    createInjector:async()=>{injectors++;return {name:'Native AV fixture',setState(slot,state){writes.push(state);},addController(){},removeController(){},close(){}};},
    createNativeMedia:env=>{const engine=new NativeMedia(env);if(process.env.NATIVE_AV_TRACE){const start=engine.startEncoder.bind(engine);engine.startEncoder=async(profile,q,...args)=>{await start(profile,q,...args);const child=profile.child,kill=child.kill.bind(child);child.kill=(...args)=>{console.log('Encoder kill:',q.frameRate,profile.refs,new Error().stack);return kill(...args);};child.on('exit',code=>console.log('Encoder exit:',q.frameRate,profile.refs,code));};}const setAudio=engine.setAudio.bind(engine);engine.setAudio=async(...args)=>{const started=performance.now();const result=await setAudio(...args);console.log('Audio operation:',args[0]?'enable':'disable',Math.round(performance.now()-started),'ms');return result;};engines.push(engine);return engine;}
  });
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(browserType,{headless:true,...(process.env.BROWSER_ENGINE==='firefox'?{}:{channel:'msedge',args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']})});
  const context=await browser.newContext({viewport:{width:1280,height:950}});
  await context.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');window.nativeAVPeers=[];const Original=RTCPeerConnection;window.RTCPeerConnection=class extends Original{constructor(...args){super(...args);window.nativeAVPeers.push(this);}};window.captureTimings={};document.addEventListener('change',event=>{if(event.target.id==='captureTarget' || event.target.id==='nativeCaptureAudio')window.captureTimings[event.target.id]=performance.now();},true);for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:capture-method','native');localStorage.setItem('webrtc-pad:hostPreviewAutoPause','false');});
  const origin=`http://127.0.0.1:${app.server.address().port}`,host=await context.newPage(),guest=await context.newPage(),errors=[];
  for(const page of [host,guest])page.on('pageerror',error=>errors.push(error.message));
  await host.goto(origin);await guest.goto(origin+'/?mode=join');
  if(!process.env.NATIVE_AV_HYBRID_ONLY){
  await host.locator('#callSettings').click();await host.locator('#hostSettings').evaluate(element=>element.open=true);await host.locator('#streamResolution').selectOption('720');await host.locator('#streamFramerate').selectOption('30');await host.getByRole('button',{name:'Close settings',exact:true}).click();
  await host.waitForFunction(id=>[...document.querySelector('#captureTarget').options].some(option=>option.value===id),a.id);
  assert.equal(await host.locator('#nativeCaptureAudio').isChecked(),true);
  await host.locator('#nativeCaptureAudio').check();
  assert.equal(engines.length,0,'Arming audio before a source must not capture anything');
  await host.bringToFront();
  assert.equal(await host.locator('#hostInviteCard').isVisible(),false);
  assert.equal(await host.locator('#hostSetupCard').isVisible(),true);
  const sourceStarted=performance.now();
  await host.locator('#captureTarget').selectOption(a.id);
  try {await host.waitForFunction(()=>document.querySelector('#hostPreview').getVideoPlaybackQuality().totalVideoFrames>5,null,{timeout:45000});}
  catch(error){console.log('Host preview:',await host.locator('#hostStatus').textContent());throw error;}
  console.log('Native source to preview:',Math.round(performance.now()-sourceStarted),'ms; after selection:',await host.evaluate(()=>Math.round(performance.now()-window.captureTimings.captureTarget)),'ms');
  const listedBefore=sourceLists;await host.locator('#captureTargetFields .source-picker-trigger').click();
  await host.waitForFunction(()=>!document.querySelector('#captureTargetTiles').hasAttribute('aria-busy'));
  assert.ok(sourceLists>listedBefore,'Opening the chooser refreshes the source list');
  await host.locator(`#captureTargetTiles [data-source-id="${a.id}"]`).scrollIntoViewIfNeeded();
  if(process.env.BROWSER_ENGINE!=='firefox')await host.locator(`#captureTargetTiles [data-source-id="${a.id}"] img`).waitFor();
  await fs.mkdir('.local/screenshots',{recursive:true});await host.locator('#captureTargetTiles').screenshot({path:'.local/screenshots/window-source-tiles.png'});
  await host.locator(`#captureTargetTiles [data-source-id="${a.id}"]`).click();
  assert.equal(app.rooms.size,0);assert.equal(injectors,0);
  assert.equal(await host.locator('#hostLiveText').textContent(),'Private preview');
  const sourceEngine=engines.at(-1),sourceEncoder=[...sourceEngine.profiles.values()][0].child;
  const beforeAudioTrack=await host.locator('#hostPreview').evaluate(video=>video.srcObject.getVideoTracks()[0].id);
  await host.waitForFunction(()=>document.querySelector('#nativeAudioStatus').textContent.includes('Audio source ready'));
  assert.equal(await host.locator('#nativeCaptureAudio').isChecked(),true,'Source selection must preserve pre-armed native audio');
  await host.locator('#nativeCaptureAudio').uncheck();
  await host.waitForFunction(()=>document.querySelector('#nativeAudioStatus').textContent==='Audio is off.');
  await host.locator('#nativeCaptureAudio').scrollIntoViewIfNeeded();
  const audioStarted=performance.now();
  await host.locator('#nativeCaptureAudio').check();
  await host.waitForFunction(()=>document.querySelector('#nativeAudioStatus').textContent.includes('Audio source ready'),null,{timeout:45000});
  console.log('Native audio enable:',Math.round(performance.now()-audioStarted),'ms; after click:',await host.evaluate(()=>Math.round(performance.now()-window.captureTimings.nativeCaptureAudio)),'ms');
  await host.waitForFunction(()=>window.nativeAVPeers.some(pc=>pc.connectionState==='connected'&&pc.getReceivers().some(r=>r.track.kind==='audio'&&!r.track.muted)));
  assert.equal(await host.locator('#hostPreview').evaluate(video=>video.srcObject.getAudioTracks().length),0);
  assert.equal(engines.at(-1),sourceEngine,'Audio toggle must keep the native engine');
  assert.equal([...sourceEngine.profiles.values()][0].child,sourceEncoder,'Audio toggle must keep the video encoder');
  assert.equal(await host.locator('#hostPreview').evaluate(video=>video.srcObject.getVideoTracks()[0].id),beforeAudioTrack,'Audio toggle must keep the preview track');
  const previewLevels=await spectrum(host,'#hostPreview');console.log('App-only preview levels:',previewLevels);
  assert.ok(previewLevels.app>.001 && previewLevels.app>previewLevels.other*5,'Window preview must exclude the other app’s audio');
  await fs.mkdir('.local/screenshots',{recursive:true});await host.locator('#hostStage').screenshot({path:'.local/screenshots/native-preview-av.png'});
  const previewEngine=engines.at(-1),track=await host.locator('#hostPreview').evaluate(video=>video.srcObject.getVideoTracks()[0].id);
  await host.locator('#hostCreate').click();await host.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);
  assert.equal(await host.locator('#hostSetupCard').isVisible(),false);
  assert.equal(await host.locator('#hostInviteCard').isVisible(),true);
  assert.equal(await host.locator('#hostEnd').isVisible(),true);
  assert.equal(await host.locator('#hostToolbar').isVisible(),true,'Session controls remain in the call toolbar');
  await host.screenshot({path:'.local/screenshots/host-session-layout.png',fullPage:true});
  await host.locator('#hostLiveSource').evaluate(element=>element.open=true);
  assert.equal(app.rooms.size,1);assert.equal(injectors,1);assert.equal([...app.rooms.values()][0].native,previewEngine);
  assert.equal(await host.locator('#hostPreview').evaluate(video=>video.srcObject.getVideoTracks()[0].id),track,'Start must reuse the local native preview');
  await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
  await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});
  await guest.waitForFunction(()=>!document.querySelector('#downloadReply').disabled);
  await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});
  await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoWidth>0 && !document.querySelector('#clientUnmute').disabled,null,{timeout:45000});
  assert.equal(await guest.locator('#clientVideo').evaluate(video=>video.srcObject.getAudioTracks().length),0,'Guest picture is independent of audio playout');
  await guest.waitForFunction(()=>{const audio=document.querySelector('#clientAudio');return !audio.muted && !audio.paused && audio.readyState>=2;});
  const guestLevels=await spectrum(guest,'#clientVideo');console.log('App-only guest levels:',guestLevels);
  assert.ok(guestLevels.app>.001 && guestLevels.app>guestLevels.other*5);
  assert.equal(previewEngine.profiles.size,1,'Matching preview and guest share their video encoder');
  await guest.evaluate(()=>{const video=document.querySelector('#clientVideo');window.handoverGaps={empty:0,max:0,last:performance.now()};const inspect=()=>{const value=window.handoverGaps;if(!value)return;if(!video.srcObject?.getVideoTracks().length)value.empty++;requestAnimationFrame(inspect);};requestAnimationFrame(inspect);const frame=()=>{const value=window.handoverGaps;if(!value)return;const now=performance.now();value.max=Math.max(value.max,now-value.last);value.last=now;video.requestVideoFrameCallback(frame);};video.requestVideoFrameCallback(frame);});
  for(const fps of ['15','30']){
    await guest.locator('#clientVideo').evaluate(video=>{window.beforeQualityTrack=video.srcObject.getVideoTracks()[0];});
    await guest.locator('#clientCallSettings').click();await guest.locator('#clientFramerate').selectOption(fps);await guest.getByRole('button',{name:'Close settings',exact:true}).click();
    try{await guest.waitForFunction(()=>document.querySelector('#clientVideo').srcObject?.getVideoTracks().some(t=>t!==window.beforeQualityTrack),null,{timeout:30000});}
    catch(error){console.log('Quality handover failed:',JSON.stringify({host:await host.locator('#hostStatus').textContent(),errors,profiles:engines.map(e=>[...e.profiles].map(([key,p])=>({key,refs:p.refs,exit:p.child?.exitCode}))),guest:await guest.evaluate(async()=>({warm:[...document.querySelectorAll('body>video')].map(v=>({width:v.videoWidth,ready:v.readyState,paused:v.paused})),peers:await Promise.all(window.nativeAVPeers.map(async pc=>({state:pc.connectionState,tracks:pc.getReceivers().map(r=>({kind:r.track.kind,muted:r.track.muted})),stats:[...(await pc.getStats()).values()].filter(s=>s.type==='inbound-rtp').map(s=>({kind:s.kind,frames:s.framesDecoded,packets:s.packetsReceived,keyframes:s.keyFramesDecoded,width:s.frameWidth}))})))}))}));throw error;}
    await guest.waitForFunction(()=>!document.querySelector('#clientUnmute').disabled);
  }
  const handoverGaps=await guest.evaluate(()=>{const value=window.handoverGaps;window.handoverGaps=null;return value;});assert.equal(handoverGaps.empty,0,'Quality changes must never clear the displayed picture');
  console.log('Native guest quality handovers:',handoverGaps);
  const soundAfterQuality=await spectrum(guest,'#clientVideo');assert.ok(soundAfterQuality.app>.001,'Quality handovers keep application audio playing');
  await host.bringToFront();
  const uninterruptedTrack=await guest.locator('#clientVideo').evaluate(video=>video.srcObject.getVideoTracks()[0].id);
  const previewEncoder=[...previewEngine.profiles.values()][0].child;
  await host.locator('#hostMonitorToggle').click();
  await host.waitForFunction(()=>!document.querySelector('#hostPreview').srcObject);
  assert.equal(await host.locator('#hostMonitorToggle').textContent(),'Show preview');
  assert.equal(await host.locator('#hostPreviewToggle').isChecked(),false);
  const guestFrames=await guest.locator('#clientVideo').evaluate(video=>video.getVideoPlaybackQuality().totalVideoFrames);
  await guest.waitForFunction(n=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>n+3,guestFrames);
  assert.equal([...previewEngine.profiles.values()][0].child,previewEncoder);
  await host.locator('#hostMonitorToggle').click();
  await host.waitForFunction(()=>document.querySelector('#hostPreview').videoWidth>0 && !!document.querySelector('#hostPreview').srcObject);
  assert.equal(await host.locator('#hostPreviewToggle').isChecked(),true);
  assert.equal(await guest.locator('#clientVideo').evaluate(video=>video.srcObject.getVideoTracks()[0].id),uninterruptedTrack);
  console.log('PASS: monitor Hide/Show preview follows the saved setting while guest frames, track and encoder continue');
  await guest.locator('#clientCallControllers').click();await guest.locator('#joinKeyboardController').click();await guest.getByRole('button',{name:'Close controllers',exact:true}).click();await guest.waitForFunction(()=>document.querySelector('#clientSlot').textContent.includes('P1'));
  const guestTrack=await guest.locator('#clientVideo').evaluate(video=>video.srcObject.getVideoTracks()[0].id);
  await host.locator('#nativeCaptureAudio').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});
  const audioOffStarted=performance.now();
  await host.locator('#nativeCaptureAudio').uncheck();
  await guest.waitForFunction(()=>document.querySelector('#clientUnmute').disabled);
  console.log('Native audio disable:',Math.round(performance.now()-audioOffStarted),'ms');
  assert.equal(await guest.locator('#clientVideo').evaluate(video=>video.srcObject.getVideoTracks()[0].id),guestTrack);
  for(let attempt=0;attempt<2;attempt++){
    await host.locator('#nativeCaptureAudio').check();
    try{await guest.waitForFunction(()=>!document.querySelector('#clientUnmute').disabled);}
    catch(error){console.log('Audio toggle failed:',await host.locator('#hostStatus').textContent(),engines.map(e=>({error:e.audioError,port:e.audioPort,peers:e.peers.size,closed:e.closed,audio:!!e.audio})),await guest.evaluate(async()=>({dataset:{...document.querySelector('#clientVideo').dataset},sound:document.querySelector('#clientUnmute').textContent,audio:document.querySelector('#clientAudio').srcObject?.getTracks().map(t=>({muted:t.muted,state:t.readyState})),peers:await Promise.all(window.nativeAVPeers.map(async pc=>({state:pc.connectionState,tracks:pc.getReceivers().map(r=>({kind:r.track.kind,muted:r.track.muted,state:r.track.readyState})),stats:[...(await pc.getStats()).values()].filter(s=>s.type==='inbound-rtp').map(s=>({kind:s.kind,packets:s.packetsReceived,bytes:s.bytesReceived,frames:s.framesDecoded}))})))})));throw error;}
    const resumed=await spectrum(guest,'#clientVideo');
    assert.ok(resumed.app>.001 && resumed.app>resumed.other*5,'Audio must resume on the same connection');
    assert.equal(await guest.locator('#clientVideo').evaluate(video=>video.srcObject.getVideoTracks()[0].id),guestTrack);
    await host.locator('#nativeCaptureAudio').uncheck();
    await guest.waitForFunction(()=>document.querySelector('#clientUnmute').disabled);
  }
  await guest.waitForFunction(()=>document.querySelector('#clientVideo').readyState>=2);
  const frames=await guest.locator('#clientVideo').evaluate(video=>video.getVideoPlaybackQuality().totalVideoFrames);
  await guest.waitForFunction(frames=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>frames+6,frames,{timeout:45000});
  await guest.locator('#clientStage').click();await guest.keyboard.down('z');
  const deadline=Date.now()+5000;while(!writes.some(state=>state.buttons.a) && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));await guest.keyboard.up('z');assert.ok(writes.some(state=>state.buttons.a));
  await host.locator('#hostChangeSource').click();await host.waitForFunction(()=>!document.querySelector('#captureTargetTiles').hasAttribute('aria-busy'));
  await host.locator('#captureTargetTiles [data-source-id="desktop"]').click();
  await host.waitForFunction(()=>document.querySelector('#hostSourceStatus').textContent.includes('sharing with'));
  await host.locator('#nativeCaptureAudio').check();
  await guest.waitForFunction(()=>!document.querySelector('#clientUnmute').disabled,null,{timeout:45000});
  const systemLevels=await spectrum(guest,'#clientVideo');console.log('System guest levels:',systemLevels);
  const systemSourceLevels=await spectrum(host,'#hostPreview');console.log('System capture source levels:',systemSourceLevels);
  if(systemSourceLevels.app>.001 && systemSourceLevels.other>.001)assert.ok(systemLevels.app>.001 && systemLevels.other>.001,'An audible system source must reach the guest');
  else console.log('NOTE: the local system loopback is quiet; audible system-tone validation is unavailable with the current output/mute settings. Application-only tones were verified separately.');
  await host.locator('#captureTarget').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await host.locator('#captureTarget').selectOption('none');await host.waitForFunction(()=>document.querySelector('#hostLiveText').textContent==='Not sharing yet');
  assert.equal(await guest.locator('#clientConnectionText').textContent(),'Connected');
  await host.setViewportSize({width:390,height:780});
  assert.ok(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Host management must fit mobile width');
  await host.locator('#hostEnd').click();
  await host.waitForFunction(()=>!document.querySelector('#hostSetupCard').hidden);
  assert.equal(await host.locator('#hostInviteCard').isVisible(),false);
  assert.equal(await host.locator('#hostSourceSetup').evaluate(element=>element.parentElement.id),'hostSetupCard');
  }
  if(!process.env.NATIVE_AV_NATIVE_ONLY){
  await host.setViewportSize({width:1280,height:950});await host.reload();await guest.reload();
  await host.evaluate(()=>{
    navigator.mediaDevices.getDisplayMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');let frame=0;
      setInterval(()=>{ctx.fillStyle=`hsl(${frame++%360} 60% 25%)`;ctx.fillRect(0,0,960,540);ctx.fillStyle='white';ctx.fillText('Browser video + native app audio',40,60);},30);
      const stream=canvas.captureStream(30),context=new AudioContext(),osc=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();
      osc.frequency.value=2200;gain.gain.value=.03;osc.connect(gain);gain.connect(destination);osc.start();context.resume();
      stream.addTrack(destination.stream.getAudioTracks()[0]);return stream;
    };
  });
  await host.locator('#nativeCaptureAudio').check();
  await host.locator('#captureAdvanced').evaluate(el=>el.open=true);await host.locator('#captureBackend').selectOption('browser');
  await host.waitForFunction(()=>document.querySelector('#hostLiveText').textContent==='Private preview');
  await host.waitForFunction(id=>[...document.querySelector('#nativeAudioTarget').options].some(o=>o.value===id),a.id);
  assert.equal(await host.locator('#nativeAudioFields').isVisible(),true);
  await host.locator('#nativeAudioSourceOptions').evaluate(el=>{for(let parent=el;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});
  await host.locator('#nativeAudioSourceOptions').evaluate(el=>{for(let parent=el;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await host.locator('#nativeAudioTarget').selectOption(a.id);
  await host.waitForFunction(()=>document.querySelector('#nativeAudioStatus').textContent.includes('Audio source ready'));
  await fs.mkdir('.local/screenshots',{recursive:true});
  await host.locator('#hostSourceSetup').screenshot({path:'.local/screenshots/browser-video-native-audio.png'});
  const audioEngine=engines.at(-1);
  assert.equal(audioEngine.env.NATIVE_AUDIO_ONLY,'1');assert.ok([...audioEngine.profiles.values()].every(profile=>!profile.child),'Audio-only capture must not start any screen encoder');
  const audioOffer=await audioEngine.offer('test-sdp',{}, {iceServers:[]});
  assert.match(audioOffer.sdp.sdp,/m=audio/);assert.doesNotMatch(audioOffer.sdp.sdp,/m=video/);await audioEngine.closePeer('test-sdp');
  assert.equal(app.rooms.size,0,'Native audio may be prepared beside browser preview before Start');
  await host.locator('#hostCreate').click();await host.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);
  assert.equal([...app.rooms.values()][0].audioCapture.native,audioEngine,'Start must adopt the prepared audio engine');
  await host.locator('#hostLiveSource').evaluate(element=>element.open=true);
  await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
  await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});
  await guest.waitForFunction(()=>!document.querySelector('#downloadReply').disabled);
  await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});
  await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoWidth>0 && !document.querySelector('#clientUnmute').disabled,null,{timeout:45000});
  const hybridLevels=await spectrum(guest,'#clientVideo');console.log('Browser video + native app audio:',hybridLevels);
  assert.ok(hybridLevels.app>.001 && hybridLevels.app>hybridLevels.other*5 && hybridLevels.app>hybridLevels.browser*5,'Browser and unrelated app audio must be excluded');
  const beforeRefresh=await guest.locator('#clientVideo').evaluate(video=>video.srcObject.getVideoTracks()[0].id);
  await guest.locator('#clientRefreshVideo').evaluate(el=>el.click());
  await guest.waitForFunction(old=>document.querySelector('#clientVideo').srcObject?.getVideoTracks().some(track=>track.id!==old && !track.muted),beforeRefresh,{timeout:45000});
  const refreshedHybrid=await spectrum(guest,'#clientVideo');
  assert.ok(refreshedHybrid.app>.001 && refreshedHybrid.app>refreshedHybrid.other*5 && refreshedHybrid.app>refreshedHybrid.browser*5,'Refreshing browser video must reconnect the selected native app audio');
  console.log('PASS: browser picture refresh restores the selected native app audio without switching to browser or system sound');
  const hybridVideo=await guest.locator('#clientVideo').evaluate(video=>video.srcObject.getVideoTracks()[0].id);
  await host.locator('#nativeAudioSourceOptions').evaluate(el=>{for(let parent=el;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await host.locator('#nativeAudioTarget').selectOption('none');await host.waitForFunction(()=>!document.querySelector('#nativeCaptureAudio').disabled);
  await guest.waitForFunction(()=>document.querySelector('#clientAudio').srcObject?.getAudioTracks().some(track=>!track.muted),null,{timeout:10000});
  const browserLevels=await spectrum(guest,'#clientVideo');console.log('Browser audio restored:',browserLevels);
  assert.ok(browserLevels.browser>.001,'Disabling native replacement must restore available browser audio');
  await host.locator('#nativeAudioSourceOptions').evaluate(el=>{for(let parent=el;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await host.locator('#nativeAudioTarget').selectOption(a.id);await host.waitForFunction(()=>document.querySelector('#nativeAudioStatus').textContent.includes('included in'));
  const restored=await spectrum(guest,'#clientVideo');assert.ok(restored.app>.001 && restored.app>restored.browser*5);
  assert.equal(await guest.locator('#clientVideo').evaluate(video=>video.srcObject.getVideoTracks()[0].id),hybridVideo,'Audio replacement must preserve browser video');
  await host.locator('#nativeAudioSourceOptions').evaluate(el=>{for(let parent=el;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await host.locator('#nativeAudioTarget').selectOption(b.id);await host.waitForFunction(()=>!document.querySelector('#nativeCaptureAudio').disabled);
  const switched=await spectrum(guest,'#clientVideo');assert.ok(switched.other>.001 && switched.other>switched.app*5);
  assert.equal(await guest.locator('#clientVideo').evaluate(video=>video.srcObject.getVideoTracks()[0].id),hybridVideo);
  await host.locator('#hostAudioOnly').check();
  await host.waitForFunction(()=>document.body.dataset.hostAudioOnly==='true');
  await host.locator('#nativeAudioSourceOptions').evaluate(el=>{for(let parent=el;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await host.locator('#nativeAudioTarget').selectOption(a.id);
  await guest.waitForFunction(()=>document.querySelector('#clientVideo').dataset.audioOnly==='true' && !document.querySelector('#clientUnmute').disabled);
  const onlyLevels=await spectrum(guest,'#clientVideo');assert.ok(onlyLevels.app>.001 && onlyLevels.app>onlyLevels.other*5);
  assert.equal(await guest.locator('#clientVideo').evaluate(video=>video.srcObject),null);
  assert.ok([...engines.at(-1).profiles.values()].every(profile=>!profile.child),'Native audio-only sharing must not start a video encoder');
  assert.equal(await host.locator('#hostPreview').evaluate(video=>video.srcObject),null);
  await guest.locator('#clientRefreshVideo').evaluate(el=>el.click());await guest.waitForFunction(()=>document.querySelector('#clientRefreshVideo').textContent==='Refresh audio');
  let refreshedOnly;
  try{refreshedOnly=await spectrum(guest,'#clientVideo');}
  catch(error){console.log('Audio refresh:',await host.locator('#hostStatus').textContent(),await guest.evaluate(async()=>({audio:document.querySelector('#clientVideo').dataset.sharedAudio,backend:document.querySelector('#clientVideo').dataset.audioBackend,peers:await Promise.all(window.nativeAVPeers.map(async pc=>({state:pc.connectionState,tracks:pc.getReceivers().map(r=>({kind:r.track.kind,muted:r.track.muted})),audio:[...(await pc.getStats()).values()].filter(s=>s.type==='inbound-rtp' && s.kind==='audio').map(s=>({bytes:s.bytesReceived,packets:s.packetsReceived}))})))})));throw error;}
  assert.ok(refreshedOnly.app>.001 && refreshedOnly.app>refreshedOnly.other*5);
  console.log('PASS: native audio-only UI sends the selected app tone with no picture/video encoder and supports audio refresh');
  await host.locator('#hostEnd').click();
  assert.ok(engines.every(engine=>engine.closed),'All native media helpers must close at session end');
  console.log('PASS: pre-armed native audio, browser video with native app audio, direct audio-only WebRTC, browser sound restoration and app switching without video restart');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: real native preview without a room/controller driver, seamless Start adoption, app-only audio isolation, Opus decoding, independent audio toggle, controller continuity and system audio');
} finally {await browser?.close();await app?.close();for(const child of fixtures){child.stdin.end();child.kill();}for(const engine of engines)engine.close();}
