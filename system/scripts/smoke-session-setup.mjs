import {launchTestBrowser} from './browser-fixture.mjs';
// Startup permissions and preview cleanup, using generated capture and simulated desktop input.
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const errors=[];let browser,driverStarts=0;
const simulatedDesktop=()=>Object.assign(new EventEmitter(),{display:{width:1280,height:720},simulatedSurface:true,async setScope(){},setState(){},event(){},close(){}});
const app=createApp({env:{},desktopSimulation:true,createDesktop:simulatedDesktop,createInjector:async()=>{driverStarts++;return {name:'Setup recording driver',addController(){},removeController(){},setState(){},close(){}};}});
const until=async predicate=>{const end=Date.now()+10000;while(!predicate()){assert.ok(Date.now()<end,'Server policy did not update');await new Promise(r=>setTimeout(r,25));}};
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.addInitScript(()=>{
    for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');
    localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');localStorage.setItem('webrtc-pad:capture-method','browser');navigator.getGamepads=()=>[];
    window.captures=[];navigator.mediaDevices.getDisplayMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const c=canvas.getContext('2d');let n=0;
      const draw=()=>{c.fillStyle='#10252d';c.fillRect(0,0,1280,720);c.fillStyle='#d1f79b';c.font='32px sans-serif';c.fillText('Session setup · demo screen',40,65);c.beginPath();c.arc(100+(n++*4)%1050,360,30,0,7);c.fill();};draw();const timer=setInterval(draw,16);
      const stream=canvas.captureStream(60),track=stream.getVideoTracks()[0],stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};window.captures.push(stream);
      if(window.holdPicker)await new Promise(resolve=>window.finishPicker=resolve);return stream;
    };
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>{errors.push('Unexpected native dialog: '+dialog.message());dialog.dismiss();});
  await page.goto(`http://127.0.0.1:${app.server.address().port}/`);
  await page.waitForFunction(()=>document.body.dataset.desktopInput==='true');
  assert.equal(await page.locator('#hostSetupTitle').textContent(),'Start a session');
  assert.equal(await page.locator('#hostPreflight').isVisible(),false);
  await page.locator('#hostSessionControls > summary').click();
  assert.equal(await page.locator('#hostDesktopScope').inputValue(),'off');await page.locator('#hostDesktopScope').selectOption('window');
  assert.equal(await page.locator('#hostDesktopMouse').isVisible(),true);assert.equal(await page.locator('#hostDesktopKeyboard').isVisible(),true);
  await page.locator('#hostDesktopScope').selectOption('desktop');assert.equal(await page.locator('#hostDesktopFull').isChecked(),true,'Scope is selected directly without a popup');assert.match(await page.locator('#hostInputCaution').textContent(),/CAUTION.*demo screen/);await page.locator('#hostDesktopScope').selectOption('window');
  for(const id of ['hostDesktopFull','hostDesktopMouse','hostDesktopKeyboard'])await (id==='hostDesktopFull'?page.locator('#hostDesktopScope').selectOption('desktop'):page.locator(`#${id}`).check());
  assert.equal(app.rooms.size,0);assert.equal(driverStarts,0,'Preparing permissions must not start a host or input driver');
  assert.equal(await page.locator('#hostSessionControlsState').textContent(),'Entire desktop');
  await fs.mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/session-setup-controls.png'});
  await page.locator('#chooseBrowserSource').click();await page.waitForFunction(()=>document.querySelector('#hostPreview').videoWidth===1280);
  assert.equal(await page.locator('#hostDesktopScope').inputValue(),'desktop');for(const id of ['hostDesktopFull','hostDesktopMouse','hostDesktopKeyboard'])assert.equal(await page.locator(`#${id}`).isChecked(),true,'Choosing a source keeps the selected access and defaults');
  for(const id of ['hostDesktopFull','hostDesktopMouse','hostDesktopKeyboard'])await (id==='hostDesktopFull'?page.locator('#hostDesktopScope').selectOption('desktop'):page.locator(`#${id}`).check());
  await page.locator('#chooseBrowserSource').click();await page.waitForFunction(()=>window.captures.length===2 && document.querySelector('#hostPreview').srcObject===window.captures[1]);
  assert.equal(await page.locator('#hostDesktopScope').inputValue(),'desktop');for(const id of ['hostDesktopFull','hostDesktopMouse','hostDesktopKeyboard'])assert.equal(await page.locator(`#${id}`).isChecked(),true,'Replacing a source keeps input choices');
  for(const id of ['hostDesktopFull','hostDesktopMouse','hostDesktopKeyboard'])await (id==='hostDesktopFull'?page.locator('#hostDesktopScope').selectOption('desktop'):page.locator(`#${id}`).check());
  await page.locator('#hostCreate').click();await until(()=>[...app.rooms.values()].some(r=>r.desktopFullAccess && r.desktopMouse && r.desktopKeyboard));
  await page.waitForFunction(()=>document.querySelector('#hostDesktopMouse').checked && document.querySelector('#hostDesktopKeyboard').checked);
  assert.equal(driverStarts,1);assert.equal(await page.evaluate(()=>window.captures.length),2,'Start reuses the approved source');
  assert.equal(await page.locator('#hostGuestSettings').evaluate(el=>el.parentElement.id),'hostSettingsSheet-players');
  assert.equal(await page.locator('#hostSessionControls').isVisible(),false);
  await page.locator('#modeClient').click();assert.equal(await page.evaluate(()=>window.captures[1].getVideoTracks()[0].readyState),'live','Changing the viewed tab does not end an active host session');await page.locator('#modeHost').click();
  await page.locator('#hostEnd').click();await page.waitForFunction(()=>!document.querySelector('#hostCreate').disabled && !document.querySelector('#hostCreate').hidden);await until(()=>app.rooms.size===0);
  assert.equal(await page.locator('#hostGuestSettings').evaluate(el=>el.parentElement.id),'hostSessionControls');
  for(const id of ['hostDesktopFull','hostDesktopMouse','hostDesktopKeyboard'])assert.equal(await page.locator(`#${id}`).isChecked(),false,'A new session requires fresh approval');
  await page.locator('#chooseBrowserSource').click();await page.waitForFunction(()=>document.querySelector('#hostPreview').videoWidth===1280);
  for(const id of ['hostDesktopFull','hostDesktopMouse','hostDesktopKeyboard'])await (id==='hostDesktopFull'?page.locator('#hostDesktopScope').selectOption('desktop'):page.locator(`#${id}`).check());
  await page.locator('#modeClient').click();await page.waitForFunction(()=>window.captures.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
  await page.locator('#modeHost').click();await page.waitForFunction(()=>!document.querySelector('#hostCreate').disabled);
  assert.equal(await page.locator('#captureTarget').inputValue(),'none');assert.equal(await page.locator('#hostPreview').evaluate(el=>el.srcObject),null);
  for(const id of ['hostDesktopFull','hostDesktopMouse','hostDesktopKeyboard'])assert.equal(await page.locator(`#${id}`).isChecked(),false,'Join releases pending access');
  await page.evaluate(()=>window.holdPicker=true);await page.locator('#chooseBrowserSource').click();await page.waitForFunction(()=>!!window.finishPicker);await page.locator('#modeClient').click();await page.evaluate(()=>window.finishPicker());
  await page.waitForFunction(()=>window.captures.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
  assert.equal(await page.locator('#clientPanel').isVisible(),true);assert.equal(app.rooms.size,0);assert.deepEqual(errors,[]);
  console.log('PASS: session naming; startup mouse/keyboard permissions; inline caution without popups; no input before Start; source selection preserves choices; Start applies permissions after source binding; controls move into settings; active hosting remains live; ending resets access; Join releases preview and late picker results.');
  const media=[],scopes=[],nativeApp=createApp({env:{NATIVE_MEDIA_HELPER:process.execPath,FFMPEG_BIN:process.execPath,NATIVE_AUDIO_HELPER:'.local/unavailable-audio-fixture.exe'},platform:'win32',
    getCaptureTargets:async()=>[{kind:'desktop',id:'desktop',label:'Primary screen'},{kind:'window',id:'4242',pid:42,processStart:'fixture',label:'Demo application',width:1280,height:720},{kind:'window',id:'5252',pid:43,processStart:'second',label:'Second application',width:1280,height:720}],
    encoderScanner:{peek:()=>null,scan:async()=>({encoders:[],devices:[],selected:null})},
    createOverlay:async()=>Object.assign(new EventEmitter(),{send(){},close(){}}),
    createInjector:async()=>({name:'Native setup recording driver',setState(){},close(){}}),
    createDesktop:()=>Object.assign(simulatedDesktop(),{async setScope(scope){scopes.push(scope);}}),
    createNativeMedia:()=>{const capture=Object.assign(new EventEmitter(),{async offer(){return {sourceSize:{width:1280,height:720}};},async closePeer(){},close(){capture.closed=true;}});media.push(capture);return capture;}
  });
  let nativeContext;
  try{
    nativeApp.server.listen(0,'127.0.0.1');await once(nativeApp.server,'listening');nativeContext=await browser.newContext({viewport:{width:1440,height:1000}});
    await nativeContext.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
    await nativeContext.addInitScript(()=>{for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');localStorage.setItem('webrtc-pad:capture-method','native');localStorage.setItem('webrtc-pad:hostPreviewToggle','false');});
    const native=await nativeContext.newPage();native.on('pageerror',e=>errors.push(e.message));native.on('dialog',dialog=>dialog.accept());await native.goto(`http://127.0.0.1:${nativeApp.server.address().port}/`);
    await native.waitForFunction(()=>[...document.querySelector('#captureTarget').options].some(o=>o.value==='4242'));
    await native.locator('#hostSessionControls > summary').click();assert.equal(await native.locator('#hostDesktopScope').inputValue(),'off');await native.locator('#hostDesktopScope').selectOption('window');
    for(const id of ['hostDesktopMouse','hostDesktopKeyboard']){assert.equal(await native.locator(`#${id}`).isChecked(),true,'Mouse and typing default checked after choosing an access scope');assert.equal(await native.locator(`#${id}`).isDisabled(),true,'Window control waits for a window');}
    await native.locator('#captureTarget').selectOption('4242');await native.waitForFunction(()=>document.querySelector('#hostLiveText').textContent==='Private preview' && !document.querySelector('#hostDesktopMouse').disabled);
    assert.equal(await native.locator('#hostDesktopScope').inputValue(),'window','Selecting a window must not switch access Off');for(const id of ['hostDesktopMouse','hostDesktopKeyboard'])assert.equal(await native.locator(`#${id}`).isChecked(),true);assert.equal(nativeApp.rooms.size,0);assert.equal(scopes.length,0);
    await native.screenshot({path:'.local/screenshots/window-control-defaults.png'});
    await native.locator('#hostCreate').click();await until(()=>[...nativeApp.rooms.values()].some(r=>r.desktopMouse && r.desktopKeyboard));assert.equal(scopes.at(-1).kind,'window');assert.equal(scopes.at(-1).id,'4242');assert.equal([...nativeApp.rooms.values()][0].desktopFullAccess,false,'Window preparation never broadens into whole-screen access');
    await native.locator('#hostCallSettings').click();await native.locator('#hostCallSettings').evaluate(el=>{if(!document.querySelector('#hostSettingsSheet').open)el.click();});await native.locator('#hostSettingsSheet-screen-tab').click();await native.locator('#captureTarget').selectOption('5252');await until(()=>[...nativeApp.rooms.values()].some(r=>r.captureTarget?.id==='5252' && r.desktopMouse && r.desktopKeyboard));assert.equal(scopes.at(-1).id,'5252');assert.equal(scopes.at(-1).kind,'window');
    await native.locator('#hostCallSettings').evaluate(el=>{if(!document.querySelector('#hostSettingsSheet').open)el.click();});await native.locator('#hostSettingsSheet-players-tab').click();assert.equal(await native.locator('#hostDesktopScope').inputValue(),'window');await native.locator('#hostDesktopKeyboard').uncheck();await until(()=>![...nativeApp.rooms.values()][0].desktopKeyboard);
    await native.locator('#hostCallSettings').evaluate(el=>{if(!document.querySelector('#hostSettingsSheet').open)el.click();});await native.locator('#hostSettingsSheet-screen-tab').click();await native.locator('#captureTarget').selectOption('4242');await until(()=>[...nativeApp.rooms.values()].some(r=>r.captureTarget?.id==='4242' && r.desktopMouse && !r.desktopKeyboard));assert.equal(scopes.at(-1).id,'4242');
    await native.locator('#hostCallSettings').evaluate(el=>{if(!document.querySelector('#hostSettingsSheet').open)el.click();});await native.locator('#hostSettingsSheet-screen-tab').click();await native.locator('#captureTarget').selectOption('desktop');await until(()=>[...nativeApp.rooms.values()].some(r=>r.captureTarget?.kind==='desktop' && !r.desktopMouse && !r.desktopKeyboard && !r.desktopFullAccess));await native.locator('#hostCallSettings').evaluate(el=>{if(!document.querySelector('#hostSettingsSheet').open)el.click();});await native.locator('#hostSettingsSheet-players-tab').click();assert.equal(await native.locator('#hostDesktopScope').inputValue(),'window');assert.equal(await native.locator('#hostDesktopMouse').isDisabled(),true,'Window scope must never become whole-screen access');assert.equal(await native.locator('#hostDesktopMouse').isChecked(),true);assert.equal(await native.locator('#hostDesktopKeyboard').isChecked(),false);
    await native.locator('#hostSettingsSheet').getByRole('button',{name:'Close settings',exact:true}).click();
    await native.locator('#hostEnd').click();await native.waitForFunction(()=>!document.querySelector('#hostCreate').disabled);await native.locator('#captureTarget').selectOption('4242');await native.waitForFunction(()=>document.querySelector('#hostLiveText').textContent==='Private preview');await native.locator('#modeClient').click();await until(()=>media.every(c=>c.closed));assert.equal(nativeApp.rooms.size,0);assert.deepEqual(errors,[]);
    console.log('PASS: native-window permissions prepare before Start, bind to the selected window, remain window-only, and native preview capture closes on Join (recording helpers).');
    await nativeContext.addInitScript(()=>{
      localStorage.setItem('webrtc-pad:capture-method','browser');
      navigator.mediaDevices.getDisplayMedia=async()=>{
        const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;canvas.getContext('2d').fillRect(0,0,1280,720);
        const stream=canvas.captureStream(30),track=stream.getVideoTracks()[0],settings=track.getSettings.bind(track);
        Object.defineProperty(track,'label',{value:window.unverified?'Unidentified browser window':'window:4242:0'});
        track.getSettings=()=>({...settings(),displaySurface:'window'});return stream;
      };
    });
    const matched=await nativeContext.newPage();matched.on('pageerror',e=>errors.push(e.message));matched.on('dialog',d=>{errors.push('Unexpected input dialog');d.dismiss();});await matched.goto(`http://127.0.0.1:${nativeApp.server.address().port}/`);
    await matched.locator('#hostSessionControls > summary').click();
    for(const id of ['hostDesktopMouse','hostDesktopKeyboard'])assert.equal(await matched.locator(`#${id}`).isDisabled(),true,'No window means no window-scoped permission');
    await matched.locator('#chooseBrowserSource').click();await matched.waitForFunction(()=>document.body.dataset.selectedSurface==='window');await matched.locator('#hostDesktopScope').selectOption('window');await matched.waitForFunction(()=>!document.querySelector('#hostDesktopMouse').disabled);
    assert.match(await matched.locator('#hostMouseScopeNote').textContent(),/limited to Demo application/);
    for(const id of ['hostDesktopMouse','hostDesktopKeyboard'])await matched.locator(`#${id}`).check();assert.equal(nativeApp.rooms.size,0);
    await matched.screenshot({path:'.local/screenshots/window-control-caution.png'});
    await matched.locator('#hostCreate').click();await until(()=>[...nativeApp.rooms.values()].some(r=>r.desktopMouse && r.desktopKeyboard));
    assert.equal(scopes.at(-1).kind,'window');assert.equal(scopes.at(-1).id,'4242');assert.equal([...nativeApp.rooms.values()][0].desktopFullAccess,false);
    await matched.locator('#hostCallSettings').click();await matched.locator('#hostSettingsSheet-players-tab').click();
    for(const id of ['hostDesktopMouse','hostDesktopKeyboard']){await matched.locator(`#${id}`).uncheck();await matched.waitForFunction(()=>!document.querySelector('#hostDesktopMouse').disabled);await matched.locator(`#${id}`).check();await matched.waitForFunction(()=>!document.querySelector('#hostDesktopMouse').disabled);}
    await matched.locator('#hostSettingsSheet').getByRole('button',{name:'Close settings',exact:true}).click();await matched.locator('#hostEnd').click();await matched.waitForFunction(()=>!document.querySelector('#hostCreate').disabled);
    await matched.evaluate(()=>window.unverified=true);await matched.locator('#chooseBrowserSource').click();await matched.locator('#hostDesktopScope').selectOption('window');
    for(const id of ['hostDesktopMouse','hostDesktopKeyboard'])assert.equal(await matched.locator(`#${id}`).isDisabled(),true,'Unidentified browser window must not gain desktop access');
    assert.match(await matched.locator('#hostMouseScopeNote').textContent(),/use Native capture/);assert.equal(await matched.locator('#hostChooseControlWindow').isVisible(),true);
    await matched.locator('#hostChooseControlWindow').click();await matched.waitForFunction(()=>document.querySelector('#captureBackend').value==='native' && !document.querySelector('#captureTarget').disabled);
    assert.equal(nativeApp.rooms.size,0);assert.equal(await matched.locator('#hostDesktopFull').isChecked(),false);assert.deepEqual(errors,[]);
    console.log('PASS: verified browser windows accept mouse and typing before and during a session without popups; scope stays bound to one window; unverified sources stay blocked with an explanation and a native-window shortcut.');
  }finally{await nativeContext?.close();await nativeApp.close();}
}finally{await browser?.close();await app.close();}
