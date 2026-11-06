import {launchTestBrowser} from './browser-fixture.mjs';
// Real browser/native protocol; simulated reader only, without physical device locks.
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {PassThrough} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {GuestInputService} from '../src/guest-input.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try{for(const platform of ['win32','linux','darwin']){
  let inventory=[],starts=[];const children=[],errors=[];
  const service=new GuestInputService({capability:{available:true,platform},launch(){
    const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null});children.push(child);
    child.say=value=>child.stdout.write(JSON.stringify(value)+'\n');child.kill=()=>{if(child.exitCode!==null)return;child.exitCode=0;child.emit('exit',0);};child.stdin.on('finish',child.kill);
    let buffer='';child.stdin.on('data',part=>{buffer+=part;for(let end;(end=buffer.indexOf('\n'))>=0;){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(message.type==='list')child.say({type:'devices',devices:inventory,notes:[]});if(message.type==='start'){starts.push(message.devices);child.say({type:'active',devices:message.devices});child.say({type:'state',gamepads:inventory.map((d,index)=>({id:d.id+' · '+d.label,index,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))})),keys:[],mouse:{buttons:[]}});}}});
    queueMicrotask(()=>{child.say({type:'devices',devices:inventory,notes:[]});child.say({type:'ready'});});return child;
  }});
  const app=createApp({env:{},platform,guestInputService:service});let context;
  try{
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');context=await browser.newContext({viewport:{width:1280,height:900}});context.setDefaultTimeout(12000);
    await context.addInitScript(()=>{for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');navigator.getGamepads=()=>[];});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=join`);await page.locator('#clientPrepareControllers').click();
    await page.waitForFunction(()=>document.querySelector('#connectedControllers').textContent.includes('Connect a controller'));
    inventory=[{id:'pad:1',kind:'gamepad',label:'PS4 Controller',available:true}];
    await page.waitForFunction(()=>document.querySelector('#connectedControllers [data-controller-id="pad:1"] .controller-map'));
    assert.equal(service.active,true);assert.equal(service.localReservation,true);assert.equal(app.rooms.size,0);
    inventory=[];children.at(-1).say({type:'error',error:platform==='win32'?'A selected controller disconnected. Devices were released. Refresh devices to reconnect.':'A selected device disconnected. Devices released; refresh before reconnecting.'});children.at(-1).kill();
    await page.waitForFunction(()=>!document.querySelector('#connectedControllers [data-controller-id="pad:1"]'));
    inventory=[{id:'pad:29',kind:'gamepad',label:'PS4 Controller',available:true}];
    await page.waitForFunction(()=>document.querySelector('#connectedControllers [data-controller-id="pad:29"] .controller-map'));
    assert.equal(service.active,true,'Controller blocking resumes after physical reconnection');assert.ok(starts.some(ids=>ids.includes('pad:29')));assert.ok(starts.every(ids=>ids.every(id=>id.startsWith('pad:'))),'Auto reconnect never seizes a keyboard/mouse');
    await page.locator('#controllerAdvanced').evaluate(el=>el.open=true);await page.locator('#nativeGuestBlockLocal').uncheck();await page.waitForTimeout(2300);assert.equal(!!service.active,false,'Turning blocking off prevents reacquisition');
    assert.deepEqual(errors,[]);console.log(`PASS: ${platform} idle discovery, hot-unplug, fresh native ID, card/test/map restoration, controller-only blocking recovery, explicit opt-out.`);
  }finally{await context?.close();await app.close();}
}}finally{await browser.close();}
