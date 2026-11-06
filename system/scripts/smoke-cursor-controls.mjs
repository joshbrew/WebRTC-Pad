import {launchTestBrowser} from './browser-fixture.mjs';
// Real local WebRTC with generated capture and recording helpers. No OS input.
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const overlays=[],writes=[],padWrites=[],errors=[];let desktopStarts=0;
const app=createApp({env:{},platform:'win32',getCaptureTargets:async()=>[{kind:'window',id:'4242',pid:42,processStart:'fixture',label:'Shared application',width:1280,height:720}],encoderScanner:{peek:()=>null,scan:async()=>({encoders:[],devices:[],selected:null})},
  createInjector:async()=>({name:'Pointer test',addController(){},removeController(){},setState(slot,state){padWrites.push(state);},close(){}}),
  createDesktop:async()=>{desktopStarts++;return Object.assign(new EventEmitter(),{display:{width:1280,height:720},simulatedSurface:true,async setScope(){},setState(value){writes.push(structuredClone(value));},event(value){writes.push({event:value});},close(){}});},
  createOverlay:async env=>{const calls=[],overlay=Object.assign(new EventEmitter(),{env,calls,send(value){calls.push(value);},close(){overlay.closed=true;}});overlays.push(overlay);return overlay;}
});
const until=async predicate=>{const end=Date.now()+7000;while(!predicate()){assert.ok(Date.now()<end,'Pointer test timed out');await new Promise(r=>setTimeout(r,20));}};
let browser;
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`;
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const pages=[];
  for(let i=0;i<3;i++){
    const context=await browser.newContext({viewport:{width:1440,height:1000}});context.setDefaultTimeout(12000);
    await context.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
    await context.addInitScript(()=>{
      for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');localStorage.setItem('webrtc-pad:capture-method','browser');localStorage.setItem('webrtc-pad:keyboard-layout-v1',JSON.stringify({version:1,bindings:{a:'Mouse2',b:'WheelDown'}}));navigator.getGamepads=()=>[];
      // Model three independently focused computers in one headless browser.
      Object.defineProperty(document,'hidden',{get:()=>false});document.hasFocus=()=>true;window.addEventListener('blur',event=>event.stopImmediatePropagation(),true);
      window.cursorPackets=0;window.desktopPackets=0;const send=RTCDataChannel.prototype.send;RTCDataChannel.prototype.send=function(value){if(typeof value==='string'){try{const v=JSON.parse(value);if(v.type==='cursor')window.cursorPackets++;if(['desktop-move','desktop-state','desktop-event'].includes(v.type))window.desktopPackets++;}catch{}}return send.call(this,value);};
      navigator.mediaDevices.getDisplayMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const c=canvas.getContext('2d');let frame=0;setInterval(()=>{c.fillStyle='#14272f';c.fillRect(0,0,1280,720);c.fillStyle='#c8f79c';c.font='32px sans-serif';c.fillText('Guest pointers · no desktop control',40,60);c.beginPath();c.arc(100+(frame++*4)%1000,360,25,0,7);c.fill();},33);const stream=canvas.captureStream(30),track=stream.getVideoTracks()[0],settings=track.getSettings.bind(track);Object.defineProperty(track,'label',{value:'window:4242:0'});track.getSettings=()=>({...settings(),displaySurface:'window'});return stream;};
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('Unexpected dialog');d.dismiss();});await page.goto(origin+(i?'/?mode=join':''));pages.push(page);
  }
  const [host,guest,watcher]=pages;
  assert.equal(await host.locator('#hostDesktopScope').inputValue(),'off');assert.equal(await host.locator('#hostShowGuestCursors').isChecked(),false);assert.equal(await host.locator('#hostCursorOverlay').count(),0);assert.equal(await guest.locator('#clientShareCursor').count(),0);
  await host.locator('#chooseBrowserSource').click();await host.waitForFunction(()=>document.body.dataset.selectedSurface==='window');assert.equal(overlays.length,0);assert.equal(desktopStarts,0);
  await host.locator('#hostCreate').click();assert.equal(overlays.length,0,'Default-off pointers must not launch an overlay');assert.equal(desktopStarts,0);
  for(const [page,role] of [[guest,'play'],[watcher,'watch']]){
    if(!await host.locator('#createInvitation').isVisible())await host.locator('#inviteFocus').click();await host.locator('#invitationRole').selectOption(role);
    const previous=await host.locator('#hostInvitation').inputValue();await host.locator(previous?'#newInvitation':'#createInvitation').click();await host.waitForFunction(previous=>!!document.querySelector('#hostInvitation').value && document.querySelector('#hostInvitation').value!==previous,previous);
    await page.locator('#clientInvitationFile').setInputFiles({name:'invite.json',mimeType:'application/json',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await page.waitForFunction(()=>!!document.querySelector('#clientReply').value);
    await host.locator('#hostReplyFile').setInputFiles({name:'reply.json',mimeType:'application/json',buffer:Buffer.from(await page.locator('#clientReply').inputValue())});await page.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Connected' && document.querySelector('#clientVideo').videoWidth>0);
  }
  const move=async(page,x)=>{await page.bringToFront();const box=await page.locator(await page.locator('#clientReceiveVideo').isChecked()?'#clientVideo':'#clientStage').boundingBox();await page.mouse.move(box.x+box.width*x,box.y+box.height*.4);};
  await move(guest,.25);await guest.mouse.down();await guest.mouse.up();await guest.waitForTimeout(120);
  assert.equal(await guest.evaluate(()=>window.cursorPackets),0,'Default-off pointers send no pointer packets');
  assert.equal(overlays.length,0);assert.equal(await host.locator('#hostStage .guest-cursor').count(),0);
  await host.locator('#hostCallSettings').click();await host.locator('#hostSettingsSheet-players-tab').click();await host.getByText('Guest cursors',{exact:true}).click();await host.locator('#hostShowGuestCursors').check();
  await until(()=>overlays.length===1);assert.equal(desktopStarts,0,'Pointing overlays must not launch the desktop-input helper');assert.equal(overlays[0].env.NATIVE_WINDOW_HANDLE,'4242');
  await host.getByRole('button',{name:'Close settings',exact:true}).click();
  await move(guest,.3);await guest.mouse.down();await until(()=>overlays[0].calls.some(v=>v.type==='cursor' && v.pressed));await guest.mouse.up();await until(()=>overlays[0].calls.some(v=>v.type==='cursor' && !v.pressed && v.visible));await guest.mouse.wheel(0,120);
  await move(watcher,.7);await watcher.mouse.click((await watcher.locator('#clientVideo').boundingBox()).x+100,(await watcher.locator('#clientVideo').boundingBox()).y+100);
  await host.waitForFunction(()=>document.querySelectorAll('#hostStage .guest-cursor:not([hidden])').length===2);
  for(const page of [guest,watcher])await page.waitForFunction(()=>document.querySelectorAll('#clientStage .guest-cursor:not([hidden])').length===2);
  const cursors=overlays[0].calls.filter(v=>v.type==='cursor');assert.equal(new Set(cursors.map(v=>v.id)).size,2);assert.equal(new Set(cursors.map(v=>v.color)).size,2);assert.equal(desktopStarts,0);assert.deepEqual(writes,[]);assert.equal(await guest.evaluate(()=>window.desktopPackets),0);assert.equal(await watcher.evaluate(()=>window.desktopPackets),0,'Spectator pointers must never send native input');
  await guest.locator('#clientCallSettings').click();await guest.locator('#clientSettingsSheet-screen-tab').click();await guest.locator('#clientMediaToggle').click();await guest.getByRole('button',{name:'Close settings',exact:true}).click();await guest.waitForFunction(()=>document.querySelector('#clientStageTitle').textContent==='Guest pointer pad');const padPackets=await guest.evaluate(()=>window.cursorPackets);await move(guest,.6);assert.ok(await guest.evaluate(()=>window.cursorPackets)>padPackets);assert.equal(desktopStarts,0,'Video-free pointing must remain visual only');
  await fs.mkdir('.local/screenshots',{recursive:true});await host.screenshot({path:'.local/screenshots/pointers-only-multiple-guests.png'});
  await host.locator('#hostCallSettings').click();await host.locator('#hostSettingsSheet-players-tab').click();await host.locator('#hostShowGuestCursors').uncheck();await until(()=>overlays[0].closed);await guest.waitForFunction(()=>!document.querySelector('#clientStage .guest-cursor'));await host.waitForFunction(()=>!document.querySelector('#hostStage .guest-cursor'));
  const sent=await guest.evaluate(()=>window.cursorPackets);await move(guest,.5);await guest.waitForTimeout(120);assert.equal(await guest.evaluate(()=>window.cursorPackets),sent,'Pointer Off stops pointer traffic');
  await host.locator('#hostShowGuestCursors').check();await until(()=>overlays.length===2);await move(guest,.4);await until(()=>overlays[1].calls.some(v=>v.type==='cursor'));assert.equal(desktopStarts,0);
  await host.locator('#hostDesktopScope').selectOption('window');await until(()=>desktopStarts===1);await guest.waitForFunction(()=>!document.querySelector('#clientDesktopMouse').disabled);
  await guest.locator('#clientCallControllers').click();await guest.locator('#controllerAdvanced > summary').click();await guest.getByText('Mouse & desktop controls',{exact:true}).click();await guest.locator('#clientDesktopMouse').check();await guest.getByRole('button',{name:'Close controllers',exact:true}).click();
  await move(guest,.55);await guest.mouse.down();await until(()=>writes.some(v=>v.buttons?.includes(0)));await guest.mouse.up();await until(()=>overlays[1].calls.some(v=>v.type==='cursor' && v.pressed));
  await host.locator('#hostShowGuestCursors').uncheck();await until(()=>overlays[1].closed);await move(guest,.65);await guest.mouse.down();const before=writes.filter(v=>v.buttons?.includes(0)).length;await until(()=>writes.filter(v=>v.buttons?.includes(0)).length>before);await guest.mouse.up();
  await host.locator('#hostShowGuestCursors').check();await until(()=>overlays.length===3);await host.locator('#hostDesktopScope').selectOption('off');await guest.waitForFunction(()=>document.querySelector('#clientDesktopMouse').disabled);assert.equal(overlays[2].closed,undefined,'Pointer overlay survives turning real mouse control Off');
  const beforePoint=await guest.evaluate(()=>window.cursorPackets);await move(guest,.8);await until(()=>overlays[2].calls.some(v=>v.type==='cursor'));assert.ok(await guest.evaluate(()=>window.cursorPackets)>beforePoint);assert.equal([...app.rooms.values()][0].desktopMouse,false);
  await guest.locator('#clientCallControllers').click();await guest.locator('#joinKeyboardController').click();await guest.waitForFunction(()=>document.querySelector('#clientSlot').textContent==='P1');await guest.getByRole('button',{name:'Close controllers',exact:true}).click();await move(guest,.2);await guest.mouse.down({button:'right'});await until(()=>padWrites.some(v=>v.buttons.a));await guest.mouse.up({button:'right'});await guest.mouse.wheel(0,120);await until(()=>padWrites.some(v=>v.buttons.b));
  assert.equal([...app.rooms.values()][0].desktopKeyboard,false);assert.equal(await watcher.evaluate(()=>window.desktopPackets),0);assert.deepEqual(errors,[]);
  console.log('PASS: pointers default off with zero pointer packets or overlays; independent colored pointers and click feedback from a player and spectator with Desktop Off; zero input-helper starts or input packets; overlays bind to the shared window; pointer visibility controls traffic without controlling mouse permission; real mouse control retains colored markers; controller mappings work with desktop access Off.');
}finally{await browser?.close();await app.close();}
