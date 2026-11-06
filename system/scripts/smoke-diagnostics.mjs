import {launchTestBrowser} from './browser-fixture.mjs';
// Real browser media and WebGPU; only the capture source is a synthetic canvas.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const app=createApp({env:{},createInjector:async()=>({name:'Recording test',addController(){},removeController(){},setState(){},close(){}})}),errors=[],requests=[];let browser;
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`;
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1366,height:900}});
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:capture-method','browser');localStorage.setItem('webrtc-pad:hostPreviewAutoPause','false');
    navigator.mediaDevices.getDisplayMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');const timer=setInterval(()=>{ctx.fillStyle='#10202a';ctx.fillRect(0,0,960,540);ctx.fillStyle='#d2f79d';ctx.font='40px sans-serif';ctx.fillText(`Diagnostics test ${Math.round(performance.now())}`,30,100);},16);const stream=canvas.captureStream(60);stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(timer));return stream;};
  });
  const host=await context.newPage(),guest=await context.newPage();
  for(const p of [host,guest]){p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().includes('/charts/'))requests.push(r.url());});}
  await host.goto(origin);await guest.goto(origin+'/?mode=join');
  for(const p of [host,guest])await p.evaluate(async()=>{const {Diagnostics}=await import('/diagnostics.js'),record=Diagnostics.prototype.record;Diagnostics.prototype.record=function(...args){window.diagnostic=this;return record.apply(this,args);};});
  assert.equal(requests.length,0,'Chart library should not load on startup');
  await host.locator('#hostCreate').click();await host.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);
  await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
  await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
  await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});await guest.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Connected');
  await guest.waitForFunction(()=>window.diagnostic?.history.rows.some(row=>row.inputMs!==null));
  assert.equal(requests.length,0,'Controller-only stats must not load charts while collapsed');
  await host.locator('#hostCapture').click();await guest.waitForFunction(()=>window.diagnostic?.history.rows.filter(row=>row.fps>0).length>=3);
  assert.equal(requests.length,0,'Live video stats must not load charts while collapsed');
  await guest.locator('#clientDiagnostics').evaluate(el=>{el.closest('.settings-card').open=true;el.open=true;});
  await guest.waitForFunction(()=>window.diagnostic?.plots.length===1 && window.diagnostic.plots.every(p=>p.ctx.ready),null,{timeout:20000});
  assert.ok(requests.length>15,'The actual uplot-webgpu source graph should load');
  assert.equal(await guest.locator('#clientDiagnostics .diagnostic-readings dd').count(),7);
  for(const metric of ['1','2','3','0']){await guest.locator('#clientDiagnostics [data-diagnostic=metric]').selectOption(metric);await guest.waitForFunction(()=>window.diagnostic?.plots.length===1 && window.diagnostic.plots[0].ctx.ready);}
  assert.ok((await guest.locator('#clientDiagnostics').boundingBox()).height<500,'Diagnostics should fit in a compact disclosure');
  const gpu=await guest.evaluate(()=>({ready:window.diagnostic.plots.every(p=>p.ctx.ready),rows:window.diagnostic.history.rows.length,buffer:window.diagnostic.history.rows.at(-1).bufferMs,live:window.diagnostic.plots[0].constructor.getLivePlots?.().length}));
  assert.equal(gpu.ready,true);console.log('WebGPU sample:',JSON.stringify(gpu));
  const downloadEvent=guest.waitForEvent('download');await guest.locator('#clientDiagnostics [data-diagnostic="export"]').click();const download=await downloadEvent;const csv=await fs.readFile(await download.path(),'utf8');assert.match(csv,/seconds,inputMs,rttMs,bufferMs,decodeMs,fps,mbps,lossPercent/);assert.ok(csv.split('\n').length>3);
  await guest.locator('#clientDiagnostics [data-diagnostic="pause"]').click();const count=await guest.evaluate(()=>window.diagnostic.history.rows.length);await guest.waitForTimeout(1700);assert.equal(await guest.evaluate(()=>window.diagnostic.history.rows.length),count);
  await fs.mkdir('.local/screenshots',{recursive:true});await guest.locator('#clientDiagnostics').screenshot({path:'.local/screenshots/diagnostics.png'});
  await guest.locator('#clientDiagnostics').evaluate(el=>el.open=false);await guest.waitForFunction(()=>window.diagnostic.plots.length===0);assert.equal(await guest.locator('#clientDiagnostics canvas').count(),0);
  await guest.locator('#clientDiagnostics').evaluate(el=>el.open=true);await guest.waitForFunction(()=>window.diagnostic.plots.length===1 && window.diagnostic.plots.every(p=>p.ctx.ready));
  await guest.setViewportSize({width:390,height:800});await guest.locator('.mobile-navigation [data-view=settings]').click();await guest.waitForTimeout(300);assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Phone page should fit');
  await guest.locator('#modeHost').click();await guest.waitForFunction(()=>window.diagnostic.plots.length===0);await guest.locator('#modeClient').click();await guest.waitForFunction(()=>window.diagnostic.plots.length===1);
  await guest.locator('#clientDiagnostics [data-diagnostic="reset"]').click();assert.equal(await guest.evaluate(()=>window.diagnostic.history.rows.length),0);
  // A browser without WebGPU still records/exports, with no renderer request.
  const fallback=await context.newPage();await fallback.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined}));await fallback.goto(origin+'/?mode=join');
  await fallback.evaluate(async()=>{const {Diagnostics}=await import('/diagnostics.js');const root=document.createElement('details');document.body.append(root);window.fallback=new Diagnostics(root);window.fallback.record({inputMs:12});root.open=true;});
  await fallback.waitForFunction(()=>window.fallback.failed);assert.equal(await fallback.locator('body > details canvas').count(),0);assert.equal(await fallback.locator('body > details [data-diagnostic="export"]').isEnabled(),true);
  assert.deepEqual(errors,[]);console.log('PASS: real WebGPU plots; existing controller/video stats; lazy loading; CSV; pause/reset; collapse/mode cleanup; narrow layout; no-WebGPU export fallback.');
}finally{await browser?.close();await app.close();}
