import {launchTestBrowser} from './browser-fixture.mjs';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const output=process.env.TEST_CONTROLLER_OUTPUT || 'ds4';
const app=createApp({env:{}}),errors=[];
const before=new Set(JSON.parse((await promisify(execFile)('python',['system/scripts/read-hid-gamepads.py'])).stdout).map(p=>p.index));
const beforeXbox=new Set(JSON.parse((await promisify(execFile)('python',['system/scripts/read-xinput.py'])).stdout).map(p=>p.index));
let browser,reader,xboxReader,latest=[],hidStates=[],xboxStates=[];
function updateNativeStates(){latest=[...hidStates,...xboxStates];}
const until=async(predicate,label='HID state')=>{const end=Date.now()+10000;while(!predicate()){if(Date.now()>end)throw new Error(`${label} timed out: ${JSON.stringify(latest)}`);await new Promise(r=>setTimeout(r,30));}};
try {
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1280,height:950}});
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');
    window.__pads=Array.from({length:8},(_,index)=>({id:['Pro Controller','Generic USB controller','PlayStation controller'][index%3]+` test ${index}`,index,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}));
    Object.defineProperty(navigator,'getGamepads',{value:()=>window.__pads});
  });
  const origin=`http://127.0.0.1:${app.server.address().port}`,host=await context.newPage(),guest=await context.newPage();
  for(const page of [host,guest])page.on('pageerror',e=>errors.push(e.message));
  await host.goto(origin);await guest.goto(origin+'/?mode=join');
  await host.waitForFunction(()=>document.querySelector('#hostControllerOutput').options.length===3);
  if(output!=='auto'){await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostControllerOutput').selectOption(output);}else assert.equal(await host.locator('#hostControllerOutput').inputValue(),'auto');
  await host.locator('#hostCreate').click();await host.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);
  const room=app.rooms.values().next().value;assert.equal(room.controllerType,output);assert.equal(room.createdSlots.size,0);assert.ok(room.injector,room.driverError);
  await guest.evaluate(()=>{window.__pads[7].buttons[0]={pressed:true,value:1};window.__pads[1].axes=[.1,-.15,0,0];});
  await guest.locator('#clientMediaToggle').click();
  await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
  await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
  await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});
  await guest.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.dynamic==='true' && !document.querySelector('#clientEnablePad').disabled);
  await guest.locator('#backgroundGamepad').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#backgroundGamepad').check();await new Promise(r=>setTimeout(r,200));assert.equal(room.createdSlots.size,0,'Idle pads, stick drift and a button held before connecting must not claim players');
  const press=async(index,button=index)=>guest.evaluate(({index,button})=>{window.__pads[index].buttons[button]={pressed:true,value:1};},{index,button});
  const release=async index=>{await guest.evaluate(index=>window.__pads[index].buttons.forEach(b=>{b.pressed=false;b.value=0;}),index);await new Promise(r=>setTimeout(r,50));};
  await press(4);await until(()=>room.createdSlots.size===1,'first press joins one controller');assert.equal(await guest.locator('#clientPadIndex').inputValue(),'4');
  reader=spawn('python',['system/scripts/read-hid-gamepads.py','--watch'],{windowsHide:true,stdio:['ignore','pipe','inherit']});
  createInterface({input:reader.stdout}).on('line',line=>{hidStates=JSON.parse(line).filter(p=>!before.has(p.index) && p.vendor===0x054c && p.product===0x05c4).map(p=>({...p,buttons:(p.buttons&1?4:0)|(p.buttons&2?1:0)|(p.buttons&4?2:0)|(p.buttons&8?8:0)|(p.buttons&16?16:0)|(p.buttons&32?32:0)|(p.buttons&64?64:0)|(p.buttons&128?128:0)}));updateNativeStates();});
  if(output==='auto'){
    xboxReader=spawn('python',['system/scripts/read-xinput.py','--watch'],{windowsHide:true,stdio:['ignore','pipe','inherit']});
    createInterface({input:xboxReader.stdout}).on('line',line=>{xboxStates=JSON.parse(line).filter(p=>!beforeXbox.has(p.index)).map(p=>({...p,x:Math.round((p.lx+32768)*65535/65535),buttons:(p.buttons&0x1000?1:0)|(p.buttons&0x2000?2:0)|(p.buttons&0x4000?4:0)|(p.buttons&0x8000?8:0)|(p.buttons&0x100?16:0)|(p.buttons&0x200?32:0)|(p.lt?64:0)|(p.rt?128:0)}));updateNativeStates();});
  }
  await until(()=>latest.length===1 && latest[0].buttons===16);
  await press(0);await until(()=>room.createdSlots.size===2);assert.match(await guest.locator('.controller-device').first().textContent(),/Pro Controller test 0/);
  await release(7);
  for(const index of [1,2,3,5,6,7]){await press(index);await until(()=>room.createdSlots.size===[4,0,1,2,3,5,6,7].indexOf(index)+1);}
  await until(()=>latest.length===8 && new Set(latest.map(p=>p.buttons)).size===8 && latest.every(p=>p.buttons!==0));
  assert.deepEqual(latest.map(p=>p.buttons).sort((a,b)=>a-b),[1,2,4,8,16,32,64,128]);
  await guest.waitForFunction(()=>[...document.querySelectorAll('.controller-test')].filter(el=>el.id!=='pressJoinStatus').every(el=>el.textContent.includes('Delivered to host')));
  console.log('PASS: no idle device creation; fresh button presses enroll only used controllers in input order; eight real Windows virtual pads receive independent WebRTC input (selected output mode)');
  await host.getByRole('button',{name:'Remove guest controller P2',exact:true}).click();await until(()=>room.createdSlots.size===7);await until(()=>latest.length===7);await guest.waitForFunction(()=>document.querySelector('#pressJoinStatus').textContent.includes('7 joined'));
  await new Promise(r=>setTimeout(r,150));assert.equal(room.createdSlots.size,7,'Holding a host-removed controller button must not immediately reclaim a spot');
  await guest.locator('#leavePrimaryController').click();await until(()=>room.createdSlots.size===6);await until(()=>latest.length===6);
  await release(0);await press(0);await until(()=>room.createdSlots.size===7);assert.ok(room.createdSlots.has('p1'),'A new intentional press reuses the first free player spot');
  await guest.evaluate(()=>{window.__unplugged=window.__pads[5];window.__pads[5]=null;window.dispatchEvent(new Event('gamepaddisconnected'));});await until(()=>room.createdSlots.size===6);await until(()=>latest.length===6);
  await guest.evaluate(()=>{window.__unplugged.buttons.forEach(b=>{b.pressed=false;b.value=0;});window.__pads[5]=window.__unplugged;window.dispatchEvent(new Event('gamepadconnected'));});await new Promise(r=>setTimeout(r,150));assert.equal(room.createdSlots.size,6);await press(5);await until(()=>room.createdSlots.size===7);
  await guest.locator('#clientEnableGroup').click();await until(()=>latest.length===7 && latest.every(p=>p.buttons===0));
  await guest.locator('#clientEnableGroup').click();await new Promise(r=>setTimeout(r,100));assert.equal(room.createdSlots.size,7,'Resume with held buttons must not enroll removed controllers');
  await fs.mkdir('.local/screenshots',{recursive:true});await host.screenshot({path:'.local/screenshots/press-to-join-host.png',fullPage:true});await guest.screenshot({path:'.local/screenshots/press-to-join-guest.png',fullPage:true});
  while(room.createdSlots.size){const old=room.createdSlots.size;await guest.locator('#leavePrimaryController').click();await until(()=>room.createdSlots.size===old-1);}
  await until(()=>latest.length===0);await guest.waitForFunction(()=>document.querySelector('#clientSlot').textContent==='Press a button to join');
  await guest.locator('#joinKeyboardController').click();await until(()=>room.createdSlots.size===1);await guest.locator('#leavePrimaryController').click();await until(()=>room.createdSlots.size===0);
  for(const width of [390,860,1280]){await guest.setViewportSize({width,height:850});assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await host.locator('#hostEnd').click();assert.deepEqual(errors,[]);
  await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostControllerOutput').selectOption('x360');assert.equal(await host.locator('#hostControllerCount option').count(),4);
  console.log('PASS: host/client per-controller removal frees native devices without disconnecting; held-button guard, free-slot reuse, pause, remove-all, keyboard joining and responsive layout');
}finally{reader?.kill();xboxReader?.kill();await browser?.close();await app.close();}
