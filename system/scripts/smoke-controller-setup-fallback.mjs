import {launchTestBrowser} from './browser-fixture.mjs';
// Driver/setup failures are fixtures. Never accesses physical controllers or installs drivers.
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {PassThrough} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {GuestInputService} from '../src/guest-input.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const cases=[{name:'missing native reader',platform:'win32',reader:false},{name:'missing HidHide',platform:'win32',reader:true,notes:['HidHide is not available.']},{name:'Linux device permissions',platform:'linux',reader:true},{name:'macOS device permissions',platform:'darwin',reader:true},{name:'host binding failure',platform:'win32',reader:false,hostError:true}];
try{for(const fixture of cases.filter(value=>!process.env.TEST_CONTROLLER_CASE || value.name===process.env.TEST_CONTROLLER_CASE)){
  const writes=[],errors=[],slots=new Set();let starts=0;
  const service=new GuestInputService({capability:{available:fixture.reader,platform:fixture.platform},launch(){
    const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null});
    child.kill=()=>{if(child.exitCode!==null)return;child.exitCode=0;child.emit('exit',0);};child.stdin.on('finish',child.kill);const say=v=>child.stdout.write(JSON.stringify(v)+'\n');
    const inventory=()=>say({type:'devices',devices:[{id:'pad:4',kind:'gamepad',label:'PS4 Controller',available:false}],notes:fixture.notes || []});
    let buffer='';child.stdin.on('data',part=>{buffer+=part;for(let end;(end=buffer.indexOf('\n'))>=0;){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(message.type==='list')inventory();if(message.type==='start')starts++;}});
    queueMicrotask(()=>{inventory();say({type:'ready'});});return child;
  }});
  const hostError='Host controller support (vigemclient) is missing. Repair it on the HOST computer. The guest does not need this package.';
  const hostApp=createApp({env:{},createInjector:async()=>{if(fixture.hostError)throw Error(hostError);return {name:'Recording controller',addController(slot){slots.add(slot);},removeController(slot){slots.delete(slot);},setState(slot,value){writes.push(value);},close(){slots.clear();}};}});
  const guestApp=createApp({env:{},platform:fixture.platform,guestInputService:service});let context;
  try{
    for(const app of [hostApp,guestApp]){app.server.listen(0,'127.0.0.1');await once(app.server,'listening');}
    context=await browser.newContext({viewport:{width:1280,height:900}});context.setDefaultTimeout(15000);
    await context.route('**/ice?*',r=>r.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
    await context.addInitScript(()=>{for(const side of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${side}`,'seen');localStorage.setItem('webrtc-pad:capture-method','browser');window.pad={id:'PS4 Controller',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};navigator.getGamepads=()=>[window.pad];navigator.mediaDevices.getDisplayMedia=()=>{throw Error('Video must not be requested');};});
    const host=await context.newPage(),guest=await context.newPage();for(const page of [host,guest])page.on('pageerror',e=>errors.push(e.message));
    await host.goto(`http://127.0.0.1:${hostApp.server.address().port}`);await guest.goto(`http://127.0.0.1:${guestApp.server.address().port}/?mode=join`);
    await guest.locator('#clientPrepareControllers').click();await guest.waitForFunction(()=>document.querySelector('#controllerSetup').dataset.inputMode==='browser' && document.querySelector('#nativeGuestRecovery').textContent.includes('Controllers are using browser input'));
    await guest.locator('#controllerAdvanced').evaluate(el=>el.open=true);await guest.locator('#clientJoinControllers').uncheck();
    if(fixture.platform==='linux'){await guest.evaluate(()=>window.pad.buttons[0]={pressed:true,value:1});await guest.waitForTimeout(50);await guest.evaluate(()=>window.pad.buttons[0]={pressed:false,value:0});await guest.waitForFunction(()=>document.querySelector('#connectedControllers .controller-use-status').textContent==='Ready to join');}
    else await guest.getByRole('button',{name:'Select PS4 Controller',exact:true}).click();
    assert.equal(await guest.getByRole('button',{name:'Select PS4 Controller',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await guest.locator('#clientJoinControllers').isChecked(),true);
    await host.locator('#hostCreate').click();await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
    await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
    await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});
    if(fixture.hostError){
      await host.waitForFunction(()=>document.querySelector('#peerList').textContent.includes('Host controller setup needed'));
      await guest.waitForFunction(()=>document.querySelector('#clientControllerError').textContent.includes('vigemclient') && !document.querySelector('#clientControllerError').hidden);
      await guest.locator('#controllersSheet').evaluate(el=>el.open=true);assert.equal(await guest.locator('#clientControllerError').isVisible(),true);assert.equal(slots.size,0);
      await guest.waitForTimeout(700);assert.match(await guest.locator('#connectedControllers').textContent(),/Host controller setup needed/);
      assert.equal(await guest.locator('#clientStageTitle').textContent(),'Host controller setup needed');
    }else{
      await guest.waitForFunction(()=>document.querySelector('#connectedControllers [data-in-use=true]'));
      assert.equal(slots.size,1,'Explicit preselection joins without a fresh button press or native driver');
      await guest.evaluate(()=>window.pad.buttons[1]={pressed:true,value:1});const deadline=Date.now()+6000;while(!writes.some(s=>s.buttons.b)){if(Date.now()>deadline)throw Error('Browser fallback did not deliver input');await new Promise(r=>setTimeout(r,20));}
      await guest.locator('#controllersSheet').evaluate(el=>el.open=true);await guest.getByRole('button',{name:'Stop using PS4 Controller',exact:true}).click();await guest.waitForFunction(()=>!document.querySelector('#connectedControllers [data-in-use=true]'));
      await guest.getByRole('button',{name:'Select PS4 Controller',exact:true}).click();await guest.waitForFunction(()=>document.querySelector('#connectedControllers [data-in-use=true]'));
    }
    assert.equal(starts,0,'Unavailable isolation must never be attempted');assert.equal(await guest.locator('#clientVideo').evaluate(el=>el.srcObject===null),true);
    assert.deepEqual(errors,[]);console.log(`PASS: ${fixture.name}: selected controller survives connection; automatic browser fallback, clear local-input notice, and explicit host error reporting.`);
  }catch(error){console.log('Failed case:',fixture.name,'Native starts:',starts,'Slots:',[...slots],'Browser errors:',errors);for(const page of context?.pages() || [])console.log(await page.evaluate(()=>({mode:document.body.dataset.mode,host:document.querySelector('#hostStatus')?.textContent,guest:document.querySelector('#clientStatus')?.textContent,controllers:document.querySelector('#connectedControllers')?.textContent,input:document.querySelector('#controllerSetup')?.dataset,native:document.querySelector('#nativeGuestStatus')?.textContent,sharing:document.querySelector('#clientEnablePad')?.dataset,group:document.querySelector('#controllerGroupStatus')?.textContent})));throw error;
  }finally{await context?.close();await hostApp.close();await guestApp.close();}
}}finally{await browser.close();}
