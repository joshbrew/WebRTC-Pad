import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {launchTestBrowser} from './browser-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
let browser;const errors=[];
const app=createApp({env:{INPUT_BACKEND:'none'},createInjector:async()=>({setState(){},addController(){},removeController(){},close(){}})});
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`;
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1366,height:820}});context.setDefaultTimeout(15000);
  await context.route('**/ice?*',r=>r.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.addInitScript(()=>{
    for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    window.mediaStreams=[];window.mediaCalls=[];
    navigator.mediaDevices.getUserMedia=async options=>{
      if(window.denyMic && options.audio)throw new DOMException('Denied','NotAllowedError');
      window.mediaCalls.push(options);let stream;
      if(options.video){const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');ctx.fillStyle='#80b67a';ctx.fillRect(0,0,640,480);stream=canvas.captureStream(24);}
      else{const audio=new AudioContext();await audio.resume();const tone=audio.createOscillator(),destination=audio.createMediaStreamDestination();tone.connect(destination);tone.start();stream=destination.stream;const track=stream.getAudioTracks()[0],stop=track.stop.bind(track);track.stop=()=>{tone.stop();audio.close();stop();};}
      window.mediaStreams.push(stream);if(options.audio && window.holdMic)await new Promise(resolve=>window.releaseMic=resolve);return stream;
    };
    navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audioinput',deviceId:'test-mic',label:'Test microphone'},{kind:'videoinput',deviceId:'test-camera',label:'Test camera'}];
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
  await page.locator('#streamMinimumResolution').evaluate(el=>{el.value='720';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#hostAutoThrottle').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.reload();assert.equal(await page.locator('#streamMinimumResolution').inputValue(),'720');assert.equal(await page.locator('#hostAutoThrottle').isChecked(),false);
  await page.locator('#streamMinimumResolution').evaluate(el=>{el.value='480';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#hostAutoThrottle').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#modeClient').click();await page.locator('#clientMinimumResolution').evaluate(el=>{el.value='720';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#clientAutoThrottle').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.reload();assert.equal(await page.locator('#clientMinimumResolution').inputValue(),'720');assert.equal(await page.locator('#clientAutoThrottle').isChecked(),false);
  await page.locator('#clientAutoThrottle').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  for(const width of [1366,1024,860,390]){
    await page.setViewportSize({width,height:820});await page.locator('#modeHost').click();const before=await page.locator('.mode-switch').boundingBox();await page.locator('#modeClient').click();const after=await page.locator('.mode-switch').boundingBox();assert.ok(Math.abs(before.x-after.x)<1,`Host/Join stays put at ${width}px: ${before.x} vs ${after.x}`);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({width:1366,height:820});await page.locator('#modeHost').click();
  const files=page.locator('#hostAllowFiles').locator('..').locator('..');
  const closed=await files.boundingBox();await files.locator('summary').click();const opened=await files.boundingBox();assert.ok(Math.abs(closed.x-opened.x)<1 && Math.abs(closed.width-opened.width)<1,'File/clipboard disclosure keeps its full-width row');
  await page.locator('#hostCameraLimits > summary').click();await page.locator('#hostCameraLimits [data-call-limit=automatic]').uncheck();
  await page.locator('#hostSessionControls > summary').click();assert.equal(await page.locator('#hostSessionControls').evaluate(el=>getComputedStyle(el).borderRadius),'0px');
  await fs.mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/session-permissions-polished.png'});
  await page.locator('#modeClient').click();
  await page.evaluate(async()=>{const {VoiceRoom}=await import('/voice.js');const preview=VoiceRoom.prototype.previewMicrophone;VoiceRoom.prototype.previewMicrophone=function(...args){window.voice=this;return preview.apply(this,args);};});
  await page.locator('#clientPrepareCamera').click();await page.locator('#clientCamera [data-camera=toggle]').click();
  await page.waitForFunction(()=>document.querySelector('#clientCamera [data-camera=toggle]').getAttribute('aria-pressed')==='true');
  await page.evaluate(()=>window.scrollTo(0,Math.min(90,document.documentElement.scrollHeight-innerHeight)));const scroll=await page.evaluate(()=>scrollY);
  const micButton=await page.locator('#clientPrepareMic').boundingBox();await page.mouse.click(micButton.x+micButton.width/2,Math.min(800,micButton.y+micButton.height/2));await page.waitForFunction(()=>document.querySelector('#clientSettingsSheet').open);assert.equal(await page.locator('#clientCameraSheet').evaluate(el=>el.open),false);await page.waitForFunction(top=>Math.abs(scrollY-top)<3,scroll);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-scroll)<3,'Menu switch does not jump the page: '+JSON.stringify({before:scroll,after:await page.evaluate(()=>scrollY),height:await page.evaluate(()=>document.documentElement.scrollHeight),pane:await page.locator('#clientSettingsSheet [role=tab][aria-selected=true]').getAttribute('aria-controls')}));
  await page.locator('#clientVoice [data-extra=ptt]').check();await page.locator('#clientVoice [data-voice=preview]').click();await page.waitForFunction(()=>window.voice?.mic && document.querySelector('#clientVoice [data-voice=level]').value>.05);
  await page.locator('#clientVoice [data-extra=ptt]').uncheck();
  assert.equal(await page.evaluate(()=>window.voice.active===true || window.voice.peers.size>0),false,'Private mic test never starts a call');assert.equal(await page.evaluate(()=>window.voice.outgoingTrack('host')),null);
  await page.screenshot({path:'.local/screenshots/private-microphone-test.png'});
  await page.locator('#clientVoice [data-voice=automatic]').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#clientVoice [data-voice=preview]').click();await page.waitForFunction(()=>!window.voice.mic && !window.voice.meterContext);
  await page.evaluate(()=>window.denyMic=true);await page.locator('#clientVoice [data-voice=preview]').click();await page.waitForFunction(()=>document.querySelector('#clientVoice [data-voice=status]').textContent.includes('blocked'));assert.equal(await page.locator('#clientVoice [data-voice=status]').isVisible(),true);await page.evaluate(()=>window.denyMic=false);
  await page.locator('#clientVoice [data-voice=preview]').click();await page.waitForFunction(()=>!!window.voice.mic);
  await page.locator('#modeHost').click();await page.waitForFunction(()=>window.mediaStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#hostCameraLimits [data-call-limit=automatic]').checked===false);
  await page.locator('#modeClient').click();await page.locator('#clientPrepareMic').click();assert.equal(await page.locator('#clientVoice [data-voice=automatic]').isChecked(),false);
  assert.equal(await page.locator('#clientCallSounds').isChecked(),true,'Call sounds default on');await page.locator('#clientCallSounds').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});await page.reload();assert.equal(await page.locator('#clientCallSounds').isChecked(),false,'Saved mute preference survives');
  await page.evaluate(async()=>{const {VoiceRoom}=await import('/voice.js');const preview=VoiceRoom.prototype.previewMicrophone;VoiceRoom.prototype.previewMicrophone=function(...args){window.voice=this;return preview.apply(this,args);};const receive=VoiceRoom.prototype.receive;VoiceRoom.prototype.receive=function(from,msg){if(window.holdVoicePolicy && ['hello','members'].includes(msg?.action)){(window.voicePolicies ||= []).push([from,msg]);return;}return receive.call(this,from,msg);};const {CameraRoom}=await import('/camera.js');const ready=CameraRoom.prototype.setReady;CameraRoom.prototype.setReady=function(...args){if(args[0] && this.constructor===CameraRoom)window.camera=this;return ready.apply(this,args);};});
  await page.locator('#clientPrepareMic').click();await page.locator('#clientVoice [data-voice=preview]').click();await page.waitForFunction(()=>!!window.voice?.mic);const captures=await page.evaluate(()=>window.mediaCalls.length);
  const host=await context.newPage();host.on('pageerror',e=>errors.push(e.message));await host.goto(origin+'/?mode=host');
  await host.evaluate(async()=>{const {VoiceRoom}=await import('/voice.js');const ready=VoiceRoom.prototype.setReady;VoiceRoom.prototype.setReady=function(...args){if(args[0])window.voice=this;return ready.apply(this,args);};});
  await host.locator('#hostCreateTop').click();
  const pair=async()=>{if(!await host.locator('#hostInviteSheet').evaluate(el=>el.open))await host.locator('#inviteFocus').click();const old=await host.locator('#hostInvitation').inputValue();await host.locator(old?'#newInvitation':'#createInvitation').click();await host.waitForFunction(old=>!!document.querySelector('#hostInvitation').value && document.querySelector('#hostInvitation').value!==old,old);await page.locator('#clientInvitationFile').setInputFiles({name:'invite.json',mimeType:'application/json',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await page.waitForFunction(()=>!!document.querySelector('#clientReply').value);await host.locator('#hostReplyFile').setInputFiles({name:'reply.json',mimeType:'application/json',buffer:Buffer.from(await page.locator('#clientReply').inputValue())});await page.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Connected');};
  await pair();await page.waitForFunction(()=>window.voice.active && !!window.voice.mic);assert.equal(await page.evaluate(()=>window.mediaCalls.length),captures,'Joining keeps the privately prepared microphone without reopening it');
  await page.waitForFunction(()=>window.camera?.sessionLimit.automatic===false);assert.equal(await page.evaluate(()=>window.camera.settings().automatic),false,'Host fixed camera policy reaches the guest');
  await host.locator('#hostCallMic').click();await host.waitForFunction(()=>[...window.voice.peers.values()].some(p=>p.audio?.srcObject));
  const audible=await host.evaluate(async()=>{const context=new AudioContext();await context.resume();const stream=[...window.voice.peers.values()].find(p=>p.audio?.srcObject).audio.srcObject,source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();analyser.fftSize=512;source.connect(analyser);await new Promise(r=>setTimeout(r,250));const data=new Float32Array(512);analyser.getFloatTimeDomainData(data);const rms=Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length);await context.close();return rms;});assert.ok(audible>.02,'Prepared microphone arrives as decoded audio at the host');
  await page.locator('#clientDisconnect').click();await page.waitForFunction(()=>!window.voice.mic && !window.voice.active);
  await page.locator('#clientPrepareMic').click();await page.locator('#clientVoice [data-voice=preview]').click();await page.waitForFunction(()=>!!window.voice.mic);
  await host.locator('#hostAllowGuestMic').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});await pair();await page.waitForFunction(()=>window.voice.ready && !window.voice.mic && !window.voice.canSpeak());assert.equal(await page.evaluate(()=>window.voice.active),false,'Host mic permission prevents automatic voice join');
  await page.locator('#clientDisconnect').click();await page.locator('#clientPrepareMic').click();await page.evaluate(()=>window.holdMic=true);await page.locator('#clientVoice [data-voice=preview]').click();await page.waitForFunction(()=>!!window.releaseMic);
  await page.evaluate(()=>window.holdVoicePolicy=true);await host.locator('#hostAllowGuestMic').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});await pair();await page.evaluate(()=>{window.holdMic=false;window.releaseMic();window.releaseMic=null;});await page.waitForFunction(()=>!!window.voice.mic && !window.voice.micBusy);assert.equal(await page.evaluate(()=>window.voice.outgoingTrack('host')),null,'Prepared mic stays private while the new policy is delayed');await page.waitForFunction(()=>window.voicePolicies?.length>0);await page.evaluate(()=>{window.holdVoicePolicy=false;for(const [from,msg] of window.voicePolicies.splice(0))window.voice.receive(from,msg);});await page.waitForFunction(()=>window.voice.active && !!window.voice.mic && !window.voice.micBusy);
  await page.locator('#clientDisconnect').click();await page.locator('#clientPrepareMic').click();await page.evaluate(()=>window.holdMic=true);await page.locator('#clientVoice [data-voice=preview]').click();await page.waitForFunction(()=>!!window.releaseMic);await page.locator('#clientVoice [data-voice=preview]').click();await page.evaluate(()=>{window.releaseMic();window.releaseMic=null;window.holdMic=false;});await page.waitForFunction(()=>window.mediaStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));assert.equal(await page.evaluate(()=>window.voice.micBusy || !!window.voice.mic),false,'Cancelling pending access releases the eventual track');
  assert.deepEqual(errors,[]);console.log('PASS: stable Host/Join header, full-width disclosures, consistent input section, scrolled panel switching, private mic meter and cleanup, permission errors, remembered camera/voice settings and sound defaults; prepared mic joins with decoded audio, survives invite preparation, and respects host permission on reconnect.');
}finally{await browser?.close();await app.close();}
