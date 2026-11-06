import {launchTestBrowser} from './browser-fixture.mjs';
// Real loopback WebRTC with an independently expiring invitation service.
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {createSessionServer} from '../src/session-server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const invitations=createSessionServer({disconnectGraceMs:100}),broker=http.createServer(),apps=[],writes=[],errors=[];let browser;
broker.on('upgrade',(req,socket,head)=>invitations.wss.handleUpgrade(req,socket,head,ws=>invitations.wss.emit('connection',ws,req)));
const until=async(predicate,label)=>{const end=Date.now()+12000;while(!await predicate()){if(Date.now()>end)throw Error(label);await new Promise(resolve=>setTimeout(resolve,25));}};
try{
  broker.listen(0,'127.0.0.1');await once(broker,'listening');const url=`http://127.0.0.1:${broker.address().port}`;
  const start=async()=>{const app=createApp({env:{SESSION_SERVER_URL:url},createInjector:async()=>({name:'Recovery fixture',addController(){},removeController(){},setState(slot,state){writes.push(state);},close(){}})});apps.push(app);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');return `http://127.0.0.1:${app.server.address().port}`;};
  const hostUrl=await start(),guestUrl=await start();browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext();await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:capture-method','browser');
    const WS=WebSocket;window.inviteSockets=[];window.WebSocket=class extends WS{constructor(url,...args){if(window.blockInvites && new URL(url).pathname==='/sessions')throw Error('Simulated invitation outage');super(url,...args);if(new URL(url).pathname==='/sessions')window.inviteSockets.push(this);}};
    navigator.mediaDevices.getDisplayMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');let frame=0;setInterval(()=>{ctx.fillStyle=`hsl(${frame++%360} 70% 35%)`;ctx.fillRect(0,0,640,360);},16);return canvas.captureStream(60);};
  });
  const host=await context.newPage(),guest=await context.newPage();for(const page of [host,guest])page.on('pageerror',e=>errors.push(e.message));
  await host.goto(hostUrl);await guest.goto(guestUrl+'/?mode=join');await host.waitForFunction(()=>!!document.body.dataset.sessionInvites);
  await host.locator('#sessionName').fill('RecoveryHost');await host.locator('#hostCreate').click();await host.locator('#sessionCreateLink').click();await host.waitForFunction(()=>!!document.querySelector('#sessionShareLink').value);
  const oldLink=await host.locator('#sessionShareLink').inputValue();await guest.locator('#sessionInviteLink').fill(oldLink);await guest.locator('#sessionJoinLink').click();await host.getByRole('button',{name:'Accept guest',exact:true}).click();
  await guest.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Connected');await guest.locator('#joinKeyboardController').click();await guest.waitForFunction(()=>document.querySelector('#clientSlot').textContent.includes('P1'));
  await host.locator('#hostCapture').click();await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoWidth>0);
  const input=async()=>{const mark=writes.length;await guest.bringToFront();await guest.locator('#clientStage').focus();await guest.keyboard.down('z');await until(()=>writes.slice(mark).some(s=>s.buttons.a),'Controller input stopped');await guest.keyboard.up('z');};
  const frames=await guest.locator('#clientVideo').evaluate(el=>el.getVideoPlaybackQuality().totalVideoFrames);
  await host.evaluate(()=>{window.blockInvites=true;window.inviteSockets.at(-1).close();});
  await until(()=>invitations.rooms.size===0,'Old invite did not expire');await guest.waitForFunction(()=>document.querySelector('#sessionJoinStatus').textContent.includes('game connection stays open'));
  assert.equal(await host.locator('#sessionCopyLink').isDisabled(),true,'Offline hosts cannot copy an unverified old link');await host.locator('#inviteFocus').click();await host.waitForFunction(()=>document.activeElement?.id==='sessionConnect');
  assert.equal(await host.locator('#hostNextTitle').textContent(),'Reconnect invitations');
  assert.equal(await guest.locator('#clientConnectionText').textContent(),'Connected');await input();await guest.waitForFunction(n=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>n+8,frames);
  await host.evaluate(async()=>{window.blockInvites=false;const button=document.querySelector('#sessionConnect');if(!button.disabled && button.textContent!=='Online')await button.onclick();});
  try{await host.waitForFunction(()=>!document.querySelector('#sessionShareLink').value);}
  catch(error){console.log({status:await host.locator('#sessionStatus').textContent(),button:await host.locator('#sessionConnect').textContent(),errors});throw error;}
  assert.equal(await host.locator('#sessionShareLink').inputValue(),'');assert.equal(await host.locator('#sessionCopyLink').isDisabled(),true);assert.equal(await host.locator('#sessionCreateLink').isVisible(),true);
  await host.locator('#sessionCreateLink').click();await host.waitForFunction(old=>document.querySelector('#sessionShareLink').value && document.querySelector('#sessionShareLink').value!==old,oldLink);assert.equal(await host.locator('#sessionConnect').textContent(),'Online');await input();
  await host.locator('#hostEnd').click();await guest.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent!=='Connected');assert.deepEqual(errors,[]);
  console.log('PASS: expired host invitation presence preserves real video/controller input; stale links clear; fresh invitation access recovers; Stop session still disconnects guests');
}finally{await browser?.close();for(const app of apps.reverse())await app.close();invitations.close();await new Promise(resolve=>broker.close(resolve));}
