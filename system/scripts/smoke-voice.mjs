import {launchTestBrowser} from './browser-fixture.mjs';
// Synthetic microphones, real browser Opus/WebRTC, three independent pages.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const writes=[],errors=[],app=createApp({env:{},createInjector:async()=>({name:'Voice test',addController(){},removeController(){},setState(slot,state){writes.push(state);},close(){}})});let browser;
let phase='starting';const watchdog=setTimeout(()=>{console.error('Voice test timed out at:',phase);browser?.close();},120000);
const until=async(predicate,label)=>{const end=Date.now()+12000;while(!await predicate()){if(Date.now()>end)throw Error(label);await new Promise(resolve=>setTimeout(resolve,40));}};
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`;
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1366,height:900}});context.setDefaultTimeout(15000);
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:capture-method','browser');
    window.micStreams=[];window.micCalls=0;
    navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audioinput',deviceId:'default',label:'Default microphone'},{kind:'audioinput',deviceId:'alternate',label:'Alternate microphone'}];
    navigator.mediaDevices.getUserMedia=async options=>{
      window.micCalls++;window.lastMicOptions=options;
      const ctx=new AudioContext(),osc=ctx.createOscillator(),out=ctx.createMediaStreamDestination();osc.frequency.value=options.audio.deviceId?.exact==='alternate'?880:window.testTone;osc.connect(out);osc.start();await ctx.resume();
      const stream=out.stream,track=stream.getAudioTracks()[0],stop=track.stop.bind(track);track.stop=()=>{stop();osc.stop();ctx.close();};window.micStreams.push(stream);
      if(window.holdMic)await new Promise(resolve=>window.releaseMic=resolve);
      return stream;
    };
  });
  const page=async(tone,guest=false)=>{const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+(guest?'/?mode=join':''));await p.evaluate(async tone=>{window.testTone=tone;const {VoiceRoom}=await import('/voice.js'),join=VoiceRoom.prototype.join;VoiceRoom.prototype.join=function(...args){window.voice=this;return join.apply(this,args);};},tone);return p;};
  const host=await page(440),a=await page(660,true),b=await page(990,true);
  assert.equal(await host.locator('#hostVoice').isVisible(),false);assert.equal(await host.locator('#hostPreviewSettings').evaluate(el=>el.closest('#hostMonitor')!==null),true);assert.equal(await host.locator('#hostSettings #hostPreviewToggle').count(),0);
  await host.locator('#hostCreate').click();await host.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);
  const pair=async(p,role)=>{if(!await host.locator('#hostInviteSheet').evaluate(el=>el.open))await host.locator('#inviteFocus').click();await host.locator('#invitationRole').selectOption(role);const old=await host.locator('#hostInvitation').inputValue();await host.locator(old?'#newInvitation':'#createInvitation').click();await host.waitForFunction(old=>document.querySelector('#hostInvitation').value!==old,old);
    await p.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await p.waitForFunction(()=>!!document.querySelector('#clientReply').value);
    await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await p.locator('#clientReply').inputValue())});await p.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Connected');};
  await pair(a,'play');await pair(b,'watch');
  for(const p of [a,b]){await p.locator('#clientCallSettings').click();await p.locator('#clientSettingsSheet-screen-tab').click();await p.locator('#clientMediaToggle').click();await p.getByRole('button',{name:'Close settings',exact:true}).click();}
  const voice=(p,name)=>p.locator(`${p===host?'#hostVoice':'#clientVoice'} [data-voice="${name}"]`);
  for(const p of [host,a,b])assert.equal(await p.evaluate(()=>window.micCalls),0,'No microphone access before joining');
  const openVoice=async p=>{const side=p===host?'host':'client';if(!await p.locator(`#${side}SettingsSheet`).evaluate(el=>el.open))await p.locator(`#${side}CallSettings`).click();const tab=p.locator(`#${side}SettingsSheet-voice-tab`);if(await tab.getAttribute('aria-selected')!=='true')await tab.click();};
  for(const p of [host,a,b])await openVoice(p);
  await voice(host,'join').click();await voice(a,'join').click();await voice(b,'listen').click();
  for(const p of [host,a,b])await p.waitForFunction(()=>window.voice?.peers.size===2 && [...window.voice.peers.values()].every(p=>p.pc.connectionState==='connected'));
  assert.equal(await b.evaluate(()=>window.micCalls),0,'Listen only never opens the microphone');
  const heard=async p=>p.evaluate(async()=>{
    const ctx=new AudioContext();await ctx.resume();const results=[];
    for(const p of window.voice.peers.values())if(p.audio?.srcObject){
      const source=ctx.createMediaStreamSource(p.audio.srcObject),analyser=ctx.createAnalyser();analyser.fftSize=8192;source.connect(analyser);await new Promise(r=>setTimeout(r,150));
      const spectrum=new Float32Array(analyser.frequencyBinCount),data=new Float32Array(analyser.fftSize);analyser.getFloatFrequencyData(spectrum);analyser.getFloatTimeDomainData(data);
      const peak=spectrum.reduce((index,value,i)=>value>spectrum[index]?i:index,1);results.push({frequency:peak*ctx.sampleRate/analyser.fftSize,rms:Math.sqrt(data.reduce((n,v)=>n+v*v,0)/data.length)});source.disconnect();
    }await ctx.close();return results;
  });
  const hears=async(p,hz)=>(await heard(p)).some(v=>v.rms>.01 && Math.abs(v.frequency-hz)<20);
  await until(()=>hears(host,660),'Host did not hear guest');await until(()=>hears(a,440),'Guest did not hear host');await until(()=>hears(b,440),'Listener did not hear host');await until(()=>hears(b,660),'Listener did not hear guest');
  assert.equal(await hears(host,440),false,'Host must not receive its own mic');
  for(const p of [host,a])assert.ok(await p.evaluate(()=>[...window.voice.peers.values()].every(p=>p.pc.localDescription.sdp.includes('maxaveragebitrate=192000') && !p.pc.localDescription.sdp.includes('m=video'))));
  await voice(b,'mic').click();await until(()=>hears(host,990),'Listener could not turn mic on');await until(()=>hears(a,990),'Guests did not receive each other directly');
  await voice(a,'mic').click();await until(async()=>!await hears(b,660),'Mute did not stop outgoing mic audio');await voice(a,'mic').click();await until(()=>hears(b,660),'Unmute did not restore audio');
  await voice(a,'device').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await voice(a,'device').selectOption('alternate');await until(()=>hears(host,880),'Changing microphone did not replace the voice track');assert.equal(await a.evaluate(()=>window.micStreams[0].getAudioTracks()[0].readyState),'ended');
  await a.evaluate(async()=>{const [first,second]=window.voice.peers.values();await window.voice.tune(first,{loss:.2,rttMs:500});await window.voice.tune(first,{loss:.2,rttMs:500});if(first.budget.bitrate!==64000 || second.budget.bitrate!==128000)throw Error('Quality adjustment leaked to another voice peer');});
  await a.locator('#clientCallControllers').click();await a.locator('#joinKeyboardController').click();await a.waitForFunction(()=>document.querySelector('#clientSlot').textContent.includes('P1'));await a.getByRole('button',{name:'Close controllers',exact:true}).click();await a.locator('#clientStage').focus();await a.keyboard.down('z');await until(()=>writes.some(s=>s.buttons.a),'Controllers stopped during voice');await a.keyboard.up('z');
  phase='revoking active microphones';
  await host.locator('#hostSettingsSheet-players-tab').click();await host.locator('#hostAllowGuestMic').uncheck();
  for(const p of [a,b])await p.waitForFunction(()=>window.voice.guestMicAllowed===false && !window.voice.mic && window.micStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
  await until(async()=>!await hears(host,880),'Guest mic audio continued after host revoked permission');await until(()=>hears(a,440),'Guest must still hear host with guest microphones disabled');
  const micCalls=await a.evaluate(()=>window.micCalls);await host.locator('#hostAllowGuestMic').check();await a.waitForFunction(()=>window.voice.guestMicAllowed===true);assert.equal(await a.evaluate(()=>window.micCalls),micCalls,'Allowing microphones must not silently restart capture');
  await openVoice(a);await voice(a,'mic').click();await until(()=>hears(host,880),'Guest could not explicitly resume microphone after host allowed it');
  phase='cancelled permission';
  await openVoice(a);await voice(a,'leave').click();await a.evaluate(()=>window.holdMic=true);await voice(a,'join').click();await a.waitForFunction(()=>!!window.releaseMic);await voice(a,'leave').click();await a.evaluate(()=>window.releaseMic());await a.waitForFunction(()=>window.micStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));assert.equal(await a.evaluate(()=>window.voice.active),false,'Late permission must not restart a left call');
  phase='revoking pending permission';
  await a.evaluate(()=>window.releaseMic=null);await voice(a,'join').click();await a.waitForFunction(()=>!!window.voice.busy && !!window.releaseMic);await host.locator('#hostAllowGuestMic').uncheck();await a.waitForFunction(()=>window.voice.guestMicAllowed===false);await a.evaluate(()=>window.releaseMic());await a.waitForFunction(()=>!window.voice.busy && window.micStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));assert.equal(await a.evaluate(()=>!!window.voice.mic),false,'Late microphone permission cannot override a host revocation');
  phase='leaving host voice';
  await openVoice(host);
  await voice(host,'leave').click();assert.equal(await host.evaluate(()=>window.micStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true);
  assert.equal(await b.locator('#clientConnectionText').textContent(),'Connected');
  await fs.mkdir('.local/screenshots',{recursive:true});await b.screenshot({path:'.local/screenshots/voice-chat.png',fullPage:true});await b.setViewportSize({width:390,height:800});assert.equal(await b.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  phase='ending session';
  await host.locator('#hostEnd').click();await b.waitForFunction(()=>!window.voice.ready && window.micStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));assert.equal(await b.evaluate(()=>window.voice.ready),false);assert.deepEqual(errors,[]);
  console.log('PASS: host microphone revocation stops audio but preserves listening, explicit resume, and late-permission cancellation; three-party real Opus voice; independent of game stream; listen-only; no self-loopback; mute; live microphone replacement; per-peer quality; controller input; cancelled mic permission and session end release tracks; preview controls beside monitor; phone layout');
}finally{clearTimeout(watchdog);await browser?.close();await app.close();}
