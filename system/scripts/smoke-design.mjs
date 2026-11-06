import {launchTestBrowser} from './browser-fixture.mjs';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
let injections=0,browser;const errors=[],requests=[];
const app=createApp({env:{},createInjector:async()=>{injections++;return {name:'Design test',addController(){},removeController(){},setState(){},close(){}};}});
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`;
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:capture-method','browser');localStorage.setItem('webrtc-pad:hostPreviewAutoPause','false');
    navigator.mediaDevices.getDisplayMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');let n=0;setInterval(()=>{ctx.fillStyle='#13201b';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#d0f79b';ctx.font='40px sans-serif';ctx.fillText('Your game · design check',70,100);ctx.beginPath();ctx.arc(150+n++%900,360,35,0,Math.PI*2);ctx.fill();},16);return canvas.captureStream(60);};
  });
  const host=await context.newPage();host.on('pageerror',e=>errors.push(e.message));host.on('request',r=>requests.push(r.url()));await host.goto(origin);await host.evaluate(()=>document.fonts.ready);
  assert.ok(await host.evaluate(()=>document.fonts.check('550 14px Inter')));assert.ok(requests.some(url=>url.includes('Inter-Variable-latin.woff2')));assert.equal(requests.some(url=>new URL(url).origin!==origin),false,'Assets must work locally');
  assert.equal(await host.locator('#hostMonitorDock > #hostMonitor').count(),1);
  assert.equal(await host.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);return ids.length===new Set(ids).size;}),true,'Preserve unique interaction targets');
  await fs.mkdir('.local/screenshots',{recursive:true});await host.screenshot({path:'.local/screenshots/design-host-setup.png',fullPage:true});
  await host.locator('#chooseBrowserSource').click();await host.waitForFunction(()=>document.querySelector('#hostPreview').videoWidth>0);assert.equal(injections,0,'Preflight capture must not start a session');
  await host.locator('#hostCreate').click();await host.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);assert.equal(injections,1);
  assert.equal(await host.locator('#hostInviteCard').evaluate(el=>el.parentElement.classList.contains('host-invite-stack')),true);
  assert.equal(await host.locator('#hostGuestSettings').evaluate(el=>el.parentElement.classList.contains('host-guest-stack')),true);
  await host.screenshot({path:'.local/screenshots/design-host-session.png',fullPage:true});
  for(const width of [1440,1190,1024,1000,768,390]){
    await host.setViewportSize({width,height:900});await host.waitForTimeout(80);
    assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Host overflow at ${width}`);
    const rects=await host.evaluate(()=>['hostInviteCard','hostGuestSettings','hostPeopleCard'].map(id=>{const {x,y,width,height}=document.getElementById(id).getBoundingClientRect();return {x,y,width,height};}));
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];assert.ok(a.x+a.width<=b.x+1 || b.x+b.width<=a.x+1 || a.y+a.height<=b.y+1 || b.y+b.height<=a.y+1,`Host cards overlap at ${width}`);}
  }
  await host.screenshot({path:'.local/screenshots/design-host-phone.png',fullPage:true});
  await host.locator('.mobile-navigation [data-view=screen]').click();assert.equal(await host.locator('#hostMonitor').isVisible(),true);assert.equal(await host.locator('#hostSessionContent').isVisible(),false);
  await host.screenshot({path:'.local/screenshots/design-host-phone-screen.png',fullPage:true});
  await host.locator('.mobile-navigation [data-view=settings]').click();assert.equal(await host.locator('#hostSettings').isVisible(),true);assert.equal(await host.locator('#hostMonitor').isVisible(),false);
  await host.locator('.mobile-navigation [data-view=room]').click();await host.setViewportSize({width:1440,height:900});
  await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
  const guest=await context.newPage();guest.on('pageerror',e=>errors.push(e.message));await guest.goto(origin+'/?mode=join');await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
  await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoWidth>0);
  await guest.screenshot({path:'.local/screenshots/design-guest-connected.png',fullPage:true});
  for(const width of [1440,1024,1000,768,390]){await guest.setViewportSize({width,height:900});assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Guest overflow at ${width}`);}
  await guest.locator('.mobile-navigation [data-view=controllers]').click();assert.equal(await guest.locator('#controllerSetup').isVisible(),true);assert.equal(await guest.locator('#clientStage').isVisible(),false);
  await guest.locator('#joinKeyboardController').click();await guest.waitForFunction(()=>document.querySelector('#clientSlot').textContent.includes('P1'));
  await guest.locator('.mobile-navigation [data-view=voice]').click();assert.equal(await guest.locator('#clientVoice').isVisible(),true);assert.equal(await guest.locator('#controllerSetup').isVisible(),false);
  await guest.locator('.mobile-navigation [data-view=settings]').click();assert.equal(await guest.locator('#clientPanel > .sidebar > .settings-card').isVisible(),true);
  await guest.locator('.mobile-navigation [data-view=game]').click();assert.equal(await guest.locator('#clientStage').isVisible(),true);await guest.waitForFunction(()=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>10);
  const nav=await guest.locator('.mobile-navigation').boundingBox();assert.ok(Math.abs(nav.y+nav.height-900)<2,'Bottom navigation stays in reach');await guest.screenshot({path:'.local/screenshots/design-guest-phone-game.png',fullPage:true});
  await host.locator('#hostEnd').click();await host.waitForFunction(()=>!document.querySelector('#hostSetupCard').hidden);assert.equal(await host.locator('#hostMonitorDock > #hostMonitor').count(),1,'Preview stays docked after Stop');
  await host.locator('#showHelp').click();assert.equal(await host.locator('.tour-target').count(),1);await host.keyboard.press('Escape');
  const guide=await context.newPage();for(const path of ['/port-forwarding','/linux-desktop','/mac-desktop','/guest-device-isolation']){await guide.goto(origin+path);await guide.setViewportSize({width:390,height:844});assert.equal(await guide.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,path);assert.ok(await guide.evaluate(()=>document.fonts.ready.then(()=>document.fonts.check('400 14px Inter'))));}
  assert.deepEqual(errors,[]);console.log('PASS: local design fonts/tokens; permanent preview; preflight capture; session grid; real video pairing; 390–1440px layouts; Stop/reset; tour target; all help pages.');
}finally{await browser?.close();await app.close();}
