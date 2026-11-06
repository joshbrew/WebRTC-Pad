import {launchTestBrowser} from './browser-fixture.mjs';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {createApp} from '../src/server.js';
import {NativeMedia} from '../src/native-media.js';
import {createDesktopInjector} from '../src/desktop-input.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const helpers=[],errors=[],engines=[];let progressTimer;let browser,host,guest,extra;
const app=createApp({env:{},createNativeMedia:env=>{const e=new NativeMedia({...env,...(process.env.NATIVE_WINDOW_TEST_HELPER?{NATIVE_MEDIA_HELPER:process.env.NATIVE_WINDOW_TEST_HELPER}:{})});const offer=e.offer.bind(e);e.offer=(id,q,ice,options)=>offer(id,q,{iceServers:[]},options);engines.push(e);return e;},createInjector:async()=>({name:'Disposable desktop test',setState(){},addController(){},removeController(){},close(){}}),createDesktop:async()=>{
  const h=await createDesktopInjector({}),states=[],events=[],set=h.setState,event=h.event;h.setState=s=>{states.push(s);set(s);};h.event=e=>{events.push(e);event(e);};helpers.push({h,states,events});return h;
}});
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`;
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});context.setDefaultTimeout(20000);
  await context.route('**/ice?*',r=>r.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');localStorage.setItem('webrtc-pad:capture-method','native');for(const mode of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${mode}`,'seen');localStorage.setItem('webrtc-pad:hostPreviewAutoPause','false');localStorage.setItem('webrtc-pad:stream-quality',JSON.stringify({resolution:'720',width:1280,height:720,frameRate:60,maxBitrate:8000000,autoThrottle:false}));window.testPCs=[];const RTC=RTCPeerConnection;window.RTCPeerConnection=class extends RTC{constructor(...args){super(...args);window.testPCs.push(this);}};Object.defineProperty(navigator,'getGamepads',{value:()=>[]});});
  host=await context.newPage();guest=await context.newPage();for(const p of [host,guest]){p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());p.on('console',m=>{if(m.type()==='error')console.log('Browser error:',m.text());});p.on('websocket',ws=>{if(ws.url().endsWith('/ws'))ws.on('framereceived',e=>{try{const v=JSON.parse(String(e.payload));if(['native-status','native-result','error'].includes(v.type))console.log(JSON.stringify({type:v.type,event:v.event,state:v.state,error:v.error,requestId:v.requestId,result:v.result?{...v.result,sdp:undefined,ice:undefined}:undefined}));}catch{}});});}
  console.log('Local native window test starting');await host.goto(origin);await guest.goto(origin+'/?mode=join');await host.locator('#hostPreviewAutoPause').evaluate(e=>{e.checked=false;e.dispatchEvent(new Event('change'));});await host.bringToFront();
  const targets=await fetch(origin+'/capture-targets').then(r=>r.json());const a=targets.targets.find(t=>t.label.replace(/^\*/, '')==='Pad-Scope-A.txt - Notepad'),b=targets.targets.find(t=>t.label.replace(/^\*/, '')==='Pad-Scope-B.txt - Notepad');assert.ok(a && b,'Open the two disposable Notepad files first');
  await host.waitForFunction(()=>document.querySelector('#captureTarget').options.length>1);

  await host.locator('#nativeCaptureAudio').uncheck();await host.locator('#captureTarget').selectOption(a.id);await host.waitForFunction(()=>document.querySelector('#hostPreview').videoWidth>0,null,{timeout:45000}).catch(async e=>{console.log('Debug',await host.evaluate(async()=>({video:[...document.querySelectorAll('video')].map(v=>({id:v.id,paused:v.paused,hidden:v.hidden,ready:v.readyState,stream:!!v.srcObject,tracks:v.srcObject?.getTracks().map(t=>({kind:t.kind,muted:t.muted,state:t.readyState}))})),pcs:await Promise.all(window.testPCs.map(async pc=>({state:pc.connectionState,stats:[...(await pc.getStats()).values()].filter(s=>s.type==='inbound-rtp').map(s=>({packets:s.packetsReceived,bytes:s.bytesReceived,frames:s.framesDecoded,framesReceived:s.framesReceived}))})))})));await host.screenshot({path:'.local/screenshots/native-scope-startup.png'});console.log('Host status',await host.locator('#hostStatus').textContent(),await host.locator('#hostSourceStatus').textContent());throw e;});
  await host.locator('#hostCreate').click();await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
  await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
  await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});await guest.waitForFunction(()=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>0,null,{timeout:30000}).catch(async e=>{
    console.log('Guest debug',JSON.stringify(await guest.evaluate(async()=>({video:[...document.querySelectorAll('video')].map(v=>({id:v.id,paused:v.paused,hidden:v.hidden,ready:v.readyState,width:v.videoWidth,frames:v.getVideoPlaybackQuality().totalVideoFrames,tracks:v.srcObject?.getTracks().map(t=>({kind:t.kind,muted:t.muted,state:t.readyState}))})),pcs:await Promise.all(window.testPCs.map(async pc=>({state:pc.connectionState,stats:[...(await pc.getStats()).values()].filter(s=>s.type==='inbound-rtp').map(s=>({packets:s.packetsReceived,bytes:s.bytesReceived,frames:s.framesDecoded,framesReceived:s.framesReceived}))})))}))));
    for(const en of engines)for(const id of en.peers.keys())console.log('Native delivery',id,await en.rpc({type:'stats',peerId:id}));await guest.screenshot({path:'.local/screenshots/native-scope-guest-startup.png'});throw e;
  });
  await host.locator('#hostCallSettings').click();await host.locator('#hostLiveSource').evaluate(e=>e.open=true);await host.locator('#hostExtraShares').evaluate(e=>e.open=true);await host.locator('#hostAddShare').click();await host.locator('#hostExtraSource').selectOption(b.id);await host.locator('#hostConfirmShare').click();await guest.waitForFunction(()=>document.querySelector('#clientSharedView').options.length===2);extra=await guest.locator('#clientSharedView option').nth(1).getAttribute('value');await host.keyboard.press('Escape');
  console.log(JSON.stringify({ready:true,main:a.label,extra:b.label,extraId:extra}));
  const rl=createInterface({input:process.stdin});
  for await(const line of rl){try{
    const cmd=JSON.parse(line);
    if(cmd.action==='stop')break;
    if(cmd.action==='enable-main')await host.locator('#hostDesktopMouse').evaluate(e=>{e.checked=true;e.dispatchEvent(new Event('change'));});
    if(cmd.action==='enable-main-keys')await host.locator('#hostDesktopKeyboard').evaluate(e=>{e.checked=true;e.dispatchEvent(new Event('change'));});
    if(cmd.action==='enable-extra')await host.locator('[data-control-source]').evaluate(e=>e.click());
    if(cmd.action==='layout')await guest.locator(`#clientTileControls [data-layout=${cmd.value}]`).click();
    if(cmd.action==='feature')await guest.locator('.tile-title').evaluateAll((buttons,id)=>buttons.find(b=>b.parentElement.dataset.sourceId===(id==='b'?document.querySelector('#clientSharedView option:nth-child(2)').value:'')).click(),cmd.value);
    if(cmd.action==='guest-input'){
      await guest.waitForFunction(()=>!document.querySelector('#clientDesktopMouse').disabled && !document.querySelector('#clientDesktopTyping').disabled);
      for(const id of ['clientDesktopMouse','clientDesktopTyping'])await guest.locator('#'+id).evaluate(e=>{e.checked=true;e.dispatchEvent(new Event('change'));});
    }
    if(cmd.action==='click'){
      const surface=await guest.locator('.view-tile[data-featured=true] video').count()?guest.locator('.view-tile[data-featured=true] video'):guest.locator('#clientVideo');
      const point=await surface.evaluate((v,p)=>{const r=v.getBoundingClientRect(),scale=Math.min(r.width/v.videoWidth,r.height/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale;return{x:r.x+(r.width-w)/2+w*p.x,y:r.y+(r.height-h)/2+h*p.y};},{x:cmd.x || .4,y:cmd.y || .4});await guest.mouse.click(point.x,point.y);
    }
    if(cmd.action==='type'){
      await guest.locator('#clientStage').focus();for(const c of cmd.text){await guest.keyboard.press(c);await new Promise(r=>setTimeout(r,80));}
    }
    if(cmd.action==='crop'){
      await guest.locator('#clientTileControls [data-layout=single]').click();await host.locator('#hostCallSettings').click();await host.locator('#hostLiveSource').evaluate(e=>e.open=true);await host.locator('#chooseCaptureArea').click();const canvas=host.locator('#captureAreaDialog canvas'),r=await canvas.boundingBox();await host.mouse.move(r.x+r.width*.1,r.y+r.height*.2);await host.mouse.down();await host.mouse.move(r.x+r.width*.7,r.y+r.height*.8);await host.mouse.up();await host.locator('#captureAreaDialog').getByRole('button',{name:'Share selected area'}).click();await host.keyboard.press('Escape');
    }
    if(cmd.action==='remove-extra')await host.locator('[aria-label^="Remove shared view"]').evaluate(e=>e.click());
    if(cmd.action==='stop-input')await host.locator('#hostStopDesktop').evaluate(e=>e.click());
    if(cmd.action==='shot')await guest.screenshot({path:'.local/screenshots/native-scope-'+cmd.name+'.png'});
    await new Promise(r=>setTimeout(r,700));
    console.log(JSON.stringify({done:cmd.action,helpers:helpers.map(({h,states,events})=>({scope:h.scopeKey,keys:states.at(-1)?.keys,keysUsed:[...new Set(states.flatMap(s=>s.keys))],buttonsUsed:[...new Set(states.flatMap(s=>s.buttons))],states:states.length,events:events.length})),errors,status:await host.locator('#hostStatus').textContent(),guest:await guest.locator('#clientDesktopNote').textContent()}));
  }catch(e){console.log(JSON.stringify({error:e.message}));}}
  rl.close();process.stdin.pause();
}finally{clearInterval(progressTimer);await browser?.close();for(const e of engines)e.close();await app.close();process.stdin.pause();}
