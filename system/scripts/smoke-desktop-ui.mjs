import {launchTestBrowser} from './browser-fixture.mjs';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/server.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const dynamic=process.env.DYNAMIC_CONTROLLERS==='1';
const writes=[], events=[], errors=[]; let started=0, closed=0;
const desktop = Object.assign(new EventEmitter(),{display:{width:1920,height:1080},setState(state){writes.push(state);},event(value){events.push(value);},close(){closed++;}});
const app=createApp({env:{},createInjector:async()=>({name:'Desktop UI fixture',setState(){},close(){}}),createDesktop:async()=>{started++;return desktop;}});
const until=async predicate=>{const end=Date.now()+6000;while(!predicate()){if(Date.now()>end)throw new Error('Desktop state did not arrive');await new Promise(r=>setTimeout(r,20));}};
let browser;
try {
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1280,height:1000}});
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');});
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const host=await context.newPage();host.on('pageerror',e=>errors.push(e.message));await host.goto(origin);
  if(!dynamic){await host.waitForFunction(()=>document.querySelector('#hostControllerOutput option[value="x360"]'));await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostControllerOutput').selectOption('x360');await host.waitForFunction(()=>document.querySelector('#hostControllerCount').options.length>=2);await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostDynamicControllers').uncheck();await host.locator('#hostControllerCount').selectOption('2');}
  await host.locator('#hostCreate').click();await host.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);
  await host.locator('#hostSettings').evaluate(el=>el.open=true);
  await host.locator('#hostGuestSettings').evaluate(el=>el.querySelectorAll('details').forEach(detail=>detail.open=true));
  assert.equal(await host.locator('#hostDesktopMouse').isChecked(),false);assert.equal(await host.locator('#hostDesktopKeyboard').isChecked(),false);assert.equal(started,0);
  assert.match(await host.locator('#hostInputCaution').textContent(),/CAUTION/);
  host.on('dialog',dialog=>dialog.accept());await host.locator('#hostDesktopScope').selectOption('desktop');await host.locator('#hostDesktopMouse').check();await host.locator('#hostDesktopKeyboard').check();
  await until(()=>started===1);
  async function join(){
    const old=await host.locator('#hostInvitation').inputValue();await host.locator(old?'#newInvitation':'#createInvitation').click();await host.waitForFunction(old=>document.querySelector('#hostInvitation').value&&document.querySelector('#hostInvitation').value!==old,old);
    const guest=await context.newPage();guest.on('pageerror',e=>errors.push(e.message));guest.on('dialog',dialog=>dialog.accept());await guest.goto(`${origin}/?mode=join`);
    await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});
    await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
    await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});
    await guest.waitForFunction(()=>!document.querySelector('#clientDesktopMouse').disabled);
    await guest.locator('#clientDesktopMouse').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});
    await guest.locator('#clientDesktopMouse').check();await guest.waitForFunction(()=>document.querySelector('#clientStage').classList.contains('mouse-pad'));
    assert.match(await guest.locator('#clientDesktopNote').textContent(),/1920 × 1080/);
    return guest;
  }
  const first=await join(),second=await join();
  await first.bringToFront();await first.locator('#clientStage').scrollIntoViewIfNeeded();
  const moves=await first.evaluate(()=>{
    const stage=document.querySelector('#clientStage'),box=stage.getBoundingClientRect(),sent=[],original=RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send=function(data){if(this.label==='desktop' && typeof data==='string'){const packet=JSON.parse(data);if(packet.type==='desktop-move')sent.push(packet);}return original.call(this,data);};
    try{for(const x of [.2,.21,.22])stage.dispatchEvent(new PointerEvent('pointermove',{clientX:box.x+box.width*x,clientY:box.y+box.height*.5,bubbles:true}));}finally{RTCDataChannel.prototype.send=original;}
    return sent;
  });
  assert.equal(moves.length,3,'Fresh browser mouse positions must send immediately, including the final position inside a 15 ms burst');
  async function point(page,x,y){await page.bringToFront();await page.locator('#clientStage').scrollIntoViewIfNeeded();const box=await page.locator('#clientStage').boundingBox();await page.mouse.move(box.x+box.width*x,box.y+box.height*y);return box;}
  await point(first,.25,.6);await first.mouse.down();await until(()=>writes.some(s=>s.buttons.includes(0)&&Math.abs(s.x-.25)<.03&&Math.abs(s.y-.6)<.03));
  await first.mouse.up();await until(()=>writes.at(-1).buttons.length===0);
  await first.mouse.wheel(0,120);await until(()=>events.some(e=>e.event==='wheel'&&e.dy>0));
  if(dynamic)await first.locator('#clientDesktopTyping').check();else {await first.locator('#inputSource').selectOption('desktop');await first.locator('#clientEnablePad').click();}await first.locator('#clientStage').focus();
  await first.keyboard.down('a');await until(()=>writes.at(-1).keys.includes('KeyA'));await first.keyboard.up('a');await until(()=>!writes.at(-1).keys.includes('KeyA'));
  await first.keyboard.down('b');await until(()=>writes.at(-1).keys.includes('KeyB'));await first.evaluate(()=>window.dispatchEvent(new Event('blur')));await until(()=>writes.at(-1).keys.length===0);await first.keyboard.up('b');
  await point(first,.3,.4);await second.waitForFunction(()=>!!document.querySelector('#clientStage .guest-cursor:not([hidden])'));
  assert.equal(await second.locator('#clientStage .guest-cursors').evaluate(el=>el.classList.contains('labels-on')),false);
  await host.locator('#hostCursorLabels').check();await second.waitForFunction(()=>document.querySelector('#clientStage .guest-cursors').classList.contains('labels-on'));
  await host.locator('#hostCursorLabels').uncheck();await second.waitForFunction(()=>!document.querySelector('#clientStage .guest-cursors').classList.contains('labels-on'));
  await point(second,.7,.6);await host.waitForFunction(()=>document.querySelectorAll('#hostStage .guest-cursor').length>=2);
  const colors=await host.locator('#hostStage .guest-cursor').evaluateAll(elements=>elements.map(el=>el.style.getPropertyValue('--cursor-color')));assert.equal(new Set(colors).size,2);
  desktop.display={width:1280,height:1024};desktop.emit('display',desktop.display);
  await first.waitForFunction(()=>document.querySelector('#clientDesktopNote').textContent.includes('1280 × 1024'));
  await first.setViewportSize({width:800,height:900});await point(first,.8,.2);await until(()=>writes.some(s=>Math.abs(s.x-.8)<.03&&Math.abs(s.y-.2)<.03));
  await first.locator('#clientFullscreen').click();await first.waitForFunction(()=>document.fullscreenElement?.id==='clientStage');
  await first.evaluate(()=>document.exitFullscreen());
  await host.locator('#hostStopDesktop').click();await first.waitForFunction(()=>document.querySelector('#clientDesktopMouse').disabled);await until(()=>closed===1);
  assert.deepEqual(errors,[]);
  console.log(`Mode: ${dynamic?'press-to-join with no controller slots':'manual reservation'}`);console.log('PASS: default-off host/guest consent; real RTC mouse pad without video; click/scroll/typing/focus release; display resize/fullscreen; distinct colored cursors and host label toggle; explicit revoke');
} finally {await browser?.close();await app.close();}
