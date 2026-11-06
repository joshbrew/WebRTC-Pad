import {launchTestBrowser} from './browser-fixture.mjs';
// Real native RTP/WebRTC, generated FFmpeg pixels. No desktop capture or input.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {NativeMedia} from '../src/native-media.js';
import {videoEncoderArguments} from '../src/encoder-scan.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
let browser,engine,starts=0;
const offers=[];
const app=createApp({env:{},getCaptureTargets:async()=>[{kind:'desktop',id:'desktop',label:'Generated test picture'}],encoderScanner:{peek:()=>null,scan:async()=>({devices:[],encoders:[],selected:null})},
  createInjector:async()=>({name:'Recording',setState(){},addController(){},removeController(){},close(){}}),
  createNativeMedia:env=>{
    engine=new NativeMedia(env);engine.sourceSize={width:1280,height:720};
    const original=engine.offer.bind(engine);engine.offer=async(id,...args)=>{offers.push(id);return original(id,args[0],{iceServers:[]},args[2]);};
    engine.ensureAudio=async()=>{assert.notEqual(engine.env.NATIVE_AUDIO,'1','This fixture must never capture real sound');};
    engine.startEncoder=async(profile,q,port)=>{
      starts++;profile.encoder='generated libx264';profile.capture='Generated test pattern';
      const child=profile.child=spawn(engine.capability.ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-progress','pipe:1','-re','-f','lavfi','-i',`testsrc2=size=1280x720:rate=${q.frameRate || 60}`,...(q.height?['-vf',`scale=${Math.round(q.width/2)*2}:${Math.round(q.height/2)*2}`]:[]),'-an',...videoEncoderArguments('libx264',q.frameRate || 60,q.maxBitrate || 8000000),'-f','rtp','-payload_type','96',`rtp://127.0.0.1:${port}?pkt_size=1200`],{windowsHide:true});
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Generated encoder timed out')),10000);child.stdout.on('data',()=>{clearTimeout(timer);resolve();});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);if(code)reject(new Error('Generated encoder failed'));});});
    };
    return engine;
  }
});
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1366,height:900}});context.setDefaultTimeout(30000);
  await context.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  const errors=[];await context.addInitScript(()=>{
    localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');localStorage.setItem('webrtc-pad:capture-method','native');
    for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');
    window.nativePreviewPeers=[];const Original=RTCPeerConnection;window.RTCPeerConnection=class extends Original{constructor(...args){super(...args);window.nativePreviewPeers.push(this);}};
  });
  const host=await context.newPage(),one=await context.newPage(),two=await context.newPage(),origin=`http://127.0.0.1:${app.server.address().port}`;
  for(const page of [host,one,two])page.on('pageerror',error=>errors.push(error.message));
  await host.goto(origin);await one.goto(origin+'/?mode=join');await two.goto(origin+'/?mode=join');
  await host.locator('#callSettings').click();await host.locator('#hostSettings').evaluate(el=>el.open=true);await host.locator('#streamResolution').selectOption('720');
  await host.waitForFunction(()=>JSON.parse(localStorage.getItem('webrtc-pad:stream-quality'))?.resolution==='720');await host.keyboard.press('Escape');
  await host.locator('#nativeCaptureAudio').evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});await host.locator('#nativeCaptureAudio').uncheck();await host.locator('#captureTarget').selectOption('desktop');await host.waitForFunction(()=>document.querySelector('#hostPreview').videoWidth>0);
  await host.locator('#hostCreate').click();
  async function join(guest){
    if(!await host.locator('#hostInviteSheet').evaluate(el=>el.open))await host.locator('#inviteFocus').click();const previous=await host.locator('#hostInvitation').inputValue();await host.locator(previous?'#newInvitation':'#createInvitation').click();await host.waitForFunction(previous=>document.querySelector('#hostInvitation').value!==previous,previous);
    await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
    await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});
    await guest.waitForFunction(()=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>10);
  }
  await join(one);
  await one.evaluate(()=>{
    const video=document.querySelector('#clientVideo');window.frameTimes=[];window.frameWatch=true;
    const tick=now=>{window.frameTimes.push(now);if(window.frameWatch)video.requestVideoFrameCallback(tick);};video.requestVideoFrameCallback(tick);
  });
  const before=offers.length,preview=await host.evaluate(()=>window.nativePreviewPeers.find(pc=>pc.connectionState==='connected' && pc.getReceivers().some(r=>r.track.kind==='video'))?.connectionState);
  assert.equal(preview,'connected');
  // Use real page focus and the same controls as the user, without closing RTC.
  for(let n=0;n<3;n++){await one.bringToFront();await host.waitForTimeout(220);await host.bringToFront();await host.waitForTimeout(220);}
  await host.locator('#hostMonitorToggle').click();await host.locator('#hostMonitorToggle').click();
  assert.equal(offers.length,before,'Focus and preview controls must not request a native offer');
  await join(two);await one.waitForTimeout(1000);
  const result=await one.evaluate(()=>{window.frameWatch=false;return {frames:window.frameTimes.length,maxGapMs:Math.max(0,...window.frameTimes.slice(1).map((now,i)=>now-window.frameTimes[i]))};});
  assert.ok(result.frames>30);assert.ok(result.maxGapMs<1200,`Existing guest must keep receiving while another joins: ${JSON.stringify(result)}`);
  assert.equal(starts,1,'Matching viewers and the preview must share one uninterrupted encoder');
  await one.locator('#clientCallSettings').click();await one.evaluate(()=>{window.emptyPictures=0;document.querySelector('#clientVideo').addEventListener('emptied',()=>window.emptyPictures++);});await one.locator('#clientResolution').selectOption('480');await one.waitForFunction(()=>document.querySelector('#clientVideo').videoHeight===480);assert.equal(await one.evaluate(()=>window.emptyPictures),0,'A quality change must retain the picture until the replacement starts');
  assert.deepEqual(errors,[]);console.log('PASS: native focus/preview toggles issue no offers; second guest reuses one encoder; first guest video continues; live resolution change retains the picture:',result);
}finally{await browser?.close();await app.close();engine?.close();}
