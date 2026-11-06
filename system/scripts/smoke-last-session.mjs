import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {lastSessionKey} from '../public/last-session.js';
import {launchTestBrowser} from './browser-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
let browser,sourceAvailable=true,nativeStarts=0;const errors=[];
const app=createApp({env:{INPUT_BACKEND:'none'},platform:'win32',getCaptureTargets:async()=>[{id:'desktop',kind:'desktop',label:'Main screen',width:1920,height:1080},...(sourceAvailable?[{id:'123',kind:'window',label:'Remembered game',pid:42,width:1280,height:720}]:[])],createNativeMedia:()=>{nativeStarts++;throw Error('No capture should start on restore');},createInjector:async()=>({setState(){},close(){}})});
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`;
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1366,height:900}});context.setDefaultTimeout(15000);
  await context.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.route('**/config',async route=>{const response=await route.fetch(),config=await response.json();config.nativeCapture={available:true,audio:{available:true,window:true,streaming:true}};config.windowMouse=true;await route.fulfill({json:config});});
  await context.addInitScript(({key})=>{
    for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({version:1,fields:{captureBackend:'native',streamResolution:'720',streamFramerate:'30',streamPriority:'resolution',hostAutoThrottle:false,nativeCaptureAudio:false,hostAllowGuestVideo:false,hostAllowGuestMic:false,hostAllowGuestScreens:false,hostDynamicControllers:true,hostDesktopMouse:true},source:{kind:'window',label:'Remembered game'},bounds:{width:1280,height:720},area:{x:20,y:20,width:640,height:360}}));
    window.sharePrompts=0;navigator.mediaDevices.getDisplayMedia=async()=>{window.sharePrompts++;const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');ctx.fillStyle='#173c2b';ctx.fillRect(0,0,640,360);return canvas.captureStream(30);};
  },{key:lastSessionKey});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
  await page.waitForFunction(()=>document.querySelector('#captureTarget').value==='123');
  assert.equal(nativeStarts,0);assert.equal(await page.evaluate(()=>window.sharePrompts),0);
  assert.equal(await page.locator('#streamResolution').inputValue(),'720');assert.equal(await page.locator('#streamFramerate').inputValue(),'30');assert.equal(await page.locator('#nativeCaptureAudio').isChecked(),false);
  for(const id of ['hostAllowGuestVideo','hostAllowGuestMic','hostAllowGuestScreens'])assert.equal(await page.locator(`#${id}`).isChecked(),false);
  assert.equal(await page.locator('#hostDesktopScope').inputValue(),'off');assert.equal(await page.locator('#captureArea-width').inputValue(),'640');
  await page.locator('#nativeCaptureAudio').check();await page.locator('#hostAllowGuestVideo').check();
  await page.locator('#hostCameraLimits [data-call-limit=height]').evaluate(el=>{el.value='480';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#hostScreenLimits [data-screen-limit=bitrate]').evaluate(el=>{el.value='4000000';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.reload();await page.waitForFunction(()=>document.querySelector('#captureTarget').value==='123');assert.equal(await page.locator('#nativeCaptureAudio').isChecked(),true);assert.equal(await page.locator('#hostAllowGuestVideo').isChecked(),true);assert.equal(nativeStarts,0);
  assert.equal(await page.locator('#hostCameraLimits [data-call-limit=height]').inputValue(),'480');assert.equal(await page.locator('#hostScreenLimits [data-screen-limit=bitrate]').inputValue(),'4000000');
  await page.locator('#modeClient').click();await page.reload();await page.waitForFunction(()=>document.body.dataset.mode==='client');
  await page.goto(origin+'/?mode=host');await page.waitForFunction(()=>document.body.dataset.mode==='host');await page.goto(origin);assert.equal(await page.locator('body').getAttribute('data-mode'),'host');
  sourceAvailable=false;await page.reload();await page.waitForFunction(()=>document.querySelector('#hostLastSourceNote').textContent.includes('Remembered game'));assert.equal(await page.locator('#captureTarget').inputValue(),'none');assert.equal(nativeStarts,0);
  await page.locator('#hostCreate').evaluate(el=>{el.disabled=true;});await page.waitForFunction(()=>document.querySelector('#hostCreateTop').disabled);await page.locator('#hostCreate').evaluate(el=>{el.disabled=false;});await page.waitForFunction(()=>!document.querySelector('#hostCreateTop').disabled);
  await page.locator('#hostLastSourceNote button').click();await page.locator('#hostCreateTop').click();await page.waitForFunction(()=>document.querySelector('#hostPanel').dataset.session==='active');assert.equal(app.rooms.size,1);assert.equal(nativeStarts,0);await page.locator('#hostEnd').click();await page.waitForFunction(()=>!document.querySelector('#hostSetupCard').hidden);
  await page.evaluate(key=>localStorage.setItem(key,JSON.stringify({version:1,fields:{captureBackend:'browser',nativeCaptureAudio:false,streamResolution:'720',streamFramerate:'30',hostAllowGuestMic:false},source:{kind:'browser',label:'Last browser screen'}})),lastSessionKey);
  await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#hostLastSourceNote').textContent.includes('Last browser screen'));assert.equal(await page.evaluate(()=>window.sharePrompts),0);
  await page.locator('#hostCreateTop').click();await page.waitForFunction(()=>document.querySelector('#hostPanel').dataset.session==='active');await page.waitForFunction(()=>!!document.querySelector('#hostPreview').srcObject);assert.equal(await page.evaluate(()=>window.sharePrompts),1,'Start reopens the browser picker once');
  assert.equal(await page.locator('#hostAllowGuestMic').isChecked(),false);await page.locator('#hostEnd').click();await page.waitForFunction(()=>!document.querySelector('#hostSetupCard').hidden);
  for(const width of [390,860,1366]){await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('#hostCreateTop').isVisible(),true);}
  await page.setViewportSize({width:1366,height:900});await fs.mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/remembered-session-setup.png'});
  assert.deepEqual(errors,[]);console.log('PASS: automatic setup memory, crop safety, no capture on load, last Host/Join page, explicit page links, missing sources, synchronized top Start, browser re-pick on Start and responsive header.');
}finally{await browser?.close();await app.close();}
