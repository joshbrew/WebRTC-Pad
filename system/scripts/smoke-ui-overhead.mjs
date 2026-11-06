import {launchTestBrowser} from './browser-fixture.mjs';
// Count UI work without changing the real controller sampling loop.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const apps=[],errors=[];let browser;
async function start(env){const app=createApp({env});apps.push(app);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');return `http://127.0.0.1:${app.server.address().port}`;}
try{
  const plain=await start({}),hosted=await start({SESSION_SERVER_URL:plain});
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext();
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');
    window.padReads=0;
    const pad={index:0,id:'UI fixture',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
    Object.defineProperty(navigator,'getGamepads',{value:()=>{window.padReads++;return [pad];}});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(plain);
  await page.waitForFunction(()=>!!document.body.dataset.platform);
  assert.equal(await page.locator('#sessionConnection').count(),0);
  await page.evaluate(()=>{
    window.readoutWrites=0;
    window.uiObserver=new MutationObserver(records=>window.readoutWrites+=records.length);
    for(const id of ['inputReadout','primaryControllerTest'])window.uiObserver.observe(document.getElementById(id),{childList:true,characterData:true,subtree:true});
  });
  const measure=async()=>{
    await page.evaluate(()=>{window.padReads=0;window.readoutWrites=0;});
    await page.waitForTimeout(450);
    return page.evaluate(()=>({reads:window.padReads,writes:window.readoutWrites}));
  };
  const hostIdle=await measure();assert.deepEqual(hostIdle,{reads:0,writes:0});
  await page.locator('#modeClient').click();await page.waitForTimeout(1250);
  const guestIdle=await measure();assert.ok(guestIdle.reads>=3 && guestIdle.reads<=7,JSON.stringify(guestIdle));assert.equal(guestIdle.writes,0);
  await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));
  const hidden=await measure();assert.deepEqual(hidden,{reads:0,writes:0});
  await page.evaluate(()=>{delete document.hidden;window.uiObserver.disconnect();});
  const cursors=await page.evaluate(async()=>{
    const {cursorLayer}=await import('/cursors.js');
    const stage=document.createElement('div'),video=document.createElement('video');
    stage.style.cssText='position:fixed;left:0;top:0;width:640px;height:360px';stage.append(video);document.body.append(stage);
    const markers=cursorLayer(stage,video);markers.source({width:1280,height:720});
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    let layouts=0;const bounds=stage.getBoundingClientRect.bind(stage);stage.getBoundingClientRect=()=>{layouts++;return bounds();};
    for(let n=0;n<500;n++)markers.set('fixture',{x:n/499,y:.5,label:'Guest',color:'#81d8ff'});
    const duringBurst=layouts;await new Promise(requestAnimationFrame);
    const afterFrame=layouts,cursor=stage.querySelector('.guest-cursor');
    const position={x:parseFloat(cursor.style.left),y:parseFloat(cursor.style.top)},label=cursor.querySelector('span').textContent;
    markers.clear();layouts=0;await new Promise(resolve=>setTimeout(resolve,1100));
    const idle=layouts;
    markers.set('expiry',{x:.25,y:.5,label:'Expiry'});await new Promise(requestAnimationFrame);
    const originalNow=Date.now;Date.now=()=>originalNow()+4100;
    try{video.dispatchEvent(new Event('resize'));await new Promise(requestAnimationFrame);}finally{Date.now=originalNow;}
    const expired=stage.querySelector('.guest-cursor').hidden;
    markers.clear();stage.remove();return {duringBurst,afterFrame,position,label,idle,expired};
  });
  assert.equal(cursors.duringBurst,0);assert.equal(cursors.afterFrame,1);assert.deepEqual(cursors.position,{x:640,y:180});assert.equal(cursors.label,'Guest');assert.equal(cursors.idle,0);assert.equal(cursors.expired,true);
  await page.goto(hosted+'/?mode=join');await page.waitForFunction(()=>!!document.querySelector('#sessionConnection'));
  const replacements=await page.evaluate(async()=>{
    const ids=['joinFocus','joinStepInvite','joinStepReply'],nodes=ids.map(id=>document.getElementById(id).firstChild);let mutations=0;
    const observer=new MutationObserver(records=>mutations+=records.length);
    for(const id of ids)observer.observe(document.getElementById(id),{childList:true});
    for(let n=0;n<50;n++)document.dispatchEvent(new CustomEvent('quick-start',{detail:'refresh'}));
    await Promise.resolve();observer.disconnect();return {mutations,retained:ids.every((id,n)=>document.getElementById(id).firstChild===nodes[n])};
  });
  assert.deepEqual(replacements,{mutations:0,retained:true});assert.deepEqual(errors,[]);
  console.log(JSON.stringify({hostIdle,guestIdle,hidden,cursorUpdates:500,cursors,hostedButtonRefreshes:50,replacements},null,2));
  console.log('PASS: disabled hosted UI is absent; hidden/host diagnostics skip polling; unchanged diagnostics do not rewrite text; cursor bursts share one layout, clear stops idle work, expiry still hides; invite refreshes retain button content');
}finally{await browser?.close();for(const app of apps.reverse())await app.close();}
