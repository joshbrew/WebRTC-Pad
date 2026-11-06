import {launchTestBrowser} from './browser-fixture.mjs';
// Real loopback WebRTC, generated media and recording controller output only.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const slots=new Set(),errors=[];
const app=createApp({env:{},createInjector:async()=>({name:'Join devices fixture',addController(slot){slots.add(slot);},removeController(slot){slots.delete(slot);},setState(){},close(){slots.clear();}})});
let browser;
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`;
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const pages=[];
  for(let i=0;i<3;i++){
    const context=await browser.newContext({viewport:{width:1366,height:950}});context.setDefaultTimeout(15000);
    await context.route('**/ice?*',r=>r.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
    await context.addInitScript(()=>{
      for(const side of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${side}`,'seen');localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
      window.mediaCalls=[];window.mediaStreams=[];
      navigator.getGamepads=()=>window.pads ||= ['PS4 Controller','Pro Controller','Generic USB gamepad'].map((id,index)=>({id,index,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}));
      navigator.mediaDevices.enumerateDevices=async()=>[{kind:'videoinput',deviceId:'camera-two',label:'USB camera'},{kind:'audioinput',deviceId:'mic-two',label:'USB microphone'}];
      navigator.mediaDevices.getUserMedia=async options=>{
        window.mediaCalls.push(options);let stream;
        if(options.video){const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const c=canvas.getContext('2d');let frame=0;const draw=()=>{c.fillStyle='#1b3032';c.fillRect(0,0,640,480);c.fillStyle='#d2f79d';c.font='28px sans-serif';c.fillText(`Private camera preview ${frame++}`,25,70);};draw();const timer=setInterval(draw,40);stream=canvas.captureStream(24);const track=stream.getVideoTracks()[0],stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};}
        else{const audio=new AudioContext();await audio.resume();const tone=audio.createOscillator(),destination=audio.createMediaStreamDestination();tone.connect(destination);tone.start();stream=destination.stream;}
        window.mediaStreams.push(stream);return stream;
      };
      // Expose room objects for transport assertions without opening real devices.
      import('/camera.js').then(({CameraRoom})=>{const capture=CameraRoom.prototype.capture;CameraRoom.prototype.capture=function(...args){window.camera=this;return capture.apply(this,args);};const ready=CameraRoom.prototype.setReady;CameraRoom.prototype.setReady=function(...args){if(args[0] && this.constructor===CameraRoom)window.camera=this;return ready.apply(this,args);};});
      import('/voice.js').then(({VoiceRoom})=>{const ready=VoiceRoom.prototype.setReady;VoiceRoom.prototype.setReady=function(...args){if(args[0])window.voice=this;return ready.apply(this,args);};});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+(i?'/?mode=join':''));pages.push(page);
  }
  const [host,guest,watcher]=pages;
  assert.equal(await host.locator('#hostAllowGuestVideo').isChecked(),true);assert.equal(await host.locator('#hostAllowGuestMic').isChecked(),true);
  await host.locator('#hostAllowGuestVideo').uncheck();await host.locator('#hostAllowGuestMic').uncheck();
  await guest.locator('#clientPrepareControllers').click();assert.equal(await guest.locator('#controllersSheet').evaluate(el=>el.parentElement.id),'clientJoinSetup');
  await guest.getByRole('button',{name:'Select Pro Controller',exact:true}).click();
  await guest.getByRole('button',{name:'Select Pro Controller',exact:true}).focus();await guest.evaluate(()=>{window.heldPad=window.pads[0];window.pads[0]=null;window.dispatchEvent(new Event('gamepaddisconnected'));});await guest.waitForFunction(()=>document.querySelectorAll('#connectedControllers [role=listitem]').length===2);assert.equal(await guest.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Select Pro Controller');
  await guest.evaluate(()=>{window.pads[0]=window.heldPad;window.dispatchEvent(new Event('gamepadconnected'));});await guest.waitForFunction(()=>document.querySelectorAll('#connectedControllers [role=listitem]').length===3);
  await guest.getByRole('button',{name:'Map Pro Controller',exact:true}).click();assert.equal(await guest.locator('[data-keyboard=device]').inputValue(),'1');await guest.locator('[data-keyboard=close]').click();
  await guest.locator('#joinKeyboardController').click();await guest.keyboard.press('Escape');await guest.waitForFunction(()=>document.activeElement.id==='clientPrepareControllers');
  await guest.locator('#clientPrepareCamera').click();await guest.locator('#clientCamera [data-camera=device]').selectOption('camera-two');await guest.locator('#clientCamera [data-camera=toggle]').click();
  await guest.waitForFunction(()=>!!window.camera?.stream && !window.camera.ready && window.camera.peers.size===0);
  assert.equal(await guest.evaluate(()=>window.mediaCalls[0].video.deviceId.exact),'camera-two');
  await guest.locator('#modeHost').click();await guest.waitForFunction(()=>window.mediaStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));await guest.locator('#modeClient').click();await guest.locator('#clientPrepareCamera').click();await guest.locator('#clientCamera [data-camera=toggle]').click();await guest.waitForFunction(()=>!!window.camera.stream && !window.camera.ready);
  await guest.getByRole('button',{name:'Close camera',exact:true}).click();
  await guest.locator('#clientPrepareMic').click();await guest.locator('#clientVoice [data-voice=device]').selectOption('mic-two');await guest.getByRole('button',{name:'Close settings',exact:true}).click();
  await fs.mkdir('.local/screenshots',{recursive:true});await guest.screenshot({path:'.local/screenshots/guest-prejoin-devices.png'});await host.screenshot({path:'.local/screenshots/host-prestart-media-permissions.png'});
  await host.locator('#hostCreate').click();
  const join=async(page,role)=>{if(!await host.locator('#hostInviteSheet').evaluate(el=>el.open))await host.locator('#inviteFocus').click();await host.locator('#invitationRole').selectOption(role);const old=await host.locator('#hostInvitation').inputValue();await host.locator(old?'#newInvitation':'#createInvitation').click();await host.waitForFunction(old=>document.querySelector('#hostInvitation').value!==old,old);await page.locator('#clientInvitationFile').setInputFiles({name:'invite.json',mimeType:'application/json',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await page.waitForFunction(()=>!!document.querySelector('#clientReply').value);await host.locator('#hostReplyFile').setInputFiles({name:'reply.json',mimeType:'application/json',buffer:Buffer.from(await page.locator('#clientReply').inputValue())});await page.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Connected');};
  await join(guest,'play');
  await guest.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.joined==='2');assert.equal(slots.size,2,'Only the selected pad and keyboard join; idle pads take no spots');
  await guest.waitForFunction(()=>window.camera?.ready && window.camera.guestVideoAllowed===false && window.voice?.guestMicAllowed===false);
  assert.equal(await guest.evaluate(()=>window.camera.stream.getVideoTracks()[0].readyState),'live','Camera preview survives manual invite/reply');
  assert.equal(await guest.evaluate(()=>window.camera.roster.find(m=>m.id===window.camera.self)?.camera),false);
  assert.equal(await guest.evaluate(()=>[...window.camera.peers.values()].some(p=>p.sender?.track)),false,'Blocked camera never sends');
  await guest.evaluate(()=>window.voice.join(true));assert.equal(await guest.evaluate(()=>window.mediaCalls.filter(c=>c.audio).length),0,'Blocked microphone never captures');
  // A spectator may prepare a device, but cannot claim player slots.
  await watcher.locator('#clientPrepareControllers').click();await watcher.getByRole('button',{name:'Select PS4 Controller',exact:true}).click();await watcher.getByRole('button',{name:'Close controllers',exact:true}).click();await join(watcher,'watch');
  assert.equal(await watcher.locator('#clientEnablePad').getAttribute('data-joined'),'0');assert.equal(slots.size,2);
  await host.locator('#hostCallSettings').click();await host.locator('#hostSettingsSheet-players-tab').click();await host.locator('#hostAllowGuestVideo').check();
  await host.waitForFunction(()=>[...window.camera.peers.values()].some(p=>p.pc.connectionState==='connected' && p.stream?.getVideoTracks().some(t=>!t.muted)));
  await host.waitForFunction(()=>document.querySelector('.guest-media-status')?.textContent.includes('Camera sharing'));
  assert.equal(await guest.evaluate(()=>window.voice.guestMicAllowed),false,'Camera permission does not enable microphones');
  await host.locator('#hostAllowGuestMic').check();await guest.waitForFunction(()=>window.voice.guestMicAllowed===true);await guest.evaluate(()=>window.voice.toggleMic());
  await host.waitForFunction(()=>document.querySelector('.guest-media-status')?.textContent.includes('Mic on'));
  await guest.waitForFunction(()=>!!window.voice.mic);assert.equal(await guest.evaluate(()=>window.mediaCalls.find(c=>c.audio).audio.deviceId.exact),'mic-two');
  await host.locator('#hostAllowGuestMic').uncheck();await guest.waitForFunction(()=>!window.voice.mic && window.voice.guestMicAllowed===false);
  await host.waitForFunction(()=>document.querySelector('.guest-media-status')?.textContent.includes('Mic muted'));
  assert.equal(await guest.evaluate(()=>window.camera.guestVideoAllowed),true,'Microphone permission does not disable cameras');
  await host.locator('#hostAllowGuestVideo').uncheck();await guest.waitForFunction(()=>window.camera.guestVideoAllowed===false && [...window.camera.peers.values()].every(p=>!p.sender?.track));
  assert.equal(slots.size,2,'Media permission changes preserve controllers');
  await fs.mkdir('.local/screenshots',{recursive:true});await host.screenshot({path:'.local/screenshots/host-guest-media-permissions.png'});
  await guest.locator('#clientDisconnect').click();await guest.waitForFunction(()=>window.mediaStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
  await guest.locator('#clientPrepareControllers').click();await guest.locator('#controllerAdvanced').evaluate(el=>el.open=true);await guest.locator('#clientJoinControllers').uncheck();await guest.getByRole('button',{name:'Close controllers',exact:true}).click();await join(guest,'play');await guest.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.ready==='true');
  await guest.evaluate(()=>window.pads[0].buttons[0]={pressed:true,value:1});await guest.waitForTimeout(180);assert.equal(await guest.locator('#clientEnablePad').getAttribute('data-joined'),'0','Controllers switched off before joining cannot claim prepared or newly pressed devices');
  await guest.locator('#clientDisconnect').click();
  await host.locator('#hostEnd').click();await host.waitForFunction(()=>!document.querySelector('#hostCreate').disabled);await host.locator('#hostPlayerOptions > summary').click();await host.locator('#hostDynamicControllers').uncheck();await host.locator('#hostControllerCount').selectOption('2');await guest.locator('#clientPrepareControllers').click();await guest.locator('#controllerAdvanced').evaluate(el=>el.open=true);await guest.locator('#clientJoinControllers').check();await guest.getByRole('button',{name:'Close controllers',exact:true}).click();await host.locator('#hostCreate').click();await join(guest,'play');
  await guest.waitForFunction(()=>document.querySelector('#clientControllerCount').value==='2' && document.querySelector('#inputSource').value==='keyboard');
  await host.waitForFunction(()=>document.querySelectorAll('.guest-controller').length===2);assert.match(await host.locator('#peerList').textContent(),/Pro Controller/);await host.locator('#hostEnd').click();await guest.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Not connected' && document.querySelector('#clientDisconnect').disabled);assert.match(await guest.locator('#clientStatus').textContent(),/host ended/);
  for(const width of [320,390,1366]){
    await guest.setViewportSize({width,height:850});assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    for(const id of ['clientPrepareControllers','clientPrepareCamera','clientPrepareMic']){await guest.locator('#'+id).click();assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Expanded device controls must fit the screen');await guest.keyboard.press('Escape');await guest.waitForFunction(id=>document.activeElement.id===id,id);}
    if(width===320)await guest.screenshot({path:'.local/screenshots/polish-prejoin-phone.png'});
  }
  assert.deepEqual(errors,[]);console.log('PASS: private prejoin camera and remembered devices; selected pad plus keyboard auto-join in adaptive and manual modes; spectators cannot claim slots; independent host camera/microphone permissions before and during calls; revocation stops sending; controller hotplug and keyboard focus; cleanup and 320px mobile bounds.');
}finally{await browser?.close();await app.close();}
