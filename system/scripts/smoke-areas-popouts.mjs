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
  console.log('Preparing text invites');const first=await invite();await host.locator('#hostNextInvite').click();await host.locator('#newInvitation').click();const second=await invite();assert.notEqual(JSON.parse(first).pairingId,JSON.parse(second).pairingId);
  assert.equal(await host.locator('#hostNextPasteReply').isVisible(),true);assert.equal(await host.locator('#hostNextInvite').isVisible(),true);
  for(const [guest,packet] of [[one,first],[two,second]]){
    await guest.locator('#joinPasteAction').click();await guest.locator('#clientInvitation').fill(packet);await guest.locator('#createReply').click();
    await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);await guest.locator('#clientReplyAction').click();await guest.waitForFunction(()=>!!window.copied);
    await host.keyboard.press('Escape');await host.locator('#hostNextPasteReply').click();await host.locator('#hostReply').fill(await guest.evaluate(()=>window.copied));await host.locator('#acceptReply').click();
    await guest.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Connected');
    console.log('Guest connected; waiting for main picture');console.log(await host.locator('#hostStatus').textContent());await guest.waitForFunction(()=>Math.abs(document.querySelector('#clientVideo').videoWidth/document.querySelector('#clientVideo').videoHeight-16/9)<.02 && document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>5);
  }
  async function testAreasAndPopouts(){
    await one.locator('#clientViewPopouts').evaluate(el=>el.open=true);
    const popouts=[];
    for(const sourceId of ['',extra]){
      const pending=one.waitForEvent('popup');
      await one.locator('#clientViewPopouts button').evaluateAll((buttons,id)=>buttons.find(b=>b.dataset.sourceId===id).click(),sourceId);
      const popup=await pending;popup.on('pageerror',e=>errors.push(e.message));await popup.waitForFunction(()=>document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames>5);await popup.waitForFunction(()=>getComputedStyle(document.body).display==='flex');popouts.push(popup);
    }
    const frameCount=page=>page.locator('video').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames);
    const before=await Promise.all(popouts.map(frameCount));await one.waitForTimeout(400);for(let i=0;i<2;i++)assert.ok(await frameCount(popouts[i])>before[i],'Both pop-outs advance independently');
    assert.equal(await one.locator('#clientSharedView').inputValue(),extra,'Opening windows does not change the main guest view');
    await popouts[0].close();const frames=await frameCount(popouts[1]);await one.waitForTimeout(1000);assert.ok(await frameCount(popouts[1])>frames,'Closing one pop-out keeps the other playing');
    await one.evaluate(()=>window.pad.buttons[0]={pressed:true,value:1});await one.waitForTimeout(200);assert.ok(writes.some(w=>w.state.buttons.a));await one.evaluate(()=>window.pad.buttons[0]={pressed:false,value:0});
    if(!await host.locator('#chooseCaptureArea').isVisible())await host.locator('#hostCallSettings').click();
    await host.locator('#hostLiveSource').evaluate(el=>el.open=true);
    await host.locator('#chooseCaptureArea').click();const canvas=host.locator('#captureAreaDialog canvas'),bounds=await canvas.boundingBox();
    await host.mouse.move(bounds.x+bounds.width/8,bounds.y+bounds.height/8);await host.mouse.down();await host.mouse.move(bounds.x+bounds.width*5/8,bounds.y+bounds.height*19/24,{steps:5});await host.mouse.up();
    await fs.mkdir('.local/screenshots',{recursive:true});await host.locator('#captureAreaDialog').screenshot({path:'.local/screenshots/capture-area-selection.png'});
    await host.locator('#captureAreaDialog').getByRole('button',{name:'Share selected area'}).click();
    await two.waitForFunction(()=>{const v=document.querySelector('#clientVideo');return v.videoWidth>620 && v.videoWidth<660 && Math.abs(v.videoWidth/v.videoHeight-4/3)<.03;});
    assert.equal(await two.locator('#clientSharedView').inputValue(),'');assert.equal(await one.locator('#clientSharedView').inputValue(),extra);
    assert.equal(await popouts[1].isClosed(),false,'Cropping the main screen keeps additional views open');
    const received=await two.locator('#clientVideo').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames);await two.waitForTimeout(500);assert.ok(await two.locator('#clientVideo').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames)>received,'Cropped stream keeps animating');
    if(!await host.locator('#chooseCaptureArea').isVisible())await host.locator('#hostCallSettings').click();
    await host.locator('#chooseCaptureArea').click();await two.waitForTimeout(200);assert.ok(await two.locator('#clientVideo').evaluate(v=>v.videoWidth<660),'Opening the crop picker never exposes the full source');await host.locator('#captureAreaDialog').getByRole('button',{name:'Cancel',exact:true}).click();
    await host.locator('#captureArea').getByText('Exact area dimensions',{exact:true}).click();await host.locator('#captureArea-x').fill('30000');await host.locator('#captureArea').getByRole('button',{name:'Apply area',exact:true}).click();await host.waitForTimeout(200);const oldPixel=await two.locator('#clientVideo').evaluate(v=>{const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(v,0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].join(',');});
    await two.waitForFunction(old=>{const v=document.querySelector('#clientVideo'),c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(v,0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].join(',')!==old;},oldPixel,{timeout:5000});assert.ok(await two.locator('#clientVideo').evaluate(v=>v.videoWidth<660),'Invalid dimensions keep the existing cropped picture');
    await host.locator('#clearCaptureArea').click();
    await two.waitForFunction(()=>Math.abs(document.querySelector('#clientVideo').videoWidth/document.querySelector('#clientVideo').videoHeight-16/9)<.02);
    await popouts[1].close();console.log('PASS: draw rectangle; native-size cropped stream; animated output; full-source restore; two simultaneous independent pop-outs; separate close; controller continuity.');
  }
  assert.equal(downloads,0,'Text pairing does not download files');
  await host.locator('#hostCallSettings').click();await host.locator('#hostLiveSource').evaluate(el=>el.open=true);
  assert.equal(await host.locator('#hostSourceSetup').evaluate(el=>el.nextElementSibling?.id),'hostExtraShares','Select the first source before adding more screens');
  assert.equal(await host.locator('#hostExtraShares').isVisible(),true,'Additional screens become available after the main share');
  assert.match(await host.locator('#hostAddShare').textContent(),/Add another screen/);
  await host.locator('#hostExtraShares').evaluate(el=>el.open=true);await host.locator('#hostAddShare').click();await host.waitForFunction(()=>document.querySelector('#hostExtraSource').checkVisibility() || document.querySelector('.extra-share-row'));if(await host.locator('#hostExtraSource').isVisible())await host.locator('#hostExtraShares').getByRole('button',{name:'Choose with browser…'}).click();console.log('Added extra browser view');
  await one.waitForFunction(()=>document.querySelector('#clientSharedView').options.length===2);
  const extra=await one.locator('#clientSharedView option').nth(1).getAttribute('value');await one.locator('#clientSharedView').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change'));},extra);
  await one.waitForFunction(()=>Math.abs(document.querySelector('#clientVideo').videoWidth/document.querySelector('#clientVideo').videoHeight-4/3)<.02);
  assert.ok(await two.locator('#clientVideo').evaluate(v=>Math.abs(v.videoWidth/v.videoHeight-16/9)<.02),'Other guests keep their own view');
  await one.evaluate(()=>{window.pad.buttons[0]={pressed:true,value:1};});await one.waitForFunction(()=>document.querySelector('#clientSlot').textContent==='P1');
  await one.waitForTimeout(200);assert.ok(writes.some(w=>w.state.buttons.a),'Controller input stays connected while switching pictures');
  await one.evaluate(()=>{window.pad.buttons[0]={pressed:false,value:0};});
  await one.locator('#clientSharedView').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change'));},'');await one.waitForFunction(()=>Math.abs(document.querySelector('#clientVideo').videoWidth/document.querySelector('#clientVideo').videoHeight-16/9)<.02);
  for(const source of [extra,'',extra,''])await one.locator('#clientSharedView').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change'));},source);
  await one.waitForFunction(()=>document.querySelector('#clientSharedView').value==='' && Math.abs(document.querySelector('#clientVideo').videoWidth/document.querySelector('#clientVideo').videoHeight-16/9)<.02);
  await one.locator('#clientSharedView').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change'));},extra);await one.waitForFunction(()=>Math.abs(document.querySelector('#clientVideo').videoWidth/document.querySelector('#clientVideo').videoHeight-4/3)<.02);
  await testAreasAndPopouts();
  if(!await host.locator('#hostExtraShares').isVisible())await host.locator('#hostCallSettings').click();await host.locator('#hostExtraShares button[aria-label^="Remove shared view"]').click();await one.waitForFunction(()=>document.querySelector('#clientSharedViews').hidden && Math.abs(document.querySelector('#clientVideo').videoWidth/document.querySelector('#clientVideo').videoHeight-16/9)<.02);
  assert.equal(await host.evaluate(()=>window.captureStreams[1].getTracks().every(t=>t.readyState==='ended')),true);
  await host.locator('#hostInviteSheet').evaluate(el=>el.open=false);for(const width of [390,860,1366])for(const page of [host,one]){await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await host.setViewportSize({width:1366,height:950});await fs.mkdir('.local/screenshots',{recursive:true});await host.screenshot({path:'.local/screenshots/pairing-next-actions.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: areas/pop-outs; text-only invite/reply without downloads; two pending invites; stable file/text actions; invite another guest; two independent guest views; source removal fallback; controller input across switches; mobile bounds.');
}catch(error){console.log('Browser errors:',errors);for(const page of (browser?.contexts()[0]?.pages() || []))console.log(await page.evaluate(()=>({host:document.querySelector('#hostStatus')?.textContent,client:document.querySelector('#clientStatus')?.textContent,w:document.querySelector('#clientVideo')?.videoWidth,frames:document.querySelector('#clientVideo')?.getVideoPlaybackQuality().totalVideoFrames})).catch(()=>null));throw error;}finally{await browser?.close();await app.close();}
