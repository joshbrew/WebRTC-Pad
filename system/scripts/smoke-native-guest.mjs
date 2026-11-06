import {launchTestBrowser} from './browser-fixture.mjs';
// Native protocol fixture + real browser/WebRTC. Does not install/block devices.
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {PassThrough} from 'node:stream';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import {createApp} from '../src/server.js';
import {GuestInputService} from '../src/guest-input.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const platform=process.env.TEST_HOST_PLATFORM || process.platform;
const devices=new Set(),states=new Map(),controllerWrites=[],desktop=[],events=[],errors=[],readers=[];
const inventory=[{id:'pad:1',kind:'gamepad',label:'PS4 Controller',detail:'Recognized SDL layout',available:true},{id:'keyboard:1',kind:'keyboard',label:'Keyboard 1',detail:'Selected USB keyboard',available:true},{id:'mouse:11',kind:'mouse',label:'Mouse 1',detail:'Selected USB mouse',available:true}];
const service=new GuestInputService({capability:{available:true,platform},launch(){
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,active:false});readers.push(child);
  child.say=value=>{if(value.type==='devices')child.inventory=value;child.stdout.write(JSON.stringify(value)+'\n');};child.kill=()=>{if(child.exitCode!==null)return;child.exitCode=0;child.emit('exit',0);};child.stdin.on('finish',child.kill);
  let data='';child.stdin.on('data',part=>{data+=part;for(let end;(end=data.indexOf('\n'))>=0;){const msg=JSON.parse(data.slice(0,end));data=data.slice(end+1);if(msg.type==='start'){child.active=true;child.say({type:'active',devices:msg.devices});}if(msg.type==='list')child.say(child.inventory || {type:'devices',devices:inventory,notes:[]});}});
  queueMicrotask(()=>{child.say({type:'devices',devices:inventory,notes:[]});child.say({type:'ready'});});return child;
}});
const app=createApp({env:platform==='linux'?{DISPLAY:':99',XDG_SESSION_TYPE:'x11'}:platform==='darwin'?{NATIVE_MAC_HELPER:process.execPath,NATIVE_MEDIA_HELPER:process.execPath,FFMPEG_BIN:process.execPath}:{},platform,getCaptureTargets:async()=>[{kind:'desktop',id:'desktop',label:'Main screen'}],encoderScanner:{peek:()=>null,scan:async()=>({encoders:[],devices:[],selected:null})},
  createOverlay:async()=>Object.assign(new EventEmitter(),{send(){},close(){}}),
  createInjector:async()=>({name:'Native guest test output',addController(slot){devices.add(slot);},removeController(slot){devices.delete(slot);},setState(slot,state){states.set(slot,state);controllerWrites.push({slot,state:structuredClone(state)});},close(){devices.clear();}}),
  createDesktop:async()=>Object.assign(new EventEmitter(),{display:{width:1280,height:720},simulatedSurface:true,async setScope(){},setState(state){desktop.push(structuredClone(state));},event(event){events.push(event);},close(){}})
});
const guestApp=createApp({env:{},platform,guestInputService:service});
const until=async(predicate,label)=>{const end=Date.now()+10000;while(!predicate()){if(Date.now()>end)throw new Error(`Timed out: ${label}`);await new Promise(r=>setTimeout(r,25));}};
let browser;
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  guestApp.server.listen(0,'127.0.0.1');await once(guestApp.server,'listening');
  browser=await launchTestBrowser(chromium,{...(process.env.BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.BROWSER_CHANNEL || 'msedge'}),headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1366,height:768}});context.setDefaultTimeout(15000);
  await context.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-input','false');for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');Object.defineProperty(navigator,'getGamepads',{value:()=>[],configurable:true});});
  if(platform==='win32'){
    const declined=await context.newPage(),origin=`http://127.0.0.1:${guestApp.server.address().port}`;
    service.capability.installDeclined=true;service.capability.installApproved=false;
    await declined.goto(origin+'/?mode=join');
    await declined.waitForFunction(()=>localStorage.getItem('webrtc-pad:driver-setup-choice')==='skip');
    assert.equal(await declined.locator('#nativeGuestBlockLocal').isChecked(),false,'Declining driver setup uses regular browser sharing');
    assert.equal(!!service.active,false,'Declining does not reserve native devices');
    service.capability.installDeclined=false;service.capability.installApproved=true;
    await declined.reload();await until(()=>service.active,'later approval enables native blocking');
    assert.equal(await declined.locator('#nativeGuestBlockLocal').isChecked(),true);
    await declined.close();await until(()=>!service.child,'test page releases native devices');
    delete service.capability.installDeclined;delete service.capability.installApproved;
  }
  const host=await context.newPage(),guest=await context.newPage();for(const page of [host,guest]){page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());}
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const enableControllerSharing=async()=>{if(!await guest.locator('#controllersSheet').evaluate(el=>el.open))await guest.locator(await guest.locator('#clientPrepareControllers').isVisible()?'#clientPrepareControllers':'#clientCallControllers').click();await guest.locator('#clientJoinControllers').check();};
  await host.goto(origin);await guest.goto(`http://127.0.0.1:${guestApp.server.address().port}/?mode=join`);
  await guest.locator('#clientPrepareControllers').click();
  assert.equal(await guest.locator('#nativeGuestBlockLocal').isChecked(),true,'Old saved copying preferences must not override the new blocking default');
  assert.equal(await guest.locator('#backgroundGamepad').evaluate(el=>el.closest('details').querySelector('summary').textContent),'Advanced input settings');
  await until(()=>service.active && service.localReservation,'controllers reserve before any session');
  assert.equal(await guest.locator('#controllerAdvanced').evaluate(el=>el.open),false,'Advanced controller setup stays closed');
  assert.equal(await guest.locator('#nativeGuestStatus').isVisible(),false,'Native setup details are hidden from the main card');
  assert.match(await guest.locator('#connectedControllers').textContent(),/PS4 ControllerConnected/);
  await fs.mkdir('.local/screenshots',{recursive:true});await guest.locator('#controllerSetup').screenshot({path:'.local/screenshots/compact-controllers.png'});
  await guest.locator('#controllerAdvanced > summary').click();
  assert.equal(await guest.locator('#backgroundGamepadOption').isVisible(),false,'Native blocking replaces the browser background checkbox with an explanation');
  assert.match(await guest.locator('#backgroundGamepadHint').textContent(),/automatically/);
  assert.equal(await guest.locator('#nativeGuestControllers input').count(),0,'Controller reservations need no per-device checkboxes');
  await guest.waitForTimeout(2400);assert.equal(service.active,true,'Local page lease survives without a call');
  assert.equal(await guest.locator('#clientJoinControllers').isVisible(),true,'Controller sharing can be disabled without opening Advanced');await guest.locator('#clientJoinControllers').uncheck();await until(()=>!service.child,'Disabling controllers releases pre-call isolation');assert.equal(await guest.locator('#nativeGuestBlockLocal').isChecked(),true,'The blocking preference is retained for next time');await guest.waitForTimeout(2400);assert.equal(service.active,false,'Idle scans must not re-block disabled controllers');await enableControllerSharing();await until(()=>service.active,'Explicitly re-enabling controllers reserves them again');
  await guest.locator('#modeHost').click();await until(()=>!service.child,'Host mode releases local reservation');
  await guest.locator('#modeClient').click();await guest.locator('#clientPrepareControllers').click();await until(()=>service.active,'Join mode reserves controllers again');
  await guest.locator('#nativeGuestBlockLocal').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change'));});
  assert.equal(await guest.locator('#backgroundGamepad').isChecked(),true);await guest.locator('#backgroundGamepad').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#backgroundGamepad').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#backgroundGamepad').uncheck();
  await host.waitForFunction(()=>!!document.querySelector('#hostPlatformNote').textContent);
  await host.locator('#hostCreate').scrollIntoViewIfNeeded();assert.ok(await host.locator('#hostCreate').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),'Start button remains reachable on a laptop viewport');
  await host.setViewportSize({width:1366,height:720});assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Setup fits the laptop width');
  await fs.mkdir('.local/screenshots',{recursive:true});await host.screenshot({path:'.local/screenshots/compact-start.png'});
  await host.setViewportSize({width:1366,height:768});
  await host.locator('#hostCreate').click();await host.locator('#hostCallSettings').click();await host.locator('#hostSettingsSheet-players-tab').click();await host.locator('#hostGuestSettings').evaluate(el=>el.querySelectorAll('details').forEach(detail=>detail.open=true));
  await host.locator('#hostDesktopScope').selectOption('desktop');await host.locator('#hostDesktopMouse').check();await host.locator('#hostDesktopKeyboard').check();
  await host.locator('#inviteFocus').click();await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
  await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
  await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});
  await guest.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.ready==='true');
  await guest.locator('#clientCallControllers').evaluate(el=>{if(!document.querySelector('#controllersSheet').open)el.click();});await guest.locator('#nativeGuestBlockLocal').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestBlockLocal').check();
  await guest.evaluate(()=>{window.__copyPad={id:'Unselected browser PS4',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},(_,i)=>({pressed:i===0,value:i===0?1:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[window.__copyPad],configurable:true});});
  await guest.waitForTimeout(250);assert.equal(devices.size,0,'Default blocking mode must not silently claim/copy a browser controller before native selection');
  await guest.locator('#nativeGuestBlockLocal').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestBlockLocal').uncheck();await guest.evaluate(()=>Object.defineProperty(navigator,'getGamepads',{value:()=>[],configurable:true}));
  await guest.locator('#nativeGuestOptions').evaluate(el=>el.open=true);await guest.locator('#nativeGuestRefresh').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestRefresh').click();await guest.locator('#nativeGuestDevices input').first().waitFor({state:'attached'});
  if(platform==='win32'){
    readers.at(-1).say({type:'devices',devices:[{...inventory[0],label:'PS4 Controller',available:false},...inventory.slice(1)],notes:['HidHide is not available. Install it with Windows/09-Guest-Exclusive-Setup.cmd, then restart Windows if requested.','Keyboard/mouse isolation needs the Interception driver and a Windows restart.']});
    await guest.waitForFunction(()=>document.querySelector('#nativeGuestSetupIssues').children.length===2);assert.match(await guest.locator('#nativeGuestStatus').textContent(),/still use browser input sharing/);assert.doesNotMatch(await guest.locator('#nativeGuestStatus').textContent(),/HidHide|Interception/);
    await guest.locator('#nativeGuestHelp summary').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestHelp summary').click();assert.match(await guest.locator('#nativeGuestSetupIssues').textContent(),/windows\/shortcuts\/09-Guest-Exclusive-Setup.cmd/);assert.doesNotMatch(await guest.locator('#nativeGuestSetupIssues').textContent(),/Windows\/09-/);assert.match(await guest.locator('#nativeGuestSetupIssues').textContent(),/optional Interception drivers/);await guest.locator('#nativeGuestHelp summary').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestHelp summary').click();
    assert.equal(await guest.locator('#nativeGuestSetupCard').isVisible(),true);assert.match(await guest.locator('#nativeGuestControllers').textContent(),/PS4 ControllerSetup needed/);assert.doesNotMatch(await guest.locator('#nativeGuestControllers').textContent(),/See optional setup|SDL/);
    await guest.locator('#nativeGuestSetupCard').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestSetupCard').scrollIntoViewIfNeeded();await guest.screenshot({path:'.local/screenshots/guest-controller-setup.png'});
    const oldReader=readers.at(-1);await guest.locator('#nativeGuestRefresh').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestRefresh').click();await until(()=>readers.at(-1)!==oldReader,'Refresh reopens the idle helper to recheck installed drivers');await guest.waitForFunction(()=>!document.querySelector('#nativeGuestSetupIssues').children.length);assert.equal(await guest.locator('#nativeGuestSetupCard').isVisible(),false);
    readers.at(-1).say({type:'devices',devices:[{...inventory[0],available:false,reason:'reconnect-required',detail:'Reconnect this controller after installing HidHide, or restart Windows, then refresh.'},...inventory.slice(1)],notes:[]});await guest.waitForFunction(()=>document.querySelector('#nativeGuestStatus').textContent.includes('not active yet'));assert.match(await guest.locator('#nativeGuestControllers').textContent(),/Reconnect controller/,'A running driver without an attached filter must not claim blocking is ready');
    await guest.locator('#clientCallControllers').evaluate(el=>{if(!document.querySelector('#controllersSheet').open)el.click();});await guest.locator('#nativeGuestBlockLocal').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestBlockLocal').check();
    await guest.waitForFunction(()=>document.querySelector('#primaryControllerTest').textContent==='Waiting for controller input…');
    await guest.waitForTimeout(1200); // Allow the initial controller-status handshake to settle.
    await guest.evaluate(()=>{window.__statusChanges=0;window.__statusObserver=new MutationObserver(()=>window.__statusChanges++);window.__statusObserver.observe(document.querySelector('#primaryControllerTest'),{childList:true,subtree:true,characterData:true});});
    await guest.waitForTimeout(1200);assert.equal(await guest.evaluate(()=>window.__statusChanges),0,'Native readiness and diagnostics must not overwrite each other');await guest.evaluate(()=>window.__statusObserver.disconnect());
    assert.equal(await guest.locator('#nativeGuestRecovery').isVisible(),true,'Unavailable blocking offers browser sharing recovery');
    await guest.locator('#nativeGuestBlockLocal').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestBlockLocal').uncheck();
    readers.at(-1).say({type:'devices',devices:inventory,notes:[]});await guest.waitForFunction(()=>document.querySelector('#nativeGuestControllers').textContent.includes('Local input allowed'));
  }
  const setup=await guest.locator('#nativeGuestSetupHelp').textContent();
  assert.ok(setup.includes(platform==='darwin'?'mac/shortcuts/09-':platform==='linux'?'linux/shortcuts/09-':'windows/shortcuts/09-'),'Native guest help matches the guest OS');
  if(platform!=='win32')assert.doesNotMatch(setup,/Windows|HidHide|Interception/);
  assert.equal((await guest.request.get(origin+'/guest-device-isolation')).status(),200);
  assert.equal(await guest.locator('#nativeGuestOtherDevices').evaluate(el=>el.open),false,'Keyboard/mouse controls are advanced by default');
  await guest.locator('#nativeGuestOtherDevices').evaluate(el=>el.open=true);
  for(const device of inventory.filter(d=>d.kind!=='gamepad'))await guest.locator(`#nativeGuestDevices input[value="${device.id}"]`).check();
  await guest.locator('#clientCallControllers').evaluate(el=>{if(!document.querySelector('#controllersSheet').open)el.click();});await guest.locator('#nativeGuestBlockLocal').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestBlockLocal').check();
  await guest.locator('#nativeGuestKeyboardMode').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestKeyboardMode').selectOption('desktop');await guest.locator('#nativeGuestStart').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestStart').click();await until(()=>service.active,'native lease starts');
  const pad={id:'pad:1 · PS4 Controller',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  const report=(pressed,key,button,dx=0,dy=0)=>{pad.buttons[0]={pressed,value:pressed?1:0};readers.at(-1).say({type:'state',gamepads:[structuredClone(pad)],keys:key?[key]:[],mouse:{buttons:button?[0]:[],dx,dy,x:.5,y:.5,wheelX:0,wheelY:0}});};
  report(false,null,false);await new Promise(r=>setTimeout(r,100));assert.equal(devices.size,0,'Selecting an idle pad does not claim a player');
  await guest.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.hasFocus=()=>false;});await host.bringToFront();
  for(let i=0;i<15;i++){report(true,'KeyA',true,2,1);await new Promise(r=>setTimeout(r,30));}
  await guest.waitForFunction(()=>document.querySelector('#connectedControllers').textContent.includes('In use · P1'));
  await until(()=>states.get('p1')?.buttons.a && desktop.some(s=>s.keys.includes('KeyA') && s.buttons.includes(0)),'background native inputs reach host');
  assert.ok(desktop.some(s=>s.x>.5 && s.y>.5),'Relative native motion uses the host surface dimensions');
  report(false,null,false);await until(()=>states.get('p1') && !states.get('p1').buttons.a,'native button release');
  const burst=controllerWrites.length;report(true,null,false);report(false,null,false);
  await until(()=>controllerWrites.slice(burst).some(value=>value.slot==='p1' && value.state.buttons.a) && !states.get('p1').buttons.a,'fresh native controller press/release must not wait for a polling tick');
  const quick=desktop.length;report(false,'KeyB',true);report(false,null,false);await until(()=>desktop.slice(quick).some(s=>s.keys.includes('KeyB') && s.buttons.includes(0)),'rapid native key/click transition preserved');
  const mark=desktop.length;await guest.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyZ',bubbles:true})));
  await new Promise(r=>setTimeout(r,100));assert.ok(desktop.slice(mark).every(s=>!s.keys.includes('KeyZ')),'Unselected browser keyboard input is not forwarded in exclusive mode');
  await guest.evaluate(async()=>{
    const {NativeGuestInput}=await import('/guest-input.js'),paint=NativeGuestInput.prototype.paint;
    window.__nativePaints=0;
    NativeGuestInput.prototype.paint=function(){window.__nativePaints++;window.__nativeInstance=this;return paint.call(this);};
  });
  for(let n=0;n<300;n++)report(false,null,false);
  pad.axes[0]=.7;report(false,null,false);await until(()=>states.get('p1')?.axes.lx>.6,'native burst reaches the host without waiting for UI painting');
  await guest.waitForTimeout(250);
  const paints=await guest.evaluate(()=>window.__nativePaints);assert.ok(paints<=3,`${paints} native settings repaints for 300 state reports`);
  console.log(`Native input UI: ${paints} settings repaints during a 300-report burst; input callbacks remain immediate.`);
  // Stop replies while the native socket and browser stay alive. The native
  // lease must expire instead of keeping local devices captive indefinitely.
  await host.evaluate(()=>{const original=RTCDataChannel.prototype.send;window.__muteNativePong=true;RTCDataChannel.prototype.send=function(data){if(window.__muteNativePong && typeof data==='string' && JSON.parse(data).type==='pong')return;return original.call(this,data);};});
  await until(()=>!service.child,'lost remote round trips release reader');
  await guest.waitForFunction(()=>document.querySelector('#clientEnablePad').getAttribute('aria-pressed')==='false');
  assert.ok(readers.at(-1).stdin.writableEnded);assert.equal(await guest.locator('#nativeGuestBlockLocal').isChecked(),true);
  await host.evaluate(()=>window.__muteNativePong=false);await guest.locator('#clientEnablePad').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#controllerAdvanced').evaluate(el=>el.open=true);await guest.locator('#clientEnablePad').click();await guest.waitForFunction(()=>document.querySelectorAll('#nativeGuestDevices input').length===2);assert.equal(await guest.locator('#nativeGuestDevices input:checked').count(),0,'Resume must require fresh selections instead of reusing native handle IDs');await until(()=>service.active && service.localReservation,'controllers re-reserve while keyboard/mouse await fresh selections');
  for(const width of [390,860,1366]){await host.setViewportSize({width,height:768});await guest.setViewportSize({width,height:768});for(const page of [host,guest])assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  for(const device of inventory.filter(d=>d.kind!=='gamepad'))await guest.locator(`#nativeGuestDevices input[value="${device.id}"]`).check();
  await guest.locator('#nativeGuestStart').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestStart').click();await until(()=>service.active,'native lease resumes after fresh selection');
  for(let n=0;n<8;n++){report(true,'KeyA',true);await new Promise(r=>setTimeout(r,30));}
  await until(()=>states.get('p1')?.buttons.a && desktop.at(-1)?.keys.includes('KeyA'),'held native controls arrive before pause');
  await guest.locator('#clientReleaseInputs').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#clientReleaseInputs').click();await until(()=>!service.child,'Pause all input releases native devices');
  await until(()=>[...states.values()].every(state=>!state.buttons.a) && desktop.at(-1)?.keys.length===0 && desktop.at(-1)?.buttons.length===0,'Pause all input neutralizes controller/key/mouse state');
  assert.equal(await guest.locator('#clientEnablePad').getAttribute('aria-pressed'),'false');assert.equal(await guest.locator('#clientDesktopMouse').isChecked(),false);
  assert.equal(await guest.locator('#backgroundGamepad').isChecked(),false,'Native capture restores the saved browser opt-out when devices are released');
  console.log('PASS: Pause all input releases selected native devices and held controller/key/mouse state without leaving the session');
  // Controller-only isolation stays active while the mapper previews native
  // reports. Editing must neither leak gameplay input nor change device IDs.
  await enableControllerSharing();
  await guest.locator('#nativeGuestBlockLocal').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestBlockLocal').uncheck();
  await guest.locator('#nativeGuestRefresh').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestRefresh').click();await guest.waitForFunction(()=>document.querySelectorAll('#nativeGuestDevices input').length===2);
  await guest.locator('#clientCallControllers').evaluate(el=>{if(!document.querySelector('#controllersSheet').open)el.click();});await guest.locator('#nativeGuestBlockLocal').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestBlockLocal').check();await until(()=>service.active && service.localReservation,'global toggle automatically reserves controllers');
  report(false,null,false);await guest.waitForTimeout(100);for(let n=0;n<5;n++){report(true,null,false);await guest.waitForTimeout(30);}await until(()=>states.get('p1')?.buttons.a,'controller-only pad joins');report(false,null,false);
  inventory.push({id:'pad:2',kind:'gamepad',label:'Second controller',detail:'Recognized SDL layout',available:true});readers.at(-1).say({type:'devices',devices:inventory,notes:[]});
  await until(()=>service.selection?.length===2,'new controller inventory is reserved automatically');await guest.waitForFunction(()=>document.querySelector('#controllerSetup').dataset.blockingState==='active');
  const secondPad={...structuredClone(pad),id:'pad:2 · Second controller',index:1};
  readers.at(-1).say({type:'state',gamepads:[structuredClone(pad),secondPad],keys:[],mouse:{buttons:[],dx:0,dy:0,wheelX:0,wheelY:0}});await guest.waitForTimeout(150);
  assert.equal(devices.size,1,'An idle additional controller takes no player spot');assert.equal(await guest.locator('#clientSlot').textContent(),'P1','Adding a controller preserves the existing player');
  inventory.pop();readers.at(-1).say({type:'devices',devices:inventory,notes:[]});await until(()=>service.selection?.length===1,'removed controller leaves the reservation');await guest.waitForFunction(()=>document.querySelector('#controllerSetup').dataset.blockingState==='active');
  report(false,null,false);await guest.waitForTimeout(100);
  const editorReader=service.child;await guest.locator('.controller-map').first().click();assert.equal(await guest.locator('[data-keyboard="device"]').inputValue(),'0');
  await guest.locator('[data-binding="a"]').click();await guest.keyboard.press('Delete');await guest.locator('[data-binding="b"]').click();
  report(false,null,false);await guest.waitForTimeout(100);report(true,null,false);await guest.waitForFunction(()=>document.querySelector('[data-binding="b"]').textContent==='Button 0');
  assert.equal(service.child,editorReader,'Editing must keep the native controller reader and isolation');assert.equal(service.active,true);
  await until(()=>[...states.values()].every(state=>!Object.values(state.buttons).some(Boolean)),'mapping pauses remote input');
  await guest.locator('[data-keyboard="save"]').click();for(let n=0;n<5;n++){report(true,null,false);await guest.waitForTimeout(30);}await until(()=>states.get('p1')?.buttons.b && !states.get('p1')?.buttons.a,'native remap reaches host');
  await guest.locator('#clientEnablePad').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#clientEnablePad').click();await until(()=>!service.child,'Pausing controller sharing releases controller-only blocking');await until(()=>[...states.values()].every(state=>!Object.values(state.buttons).some(Boolean)),'Pausing controllers releases held host buttons');assert.equal(await guest.locator('#clientJoinControllers').isChecked(),false);await guest.waitForTimeout(2400);assert.equal(service.active,false,'Controller sharing stays off through background ticks');await enableControllerSharing();await until(()=>service.active && service.localReservation,'Controllers can be explicitly re-enabled during the call');
  await guest.locator('#clientDisconnect').click();await guest.waitForTimeout(2400);assert.equal(service.active,true,'Local reservation survives ending a call');
  await guest.locator('#nativeGuestBlockLocal').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestBlockLocal').uncheck();await until(()=>!service.child,'global toggle releases controllers');
  await guest.locator('#clientCallControllers').evaluate(el=>{if(!document.querySelector('#controllersSheet').open)el.click();});await guest.locator('#nativeGuestBlockLocal').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#nativeGuestBlockLocal').check();await until(()=>service.active,'global toggle re-reserves without a call');
  await guest.close();await until(()=>!service.child,'Closing the Join page releases controllers');
  console.log('PASS: native controller-only isolation survives mapping; editor pauses remote input; saved remap reaches host; devices still release normally');
  assert.deepEqual(errors,[]);
  console.log(`PASS (${platform} configuration): native controller/key/mouse WebRTC delivery in background; idle pads do not join; browser inputs excluded; lost round trips release devices; OS setup help, compact setup and mobile bounds (recording drivers)`);
}finally{await browser?.close();await app.close();await guestApp.close();}
