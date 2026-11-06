import {launchTestBrowser} from './browser-fixture.mjs';
// Real loopback WebRTC and native-reader protocol; no hardware, drivers or capture.
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {PassThrough} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {GuestInputService} from '../src/guest-input.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try{for(const platform of ['win32','linux','darwin']){
  const errors=[],writes=[],slots=new Set();let child,started=false,buttons=false,extraButton=false,streaming=false;
  const inventory=[{id:'pad:4',kind:'gamepad',label:'PS4 Controller',available:true},{id:'pad:7',kind:'gamepad',label:'Pro Controller',available:true}];
  const state=()=>child?.say({type:'state',gamepads:inventory.map((device,index)=>({id:`${device.id} · ${device.label}`,index,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},(_,i)=>({pressed:buttons && i===0 || extraButton && i===1,value:buttons && i===0 || extraButton && i===1?1:0}))})),keys:[],mouse:{buttons:[]}});
  const service=new GuestInputService({capability:{available:true,platform},launch(){
    child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null});
    child.say=value=>child.stdout.write(JSON.stringify(value)+'\n');child.kill=()=>{if(child.exitCode!==null)return;child.exitCode=0;child.emit('exit',0);};child.stdin.on('finish',child.kill);
    let buffer='';child.stdin.on('data',part=>{buffer+=part;for(let end;(end=buffer.indexOf('\n'))>=0;){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(message.type==='list')child.say({type:'devices',devices:inventory});if(message.type==='start'){started=true;child.say({type:'active',devices:message.devices});}if(message.type==='heartbeat' && streaming)state();}});
    queueMicrotask(()=>{child.say({type:'devices',devices:inventory});child.say({type:'ready'});});return child;
  }});
  const hostApp=createApp({env:{},createInjector:async()=>({name:'Recording controllers',addController(slot){slots.add(slot);},removeController(slot){slots.delete(slot);},setState(slot,value){writes.push({slot,value});},close(){slots.clear();}})});
  const guestApp=createApp({env:{},platform,guestInputService:service});let context;
  try{
    for(const app of [hostApp,guestApp]){app.server.listen(0,'127.0.0.1');await once(app.server,'listening');}
    context=await browser.newContext({viewport:{width:1366,height:900}});context.setDefaultTimeout(15000);
    await context.route('**/ice?*',r=>r.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
    await context.addInitScript(()=>{for(const side of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${side}`,'seen');localStorage.setItem('webrtc-pad:capture-method','browser');navigator.getGamepads=()=>[];navigator.mediaDevices.getDisplayMedia=()=>{throw new Error('Capture must not be needed');};});
    const host=await context.newPage(),guest=await context.newPage();for(const page of [host,guest])page.on('pageerror',e=>errors.push(e.message));
    await host.goto(`http://127.0.0.1:${hostApp.server.address().port}`);await guest.goto(`http://127.0.0.1:${guestApp.server.address().port}/?mode=join`);
    await guest.locator('#clientPrepareControllers').click();await guest.getByRole('button',{name:'Select PS4 Controller',exact:true}).click();
    assert.equal(started,true);assert.equal(streaming,false,'Native reservation is ready before its first input packet');
    await host.locator('#hostCreate').click();await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
    assert.equal(await host.locator('#hostExtraShares').evaluate(el=>el.hidden),true,'Add another screen is hidden until the first video share');
    await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
    await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});await guest.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.ready==='true');
    await host.waitForFunction(()=>document.querySelector('#peerList').textContent.includes('2 controllers detected · not joined'));assert.equal(slots.size,0);
    streaming=true;state();
    await guest.waitForFunction(()=>document.querySelector('[data-controller-id="pad:4"]').dataset.inUse==='true');
    await host.waitForFunction(()=>document.querySelector('.guest-controller').textContent.includes('PS4 Controller'));assert.equal(slots.size,1,'Only the preselected native pad claims a spot after delayed readiness');
    buttons=true;state();await host.waitForFunction(()=>document.querySelectorAll('.guest-controller').length===2);
    const deadline=Date.now()+6000;while(!writes.some(w=>w.value.buttons.a)){if(Date.now()>deadline)throw new Error('Native input was not delivered without video');await new Promise(r=>setTimeout(r,20));}
    await guest.locator('#controllersSheet').evaluate(el=>el.open=true);await guest.getByRole('button',{name:'Stop using PS4 Controller',exact:true}).click();
    await guest.waitForFunction(()=>document.querySelectorAll('#connectedControllers [data-in-use=true]').length===1);await guest.waitForTimeout(700);assert.equal(slots.size,1,'Preselection never reclaims a removed controller');
    extraButton=true;state();await guest.waitForFunction(()=>document.querySelectorAll('#connectedControllers [data-in-use=true]').length===2);
    assert.equal(await guest.locator('#clientVideo').evaluate(el=>el.srcObject===null),true);assert.deepEqual(errors,[]);
    console.log(`PASS: ${platform} native controller-only call, detected status, delayed preselection, multi-pad button joining, delivered input, removal stays removed, fresh button rejoins while another stays held.`);
  }finally{await context?.close();await hostApp.close();await guestApp.close();}
}}finally{await browser.close();}
