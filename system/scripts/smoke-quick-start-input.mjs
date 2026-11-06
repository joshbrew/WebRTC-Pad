import {launchTestBrowser} from './browser-fixture.mjs';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const platform=process.env.TEST_HOST_PLATFORM || process.platform;
const writes=[],scopes=[];let controllers=0;
const app=createApp({env:platform==='linux'?{DISPLAY:':99',XDG_SESSION_TYPE:'x11'}:platform==='darwin'?{NATIVE_MAC_HELPER:process.execPath,NATIVE_MEDIA_HELPER:process.execPath,FFMPEG_BIN:process.execPath}:{},platform,getCaptureTargets:async()=>[{kind:'desktop',id:'desktop',label:'Main screen'}],encoderScanner:{peek:()=>null,scan:async()=>({encoders:[],devices:[],selected:null})},
  createOverlay:async()=>Object.assign(new EventEmitter(),{send(){},close(){}}),
  createInjector:async()=>({name:'Keyboard/mouse guide fixture',setState(){},addController(){controllers++;},removeController(){},close(){}}),
  createDesktop:async()=>Object.assign(new EventEmitter(),{display:{width:1280,height:720},simulatedSurface:true,async setScope(scope){scopes.push(scope);},setState(state){writes.push(structuredClone(state));},event(){},close(){}})
});
let browser;
try {
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{...(process.env.BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.BROWSER_CHANNEL || 'msedge'}),headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:950}});
  await context.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');Object.defineProperty(navigator,'getGamepads',{value:()=>[]});window.__captures=0;navigator.mediaDevices.getDisplayMedia=async()=>{window.__captures++;throw new Error('No capture needed');};});
  const errors=[],host=await context.newPage(),guest=await context.newPage();
  for(const page of [host,guest]){page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());}
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  await host.goto(origin);await guest.goto(origin+'/?mode=join');
  const target=(page,selector)=>page.waitForFunction(selector=>document.querySelector(selector)?.classList.contains('tour-target'),selector);
  await host.locator('#showHelp').click();await host.locator('#tourTopics').evaluate(el=>el.open=true);await host.locator('#tourScenario').selectOption('input');
  await target(host,await host.locator('#captureBackend').inputValue()==='native'?'#captureTarget':'#chooseBrowserSource');assert.equal(await host.locator('#captureTarget').inputValue(),'none');
  await host.locator('#tourNext').click();
  await target(host,'#hostDesktopScope');assert.equal(await host.locator('#hostDesktopMouse').isChecked(),false);
  await host.locator('#hostDesktopScope').selectOption('desktop');await host.locator('#tourNext').click();
  await target(host,'#hostDesktopMouse');await host.locator('#hostDesktopMouse').check();await host.locator('#tourNext').click();
  await target(host,'#hostDesktopKeyboard');await host.locator('#hostDesktopKeyboard').check();await host.locator('#tourNext').click();
  await target(host,'#hostCreate');assert.equal(app.rooms.size,0,'Guide prepares access before starting');await host.locator('#hostCreate').click();
  await target(host,'#createInvitation');await host.locator('#createInvitation').click();await target(host,'#createInvitation');await host.locator('#tourNext').click();
  await guest.locator('#showHelp').click();await guest.locator('#tourTopics').evaluate(el=>el.open=true);await guest.locator('#tourScenario').selectOption('input');
  await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});
  await target(guest,'#clientReplyAction');await guest.locator('#clientReplyAction').click();
  await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});
  await target(guest,'#clientDesktopMouse');await guest.waitForFunction(()=>!document.querySelector('#clientDesktopMouse').disabled);
  await guest.locator('#clientDesktopMouse').check();await guest.locator('#tourNext').click();
  await target(guest,'#clientDesktopTyping');await guest.locator('#clientDesktopTyping').check();await guest.locator('#tourNext').click();
  await target(guest,'#clientStage');await guest.locator('#tourNext').click();await guest.bringToFront();
  await guest.locator('#clientStage').click({position:{x:100,y:100}});await guest.keyboard.down('a');
  const end=Date.now()+5000;while(!writes.some(state=>state.keys.includes('KeyA')) && Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));
  await guest.keyboard.up('a');
  assert.ok(writes.some(state=>state.keys.includes('KeyA')),'Guest keys must reach the approved desktop backend');
  assert.ok(writes.some(state=>state.buttons.includes(0)),'Guest mouse clicks must reach the approved desktop backend');
  assert.equal(controllers,0,'Keyboard/mouse play must not claim virtual gamepads');
  assert.equal(await host.evaluate(()=>window.__captures),0);
  assert.equal(await guest.locator('#clientStage').evaluate(el=>el.classList.contains('mouse-pad')),true);
  assert.equal(scopes.at(-1).kind,'desktop');assert.deepEqual(errors,[]);
  console.log(`PASS (${platform} configuration): Play together (keyboard & mouse) guides both approvals and delivers keys/clicks without video or virtual-controller claims`);
} finally {await browser?.close();await app.close();}
