import {launchTestBrowser} from './browser-fixture.mjs';
// Generated controllers and loopback WebRTC only; never opens physical inputs.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const errors=[],writes=[];
const app=createApp({env:{},createInjector:async()=>({name:'Invite reuse fixture',addController(){},removeController(){},setState(slot,state){writes.push({slot,state});},close(){}})});
let browser;
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1366,height:900}});context.setDefaultTimeout(15000);
  await context.route('**/ice?*',r=>r.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.addInitScript(()=>{
    for(const side of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${side}`,'seen');
    localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text;}}});
    window.pads=['PS4 Controller','Pro Controller','Generic controller'].map((id,index)=>({id,index,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}));
    navigator.getGamepads=()=>window.pads;
    window.offers=0;const offer=RTCPeerConnection.prototype.createOffer;
    RTCPeerConnection.prototype.createOffer=function(...args){window.offers++;return offer.apply(this,args);};
  });
  const host=await context.newPage(),one=await context.newPage(),two=await context.newPage(),origin=`http://127.0.0.1:${app.server.address().port}`;
  for(const page of [host,one,two])page.on('pageerror',e=>errors.push(e.message));
  await host.goto(origin);for(const guest of [one,two])await guest.goto(origin+'/?mode=join');
  await one.locator('#clientPrepareControllers').click();
  assert.equal(await one.locator('#clientJoinControllers').isVisible(),false,'Global sharing switch belongs in Advanced');
  await one.getByRole('button',{name:'Select PS4 Controller',exact:true}).click();
  assert.equal(await one.getByRole('button',{name:'Select PS4 Controller',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await one.getByRole('checkbox',{name:/Join with/}).count(),0,'Selection has one visible action per device');
  await one.getByRole('button',{name:'Map PS4 Controller',exact:true}).click();await one.locator('[data-keyboard=close]').click();
  await one.getByRole('button',{name:'Close controllers',exact:true}).click();
  await host.locator('#hostCreate').click();await host.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);
  const room=()=>[...app.rooms.values()][0];
  await host.evaluate(()=>Promise.all([document.querySelector('#createInvitationText').onclick(),document.querySelector('#createInvitation').onclick()]));await host.waitForFunction(()=>!!window.copied);
  const first=await host.evaluate(()=>window.copied),firstPacket=JSON.parse(first);
  assert.equal(room().peers.size,1);
  assert.equal(await host.evaluate(()=>window.offers),1);
  // Copy and download repeatedly, in either order, without allocating peers.
  const download=host.waitForEvent('download');await host.locator('#createInvitation').click();
  assert.equal(await fs.readFile(await (await download).path(),'utf8'),first);
  await host.evaluate(()=>{window.copied=null;});await host.locator('#createInvitationText').click();await host.waitForFunction(()=>!!window.copied);
  assert.equal(await host.evaluate(()=>window.copied),first);
  assert.equal(room().peers.size,1);assert.equal(await host.evaluate(()=>window.offers),1);
  await host.evaluate(()=>{window.copyWrite=navigator.clipboard.writeText;navigator.clipboard.writeText=async()=>{throw Error('Clipboard permission denied');};});
  await host.locator('#createInvitationText').click();
  assert.equal(await host.locator('#hostInvitation').isVisible(),true,'Clipboard denial reveals the existing text for manual copying');
  assert.equal(await host.locator('#hostInvitation').inputValue(),first);
  assert.equal(await host.locator('#hostInvitation').evaluate(el=>el.selectionEnd-el.selectionStart),first.length);
  await host.evaluate(()=>navigator.clipboard.writeText=window.copyWrite);
  // Changing the next guest's access cannot silently replace this invite.
  await host.locator('#invitationRole').selectOption('watch');await host.locator('#createInvitationText').click();
  assert.equal(await host.evaluate(()=>window.copied),first);
  const pendingDownload=host.waitForEvent('download',{timeout:400}).then(()=>true,()=>false);
  await host.locator('#newInvitation').click();await host.waitForFunction(id=>JSON.parse(document.querySelector('#hostInvitation').value).pairingId!==id,firstPacket.pairingId);
  assert.equal(await pendingDownload,false,'New invite prepares a draft without choosing its delivery method');
  const second=await host.locator('#hostInvitation').inputValue();assert.equal(room().peers.size,2);
  await host.locator('#createInvitationText').click();assert.equal(await host.evaluate(()=>window.copied),second);
  const secondDownload=host.waitForEvent('download');await host.locator('#createInvitation').click();assert.equal(await fs.readFile(await (await secondDownload).path(),'utf8'),second);
  assert.equal(await host.evaluate(()=>window.offers),2);
  await fs.mkdir('.local/screenshots',{recursive:true});await host.screenshot({path:'.local/screenshots/invite-reusable-options.png'});
  // Accept both pending replies, including the older invite.
  for(const [guest,packet] of [[two,second],[one,first]]){
    await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.json',mimeType:'application/json',buffer:Buffer.from(packet)});
    await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
    await host.locator('#hostReplyFile').setInputFiles({name:'reply.json',mimeType:'application/json',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});
    await guest.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Connected');
    if(guest===two){await host.waitForFunction(()=>document.querySelector('#hostNextAction').textContent==='Open reply file');assert.equal(await host.locator('#hostNextStep').isVisible(),true,'Connecting the newest invite cannot hide an older pending reply');await host.locator('#showHelp').click();await host.waitForFunction(()=>!!document.querySelector('.tour-target')?.closest('#hostReplyStep'));await host.locator('#helpDone').click();}
    if(guest===one)await one.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.joined==='1');
  }
  await host.waitForFunction(()=>document.querySelector('#hostNextStep').classList.contains('call-step-complete'));
  assert.equal(room().peers.size,2);assert.equal(await two.locator('#clientEnablePad').getAttribute('data-can-play'),'false','New invite uses the new access setting');
  await one.evaluate(()=>window.pads[0].buttons[0]={pressed:true,value:1});
  await one.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.joined==='1');
  await one.locator('#clientControlsFocus').click();await one.getByRole('button',{name:'Select Pro Controller',exact:true}).click();
  await one.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.joined==='2');
  await one.getByRole('button',{name:'Stop using PS4 Controller',exact:true}).click();await one.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.joined==='1');
  await one.getByRole('button',{name:'Select PS4 Controller',exact:true}).click();await one.waitForFunction(()=>document.querySelector('#clientEnablePad').dataset.joined==='2');
  await one.screenshot({path:'.local/screenshots/guest-simple-controller-cards.png'});
  await host.locator('#hostInviteSheet').evaluate(el=>el.open=false);await host.screenshot({path:'.local/screenshots/host-controller-only-call.png'});
  // A used invite must not create another connection through an export action.
  const offers=await host.evaluate(()=>window.offers);await host.evaluate(()=>document.querySelector('#createInvitation').onclick());
  assert.equal(await host.evaluate(()=>window.offers),offers);assert.equal(room().peers.size,2);
  await host.locator('#inviteFocus').click();await host.locator('#newInvitation').click();
  await host.waitForFunction(()=>!document.querySelector('#downloadInvitation').disabled);
  const expired=JSON.parse(await host.locator('#hostInvitation').inputValue());
  await host.evaluate(expires=>{window.realNow=Date.now;Date.now=()=>expires+1;},expired.expiresAt);
  await host.waitForFunction(()=>document.querySelector('#hostNextAction').textContent==='New invite');
  assert.equal(await host.locator('#createInvitation').isVisible(),false,'An expired invite cannot be exported as a fresh invitation');
  assert.equal(await one.locator('#clientConnectionText').textContent(),'Connected','Expiring an unused invite keeps existing calls connected');
  await host.locator('#showHelp').click();await host.waitForFunction(()=>document.querySelector('#newInvitation').classList.contains('tour-target'));await host.locator('#helpDone').click();
  await host.evaluate(()=>Date.now=window.realNow);await host.keyboard.press('Escape');await host.locator('#hostNextAction').click();
  await host.waitForFunction(id=>{const text=document.querySelector('#hostInvitation').value;return text && JSON.parse(text).pairingId!==id;},expired.pairingId);
  await host.keyboard.press('Escape');await host.locator('#hostEnd').click();await host.waitForFunction(()=>!document.querySelector('#hostCreate').disabled);
  await host.locator('#hostCreate').click();await host.waitForFunction(()=>document.querySelector('#hostPanel').dataset.session==='active' && document.querySelector('#hostInviteSheet').open && !document.querySelector('#createInvitation').disabled);assert.equal(await host.locator('#createInvitation').isVisible(),true,'A new session restores invite exports after a consumed or expired invite');
  await host.locator('#createInvitationText').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
  assert.equal(room().peers.size,1);
  await two.locator('#clientInvitationFile').setInputFiles({name:'viewer.json',mimeType:'application/json',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});
  await two.waitForFunction(()=>!!document.querySelector('#clientReply').value);
  await host.locator('#hostReplyFile').setInputFiles({name:'reply.json',mimeType:'application/json',buffer:Buffer.from(await two.locator('#clientReply').inputValue())});
  await two.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Connected');
  await host.waitForFunction(()=>document.querySelector('#hostNextStep').classList.contains('call-step-complete'));
  assert.equal(await host.locator('#hostNextStep').isVisible(),false,'Viewer-only sessions do not ask for controller setup');
  assert.equal(await host.locator('#hostControllerSummary').isVisible(),false,'Viewer-only sessions do not show an empty gamepad count');
  assert.equal(await host.locator('#hostPeopleCard > details.advanced').isVisible(),false,'Gamepad troubleshooting is shown only when relevant');
  assert.match(await host.locator('#peerList').textContent(),/Guest 1/,'Guest numbering starts again in a new session');
  await host.locator('#showHelp').click();await host.waitForFunction(()=>document.querySelector('#tourTitle').textContent==='Your guests are connected');await host.locator('#helpDone').click();
  await host.screenshot({path:'.local/screenshots/host-viewers-call.png'});
  for(const page of [host,one])for(const width of [320,390,1366]){await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  assert.deepEqual(errors,[]);
  console.log('PASS: identical file/text invites; exports reuse one ICE offer and one peer; explicit New invite; access for next invite; concurrent exports; clipboard recovery; expiry and matching guide; session restart; two pending replies; selected controllers auto-join; add/remove/rejoin from one card; no video needed; mobile bounds.');
}finally{await browser?.close();await app.close();}
