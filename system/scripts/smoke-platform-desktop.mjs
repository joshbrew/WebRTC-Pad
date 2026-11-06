import {launchTestBrowser} from './browser-fixture.mjs';
// Browser UI fixtures use real detected-platform config without touching OS input.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const common={NATIVE_MEDIA_HELPER:process.execPath,FFMPEG_BIN:process.execPath,NATIVE_AUDIO_HELPER:process.execPath};
const scenarios=[
  {name:'Windows',platform:'win32',env:common,window:true,audio:true},
  {name:'Linux X11',platform:'linux',env:{...common,DISPLAY:':99',XDG_SESSION_TYPE:'x11',NATIVE_AUDIO_LIBPULSE:process.execPath},window:true,audio:true},
  {name:'Linux Wayland',platform:'linux',env:{...common,DISPLAY:':0',WAYLAND_DISPLAY:'wayland-0',XDG_SESSION_TYPE:'wayland',NATIVE_AUDIO_LIBPULSE:process.execPath},window:false,audio:true},
  {name:'macOS',platform:'darwin',env:{...common,NATIVE_MAC_HELPER:'/missing/mac/helper'},window:false,audio:false},
  {name:'macOS native',platform:'darwin',env:{...common,NATIVE_MAC_HELPER:process.execPath},window:true,audio:true}
];
const browser=await launchTestBrowser(chromium,{...(process.env.BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.BROWSER_CHANNEL || 'msedge'}),headless:true});
try{for(const item of scenarios){
  const permissionRequests=[];
  const app=createApp({platform:item.platform,env:item.env,getCaptureTargets:async()=>[{kind:'desktop',id:'desktop',label:'Entire test screen'},{kind:'window',id:'100',pid:700,processStart:'100',label:'Test game'}],
    getMacPermissions:async action=>{permissionRequests.push(action);return {screen:action==='screen',input:action==='input'};},
    encoderScanner:{peek:()=>null,scan:async()=>({encoders:[],devices:[],selected:null})},createInjector:async()=>({setState(){},close(){}})});
  let context;
  try{
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
    context=await browser.newContext({viewport:{width:1366,height:768}});await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');navigator.mediaDevices.getDisplayMedia=async()=>{throw new Error('Test picker dismissed');};});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${app.server.address().port}`);await page.waitForFunction(()=>!!document.querySelector('#hostPlatformNote').textContent);
    const note=await page.locator('#hostPlatformNote').textContent();assert.ok(note.includes(item.name==='Linux X11'?'X11':item.name==='Linux Wayland'?'Wayland':item.platform==='darwin'?'macOS':'Windows'));
    if(item.platform==='win32'){assert.doesNotMatch(note,/Linux|Wayland|macOS/);assert.doesNotMatch(await page.locator('#hostOverlayNote').textContent(),/X11|Wayland|Linux/);assert.equal(await page.locator('#hostPlatformGuide').isHidden(),true);}
    if(item.platform==='darwin'){assert.equal(await page.locator('#hostPlatformGuide').getAttribute('hidden'),null);assert.equal(await page.locator('#hostPlatformGuide').getAttribute('href'),'/mac-desktop');assert.doesNotMatch(note,/X11|Linux|Wayland/);assert.equal((await page.request.get(`http://127.0.0.1:${app.server.address().port}/mac-desktop`)).status(),200);}
    if(item.platform==='linux')assert.equal((await page.request.get(`http://127.0.0.1:${app.server.address().port}/linux-desktop`)).status(),200);
    assert.equal(await page.locator('#hostShowGuestCursors').isChecked(),true,'Overlay preferences are available before Start on supported platforms');
    if(!item.window)assert.match(await page.locator('#hostOverlayNote').textContent(),/unavailable|require an X11/);
    await page.locator('#hostCreate').click();await page.waitForFunction(()=>!document.querySelector('#hostEnd').disabled);await page.locator('#hostCallSettings').click();await page.locator('#hostGuestSettings').evaluate(el=>el.querySelectorAll('details').forEach(detail=>detail.open=true));
    assert.equal(await page.locator('#hostShowGuestCursors').isChecked(),true);
    assert.equal(await page.locator('#hostDesktopScope').isEnabled(),item.window);
    await page.locator('#hostSettingsSheet-screen-tab').click();
    await page.locator('#captureBackend').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});
    await page.locator('#captureBackend').selectOption('browser');
    if(item.audio){assert.equal(await page.locator('#nativeAudioFields').isVisible(),true);assert.equal(await page.locator('#nativeCaptureAudio').isEnabled(),true);}
    else {assert.equal(await page.locator('#nativeAudioFields').isVisible(),true,'Browser audio remains selectable without native audio tools');assert.equal(await page.locator('#nativeAudioSourceOptions').isVisible(),false);}
    if(item.name==='Linux Wayland'){
      assert.equal(await page.locator('#captureBackend option[value="native"]').isDisabled(),true);
      assert.equal(await page.locator('#hostDesktopMouse').isDisabled(),true);
      await page.locator('#showHelp').click();await page.locator('#tourScenario').selectOption('input');assert.match(await page.locator('#helpDialog').textContent(),/unavailable here/);
    }
    if(item.platform==='darwin'){
      assert.deepEqual(permissionRequests,[],'Host page must not request Mac permissions');
      const guide=await context.newPage();await guide.goto(`http://127.0.0.1:${app.server.address().port}/mac-desktop`);
      await guide.waitForFunction(()=>document.querySelector('#macPermissionStatus').textContent.includes('Screen/audio:'));
      assert.deepEqual(permissionRequests,['status']);
      await guide.locator('#macScreen').click();await guide.waitForFunction(()=>document.querySelector('#macPermissionStatus').textContent.includes('Screen/audio: allowed'));
      assert.deepEqual(permissionRequests,['status','screen']);
      await guide.locator('#macInput').click();await guide.waitForFunction(()=>document.querySelector('#macPermissionStatus').textContent.includes('Accessibility: allowed'));
      assert.deepEqual(permissionRequests,['status','screen','input']);await guide.close();
    }
    assert.deepEqual(errors,[]);console.log(`PASS: ${item.name} shows only its detected capabilities and relevant help`);
  }finally{await context?.close();await app.close();}
}}finally{await browser.close();}
