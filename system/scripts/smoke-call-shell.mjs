import {launchTestBrowser} from './browser-fixture.mjs';
// Compact call UI with real local WebRTC, generated pixels and recording input.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
let browser;const errors=[],writes=[];
const app=createApp({env:{},createInjector:async()=>({name:'Call UI fixture',setState(slot,state){writes.push(state);},addController(){},removeController(){},close(){}})});
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{...(process.env.BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.BROWSER_CHANNEL || 'msedge'}),headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const context=await browser.newContext({viewport:{width:1366,height:900}});context.setDefaultTimeout(20000);
  await context.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.addInitScript(()=>{
    localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');localStorage.setItem('webrtc-pad:capture-method','browser');
    for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied=text}});
    window.pad={id:'PS4 Controller',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[window.pad]});
    navigator.mediaDevices.getDisplayMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');let n=0;setInterval(()=>{ctx.fillStyle='#15271c';ctx.fillRect(0,0,960,540);ctx.fillStyle='#cefb97';ctx.beginPath();ctx.arc(160+n++%640,270,36,0,Math.PI*2);ctx.fill();ctx.font='28px sans-serif';ctx.fillText('Playing together',50,75);},33);return canvas.captureStream(30);};
  });
  const host=await context.newPage(),guest=await context.newPage(),origin=`http://127.0.0.1:${app.server.address().port}`;
  for(const page of [host,guest])page.on('pageerror',error=>errors.push(error.message));
  await host.goto(origin);await guest.goto(origin+'/?mode=join');
  await fs.mkdir('.local/screenshots',{recursive:true});await host.screenshot({path:'.local/screenshots/call-host-setup.png'});await guest.screenshot({path:'.local/screenshots/call-guest-setup.png'});
  await host.setViewportSize({width:1366,height:768});for(const selector of ['#hostMediaPermissions','#hostSessionControls > summary'])assert.ok(await host.locator(selector).evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),`${selector} fits on a laptop display`);await host.screenshot({path:'.local/screenshots/compact-session-setup.png'});await host.setViewportSize({width:1366,height:900});
  assert.equal(await host.locator('#hostSettingsSheet').evaluate(el=>el.open),false);
  await host.evaluate(()=>document.querySelector('#hostStatus').textContent='Screen capture permission denied.');await host.waitForFunction(()=>!document.querySelector('#hostStatus').parentElement.hidden);assert.equal(await host.locator('#hostStatus').isVisible(),true);await host.evaluate(()=>document.querySelector('#hostStatus').textContent='Ready when you are');
  await guest.locator('#joinPasteAction').click();assert.equal(await guest.locator('#clientInvitation').isVisible(),true);await guest.waitForFunction(()=>document.activeElement?.id==='clientInvitation');await guest.waitForTimeout(350);assert.equal(await guest.locator('#clientPairSheet').evaluate(el=>el.open),true,'Paste opener is not its own outside dismissal');await guest.keyboard.press('Escape');assert.equal(await guest.locator('#clientPairSheet').evaluate(el=>el.open),false);
  await host.locator('#chooseBrowserSource').click();await host.locator('#hostCreate').click();await host.waitForFunction(()=>document.querySelector('#hostInviteSheet').open);
  await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
  await host.keyboard.press('Escape');
  for(const width of [390,640,800,1366]){await host.setViewportSize({width,height:850});const size=await host.locator('#hostSessionContent').evaluate(el=>el.getBoundingClientRect().width);assert.ok(size>width*.45,`Host content keeps a usable width at ${width}px: ${size}`);assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await host.setViewportSize({width:1366,height:850});await host.bringToFront();
  await host.locator('#hostTileControls [data-layout=streamer]').click();await host.waitForFunction(()=>!document.querySelector('#hostScreenWatch').hidden);
  await host.locator('#hostSmallPreview').click();await host.waitForFunction(()=>document.querySelector('#hostScreenWatch').hidden);assert.equal(await host.locator('#hostPreview').isVisible(),true);
  await host.screenshot({path:'.local/screenshots/stable-host-pending-reply.png'});
  await guest.bringToFront();const box=await guest.locator('#joinPasteAction').boundingBox();await guest.mouse.move(box.x+1,box.y+box.height/2);await guest.mouse.down();const pressed=await guest.locator('#joinPasteAction').boundingBox();assert.ok(Math.abs(pressed.x-box.x)<.5 && Math.abs(pressed.width-box.width)<.5,'Press feedback never shrinks or shifts the hit area');await guest.mouse.up();
  await guest.waitForFunction(()=>document.querySelector('#clientPairSheet').open && document.activeElement?.id==='clientInvitation');
  await guest.locator('#clientInvitation').fill(await host.locator('#hostInvitation').inputValue());await guest.locator('#createReply').click();await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
  await host.locator('#inviteFocus').click();await host.locator('#hostPasteReply').click();await host.waitForFunction(()=>document.querySelector('#hostInviteSheet').open && document.activeElement?.id==='hostReply');
  await host.locator('#hostReply').fill(await guest.locator('#clientReply').inputValue());await host.locator('#acceptReply').click();
  await guest.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.ready==='true');await guest.waitForFunction(()=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>5);
  await host.waitForFunction(()=>!document.querySelector('#hostInviteSheet').open);
  await guest.evaluate(()=>{window.pad.buttons[0]={pressed:true,value:1};});await guest.waitForFunction(()=>document.querySelector('#clientCallControllers').textContent.includes('1'));
  await host.waitForFunction(()=>document.querySelector('.guest-controller')?.textContent.includes('PS4 Controller'));
  assert.equal(await guest.locator('#controllersSheet').evaluate(el=>el.open),false,'Joining a controller does not interrupt the game with a panel');
  await guest.locator('#clientCallControllers').click();assert.equal(await guest.locator('#connectedControllers').isVisible(),true);await guest.locator('.controller-map').first().click();assert.equal(await guest.locator('[data-keyboard=dialog]').isVisible(),true);await guest.locator('[data-keyboard=close]').click();
  await guest.keyboard.press('Escape');assert.equal(await guest.locator('#controllersSheet').evaluate(el=>el.open),false);
  await guest.evaluate(()=>{window.surfacePresses=0;document.querySelector('#clientStage').addEventListener('pointerdown',()=>window.surfacePresses++,true);});
  await guest.locator('#clientCallControllers').click();
  const surface=await guest.locator('#clientStage').boundingBox();await guest.mouse.click(surface.x+surface.width*.25,surface.y+surface.height*.6);
  assert.equal(await guest.locator('#controllersSheet').evaluate(el=>el.open),false);assert.equal(await guest.evaluate(()=>window.surfacePresses),0,'Dismissing a panel must not click the remote application');
  await guest.mouse.click(surface.x+surface.width*.25,surface.y+surface.height*.6);assert.equal(await guest.evaluate(()=>window.surfacePresses),1,'The following click returns to the remote application');
  await host.evaluate(()=>{window.savedGetMedia=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});await host.locator('#hostCallMic').click();await host.waitForFunction(()=>!document.querySelector('#toast').hidden && document.querySelector('#toast').textContent.includes('Microphone blocked'));await host.evaluate(()=>navigator.mediaDevices.getUserMedia=window.savedGetMedia);
  await host.locator('#hostCallMic').click();await host.waitForFunction(()=>document.querySelector('#hostCallMic').getAttribute('aria-pressed')==='true');await host.locator('#hostCallMic').click();await host.waitForFunction(()=>document.querySelector('#hostCallMic').getAttribute('aria-pressed')==='false');
  await guest.locator('#clientCallSettings').click();assert.equal(await guest.locator('#clientResolution').isVisible(),true);assert.equal(await guest.locator('#clientPopout').isVisible(),true);await guest.keyboard.press('Escape');
  await guest.locator('#clientFullscreen').click();await guest.waitForFunction(()=>!!document.fullscreenElement);await guest.locator('#clientCallControllers').click();assert.equal(await guest.locator('#connectedControllers').isVisible(),true);await guest.keyboard.press('Escape');await guest.evaluate(()=>document.exitFullscreen());
  for(const [page,name] of [[host,'host'],[guest,'guest']]){
    await page.screenshot({path:`.local/screenshots/call-${name}-active.png`});
    for(const width of [390,860,1366]){await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const bar=page.locator(name==='host'?'#hostToolbar':'#clientToolbar');assert.ok(await bar.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight;}));}
  }
  await guest.setViewportSize({width:390,height:844});await guest.locator('#clientCallControllers').click();await guest.screenshot({path:'.local/screenshots/call-guest-mobile-controls.png'});await guest.keyboard.press('Escape');
  await host.locator('#inviteFocus').click();assert.equal(await host.locator('#newInvitation').isVisible(),true,'An accepted invite offers a new invite rather than exporting the used one');await host.keyboard.press('Escape');
  await host.locator('#showHelp').click();await host.waitForFunction(()=>!!document.querySelector('.tour-target'));assert.equal(await host.locator('#helpDialog').isVisible(),true);await host.locator('#helpDone').click();
  const firstContext=await browser.newContext({viewport:{width:390,height:844}});
  await firstContext.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await firstContext.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');localStorage.setItem('webrtc-pad:capture-method','browser');Object.defineProperty(navigator,'getGamepads',{value:()=>[]});});
  for(const role of ['host','join']){const page=await firstContext.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+`/?mode=${role}`);await page.waitForFunction(()=>document.querySelector('#helpDialog').open && !!document.querySelector('.tour-target')).catch(async error=>{console.error('First visit',role,await page.evaluate(()=>({mode:document.body.dataset.mode,help:document.querySelector('#helpDialog')?.open,errors:document.querySelector('#hostStatus')?.textContent,target:document.querySelector('.tour-target')?.id,guide:document.querySelector('#helpDialog')?.textContent})),errors);throw error;});assert.equal(await page.locator('.tour-target').isVisible(),true,'First-run guidance must open any panel containing its target');await page.locator('#helpDone').click();await page.close();}
  await firstContext.close();
  assert.deepEqual(errors,[]);assert.ok(writes.some(s=>s.buttons.a));
  console.log('PASS: compact call bars; file/text invites; panels close after connecting; controller status/remapping; fake mic on/off; settings/popout; fullscreen controls; guides; mobile bounds.');
}finally{await browser?.close();await app.close();}
