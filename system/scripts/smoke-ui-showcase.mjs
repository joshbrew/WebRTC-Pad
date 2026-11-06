import {launchTestBrowser} from './browser-fixture.mjs';
// Real local WebRTC call, generated screen content, and three simulated pads.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const writes=[],errors=[];let browser;
const app=createApp({env:{},createInjector:async()=>({name:'UI screenshot fixture',addController(){},removeController(){},setState(slot,state){writes.push({slot,state});},close(){}})});
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{...(process.env.BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.BROWSER_CHANNEL || 'msedge'}),headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion']});
  const context=await browser.newContext({viewport:{width:1440,height:960}});context.setDefaultTimeout(20000);
  await context.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.addInitScript(()=>{
    window.fixtureConnections=[];window.viewMessages=[];const hooks=new WeakSet(),hook=ch=>{if(ch.label!=='control' || hooks.has(ch))return;hooks.add(ch);const log=(direction,data)=>{try{const m=JSON.parse(data);if(m.type?.includes('view'))window.viewMessages.push({direction,type:m.type,source:m.sourceId,request:m.requestId,token:m.token});}catch{}};const send=ch.send.bind(ch);ch.send=data=>{log('send',data);return send(data);};ch.addEventListener('message',e=>log('receive',e.data));};const RTC=RTCPeerConnection;window.RTCPeerConnection=class extends RTC{constructor(...args){super(...args);window.fixtureConnections.push(this);this.addEventListener('datachannel',e=>hook(e.channel));}createDataChannel(...args){const ch=super.createDataChannel(...args);hook(ch);return ch;}};
    localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');localStorage.setItem('webrtc-pad:capture-method','browser');
    localStorage.setItem('webrtc-pad:stream-quality',JSON.stringify({resolution:'1080',width:1920,height:1080,frameRate:60,maxBitrate:8000000,priority:'motion',autoThrottle:false}));
    for(const mode of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${mode}`,'seen');
    window.pads=['PS4 Controller','Xbox Wireless Controller','Pro Controller'].map((id,index)=>({id,index,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}));
    Object.defineProperty(navigator,'getGamepads',{value:()=>window.pads});
    const silentAudio=()=>{const ac=new AudioContext(),destination=ac.createMediaStreamDestination(),osc=ac.createOscillator(),gain=ac.createGain();gain.gain.value=0;osc.connect(gain).connect(destination);osc.start();const track=destination.stream.getAudioTracks()[0],stop=track.stop.bind(track);let stopped=false;track.stop=()=>{if(stopped)return;stopped=true;stop();osc.stop();ac.close();};return destination.stream;};
    navigator.mediaDevices.enumerateDevices=async()=>[{kind:'videoinput',deviceId:'demo-camera',label:'Demo camera'},{kind:'audioinput',deviceId:'demo-mic',label:'Demo microphone'}];
    navigator.mediaDevices.getUserMedia=async options=>{if(options.audio)return silentAudio();const guest=location.search.includes('join'),canvas=document.createElement('canvas'),fps=options.video?.frameRate?.max || 24;canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');let frame=0;const draw=()=>{frame++;ctx.fillStyle=guest?'#2b3041':'#233a31';ctx.fillRect(0,0,640,480);ctx.strokeStyle=guest?'#606b93':'#63866c';ctx.lineWidth=2;for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(320,250,100+i*45+Math.sin(frame/50)*4,0,Math.PI*2);ctx.stroke();}ctx.fillStyle=guest?'#bec9fa':'#c5eea2';ctx.beginPath();ctx.arc(320,205+Math.sin(frame/35)*5,65,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(320,430,135,135,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#e6eee5';ctx.font='24px sans-serif';ctx.fillText(guest?'Demo camera · Guest':'Demo camera · Host',24,38);};draw();const timer=setInterval(draw,1000/fps),stream=canvas.captureStream(fps),track=stream.getVideoTracks()[0],stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};return stream;};
    navigator.mediaDevices.getDisplayMedia=async(options={})=>{
      const view=window.captureCount || 0;window.captureCount=view+1;
      const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');ctx.scale(2/3,2/3);let frame=0;
      const colors=['#cef99b','#91cfee','#eeb6d3'];
      const draw=()=>{
        frame++;ctx.fillStyle='#102228';ctx.fillRect(0,0,1920,1080);
        ctx.strokeStyle='#20353a';ctx.lineWidth=2;for(let x=0;x<1920;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,1080);ctx.stroke();}for(let y=0;y<1080;y+=80){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1920,y);ctx.stroke();}
        ctx.fillStyle='#0c1a20';ctx.fillRect(0,0,1920,160);ctx.fillStyle='#daf2e8';ctx.font='600 46px sans-serif';ctx.fillText(view?'World map':'Playing together',70,82);ctx.fillStyle='#9ab6b3';ctx.font='24px sans-serif';ctx.fillText(view?'Second demo window · independent shared view':'Demo screen · local WebRTC test call',70,125);
        ctx.strokeStyle='#395852';ctx.lineWidth=3;ctx.strokeRect(100,220,1720,700);
        for(let i=0;i<3;i++){
          const x=420+i*530+Math.sin(frame/75+i)*90,y=500+Math.cos(frame/100+i)*115;
          ctx.strokeStyle=colors[i]+'50';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,125,0,Math.PI*2);ctx.stroke();ctx.fillStyle=colors[i];ctx.beginPath();ctx.arc(x,y,40,0,Math.PI*2);ctx.fill();ctx.font='600 25px sans-serif';ctx.textAlign='center';ctx.fillText(`P${i+1}`,x,y+85);
        }
        ctx.textAlign='left';ctx.fillStyle='#9ab6b3';ctx.font='24px sans-serif';ctx.fillText('CONTROLLERS CONNECTED',100,1000);ctx.fillStyle='#daf2e8';ctx.fillText('Play on the host. Keep the call open here.',100,1038);
      };draw();setInterval(draw,1000/60);const stream=canvas.captureStream(60);Object.defineProperty(stream.getVideoTracks()[0],'label',{value:view?'Demo · Map window':'Demo · Game window'});if(options.audio)stream.addTrack(silentAudio().getAudioTracks()[0]);return stream;
    };
  });
  const host=await context.newPage(),guest=await context.newPage(),origin=`http://127.0.0.1:${app.server.address().port}`;
  for(const page of [host,guest])page.on('pageerror',error=>errors.push(error.message));
  const folder='.local/screenshots';await fs.mkdir(folder,{recursive:true});
  const shot=async(page,name)=>{await page.mouse.move(400,25);assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.call-sheet[open]:not(.chat-sheet)')].filter(el=>el.checkVisibility()).every(el=>el.querySelector('.call-sheet-heading').getBoundingClientRect().top>=el.getBoundingClientRect().top)),`Panel heading must stay visible: ${name}`);await page.screenshot({animations:'disabled',path:`${folder}/polished-${name}.png`});};
  await host.goto(origin);await guest.goto(origin+'/?mode=join');
  await guest.evaluate(()=>document.querySelector('#clientAutoThrottle').checked=false);
  await shot(host,'host-setup');await shot(guest,'guest-setup');
  await host.locator('#chooseBrowserSource').click();await host.waitForFunction(()=>document.querySelector('#hostPreview').videoWidth===1280);await shot(host,'host-preview');
  await host.locator('#hostCreate').click();await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
  await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
  await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});
  await guest.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.ready==='true' && document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>10);
  assert.equal(await guest.locator('#clientTileControls [data-layout=grid]').isVisible(),false,'A single shared view hides multi-screen templates');assert.equal(await guest.locator('#clientTileControls [data-layout=streamer]').isVisible(),true,'Streamer is available for one screen even without a camera');
  for(let i=0;i<3;i++){
    await guest.evaluate(index=>window.pads[index].buttons[0]={pressed:true,value:1},i);
    await guest.waitForFunction(count=>Number(document.querySelector('#clientEnablePad').dataset.joined)===count,i+1);
    for(let n=0;n<100 && !writes.some(w=>w.slot===`p${i+1}` && w.state.buttons.a);n++)await new Promise(r=>setTimeout(r,20));
    await guest.evaluate(index=>window.pads[index].buttons[0]={pressed:false,value:0},i);
  }
  await host.waitForFunction(()=>document.querySelectorAll('.guest-controller[data-state=ready]').length===3);
  await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoWidth>=1280);await guest.waitForTimeout(2000);
  await host.bringToFront();await host.waitForFunction(()=>!!document.querySelector('#hostPreview').srcObject);await host.waitForFunction(()=>Number(document.querySelector('#hostPreviewStats').textContent.match(/(\d+) fps/)?.[1] || 0)>=25);await shot(host,'host-active');
  await host.locator('.call-preview-heading').getByRole('button',{name:'Streamer view'}).click();await host.waitForFunction(()=>document.querySelector('#hostTileGrid')?.dataset.layout==='streamer' && document.querySelector('#hostTileGrid .streamer-camera')?.dataset.camera==='false');await shot(host,'host-streamer-avatar');await host.locator('#hostTileControls [data-layout=single]').click();
  await guest.bringToFront();await guest.waitForFunction(()=>Number(document.querySelector('#clientVideoStats').textContent.match(/(\d+) fps/)?.[1] || 0)>=25);await shot(guest,'guest-active');
  if(process.env.SHARING_SCREENSHOTS==='1'){
    await context.route('**/capture-targets',route=>route.fulfill({json:{targets:[]}}));
    await host.locator('#hostCallSettings').click();await host.locator('#hostLiveSource').evaluate(el=>el.open=true);await host.locator('#hostExtraShares').evaluate(el=>el.open=true);
    await host.locator('#hostAddShare').click();
    await host.waitForFunction(()=>document.querySelector('#hostExtraSource').checkVisibility() || !!document.querySelector('.extra-share-row'));
    if(await host.locator('#hostExtraShares').getByRole('button',{name:'Choose with browser…'}).isVisible())await host.locator('#hostExtraShares').getByRole('button',{name:'Choose with browser…'}).click();
    await guest.waitForFunction(()=>document.querySelector('#clientSharedView').options.length===2);
    await host.locator('#hostExtraShares').scrollIntoViewIfNeeded();await shot(host,'multi-host');await host.locator('#hostSettingsSheet').screenshot({path:`${folder}/polished-multi-host-panel.png`});await host.keyboard.press('Escape');
    await guest.setViewportSize({width:1440,height:960});await guest.locator('#clientViewPopouts').evaluate(el=>el.open=true);await shot(guest,'multi-guest');
    const extra=await guest.locator('#clientSharedView option').nth(1).getAttribute('value'),popouts=[];
    if(process.env.TILING_SCREENSHOTS==='1'){
      await guest.locator('#clientTileControls [data-layout=grid]').click();
      await guest.waitForFunction(()=>[...document.querySelectorAll('.view-tile video')].length===2 && [...document.querySelectorAll('.view-tile video')].every(v=>v.videoWidth>0 && v.getVideoPlaybackQuality().totalVideoFrames>10));
      await shot(guest,'tiles-grid');
      const before=await guest.evaluate(()=>window.fixtureConnections.length);
      const popupEvent=guest.waitForEvent('popup');await guest.locator('#clientViewPopouts button').evaluateAll((buttons,id)=>buttons.find(b=>b.dataset.sourceId===id).click(),extra);
      const tiledPopup=await popupEvent;await tiledPopup.waitForFunction(()=>document.querySelector('video').videoWidth>0);assert.equal(await guest.evaluate(()=>window.fixtureConnections.length),before,'Tile and pop-out reuse a single subscription');await tiledPopup.close();
      const frameCount=await guest.locator('.view-tile video').last().evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames);await guest.waitForFunction(n=>document.querySelectorAll('.view-tile video')[1].getVideoPlaybackQuality().totalVideoFrames>n,frameCount);
      await guest.locator('#clientVideo').evaluate(v=>v.muted=false);

      const tile=guest.locator('.view-tile').filter({has:guest.getByRole('button',{name:'Demo · Map window',exact:true})});
      await tile.locator('button').click();assert.equal(await guest.locator('#clientTileControls [data-layout=focus]').getAttribute('aria-pressed'),'true');
      await shot(guest,'tiles-featured');assert.equal(await guest.locator('#clientVideo').evaluate(v=>v.muted),false,'Changing layout must preserve the main stream sound setting');assert.equal(await guest.evaluate(()=>window.fixtureConnections.length),before,'Featuring a tile must not restart media');await guest.locator('#clientVideo').evaluate(v=>v.muted=true);
      await guest.locator('#clientFullscreen').click();await guest.waitForFunction(()=>document.fullscreenElement?.id==='clientStage');
      await guest.locator('#clientTileControls [data-layout=columns]').click();await shot(guest,'tiles-fullscreen-columns');
      await guest.locator('#clientTileControls [data-layout=grid]').click();await shot(guest,'tiles-fullscreen-grid');
      await guest.locator('#clientTileControls [data-layout=stacked]').click();
      const positions=await guest.locator('.view-tile').evaluateAll(tiles=>tiles.map(t=>{const r=t.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));assert.equal(positions[0].x,positions[1].x);assert.ok(positions[1].y>positions[0].y);await shot(guest,'tiles-fullscreen-stacked');
      await guest.locator('#clientTileControls [data-layout=single]').click();await guest.waitForFunction(()=>document.querySelector('#clientViewSwap').checkVisibility());
      const name=await guest.locator('#clientViewSwap span').textContent();await guest.getByRole('button',{name:'Next view',exact:true}).click();await guest.waitForFunction(old=>document.querySelector('#clientViewSwap span').textContent!==old,name);
      await guest.getByRole('button',{name:'Previous view',exact:true}).click();await guest.waitForFunction(old=>document.querySelector('#clientViewSwap span').textContent===old,name);await guest.waitForFunction(()=>{const v=document.querySelector('#clientVideo');return v.videoWidth>0 && v.readyState>=2 && !document.querySelector('.view-transition') && document.querySelector('#clientStage').classList.contains('has-video');});await shot(guest,'single-fullscreen-swap');
      await guest.locator('#clientTileControls [data-layout=grid]').click();

      await guest.evaluate(()=>document.exitFullscreen());await guest.waitForFunction(()=>!document.fullscreenElement);
      await guest.setViewportSize({width:390,height:844});assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await shot(guest,'tiles-mobile');
      await guest.setViewportSize({width:1440,height:960});await guest.locator('#clientTileControls [data-layout=single]').click();
      await guest.waitForFunction(()=>!document.querySelector('#clientTileGrid').checkVisibility());
      console.log('PASS: grid, featured tile, fullscreen layout controls, mobile bounds and return to single view.');
    }

    for(const sourceId of ['',extra]){
      const pending=guest.waitForEvent('popup');await guest.locator('#clientViewPopouts button').evaluateAll((buttons,id)=>buttons.find(b=>b.dataset.sourceId===id).click(),sourceId);
      const page=await pending;page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:960,height:640});await page.waitForFunction(()=>document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames>10).catch(async error=>{console.log('Popout debug',sourceId,await page.evaluate(()=>({note:document.querySelector('[role=status]').textContent,video:document.querySelector('video') && {ready:document.querySelector('video').readyState,paused:document.querySelector('video').paused,stream:!!document.querySelector('video').srcObject}})),await guest.evaluate(()=>viewMessages.slice(-25)),await host.evaluate(()=>viewMessages.slice(-25)));throw error;});
      await page.waitForFunction(()=>getComputedStyle(document.body).display==='flex');popouts.push(page);
    }
    for(const [i,page] of popouts.entries())await shot(page,`multi-popout-${i===0?'game':'map'}`);
    const frames=await popouts[1].locator('video').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames);await guest.waitForTimeout(300);assert.ok(await popouts[1].locator('video').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames)>frames);
    await guest.locator('#clientSharedView').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change'));},extra);await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoWidth>0 && document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>10);await shot(guest,'multi-guest-map');
    for(const page of popouts)await page.close();await guest.locator('#clientSharedView').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change'));},'');await guest.locator('#clientViewPopouts').evaluate(el=>el.open=false);await guest.setViewportSize({width:1440,height:960});
    await host.locator('#hostCallSettings').click();await host.locator('#hostLiveSource').evaluate(el=>el.open=true);await host.locator('#hostExtraShares button[aria-label^="Remove shared view"]').click();await guest.waitForFunction(()=>document.querySelector('#clientSharedViews').hidden);assert.equal(await guest.locator('#clientTileControls').isVisible(),false);
    await host.bringToFront();await host.locator('#chooseCaptureArea').click();const canvas=host.locator('#captureAreaDialog canvas'),box=await canvas.boundingBox();
    await host.mouse.move(box.x+box.width*.10,box.y+box.height*.22);await host.mouse.down();await host.mouse.move(box.x+box.width*.62,box.y+box.height*.88,{steps:8});await host.mouse.up();await shot(host,'region-host-picker');
    await host.locator('#captureAreaDialog').getByRole('button',{name:'Share selected area'}).click();
    await guest.waitForFunction(()=>{const v=document.querySelector('#clientVideo');return v.videoWidth>500 && v.videoWidth<800 && v.videoHeight>300 && v.getVideoPlaybackQuality().totalVideoFrames>5;});
    await host.waitForFunction(()=>document.querySelector('#hostPreview').videoWidth<800 && document.querySelector('#hostPreview').videoWidth>0);await host.waitForTimeout(1200);await shot(host,'region-host-active');
    await guest.bringToFront();await shot(guest,'region-guest-active');
    await host.locator('#hostCallSettings').click();await host.locator('#hostLiveSource').evaluate(el=>el.open=true);await host.locator('#captureArea').scrollIntoViewIfNeeded();await shot(host,'region-host-settings');await host.locator('#clearCaptureArea').click();await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoWidth===1280);
    console.log('PASS: multi-view host/guest controls, two independent live pop-outs, source switching, rectangle picker and cropped host/guest screenshots.');
  }
  if(process.env.SHOWCASE_EXTRAS==='1'){
    await guest.bringToFront();await guest.locator('#clientCallControllers').click();await guest.locator('.connected-controller .pad-live-test > summary').first().click();await guest.evaluate(()=>{window.pads[0].buttons[1]={pressed:true,value:1};window.pads[0].axes[0]=.6;});await guest.waitForFunction(()=>document.querySelector('.pad-live-test[open] [data-button="1"]')?.classList.contains('is-pressed'));await shot(guest,'controllers-live');await guest.evaluate(()=>{window.pads[0].buttons[1]={pressed:false,value:0};window.pads[0].axes[0]=0;});await guest.keyboard.press('Escape');
    const message=async(page,side,text)=>{const sheet=page.locator(`#${side}ChatSheet`);if(!await sheet.evaluate(el=>el.open))await page.locator(`#${side}CallChat`).click();await page.locator(`#${side}Chat [data-chat=input]`).fill(text);await page.locator(`#${side}Chat [data-chat=input]`).press('Enter');await page.waitForFunction(({side,text})=>[...document.querySelectorAll(`#${side}Chat .chat-message p`)].some(el=>el.textContent===text),{side,text});};
    await message(host,'host','Ready for game night? Your three controllers are connected.');await message(guest,'client','All set! The PS4, Xbox and Pro controllers are working.');await message(host,'host','Perfect. You can pop out the map or switch to fullscreen.');await host.keyboard.press('Escape');await guest.bringToFront();await shot(guest,'chat-floating');
    const input=guest.locator('#clientChat [data-chat=input]'),small=await input.evaluate(el=>el.getBoundingClientRect().height);await input.fill('A quick note\nfor the call\nwith a few lines.');assert.ok(await input.evaluate(el=>el.getBoundingClientRect().height)>small,'Chat composer expands for multiple lines');await input.fill('');await guest.keyboard.press('Escape');assert.equal(await guest.locator('#clientChatSheet').evaluate(el=>el.open),false,'Escape closes chat while its composer is focused');
    for(const [page,side] of [[host,'host'],[guest,'client']])await page.locator(`#${side}CallCamera`).click();await guest.waitForFunction(()=>[...document.querySelectorAll('.camera-tile video')].length===2 && [...document.querySelectorAll('.camera-tile video')].every(v=>v.videoWidth>0));await guest.bringToFront();await shot(guest,'cameras-call');assert.ok(await guest.evaluate(()=>document.querySelector('#clientPanel .camera-gallery').getBoundingClientRect().bottom<document.querySelector('#clientToolbar').getBoundingClientRect().top),'Camera strip must clear the call bar');
    await guest.locator('#clientTileControls [data-layout=grid]').click();await guest.locator('#clientFullscreen').click();await guest.waitForFunction(()=>document.fullscreenElement?.id==='clientStage');await guest.waitForFunction(()=>document.querySelectorAll('#clientTileGrid .view-tile').length===3 && [...document.querySelectorAll('#clientTileGrid .view-tile video')].every(v=>v.videoWidth>0));await shot(guest,'cameras-fullscreen');await guest.locator('#clientTileControls [data-layout=focus]').click();await shot(guest,'cameras-featured');await guest.evaluate(()=>document.exitFullscreen());await guest.locator('#clientTileControls [data-layout=single]').click();
    for(const [page,side] of [[host,'host'],[guest,'client']])await page.locator(`#${side}CallCamera`).click();await guest.waitForFunction(()=>document.querySelector('#clientPanel .camera-gallery').hidden);
    await host.bringToFront();await host.locator('#hostCallSettings').click();await host.locator('#hostSettingsSheet-screen-tab').click();await host.locator('#hostLiveSource').evaluate(el=>el.open=false);await host.locator('#hostSettings > summary').click();await host.locator('#streamResolution').scrollIntoViewIfNeeded();assert.equal(await host.locator('#qualityToggle').isVisible(),false);await shot(host,'stream-settings');await host.keyboard.press('Escape');
    await guest.locator('#clientCallSettings').click();await guest.locator('#clientSettingsSheet-screen-tab').click();assert.equal(await guest.locator('#clientReceiveVideo').isVisible(),false);await shot(guest,'guest-stream-settings');await guest.keyboard.press('Escape');
  }
  await guest.locator('#clientCallControllers').click();await shot(guest,'guest-controllers');await guest.keyboard.press('Escape');
  await host.locator('#inviteFocus').click();await shot(host,'host-invite');await host.keyboard.press('Escape');
  await host.locator('#hostCallSettings').click();await shot(host,'host-settings');await host.keyboard.press('Escape');
  for(const [page,name] of [[host,'host'],[guest,'guest']])for(const width of [390,860,1440]){
    await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} at ${width}px`);
  }
  await guest.setViewportSize({width:390,height:844});await shot(guest,'guest-mobile');await guest.locator('#clientCallControllers').click();await shot(guest,'guest-mobile-controllers');
  assert.ok(new Set(writes.filter(w=>w.state.buttons.a).map(w=>w.slot)).size===3,'All three pads reach independent host slots');assert.deepEqual(errors,[]);
  console.log('PASS: setup and active-call screenshots; preview, invites and settings; three mixed controller types; controller panel; mobile layouts; no browser errors.');
}finally{await browser?.close();await app.close();}
