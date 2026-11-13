import {launchTestBrowser} from './browser-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
let browser,hostPage;const errors=[],writes=[];
const realDriver = process.env.REAL_DRIVER === '1';
const readXInput = async () => JSON.parse((await promisify(execFile)('python', ['system/scripts/read-xinput.py'], { windowsHide: true })).stdout);
const existingPads = realDriver ? new Set((await readXInput()).map(pad => pad.index)) : new Set();
const app=createApp(realDriver ? {env:{}} : {env:{},createInjector:async()=>({name:'Call fixture',setState(slot,state){writes.push(state);},addController(){},removeController(){},close(){}})});
try{
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const context=await browser.newContext({viewport:{width:1366,height:850}});context.setDefaultTimeout(20000);await context.route('**/ice?*',r=>r.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
 await context.addInitScript(()=>{for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:capture-method','browser');localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');localStorage.setItem('webrtc-pad:hostPreviewAutoPause','false');window.streams=[];let number=0;
 const picture=()=>{const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d'),index=++number;const timer=setInterval(()=>{ctx.fillStyle=index%2?'#224455':'#354925';ctx.fillRect(0,0,960,540);ctx.fillStyle='white';ctx.font='32px sans-serif';ctx.fillText(`View ${index} · ${Math.round(performance.now())}`,80,100);},16);const stream=canvas.captureStream(60),track=stream.getVideoTracks()[0],stop=track.stop.bind(track);Object.defineProperty(track,'label',{value:`Shared view ${index}`});track.stop=()=>{stop();clearInterval(timer);};window.streams.push(stream);return stream;};navigator.mediaDevices.getDisplayMedia=async()=>picture();navigator.mediaDevices.getUserMedia=async()=>picture();navigator.mediaDevices.enumerateDevices=async()=>[{kind:'videoinput',deviceId:'default',label:'Fixture camera'}];
 });
 const host=await context.newPage(),guest=await context.newPage(),origin=`http://127.0.0.1:${app.server.address().port}`;hostPage=host;for(const p of [host,guest])p.on('pageerror',e=>errors.push(e.message));
 await guest.addInitScript(() => {
   window.testPad = { id: 'Guest gamepad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({length: 17}, () => ({ pressed: false, value: 0 })) };
   navigator.getGamepads = () => [window.testPad];
 });
 await host.goto(origin);await guest.goto(origin+'/?mode=host');await host.locator('#hostCreate').click();await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
 await guest.locator('#hostPanel').evaluate((panel,contents)=>{
   const dataTransfer=new DataTransfer();dataTransfer.items.add(new File([contents],'invite.json',{type:'application/json'}));
   panel.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));
 },await host.locator('#hostInvitation').inputValue());
 await guest.waitForFunction(()=>document.body.dataset.mode==='client' && !!document.querySelector('#clientReply').value);
 assert.match(await guest.locator('#clientStageNote').textContent(), /drop it onto the session window/);
 const reply = await guest.locator('#clientReply').inputValue();
 const replyCard = host.locator('.host-call-person').filter({ hasText: 'Waiting for reply file' });
 await replyCard.waitFor();
 await replyCard.evaluate((card, contents) => {
   const dataTransfer = new DataTransfer();
   dataTransfer.items.add(new File([contents], 'reply.txt', { type: 'text/plain' }));
   card.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
 }, reply);
 await guest.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Connected');
 await replyCard.waitFor({state:'detached'});
 await host.bringToFront();await host.waitForFunction(()=>document.body.dataset.hostCallView==='call');assert.equal(await host.locator('#hostScreenWatch').isVisible(),true);assert.equal(await host.locator('#hostPeopleCard').isVisible(),false);assert.equal(await host.locator('.host-call-person').count(),2);
 const headerInvite=host.getByRole('button',{name:'Invite guests',exact:true}).and(host.locator('#hostHeaderInvite'));
 await headerInvite.click();await host.locator('#hostInviteSheet').waitFor();
 await host.locator('#hostInviteSheet').getByRole('button',{name:'Close invite guests'}).click();
 assert.equal(await host.locator('#hostCallPeople + #inviteFocus use').getAttribute('href'),'#i-plus');
 await host.locator('#inviteFocus').click();await host.locator('#hostInviteSheet').waitFor();
 await host.locator('#hostInviteSheet').getByRole('button',{name:'Close invite guests'}).click();
 for(const width of [390,800,900,1000,1366]){
   await host.setViewportSize({width,height:850});
   await host.waitForFunction(()=>{
     const stage=document.querySelector('#hostWatchStage').getBoundingClientRect();
     const heading=document.querySelector('.host-watch-heading').getBoundingClientRect();
     const toolbar=document.querySelector('#hostToolbar').getBoundingClientRect();
     return Math.abs(heading.width-stage.width)<2 && stage.bottom<=toolbar.top;
   });
   assert.equal(await headerInvite.isVisible(),true);
   assert.equal(await host.locator('#hostCallControllers').isVisible(),true);
   assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(width>700)assert.equal(await host.evaluate(()=>document.documentElement.scrollHeight>innerHeight+2),false);
   if(width===900){await fs.mkdir('.local/screenshots',{recursive:true});await host.screenshot({animations:'disabled',path:'.local/screenshots/host-call-narrow-controls.png'});}
 }
 await guest.locator('#clientJoinControllers').evaluate(input => input.click());
 await guest.waitForFunction(() => document.querySelector('#clientStageTitle').textContent === 'Controller sharing paused');
 await guest.locator('#clientJoinControllers').evaluate(input => input.click());
 await guest.waitForFunction(() => document.querySelector('#clientStageTitle').textContent === 'Join with your controller');
 await host.locator('#hostCallPeople').click();assert.equal(await host.locator('#hostPeopleCard').isVisible(),true);assert.equal(await host.getByRole('button',{name:'Make host',exact:true}).count(),1);
 await host.locator('#hostPeopleInvite').click();await host.locator('#hostInviteSheet').waitFor();
 await host.locator('#hostInviteSheet').getByRole('button',{name:'Close invite guests'}).click();
 await host.locator('#hostCallPeople').click();
 await host.locator('#hostPeopleCard').getByRole('button', { name: 'Check controllers', exact: true }).click();
 await guest.evaluate(() => { window.testPad.buttons[0] = { pressed: true, value: 1 }; });
 await host.locator('.host-input-check').getByText('Input reached the host').waitFor();
 await guest.waitForFunction(() => document.querySelector('#clientStageTitle').textContent === 'Controller joined');
 if (realDriver) {
   const deadline = Date.now() + 3000;
   while (!(await readXInput()).some(pad => !existingPads.has(pad.index) && pad.buttons === 0x1000)) {
     if (Date.now() > deadline) throw new Error('The guest button did not appear on the new Windows XInput controller');
     await host.waitForTimeout(40);
   }
 } else {
   assert.ok(writes.some(state => state.buttons.a));
 }
 await guest.evaluate(() => { window.testPad.buttons[0] = { pressed: false, value: 0 }; });
 await host.keyboard.press('Escape');
 console.log(`PASS: reply dropped on the guest tile, controller joined and host check confirmed the press${realDriver ? ' through Windows XInput' : ''}.`);
 await host.locator('#hostCallCamera').click();await host.waitForFunction(()=>document.querySelector('#hostTileGrid video')?.videoWidth>0);await host.locator('#hostTileControls [data-layout=streamer]').click();await host.waitForFunction(()=>document.querySelector('#hostTileGrid .streamer-camera video')?.videoWidth>0);assert.equal(await host.locator('#hostTileControls [data-layout=streamer]').isEnabled(),true);
 await fs.mkdir('.local/screenshots',{recursive:true});await host.screenshot({animations:'disabled',path:'.local/screenshots/host-call-camera-corner.png'});
 await host.locator('#hostTileControls [data-layout=single]').click();await host.locator('#hostTileControls [data-layout=streamer]').click();await host.waitForFunction(()=>document.querySelector('.streamer-camera')?.dataset.camera==='true');
 await host.locator('#hostCallFullscreen').click();await host.waitForFunction(()=>document.fullscreenElement?.id==='hostWatchStage');
 await host.locator('#hostCallPeople').hover();
 await host.waitForFunction(()=>{const hint=document.querySelector('#callControlHint');return hint.parentElement===document.fullscreenElement && !hint.hidden;});
 await host.locator('#hostCallPeople').click();assert.equal(await host.locator('#hostPeopleCard').isVisible(),true);await host.keyboard.press('Escape');await host.locator('#hostCallChat').click();assert.equal(await host.locator('#hostChatSheet').isVisible(),true);await host.keyboard.press('Escape');
 await host.locator('#hostCallSettings').click();
 await host.locator('#hostSettingsSheet [data-appearance-browse]').click();
 const fullscreenGallery=host.getByRole('dialog',{name:'Appearance'});
 assert.equal(await fullscreenGallery.evaluate(el=>el.parentElement===document.fullscreenElement),true);
 await fullscreenGallery.getByRole('button',{name:'Close appearance'}).click();
 await host.keyboard.press('Escape');await host.evaluate(()=>document.exitFullscreen());
 await host.locator('#hostSmallPreview').click();await host.waitForFunction(()=>document.body.dataset.hostCallView==='compact');
 const roster=host.locator('.host-compact-roster');
 assert.equal(await roster.isVisible(),true);
 assert.equal(await roster.locator('.host-call-person').count(),2);
 assert.match(await roster.textContent(),/1 controller/);
 await roster.getByRole('button',{name:'People'}).click();assert.equal(await host.locator('#hostPeopleCard').isVisible(),true);await host.keyboard.press('Escape');
 await host.screenshot({animations:'disabled',path:'.local/screenshots/host-compact-roster.png'});
 await host.locator('#hostExpandCall').click();await host.waitForFunction(()=>document.body.dataset.hostCallView==='call');
 assert.equal(await roster.isVisible(),false);
 await host.locator('#hostCallAddScreen').click();await host.waitForFunction(()=>document.querySelectorAll('.host-share-chip').length===1);await host.keyboard.press('Escape');await host.locator('#hostCallAddScreen').click();await host.waitForFunction(()=>document.querySelectorAll('.host-share-chip').length===2);await host.keyboard.press('Escape');await host.locator('#hostTileControls [data-layout=grid]').click();await host.waitForFunction(()=>document.querySelectorAll('#hostTileGrid .view-tile').length===3);
 await host.locator('[data-watch-fullscreen]').click();await host.waitForFunction(()=>document.fullscreenElement?.id==='hostWatchStage');
 const fullStage=host.locator('#hostWatchStage'),layoutControls=host.locator('#hostSharedViews');
 const sharedTile=fullStage.locator('#hostTileGrid > .view-tile').first();
 await sharedTile.hover();
 await host.waitForFunction(()=>{const stage=document.fullscreenElement;return !stage.classList.contains('controls-visible') && ['#hostSharedViews','#hostToolbar','.call-preview-options'].every(selector=>getComputedStyle(stage.querySelector(selector)).opacity==='0');});
 await sharedTile.hover({position:{x:40,y:85}});
 await host.waitForFunction(()=>{const stage=document.fullscreenElement;return stage.classList.contains('controls-visible') && ['#hostSharedViews','#hostToolbar','.call-preview-options'].every(selector=>getComputedStyle(stage.querySelector(selector)).opacity==='1');});
 await layoutControls.getByRole('button',{name:'Side by side'}).focus();
 await host.waitForFunction(()=>!document.fullscreenElement.classList.contains('controls-visible'));
 assert.equal(await layoutControls.evaluate(el=>getComputedStyle(el).opacity),'1','The focused layout stays visible after the controls time out');
 await host.keyboard.press('Enter');assert.equal(await host.locator('#hostTileGrid').getAttribute('data-layout'),'columns');
 const exitFullscreen=host.locator('#hostCallFullscreen');
 const exitBounds=await exitFullscreen.boundingBox();
 await host.mouse.move(exitBounds.x+exitBounds.width/2,exitBounds.y+exitBounds.height/2);
 await exitFullscreen.click();await host.waitForFunction(()=>!document.fullscreenElement);
 await fullStage.locator('#hostToolbar').waitFor({state:'detached'});
 await host.locator('#hostTileControls [data-layout=grid]').click();
 await host.screenshot({animations:'disabled',path:'.local/screenshots/host-call-screens-camera.png'});
 await host.locator('#hostTileGrid .tile-remove').first().click();await host.waitForFunction(()=>document.querySelectorAll('.host-share-chip').length===1);assert.equal(await host.locator('#hostTileGrid .tile-remove').count(),1);assert.equal(await host.locator('#hostCallCamera').getAttribute('aria-pressed'),'true');
 await host.locator('#hostCallSettings').hover();
 await host.waitForFunction(()=>document.querySelector('#callControlHint').textContent==='More settings' && !document.querySelector('#callControlHint').hidden);
 assert.equal(await host.locator('#hostToolbar [title]').count(),0);
 assert.equal(await host.locator('#hostCallSettings').evaluate(el=>getComputedStyle(el,'::after').content),'none');
 await host.keyboard.press('Escape');assert.equal(await host.locator('#callControlHint').isVisible(),false);
 for(const width of [390,800,1366]){
   await host.setViewportSize({width,height:850});assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const [more,end]=await Promise.all([host.locator('#hostCallSettings').boundingBox(),host.locator('#hostEnd').boundingBox()]);
   assert.ok(more && end && Math.abs(more.y+more.height/2-end.y-end.height/2)<2 && end.x>=more.x+more.width-1,`More settings sits beside End at ${width}px`);
   assert.equal(await host.locator('#hostEnd').evaluate(el=>el.previousElementSibling?.id),'hostCallSettings');
 }
 await host.locator('#inviteFocus').evaluate(button => button.click());
 for(const width of [390,1366]){
   await host.setViewportSize({width,height:850});
   const select=await host.locator('#invitationRole').boundingBox(),button=await host.locator('#newInvitation').boundingBox();
   assert.ok(select && button && button.x>=select.x+select.width && Math.abs(button.y-select.y)<3,'New invite sits to the right of the access dropdown');
   assert.equal(await host.locator('#newInvitation').evaluate(el=>getComputedStyle(el).backgroundColor===getComputedStyle(document.querySelector('#hostHeaderInvite')).backgroundColor),true);
 }
 await host.locator('#newInvitation').click();
 await host.locator('.host-pending-replies').getByText(/drop a reply file here/i).waitFor();
 const [replyBounds,stageBounds]=await Promise.all([host.locator('.host-pending-replies').boundingBox(),host.locator('#hostWatchStage').boundingBox()]);
 assert.ok(replyBounds && stageBounds && replyBounds.y+replyBounds.height<=stageBounds.y,'Reply prompt stays above the media');
 await host.locator('#hostInviteSheet').getByRole('button',{name:'Close invite guests'}).click();
 await host.locator('#hostCallSettings').click();
 const appearance=host.locator('#hostSettingsSheet [data-appearance-browse]');
 const gallery=host.getByRole('dialog',{name:'Appearance'});
 const sharedVideo=host.locator('#hostTileGrid .view-tile video').first();
 const streamId=await sharedVideo.evaluate(video=>video.srcObject.id);
 for(const theme of ['signal','cobalt','classic']){
   await appearance.click();
   assert.equal(await gallery.locator('[aria-pressed=true]').count(),1);
   const choice=gallery.locator(`[data-appearance-choice="${theme}"]`);
   await choice.click();
   await host.waitForFunction(theme=>document.documentElement.dataset.skin===theme,theme);
   await guest.waitForFunction(theme=>document.documentElement.dataset.skin===theme,theme);
   assert.equal(await choice.getAttribute('aria-pressed'),'true');
   if(theme==='signal'){
     await host.waitForFunction(()=>[...document.querySelectorAll('.appearance-gallery img')].filter(img=>img.complete && img.naturalWidth>0).length===4);
     await host.screenshot({animations:'disabled',path:'.local/screenshots/appearance-gallery.png'});
     await host.setViewportSize({width:360,height:650});
     const bounds=await gallery.boundingBox();
     assert.ok(bounds.x>=0 && bounds.x+bounds.width<=360 && bounds.y+bounds.height<=650,'Appearance fits the phone viewport');
     await host.setViewportSize({width:1366,height:850});
   }
   await host.keyboard.press('Escape');
   await gallery.waitFor({state:'hidden'});
   assert.equal(await appearance.evaluate(el=>el===document.activeElement),true);
   assert.equal(await sharedVideo.evaluate(video=>video.srcObject.id),streamId,'Appearance switching keeps the same video stream');
   assert.equal(await guest.locator('#clientConnectionText').textContent(),'Connected');
   if(theme==='signal')assert.equal(await host.locator('.app-header').evaluate(el=>getComputedStyle(el).flexDirection),'column');
   if(theme==='cobalt'){
     const settings=await host.locator('#hostSettingsSheet').boundingBox();
     assert.ok(Math.abs(settings.x+settings.width/2-1366/2)<2,'Cobalt centers its settings panel');
   }
   if(theme!=='classic'){
     await host.screenshot({animations:'disabled',path:`.local/screenshots/theme-${theme}-call.png`});
     await host.setViewportSize({width:390,height:850});
     assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${theme} fits narrow screens`);
     await host.setViewportSize({width:1366,height:850});
   }
 }
 await host.locator('#hostEnd').click();await host.waitForFunction(()=>document.body.dataset.hostCallView==='setup');assert.deepEqual(errors,[]);console.log('PASS: media-first host call; avatars, camera-only corner and layout switching; fullscreen People/Chat; compact return; direct add-screen and individual removal; one tooltip; responsive bounds; session cleanup.');
}catch(error){console.error('HOST DEBUG',await hostPage?.evaluate(()=>({shares:document.querySelectorAll('.host-share-chip').length,backend:document.querySelector('#captureBackend').value,status:document.querySelector('#hostStatus').textContent,streams:window.streams.length,extra:document.querySelector('#hostExtraShares').textContent,tiles:document.querySelectorAll('#hostTileGrid .view-tile').length})));await hostPage?.screenshot({path:'.local/screenshots/host-call-error.png'});throw error;}finally{await browser?.close();await app.close();}
