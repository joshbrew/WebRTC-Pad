import {launchTestBrowser} from './browser-fixture.mjs';
// Real local WebRTC; animated canvas shares and recording controller output.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const writes=[],errors=[];let browser;
const app=createApp({env:{},createInjector:async()=>({name:'Text/views fixture',addController(){},removeController(){},setState(slot,state){writes.push({slot,state});},close(){}})});
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{...(process.env.BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.BROWSER_CHANNEL || 'msedge'}),headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1366,height:950}});context.setDefaultTimeout(20000);let downloads=0;
  await context.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.addInitScript(()=>{
    localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');localStorage.setItem('webrtc-pad:capture-method','browser');
    for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text;}}});
    window.captureCount=0;window.captureStreams=[];
    navigator.mediaDevices.getDisplayMedia=async()=>{
      const n=window.captureCount++,canvas=document.createElement('canvas');canvas.width=n?640:1280;canvas.height=n?480:720;
      const ctx=canvas.getContext('2d');let frame=0;setInterval(()=>{ctx.fillStyle=`hsl(${frame++%360} 80% 30%)`;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#fff';ctx.font='40px sans-serif';ctx.fillText(`View ${n+1} frame ${frame}`,20,60);},16);
      const stream=canvas.captureStream(60);window.captureStreams.push(stream);return stream;
    };
    window.pad={id:'PS4 Controller',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
    Object.defineProperty(navigator,'getGamepads',{value:()=>[window.pad]});
  });
  const host=await context.newPage(),one=await context.newPage(),two=await context.newPage(),origin=`http://127.0.0.1:${app.server.address().port}`;
  for(const page of [host,one,two]){page.on('download',()=>downloads++);page.on('pageerror',error=>errors.push(error.message));}
  await host.goto(origin);for(const guest of [one,two])await guest.goto(origin+'/?mode=join');
  await host.locator('#chooseBrowserSource').click();await host.waitForFunction(()=>document.querySelector('#hostLiveText').textContent==='Private preview');await host.locator('#hostCreate').click();
  async function view(page,id){if(await page.locator('#clientSharedView').inputValue()!==id)await page.getByRole('button',{name:'Next view',exact:true}).click();}
  async function invite(){
    await host.evaluate(()=>{window.copied=null;});await host.locator('#createInvitationText').click();await host.waitForFunction(()=>!!window.copied);
    assert.equal((await host.locator('#createInvitation').textContent()).trim(),'Download invite file');
    return host.evaluate(()=>window.copied);
  }
  console.log('Preparing text invites');const first=await invite();await host.locator('#newInvitation').click();const second=await invite();assert.notEqual(JSON.parse(first).pairingId,JSON.parse(second).pairingId);
  const firstCode=JSON.parse(first).pairingId.slice(0,8),secondCode=JSON.parse(second).pairingId.slice(0,8);
  const pendingInvites=host.locator('#hostPendingInvites');
  await pendingInvites.getByText('Waiting for 2 replies',{exact:true}).click();
  await pendingInvites.getByRole('button',{name:`Use invite ${firstCode}`}).click();
  assert.equal(await invite(),first,'Returning to an earlier invite copies that exact packet');
  await pendingInvites.getByRole('button',{name:`Use invite ${secondCode}`}).click();
  assert.equal(await host.locator('#hostInvitation').inputValue(),second);
  assert.equal(await host.locator('#hostPasteReply').isVisible(),true);assert.equal(await host.locator('#newInvitation').isVisible(),true);
  for(const [guest,packet] of [[two,second],[one,first]]){
    await guest.locator('#joinPasteAction').click();await guest.locator('#clientInvitation').fill(packet);await guest.locator('#createReply').click();
    await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);await guest.locator('#clientReplyAction').click();await guest.waitForFunction(()=>!!window.copied);
    if(guest===two){
      const [replyDownload]=await Promise.all([guest.waitForEvent('download'),guest.locator('#clientReplyAlternate').click()]);
      assert.equal(await fs.readFile(await replyDownload.path(),'utf8'),await guest.evaluate(()=>window.copied),'File and text export the same reply');
    }
    if(!await host.locator('#hostInviteSheet').isVisible())await host.locator('#inviteFocus').click();
    await host.locator('#hostPasteReply').click();await host.locator('#hostReply').fill(await guest.evaluate(()=>window.copied));await host.locator('#acceptReply').click();
    await guest.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Connected');
    if(guest===two){await host.locator('#hostPendingInvitesSummary').getByText('Waiting for 1 reply').waitFor({state:'attached'});assert.equal(await host.locator('#hostPendingInviteList li').count(),1);}
    console.log('Guest connected; waiting for main picture');console.log(await host.locator('#hostStatus').textContent());await guest.waitForFunction(()=>Math.abs(document.querySelector('#clientVideo').videoWidth/document.querySelector('#clientVideo').videoHeight-16/9)<.02 && document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>5);
  }
  assert.equal(await host.locator('#hostPendingInviteList li').count(),0);
  const late=await context.newPage();late.on('pageerror',error=>errors.push(error.message));await late.goto(origin+'/?mode=join');
  if(!await host.locator('#hostInviteSheet').isVisible())await host.locator('#inviteFocus').click();
  await host.locator('#newInvitation').click();const unused=await invite();
  await host.locator('#newInvitation').click();const withdrawn=await invite();
  const withdrawnCode=JSON.parse(withdrawn).pairingId.slice(0,8);
  await late.locator('#joinPasteAction').click();await late.locator('#clientInvitation').fill(withdrawn);await late.locator('#createReply').click();
  await late.waitForFunction(()=>!!document.querySelector('#clientReply').value);
  if(!await pendingInvites.locator('summary').evaluate(el=>el.parentElement.open))await pendingInvites.locator('summary').click();
  await pendingInvites.getByRole('button',{name:`Cancel invite ${withdrawnCode}`}).click();
  assert.equal(await host.locator('#hostInvitation').inputValue(),unused,'Cancelling the selected invite restores the other pending invite');
  await host.locator('#hostPasteReply').click();await host.locator('#hostReply').fill(await late.locator('#clientReply').inputValue());await host.locator('#acceptReply').click();
  assert.match(await host.locator('#hostPairErrorText').textContent(),/invite was cancelled/);
  assert.equal(await host.locator('#hostPendingInviteList li').count(),1);
  const unusedCode=JSON.parse(unused).pairingId.slice(0,8);
  await pendingInvites.getByRole('button',{name:`Cancel invite ${unusedCode}`}).click();
  assert.equal(await pendingInvites.isVisible(),false);
  assert.equal(await host.locator('#newInvitation').isVisible(),true);
  for(const guest of [one,two])assert.equal(await guest.locator('#clientConnectionText').textContent(),'Connected');
  await late.close();
  assert.equal(downloads,1,'Text pairing downloads only when the guest asks for a file');
  await host.locator('#hostCallSettings').click();await host.locator('#hostLiveSource').evaluate(el=>el.open=true);await host.locator('#hostExtraShares').evaluate(el=>el.open=true);await host.locator('#hostAddShare').click();await host.waitForFunction(()=>document.querySelector('#hostExtraSource').checkVisibility() || document.querySelector('.extra-share-row'));if(await host.locator('#hostExtraSource').isVisible())await host.locator('#hostExtraShares').getByRole('button',{name:'Choose with browser…'}).click();console.log('Added extra browser view');
  await one.waitForFunction(()=>document.querySelector('#clientSharedView').options.length===2);
  const extra=await one.locator('#clientSharedView option').nth(1).getAttribute('value');await view(one,extra);
  await one.waitForFunction(()=>Math.abs(document.querySelector('#clientVideo').videoWidth/document.querySelector('#clientVideo').videoHeight-4/3)<.02);
  assert.ok(await two.locator('#clientVideo').evaluate(v=>Math.abs(v.videoWidth/v.videoHeight-16/9)<.02),'Other guests keep their own view');
  await one.evaluate(()=>{window.pad.buttons[0]={pressed:true,value:1};});await one.waitForFunction(()=>document.querySelector('#clientSlot').textContent==='P1');
  await one.waitForTimeout(200);assert.ok(writes.some(w=>w.state.buttons.a),'Controller input stays connected while switching pictures');
  await one.evaluate(()=>{window.pad.buttons[0]={pressed:false,value:0};});
  await view(one,'');await one.waitForFunction(()=>Math.abs(document.querySelector('#clientVideo').videoWidth/document.querySelector('#clientVideo').videoHeight-16/9)<.02);
  for(const source of [extra,'',extra,''])await view(one,source);
  await one.waitForFunction(()=>document.querySelector('#clientSharedView').value==='' && Math.abs(document.querySelector('#clientVideo').videoWidth/document.querySelector('#clientVideo').videoHeight-16/9)<.02);
  await view(one,extra);await one.waitForFunction(()=>Math.abs(document.querySelector('#clientVideo').videoWidth/document.querySelector('#clientVideo').videoHeight-4/3)<.02);
  if(!await host.locator('#hostExtraShares').isVisible())await host.locator('#hostCallSettings').click();await host.locator('#hostExtraShares button[aria-label^="Remove shared view"]').click();await one.waitForFunction(()=>document.querySelector('#clientSharedView').options.length===1 && Math.abs(document.querySelector('#clientVideo').videoWidth/document.querySelector('#clientVideo').videoHeight-16/9)<.02);
  assert.equal(await host.evaluate(()=>window.captureStreams[1].getTracks().every(t=>t.readyState==='ended')),true);
  await host.locator('#hostInviteSheet').evaluate(el=>el.open=false);for(const width of [390,860,1366])for(const page of [host,one]){await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await host.setViewportSize({width:1366,height:950});await fs.mkdir('.local/screenshots',{recursive:true});await host.screenshot({path:'.local/screenshots/pairing-next-actions.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: text-only invite/reply without downloads; two pending invites; stable file/text actions; invite another guest; two independent guest views; source removal fallback; controller input across switches; mobile bounds.');
}catch(error){console.log('Browser errors:',errors);for(const page of (browser?.contexts()[0]?.pages() || []))console.log(await page.evaluate(()=>({host:document.querySelector('#hostStatus')?.textContent,client:document.querySelector('#clientStatus')?.textContent,w:document.querySelector('#clientVideo')?.videoWidth,frames:document.querySelector('#clientVideo')?.getVideoPlaybackQuality().totalVideoFrames})).catch(()=>null));throw error;}finally{await browser?.close();await app.close();}
