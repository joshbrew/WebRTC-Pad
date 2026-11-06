// Real encoded RTP/Pion/browser handover with generated pixels only. No
// desktop windows, audio devices or native controller outputs are opened.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {NativeMedia} from '../src/native-media.js';
import {videoEncoderArguments} from '../src/encoder-scan.js';
import {launchTestBrowser} from './browser-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
let browser;const errors=[],engines=[];
const app=createApp({env:{...(process.env.NATIVE_MEDIA_HELPER?{NATIVE_MEDIA_HELPER:process.env.NATIVE_MEDIA_HELPER}:{})},getCaptureTargets:async()=>[{id:'desktop',kind:'desktop',label:'Generated motion test',width:1280,height:720}],createInjector:async()=>({setState(){},close(){}}),createNativeMedia:env=>{
  const engine=new NativeMedia({...env,NATIVE_AUDIO:'0'});engine.sourceSize={width:1280,height:720};engines.push(engine);
  engine.startEncoder=async(profile,q,port)=>{
    profile.encoder='libx264';profile.capture='Generated test frames';
    const ratio=Math.min(1,(q.width || 1280)/1280,(q.height || 720)/720),width=Math.floor(1280*ratio/2)*2,height=Math.floor(720*ratio/2)*2;
    const child=spawn(engine.capability.ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-progress','pipe:1','-re','-f','lavfi','-i',`testsrc2=size=${width}x${height}:rate=${q.frameRate}`,...videoEncoderArguments('libx264',q.frameRate,q.maxBitrate),'-f','rtp','-payload_type','96',`rtp://127.0.0.1:${port}?pkt_size=1200`],{windowsHide:true,stdio:['ignore','pipe','pipe']});profile.child=child;
    await new Promise((resolve,reject)=>{let stderr='';const timer=setTimeout(()=>{child.kill();reject(Error('Generated encoder timed out'));},10000);child.stderr.on('data',data=>{stderr=(stderr+data).slice(-2000);});createInterface({input:child.stdout}).on('line',line=>{if(/^frame=\s*[1-9]/.test(line)){clearTimeout(timer);resolve();}});child.on('error',reject);child.on('exit',()=>{clearTimeout(timer);reject(Error(stderr || 'Generated encoder exited'));});});
  };return engine;
}});
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1280,height:900}});context.setDefaultTimeout(20000);
  await context.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.addInitScript(()=>{const PC=RTCPeerConnection;window.handoverPeers=[];window.RTCPeerConnection=class extends PC{constructor(...args){super(...args);window.handoverPeers.push(this);}};});
  await context.addInitScript(()=>{window.playerWrites=[];const d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'srcObject');Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{...d,set(value){if(this.id==='clientVideo')window.playerWrites.push({tracks:value?.getTracks().map(t=>t.id),stack:new Error().stack});d.set.call(this,value);}});});
  await context.addInitScript(()=>{const send=RTCDataChannel.prototype.send;RTCDataChannel.prototype.send=function(value){if(typeof value==='string' && value.includes('quality-request'))window.qualityChannel=this;return send.call(this,value);};for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:capture-method','native');localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');});
  const origin=`http://127.0.0.1:${app.server.address().port}`,host=await context.newPage();host.on('pageerror',e=>errors.push(e.message));await host.goto(origin);
  await host.locator('#hostAutoThrottle').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});await host.locator('#nativeCaptureAudio').uncheck();await host.locator('#captureTarget').selectOption('desktop');await host.waitForFunction(()=>document.querySelector('#hostPreview').videoWidth>0);
  await host.locator('#hostCreate').click();
  const guests=[];
  for(let i=0;i<2;i++){
    if(i)await host.locator('#inviteFocus').click();const previous=await host.locator('#hostInvitation').inputValue();await host.locator(i?'#newInvitation':'#createInvitation').click();await host.waitForFunction(previous=>!!document.querySelector('#hostInvitation').value && document.querySelector('#hostInvitation').value!==previous,previous);
    const guest=await context.newPage();guest.on('pageerror',e=>errors.push(e.message));await guest.goto(origin+'/?mode=join');
    await guest.locator('#clientAutoThrottle').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
    await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.json',mimeType:'application/json',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
    await host.locator('#hostReplyFile').setInputFiles({name:'reply.json',mimeType:'application/json',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});await guest.waitForFunction(()=>document.querySelector('#clientVideo').readyState>=2 && document.querySelector('#clientVideo').videoHeight===720);await host.waitForFunction(()=>!document.querySelector('#hostInviteSheet').open);guests.push(guest);
  }
  const stableProfiles=engines[0].profiles.size,guest=guests[0];await guest.bringToFront();await guest.evaluate(()=>{window.playerWrites=[];window.handoverAudit={empty:0,black:0,max:0,last:performance.now()};const video=document.querySelector('#clientVideo'),canvas=document.createElement('canvas');canvas.width=canvas.height=8;const ctx=canvas.getContext('2d',{willReadFrequently:true});const inspect=()=>{const a=window.handoverAudit;if(!a)return;if(!video.srcObject?.getVideoTracks().length || video.readyState<2)a.empty++;else{ctx.drawImage(video,0,0,8,8);const pixels=ctx.getImageData(0,0,8,8).data;let light=0;for(let i=0;i<pixels.length;i+=4)light+=pixels[i]+pixels[i+1]+pixels[i+2];if(light<384)a.black++;}requestAnimationFrame(inspect);};requestAnimationFrame(inspect);const frame=()=>{const a=window.handoverAudit;if(!a)return;const now=performance.now();a.max=Math.max(a.max,now-a.last);a.last=now;video.requestVideoFrameCallback(frame);};video.requestVideoFrameCallback(frame);});
  const transportsBefore=[...engines[0].transports.values()];const previewBefore=await host.locator('#hostPreview').evaluate(v=>v.srcObject.id);
  await host.locator('#hostAutoThrottle').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await host.waitForTimeout(400);
  assert.deepEqual([...engines[0].transports.values()],transportsBefore,'Changing only automatic quality policy must not replace native transports');assert.equal(await host.locator('#hostPreview').evaluate(v=>v.srcObject.id),previewBefore,'Policy changes keep the preview receiver');
  await host.locator('#hostAutoThrottle').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
  for(const resolution of ['360','720','480','720']){
    await guest.locator('#clientCallSettings').click();await guest.locator('#clientResolution').selectOption(resolution);await guest.getByRole('button',{name:'Close settings',exact:true}).click();
    try{await guest.waitForFunction(height=>{const value=document.querySelector('#clientVideo').videoHeight;return value<=height && value>=height-2;},Number(resolution));}
    catch(error){console.error('Quality handover state',resolution,JSON.stringify(await guest.evaluate(()=>({height:document.querySelector('#clientVideo').videoHeight,status:document.querySelector('#clientStatus').textContent,writes:window.playerWrites,tracks:document.querySelector('#clientVideo').srcObject?.getTracks().map(t=>({id:t.id,muted:t.muted,state:t.readyState})),peers:window.handoverPeers.map(p=>({state:p.connectionState,receivers:p.getReceivers().map(r=>({id:r.track.id,muted:r.track.muted,state:r.track.readyState}))}))}))),errors);throw error;}
    const otherFrames=await guests[1].locator('#clientVideo').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames);await guests[1].waitForFunction(n=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>n+3,otherFrames);
    assert.equal(await guests[1].locator('#clientVideo').evaluate(v=>v.videoHeight),720);
  }
  await guest.evaluate(()=>{document.querySelector('#clientResolution').value='480';for(const resolution of ['360','720','480'])window.qualityChannel.send(JSON.stringify({type:'quality-request',quality:{resolution,frameRate:0,automatic:false}}));});
  await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoHeight>=478 && document.querySelector('#clientVideo').videoHeight<=480);
  await guest.locator('#clientResolution').evaluate(el=>{el.value='720';el.dispatchEvent(new Event('change',{bubbles:true}));});await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoHeight===720);
  let audit=await guest.evaluate(()=>window.handoverAudit);assert.equal(audit.empty,0);assert.equal(audit.black,0);
  const engine=engines[0];await host.waitForTimeout(200);assert.equal(engine.profiles.size,stableProfiles,'Retire replaced profiles once the new frame is presented');assert.equal(engine.transports.size,3,'One preview and two guest transports remain');
  // Negotiate valid replacement media that never produces a frame. Expire
  // the same timer path directly rather than making the fixture wait 45 s.
  const encode=engine.startEncoder;let blocked=false;
  engine.startEncoder=async(profile,q,port)=>{if(q.height===360){blocked=true;profile.encoder='fixture-no-frames';return;}return encode(profile,q,port);};
  const working=[...engine.transports.entries()].find(([id])=>id!=='preview' && !id.includes(':view:'));
  const [peerId,workingTransport]=working;
  const peerCount=await guest.evaluate(()=>window.handoverPeers.length);
  await guest.locator('#clientResolution').evaluate(el=>{el.value='360';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await guest.waitForFunction(n=>window.handoverPeers.length>n && window.handoverPeers.at(-1).connectionState==='connected',peerCount);
  const deadline=Date.now()+10000;
  while((!blocked || engine.transports.get(peerId)===workingTransport) && Date.now()<deadline)await host.waitForTimeout(50);
  assert.equal(blocked,true);const pending=engine.transports.get(peerId);assert.notEqual(pending,workingTransport);
  const framesBefore=await guest.locator('#clientVideo').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames);
  await guest.waitForFunction(n=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>n+6,framesBefore);
  assert.equal(await guest.locator('#clientVideo').evaluate(v=>v.videoHeight),720,'Undecoded replacement must not replace the working picture');
  engine.expireHandover(peerId,pending);
  await guest.waitForFunction(()=>document.querySelector('#clientStatus').textContent.includes('Keeping the previous stream'));
  assert.equal(engine.transports.get(peerId),workingTransport);assert.equal(engine.profiles.size,stableProfiles);
  assert.equal(await guest.locator('#clientConnectionText').textContent(),'Connected');
  const resumed=await guest.locator('#clientVideo').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames);
  await guest.waitForFunction(n=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>n+6,resumed);
  engine.startEncoder=encode;
  await guest.locator('#clientResolution').evaluate(el=>{el.value='480';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoHeight>=478 && document.querySelector('#clientVideo').videoHeight<=480);
  await guest.locator('#clientResolution').evaluate(el=>{el.value='720';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoHeight===720);
  await host.locator('#hostAutoThrottle').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  const pressure=async()=>{for(let n=0;n<3;n++){await guest.evaluate(()=>window.qualityChannel.send(JSON.stringify({type:'stream-metrics',metrics:{loss:.2,bufferMs:300,freezeMs:400}})));await guest.waitForTimeout(1100);}};
  await pressure();assert.equal(await guest.locator('#clientVideo').evaluate(v=>v.videoHeight),720,'A fixed guest must stay fixed even when host automatic quality is enabled');
  await guest.locator('#clientMinimumResolution').evaluate(el=>{el.value='720';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await guest.locator('#clientAutoThrottle').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await guest.waitForTimeout(400);const beforeFloor=[...engine.transports.values()];await pressure();
  assert.equal(await guest.locator('#clientVideo').evaluate(v=>v.videoHeight),720,'Automatic quality must respect the guest floor');
  assert.deepEqual([...engine.transports.values()],beforeFloor,'Pressure at the floor does not restart the stream');
  audit=await guest.evaluate(()=>{const a=window.handoverAudit;window.handoverAudit=null;return a;});
  assert.equal(audit.empty,0);assert.equal(audit.black,0);assert.ok(audit.max<1000,'Local handovers must not produce multi-second stalls');
  assert.equal(await guest.evaluate(()=>window.playerWrites.some(w=>!w.tracks?.length)),false,'Quality changes never detach the live video player');
  console.log('PASS: a replacement with no frames rolls back without stopping the live picture or call; later changes succeed; fixed resolution and automatic floors withstand pressure.');
  console.log('PASS: policy-only changes keep transports; quality handovers and rapid requests keep the picture; second guest and profile cleanup remain stable.',audit);
  for(const [page,side] of [[host,'host'],[guest,'client']]){
    const bar=await page.locator(`#${side}Toolbar`).evaluate(el=>[...el.querySelector('.toolbar-actions').children].filter(el=>el.getClientRects().length).map(el=>Math.round(el.getBoundingClientRect().top)));
    assert.equal(Math.max(...bar)-Math.min(...bar),0,'Desktop call controls occupy one row');
  }
  await host.bringToFront();await host.locator('#hostCallAddScreen').click();await host.waitForFunction(()=>!document.querySelector('#hostConfirmShare').disabled);await host.locator('#hostConfirmShare').click();await host.waitForFunction(()=>document.querySelector('.host-share-chip:nth-child(2)'));await host.keyboard.press('Escape');
  await host.locator('#hostTileControls [data-layout=grid]').click();await host.waitForFunction(()=>[...document.querySelectorAll('#hostTileGrid .view-tile')].some(t=>t.dataset.sourceId!=='host-main' && t.querySelector('video')?.videoWidth>0));
  await host.locator('#hostTileGrid .view-tile:not([data-source-id="host-main"]) .tile-remove').click();await host.waitForFunction(()=>document.querySelectorAll('.host-share-chip').length===1);assert.equal(await guest.locator('#clientConnectionText').textContent(),'Connected');
  assert.deepEqual(errors,[]);console.log('PASS: native/Pion/browser handovers and rapid requests; no cleared guest picture; second guest unaffected; profile cleanup; one-row controls.',audit);
}finally{await browser?.close();await app.close();for(const engine of engines)engine.close();}
