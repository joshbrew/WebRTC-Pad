import {launchTestBrowser} from './browser-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createApp} from '../src/server.js';
import injection from '../src/inject/index.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const writes=[],errors=[],native=process.env.TEST_NATIVE_CONTROLLERS==='1';let createdCount=0;
const app=createApp({env:{},createInjector:async options=>{
  createdCount=options.playerCount;
  const driver=native?await injection.createInjector(options):{name:'Multi-controller fixture',setState(){},close(){}};
  return {...driver,setState(slot,state){writes.push({slot,state});driver.setState(slot,state);}};
}});
const until=async (predicate,label='controller delivery')=>{const end=Date.now()+8000;while(!predicate()){if(Date.now()>end)throw new Error(`Timed out: ${label}`);await new Promise(r=>setTimeout(r,20));}};
const snapshot=async()=>JSON.parse((await promisify(execFile)('python',['system/scripts/read-xinput.py'])).stdout);
let browser;
try {
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  const context=await browser.newContext({viewport:{width:1280,height:950}});
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    window.__binaryInputs=0;const originalSend=RTCDataChannel.prototype.send;RTCDataChannel.prototype.send=function(data){if(this.label==='input' && data instanceof ArrayBuffer)window.__binaryInputs++;return originalSend.call(this,data);};
    for(const mode of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${mode}`,'seen');
    localStorage.setItem('webrtc-pad:capture-method','browser');
    window.__pads=Array.from({length:3},(_,index)=>({index,id:`Test gamepad ${index+1}`,mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}));
    Object.defineProperty(navigator,'getGamepads',{value:()=>window.__pads});
    navigator.mediaDevices.getDisplayMedia=async()=>{const c=document.createElement('canvas');c.width=1280;c.height=720;const ctx=c.getContext('2d');let n=0;setInterval(()=>{ctx.fillStyle=`hsl(${n++%360} 50% 35%)`;ctx.fillRect(0,0,1280,720);},16);return c.captureStream(60);};
  });
  const origin=`http://127.0.0.1:${app.server.address().port}`,host=await context.newPage(),guest=await context.newPage();
  for(const page of [host,guest])page.on('pageerror',e=>errors.push(e.message));
  await host.goto(origin);await guest.goto(origin+'/?mode=join');
  await host.waitForFunction(()=>document.querySelector('#hostControllerOutput option[value="x360"]'));await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostControllerOutput').selectOption('x360');await host.waitForFunction(()=>document.querySelector('#hostControllerCount').options.length===4);
  await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostDynamicControllers').uncheck();await host.locator('#hostControllerCount').selectOption('3');await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostDynamicControllers').uncheck();await host.locator('#hostCreate').click();await host.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);assert.equal(createdCount,3);
  assert.equal(await host.locator('#hostControllerCount').isDisabled(),true);
  await guest.locator('#clientMediaToggle').click();
  async function pair(){
    const old=await host.locator('#hostInvitation').inputValue();await host.locator(old?'#newInvitation':'#createInvitation').click();await host.waitForFunction(old=>document.querySelector('#hostInvitation').value && document.querySelector('#hostInvitation').value!==old,old);
    await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});
    await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
    await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});
    await guest.waitForFunction(()=>!document.querySelector('#clientEnablePad').disabled);await guest.locator('#controllerAdvanced').evaluate(el=>el.open=true);await guest.locator('#clientControllerCount').selectOption('3');
    await guest.waitForFunction(()=>document.querySelector('#clientSlot').textContent==='P1 · P2 · P3');
  }
  await pair();assert.equal(await guest.locator('#clientPadIndex').inputValue(),'0');assert.equal(await guest.locator('#extraPad1').inputValue(),'1');assert.equal(await guest.locator('#extraPad2').inputValue(),'2');
  await guest.locator('#backgroundGamepad').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#backgroundGamepad').check();await guest.locator('#clientEnableGroup').click();
  assert.equal(await guest.locator('#clientEnablePad').getAttribute('aria-pressed'),'true');
  const press=async()=>guest.evaluate(()=>{[0,1,2].forEach((index)=>{window.__pads[index].buttons[index]={pressed:true,value:1};});});
  await press();await until(()=>['a','b','x'].every((button,i)=>writes.some(w=>w.slot===`p${i+1}` && w.state.buttons[button])));
  assert.ok(await guest.evaluate(()=>window.__binaryInputs>0),'Multiple controllers must use the compact format after slot assignment');
  await guest.waitForFunction(()=>['primaryControllerTest','controllerTest1','controllerTest2'].every(id=>document.getElementById(id).textContent.includes('Delivered to host')));
  assert.match(await host.locator('#hostSlotSummary').textContent(),/3 of 3 assigned/);
  if(native){const pads=await snapshot();assert.equal(pads.length,3);assert.deepEqual(pads.map(p=>p.buttons).sort((a,b)=>a-b),[4096,8192,16384]);console.log('PASS: three separate Windows XInput pads receive A, B and X from one WebRTC guest');}
  console.log('PASS: one file exchange gives a guest TV three independently tested/controller slots; no video required');
  // A second TV can wait for a spot, then retry without replacing its invite.
  const side=await context.newPage();side.on('pageerror',e=>errors.push(e.message));await side.goto(origin+'/?mode=join');
  const previousInvite=await host.locator('#hostInvitation').inputValue();await host.locator(previousInvite?'#newInvitation':'#createInvitation').click();await host.waitForFunction(old=>document.querySelector('#hostInvitation').value!==old,previousInvite);
  await side.locator('#clientInvitationFile').setInputFiles({name:'waiting-invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await side.waitForFunction(()=>!!document.querySelector('#clientReply').value);
  await host.locator('#hostReplyFile').setInputFiles({name:'waiting-reply.txt',mimeType:'text/plain',buffer:Buffer.from(await side.locator('#clientReply').inputValue())});
  await side.waitForFunction(()=>document.querySelector('#controllerGroupStatus').textContent.includes('No free player spots'));
  await guest.locator('#clientControllerCount').selectOption('2');await guest.waitForFunction(()=>document.querySelector('#clientSlot').textContent==='P1 · P2');
  await side.locator('#retryControllerSpots').click();await side.waitForFunction(()=>document.querySelector('#clientSlot').textContent==='P3');
  await guest.locator('#controllerAdvanced').evaluate(el=>el.open=true);await guest.locator('#clientControllerCount').selectOption('3');await guest.waitForFunction(()=>document.querySelector('#controllerGroupStatus').textContent.includes('2 of 3 spots'));
  await side.locator('#clientDisconnect').click();await until(()=>app.rooms.values().next().value.peers.size===1);
  await guest.locator('#retryControllerSpots').click();await guest.waitForFunction(()=>document.querySelector('#clientSlot').textContent==='P1 · P2 · P3');await side.close();
  console.log('PASS: full room shows a waiting TV; count changes free spots; retry assigns only available seats without a new file exchange');
  // An unplugged gamepad must not silently take another player's device.
  await guest.evaluate(()=>window.__pads[1]=null);await guest.waitForFunction(()=>document.querySelector('#controllerTest1').textContent.includes('Disconnected'));
  await until(()=>writes.filter(w=>w.slot==='p2').at(-1)?.state.buttons.b===false);
  assert.equal(await guest.locator('#extraPad2').inputValue(),'2');assert.equal(await guest.locator('#extraPad1').inputValue(),'1');
  // Reusing a device is visibly rejected and sends neutral for the duplicate lane.
  await guest.locator('#extraPad1').selectOption('2');await guest.waitForFunction(()=>document.querySelector('#controllerTest2').textContent.includes('Already used'));
  await until(()=>writes.filter(w=>w.slot==='p3').at(-1)?.state.buttons.x===false);
  await guest.locator('#extraPad1').selectOption('');
  // A custom layout applies only to its configured device, without stealing player 1.
  await guest.evaluate(()=>{window.__pads[1]={index:1,id:'Custom second controller',mapping:'',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},(_,i)=>({pressed:i===0,value:i===0?1:0}))};window.dispatchEvent(new Event('gamepadconnected'));});
  await guest.locator('#extraPad1').selectOption('1');assert.equal(await guest.getByRole('button',{name:'Change button layout',exact:true}).count(),0);await guest.locator('.controller-map').first().click();await guest.locator('[data-keyboard="device"]').selectOption('1');
  assert.equal(await guest.locator('#clientPadIndex').inputValue(),'0');
  await guest.locator('[data-binding="a"]').click();await guest.keyboard.press('Delete');
  await guest.locator('[data-binding="b"]').click();
  await guest.evaluate(()=>window.__pads[1].buttons[0]={pressed:false,value:0});await guest.waitForTimeout(100);
  await guest.evaluate(()=>window.__pads[1].buttons[0]={pressed:true,value:1});await guest.waitForFunction(()=>document.querySelector('[data-binding="b"]').textContent==='Button 0');
  await guest.evaluate(()=>window.dispatchEvent(new Event('gamepadconnected')));assert.equal(await guest.locator('[data-binding="b"]').textContent(),'Button 0');
  await guest.locator('[data-keyboard="save"]').click();if(await guest.locator('#clientEnablePad').getAttribute('aria-pressed')==='false')await guest.locator('#clientEnableGroup').click();
  await until(()=>writes.filter(w=>w.slot==='p2').at(-1)?.state.buttons.b===true,'custom mapping');
  // Video can come and go without combining or disrupting controller lanes.
  await host.locator('#hostCapture').click();await guest.locator('#clientMediaToggle').click();await guest.waitForFunction(()=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>10);
  await host.locator('#hostStopCapture').click();assert.equal(await guest.locator('#clientEnablePad').getAttribute('aria-pressed'),'true');
  await guest.locator('#clientEnableGroup').click();await until(()=>['p1','p2','p3'].every(slot=>{const state=writes.filter(w=>w.slot===slot).at(-1)?.state;return state && !Object.values(state.buttons).some(Boolean);}));
  if(native)assert.ok((await snapshot()).every(p=>p.buttons===0));
  // Responsive setup cards must stay inside their columns, including after disconnect.
  await fs.mkdir('.local/screenshots',{recursive:true});
  await host.screenshot({path:'.local/screenshots/multi-host.png',fullPage:true});await guest.screenshot({path:'.local/screenshots/multi-guest.png',fullPage:true});
  for(const width of [390,860,1280]){await guest.setViewportSize({width,height:850});assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await guest.locator('#clientDisconnect').click();await until(()=>app.rooms.values().next().value.peers.size===0);
  await guest.setViewportSize({width:1280,height:950});await pair();await guest.locator('#clientEnableGroup').click();await press();await until(()=>writes.filter(w=>w.slot==='p3').at(-1)?.state.buttons.x);
  await host.locator('#hostEnd').click();await guest.waitForFunction(()=>document.querySelector('#clientEnableGroup').disabled);
  assert.equal(await host.locator('#hostControllerCount').isDisabled(),false);assert.deepEqual(errors,[]);
  console.log('PASS: unplug/duplicate prevention, per-device remapping, independent video, group pause, mobile sizing, fresh session/reconnect and end-session release');
}finally{await browser?.close();await app.close();}
