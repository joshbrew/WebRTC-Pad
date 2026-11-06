import {launchTestBrowser} from './browser-fixture.mjs';
// Real browser/WebRTC allocation regression; recording output, no OS devices.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const devices=new Set(), writes=new Map(), errors=[];
const app=createApp({env:{},platform:'win32',createInjector:async({playerCount})=>{
  assert.equal(playerCount,0);
  return {name:'Recording adaptive pads',addController(slot){devices.add(slot);},removeController(slot){devices.delete(slot);writes.delete(slot);},setState(slot,state){assert.ok(devices.has(slot));writes.set(slot,state);},close(){devices.clear();}};
}});
const until=async(predicate,label)=>{const end=Date.now()+20000;while(!predicate()){if(Date.now()>end)throw new Error(`Timed out: ${label}; ${devices.size} devices`);await new Promise(r=>setTimeout(r,30));}};
let browser;
try {
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1280,height:950}});
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');
    window.__pads=Array.from({length:71},(_,index)=>({id:`Generic test controller ${index}`,index,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}));
    Object.defineProperty(navigator,'getGamepads',{value:()=>window.__pads});
  });
  const origin=`http://127.0.0.1:${app.server.address().port}`,host=await context.newPage(),guest=await context.newPage();
  for(const page of [host,guest])page.on('pageerror',e=>errors.push(e.message));
  await host.goto(origin);await guest.goto(origin+'/?mode=join');
  await host.waitForFunction(()=>document.querySelector('#hostControllerOutput').options.length===3);
  assert.match(await host.locator('#playerCountInfo').textContent(),/Players are added as controllers join/);
  assert.doesNotMatch(await host.locator('#playerCountInfo').textContent(),/Manual setup|4 remote/);
  await host.locator('#hostCreate').click();await host.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);
  const room=app.rooms.values().next().value;
  assert.equal(room.controllerLimit,null);assert.equal(room.slots.length,0);assert.equal(devices.size,0);
  await guest.locator('#clientMediaToggle').click();
  await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
  await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});
  await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
  await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});
  await guest.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.dynamic==='true' && !document.querySelector('#clientEnablePad').disabled);
  await guest.locator('#backgroundGamepad').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#backgroundGamepad').check();await new Promise(r=>setTimeout(r,200));assert.equal(devices.size,0);
  await guest.evaluate(()=>window.__pads.slice(0,70).forEach(p=>p.buttons[0]={pressed:true,value:1}));
  await until(()=>devices.size===70,'70 fresh controllers enrolled');
  await until(()=>writes.get('p70')?.buttons.a,'input delivered to P70');
  await host.waitForFunction(()=>document.querySelector('#hostSlotSummary').textContent==='70 controllers joined');
  await guest.waitForFunction(()=>document.querySelector('#clientSlot').textContent.includes('P70'));
  await host.getByRole('button',{name:'Remove guest controller P65',exact:true}).click();
  await until(()=>devices.size===69 && !devices.has('p65'),'host removal');
  await new Promise(r=>setTimeout(r,250));assert.equal(devices.size,69,'Held button must not reclaim removed slot');
  await guest.evaluate(()=>window.__pads[70].buttons[1]={pressed:true,value:1});
  await until(()=>devices.size===70 && writes.get('p65')?.buttons.b,'new controller reuses P65 with independent state');
  assert.equal(room.slots.length,70);assert.equal(writes.get('p70').buttons.a,true);
  await guest.locator('#leavePrimaryController').click();await until(()=>devices.size===69,'guest removal');
  for(const width of [390,860,1280]){await host.setViewportSize({width,height:850});await guest.setViewportSize({width,height:850});for(const page of [host,guest])assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await host.locator('#hostEnd').click();await until(()=>devices.size===0,'session cleanup');
  assert.deepEqual(errors,[]);
  console.log('PASS: zero idle reservations; 70 browser controllers enroll and route independent WebRTC input; host/guest removal, held-button guard, free-slot reuse, responsive layout and session cleanup (recording output)');
} finally {await browser?.close();await app.close();}
