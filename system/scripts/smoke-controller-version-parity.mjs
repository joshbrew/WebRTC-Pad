import {launchTestBrowser} from './browser-fixture.mjs';
// Compares supplied working-version sources with current sources using fake pads and output.
// Prepare .local/controller-regression from the user-provided archive before running.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {GuestInputService} from '../src/guest-input.js';
const old=await import('../../.local/controller-regression/system/src/server.js');
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try{for(const [name,factory,guestFactory=factory] of [['attached working ZIP',old.createApp],['current',createApp],['working host + current guest',old.createApp,createApp],['current host + working guest',createApp,old.createApp]]){
  const writes=[],slots=new Set(),errors=[];
  const service=new GuestInputService({capability:{available:false,platform:'win32'},launch:()=>assert.fail('No native reader needed')});
  const app=factory({env:{},guestInputService:service,createInjector:async()=>({name:'Recording gamepads',addController(slot){slots.add(slot);},removeController(slot){slots.delete(slot);},setState(slot,state){writes.push({slot,state});},close(){slots.clear();}})});
  const guestApp=guestFactory===factory?app:guestFactory({env:{},guestInputService:new GuestInputService({capability:{available:false,platform:'win32'},launch:()=>assert.fail('No native reader needed')}),createInjector:async()=>assert.fail('Guest does not create host output')});let context;
  try{
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`;
    if(guestApp!==app){guestApp.server.listen(0,'127.0.0.1');await once(guestApp.server,'listening');}const guestOrigin=`http://127.0.0.1:${guestApp.server.address().port}`;
    context=await browser.newContext({viewport:{width:1366,height:900}});context.setDefaultTimeout(15000);await context.route('**/ice?*',r=>r.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
    await context.addInitScript(()=>{for(const side of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${side}`,'seen');localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');localStorage.setItem('webrtc-pad:capture-method','browser');window.pads=['PS4 Controller','Pro Controller'].map((id,index)=>({id,index,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}));navigator.getGamepads=()=>window.pads;navigator.mediaDevices.getDisplayMedia=()=>{throw Error('Capture should not be needed');};});
    const host=await context.newPage(),guest=await context.newPage();for(const page of [host,guest])page.on('pageerror',e=>errors.push(e.message));await host.goto(origin);await guest.goto(guestOrigin+'/?mode=join');
    await host.locator('#hostCreate').click();await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
    await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
    await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});await guest.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.ready==='true');assert.equal(slots.size,0);
    for(let index=0;index<2;index++){
      await guest.evaluate(index=>window.pads[index].buttons[index]={pressed:true,value:1},index);await guest.waitForFunction(count=>document.querySelectorAll('#connectedControllers [data-in-use=true]').length===count,index+1);
      const deadline=Date.now()+6000;while(!writes.some(w=>w.slot===`p${index+1}` && w.state.buttons[index?'b':'a'])){if(Date.now()>deadline)throw Error('Controller output did not arrive');await new Promise(r=>setTimeout(r,20));}
      await guest.evaluate(index=>window.pads[index].buttons[index]={pressed:false,value:0},index);
    }
    assert.equal(slots.size,2);assert.equal(await guest.locator('#clientVideo').evaluate(el=>el.srcObject===null),true);assert.deepEqual(errors,[]);
    console.log(`PASS: ${name}: two distinct browser controllers press-to-join and deliver correct input without video.`);
  }finally{await context?.close();await app.close();if(guestApp!==app)await guestApp.close();}
}}finally{await browser.close();}
