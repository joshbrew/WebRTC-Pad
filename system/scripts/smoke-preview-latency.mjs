import {launchTestBrowser} from './browser-fixture.mjs';
// Windows acceptance: time freshly generated pixels through capture -> native
// H.264 -> loopback WebRTC -> rendered browser video. No real desktop inputs.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createApp} from '../src/server.js';
import {NativeMedia} from '../src/native-media.js';
import {captureTargets} from '../src/desktop-input.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
let child,browser,app,engine;const browserCapture=process.env.LATENCY_CAPTURE==='browser';
try{
  assert.equal(process.platform,'win32');await fs.mkdir('.local/tools',{recursive:true});
  const file=path.resolve(`.local/tools/native-latency-${process.pid}.exe`);
  await promisify(execFile)(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:exe','/r:System.Windows.Forms.dll','/r:System.Drawing.dll',`/out:${file}`,path.resolve('system/scripts/native-latency-fixture.cs')],{windowsHide:true});
  const withAudio=process.env.LATENCY_AUDIO==='1';child=spawn(file,withAudio?['--audio']:[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const target=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Latency fixture did not open')),8000);createInterface({input:child.stdout}).once('line',line=>{clearTimeout(timeout);resolve(JSON.parse(line));});child.on('error',reject);});
  Object.assign(target,(await captureTargets()).find(value=>value.id===target.id && value.pid===target.pid));
  const guestView=process.env.LATENCY_GUEST==='1',throughUI=browserCapture || guestView || process.env.LATENCY_UI==='1';
  const mediaEnv=env=>({...env,...Object.fromEntries(['NATIVE_PLAYOUT_DELAY','NATIVE_QSV_ASYNC_DEPTH','NATIVE_NVENC_PRESET'].filter(key=>process.env[key]).map(key=>[key,process.env[key]])),...(process.env.LATENCY_HELPER?{NATIVE_MEDIA_HELPER:process.env.LATENCY_HELPER}:{}),...(process.env.LATENCY_ENCODER?{NATIVE_ENCODER:process.env.LATENCY_ENCODER}:{})});
  app=createApp({env:{},createInjector:async()=>({name:'Latency fixture',addController(){},setState(){},close(){}}),getCaptureTargets:async()=>[{...target,kind:'window',label:'Local preview latency test'}],createNativeMedia:env=>engine=new NativeMedia(mediaEnv(env))});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{channel:process.env.LATENCY_BROWSER_CHANNEL || 'msedge',headless:process.env.LATENCY_HEADED!=='1',args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding',...(browserCapture?['--auto-select-window-capture-source-by-title=Local preview latency test']:[])]});
  const installUI=({browserCapture})=>{
    for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:capture-method',browserCapture?'browser':'native');localStorage.setItem('webrtc-pad:hostPreviewAutoPause','false');
    window.latencyPeers=[];const Original=RTCPeerConnection;window.RTCPeerConnection=class extends Original{constructor(...args){super(...args);window.latencyPeers.push(this);}};
  };
  const page=await browser.newPage();await page.addInitScript(installUI,{browserCapture});const origin=`http://127.0.0.1:${app.server.address().port}`;await page.goto(origin);
  const fps=Number(process.env.LATENCY_FPS || 60);let offer;
  if(throughUI){
    if(!browserCapture)await page.waitForFunction(id=>[...document.querySelector('#captureTarget').options].some(option=>option.value===id),target.id);
    await page.locator('#hostSettings').evaluate(element=>element.open=true);
    if(process.env.LATENCY_RESOLUTION)await page.locator('#streamResolution').selectOption(process.env.LATENCY_RESOLUTION);
    await page.locator('#streamFramerate').selectOption(String(fps));
    if(process.env.LATENCY_CODEC==='h265'){
      await page.waitForFunction(()=>!document.querySelector('#streamCodec option[value="h265"]').disabled);
      await page.locator('#nativeCodecOptions').evaluate(element=>element.open=true);await page.locator('#streamCodec').selectOption('h265');
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('webrtc-pad:stream-quality'))?.codec==='h265');
    }
    if(withAudio)await page.locator('#nativeCaptureAudio').check();
    if(browserCapture){
      await page.locator('#chooseBrowserSource').click();
      await page.waitForFunction(()=>document.querySelector('#hostPreview').videoWidth>0,null,{timeout:20000});
      const selected=await page.locator('#hostPreview').evaluate(video=>{const track=video.srcObject.getVideoTracks()[0];return {label:track.label,surface:track.getSettings().displaySurface};});
      assert.equal(selected.surface,'window','Browser test must never capture an entire real desktop');
      assert.equal(selected.label.split(':')[1],target.id,'Browser must capture only the generated fixture');
    }else await page.locator('#captureTarget').selectOption(target.id);
    await page.waitForFunction(()=>document.querySelector('#hostPreview').videoWidth>0 && !document.querySelector('#hostPreviewStats').hidden);
    await page.evaluate(()=>{window.latencyVideo=document.querySelector('#hostPreview');window.latencyPC=window.latencyPeers.find(pc=>pc.connectionState==='connected' && pc.getReceivers().some(r=>r.track.kind==='video'));});
    const profile=engine && [...engine.profiles.values()][0];offer={encoder:profile?.encoder || 'browser',scaling:profile?.scaling || 'browser',audioAvailable:!!engine?.audio};
    assert.equal(await page.locator('#hostPreview').evaluate(video=>video.srcObject.getAudioTracks().length),0,'Muted host preview must not wait for audio synchronization');
    if(withAudio)assert.equal(offer.audioAvailable,true,'Guest audio capture must stay active independently of the host monitor');
    if(!browserCapture)assert.deepEqual(engine.sourceSize,{width:target.width,height:target.height},'Profile resizing must preserve original source dimensions for mouse mapping and client limits');
  }else{
  engine=new NativeMedia(mediaEnv({NATIVE_WINDOW_HANDLE:target.id,NATIVE_WINDOWS_CAPTURE:'wgc',NATIVE_CAPTURE_SOURCE_SIZE:`${target.width}x${target.height}`,NATIVE_AUDIO:withAudio?'1':'0',NATIVE_AUDIO_PID:String(target.pid)}));
  offer=await engine.offer('latency',{frameRate:fps,width:1920,height:1080,maxBitrate:8000000},{iceServers:[]});
  const answer=await page.evaluate(async({offer,lowDelay})=>{
    const pc=new RTCPeerConnection({iceServers:[]});window.latencyPC=pc;
    const video=document.createElement('video');video.muted=true;video.autoplay=true;video.playsInline=true;document.body.replaceChildren(video);window.latencyVideo=video;
    const stream=new MediaStream();video.srcObject=stream;
    pc.ontrack=event=>{if(lowDelay){try{if('jitterBufferTarget' in event.receiver)event.receiver.jitterBufferTarget=0;if('playoutDelayHint' in event.receiver)event.receiver.playoutDelayHint=0;}catch{}}if(event.track.kind==='video' || offer.audioAvailable)stream.addTrack(event.track);};
    await pc.setRemoteDescription(offer.sdp);await pc.setLocalDescription(await pc.createAnswer());
    if(pc.iceGatheringState!=='complete')await new Promise(resolve=>pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete')resolve();}));
    return pc.localDescription.toJSON();
  },{offer,lowDelay:process.env.LATENCY_RECEIVER==='1'});
  await engine.answer('latency',answer);await page.waitForFunction(()=>window.latencyVideo.videoWidth>0);
  }
  let measured=page;
  if(guestView){
    await page.locator('#hostCreate').click();await page.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);
    await page.locator('#createInvitation').click();await page.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
    measured=await browser.newPage();await measured.addInitScript(installUI,{browserCapture});await measured.goto(origin+'/?mode=join');
    await measured.locator('#clientInvitationFile').setInputFiles({name:'clock-invite.txt',mimeType:'text/plain',buffer:Buffer.from(await page.locator('#hostInvitation').inputValue())});
    await measured.waitForFunction(()=>!!document.querySelector('#clientReply').value);
    await page.locator('#hostReplyFile').setInputFiles({name:'clock-reply.txt',mimeType:'text/plain',buffer:Buffer.from(await measured.locator('#clientReply').inputValue())});
    await measured.waitForFunction(()=>document.querySelector('#clientVideo').videoWidth>0,null,{timeout:45000});
    if(withAudio){await measured.waitForFunction(()=>!document.querySelector('#clientUnmute').disabled);await measured.locator('#clientUnmute').click();}
    assert.equal(await measured.locator('#clientVideo').evaluate(video=>video.srcObject.getAudioTracks().length),0);
    await measured.evaluate(()=>{window.latencyVideo=document.querySelector('#clientVideo');window.latencyPC=window.latencyPeers.find(pc=>pc.connectionState==='connected'&&pc.getReceivers().some(r=>r.track.kind==='video'));});
  }
  let comparison;
  if(process.env.LATENCY_COMPARE_RENDER==='1'){
    await measured.evaluate(()=>{
      if(typeof MediaStreamTrackProcessor!=='function')throw new Error('Frame processor unavailable for rendering comparison');
      const video=window.latencyVideo,holder=document.createElement('div'),canvas=document.createElement('canvas');
      holder.id='latencyComparison';holder.style.cssText='position:fixed;inset:0;z-index:99999;background:#111;display:grid;grid-template-columns:600px 600px;grid-template-rows:30px 360px;gap:10px;padding:10px;';
      for(const text of ['Standard video player','Immediate decoded frames']){const label=document.createElement('div');label.textContent=text;holder.append(label);}
      video.style.cssText='position:static;width:600px;height:360px;object-fit:contain;background:#000;';canvas.style.cssText='width:600px;height:360px;object-fit:contain;background:#000;';canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      holder.append(video,canvas);document.body.append(holder);const context=canvas.getContext('2d',{alpha:false,desynchronized:true});
      const track=video.srcObject.getVideoTracks()[0].clone(),reader=new MediaStreamTrackProcessor({track,maxBufferSize:1}).readable.getReader();let stopped=false;
      window.stopComparison=async()=>{stopped=true;await reader.cancel();track.stop();};
      (async()=>{try{while(!stopped){const {value:frame,done}=await reader.read();if(done)break;try{if(canvas.width!==frame.displayWidth || canvas.height!==frame.displayHeight){canvas.width=frame.displayWidth;canvas.height=frame.displayHeight;}context.drawImage(frame,0,0);}finally{frame.close();}}}catch(error){if(!stopped)throw error;}})();
    });
    const differences=[];
    for(let i=0;i<12;i++){
      await new Promise(resolve=>setTimeout(resolve,150));
      const png=await measured.screenshot();
      const stamps=await measured.evaluate(async data=>{
        const binary=atob(data.slice(data.indexOf(',')+1)),bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);bitmap.close();const {data:pixels}=context.getImageData(0,0,canvas.width,canvas.height),stamps=[];
        for(const left of [10,620]){
          let marker,run=0;for(let y=40;y<400;y++)for(let x=left;x<left+600;x++){let p=(y*canvas.width+x)*4;if(pixels[p]>170&&pixels[p+1]<90&&pixels[p+2]>170){const start=x;while(x<left+600){p=(y*canvas.width+x)*4;if(pixels[p]<170||pixels[p+1]>90||pixels[p+2]<170)break;x++;}if(x-start>run){run=x-start;marker={x,y:y+2};}}}
          if(!marker){stamps.push(null);continue;}let end=marker.x;while(end<left+600){const p=(marker.y*canvas.width+end)*4;if(pixels[p]<90&&pixels[p+1]>170&&pixels[p+2]>170)break;end++;}let stamp=0;for(let bit=0;bit<24;bit++){const p=(marker.y*canvas.width+Math.round(marker.x+(end-marker.x)/24*(bit+.5)))*4;if(pixels[p]+pixels[p+1]+pixels[p+2]>384)stamp+=2**bit;}stamps.push(stamp);
        }return stamps;
      },'data:image/png;base64,'+png.toString('base64'));
      if(stamps.every(Number.isFinite))differences.push(((stamps[1]-stamps[0]+2**23)%2**24+2**24)%2**24-2**23);
    }
    differences.sort((a,b)=>a-b);comparison={samples:differences.length,compositedFramesAheadMs:differences[Math.floor(differences.length/2)],minAheadMs:differences[0],maxAheadMs:differences.at(-1)};
    assert.ok(differences.length>=8,'Comparison clock must be visible in both composited pictures');
    await fs.mkdir('.local/screenshots',{recursive:true});await measured.screenshot({path:`.local/screenshots/render-comparison-${browserCapture?'browser':'native'}.png`});
  }
  const result=await measured.evaluate(async({rawFrames})=>{
    const video=window.latencyVideo,canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true}),ages=[],receiveToDisplay=[],sourceToReceive=[],processing=[],rawAges=[],frameIntervals=[],start=performance.now();let clock,rawReader,rawTrack,rawDone=false,previousDisplay,firstDisplay,lastDisplay;
    if(rawFrames && typeof MediaStreamTrackProcessor==='function'){
      rawTrack=video.srcObject.getVideoTracks()[0].clone();rawReader=new MediaStreamTrackProcessor({track:rawTrack,maxBufferSize:1}).readable.getReader();
      const strip=document.createElement('canvas');strip.width=canvas.width;strip.height=1;const rawContext=strip.getContext('2d',{willReadFrequently:true});
      (async()=>{try{while(!rawDone){const {value:frame,done}=await rawReader.read();if(done)break;try{if(!clock || performance.now()-start<1200)continue;const at=Date.now();rawContext.drawImage(frame,clock.x,clock.y,clock.width,1,0,0,clock.width,1);const pixels=rawContext.getImageData(0,0,clock.width,1).data;let stamp=0;for(let bit=0;bit<24;bit++){const p=Math.round(clock.width/24*(bit+.5))*4;if(pixels[p]+pixels[p+1]+pixels[p+2]>384)stamp+=2**bit;}const age=(at-stamp+2**24)%2**24;if(age<5000)rawAges.push(age);}finally{frame.close();}}}catch(error){if(!rawDone)throw error;}})();
    }
    await new Promise(resolve=>{const timer=setTimeout(resolve,8500);const sample=(_now,metadata)=>{
      // Timestamp before reading pixels: test analysis must not count as stream
      // delay. rVFC's expectedDisplayTime is the browser's presentation estimate.
      const displayTime=Date.now()+(metadata.expectedDisplayTime-performance.now());
      if(canvas.width!==video.videoWidth || canvas.height!==video.videoHeight){canvas.width=video.videoWidth;canvas.height=video.videoHeight;clock=undefined;}
      if(!clock){ctx.drawImage(video,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let marker=-1,run=0;
      for(let y=0;y<canvas.height;y++){let x=0;while(x<canvas.width){let p=(y*canvas.width+x)*4;if(pixels[p]>170 && pixels[p+1]<90 && pixels[p+2]>170){let a=x;while(x<canvas.width){p=(y*canvas.width+x)*4;if(pixels[p]<170||pixels[p+1]>90||pixels[p+2]<170)break;x++;}if(x-a>run){run=x-a;marker=y*canvas.width+a;}}else x++;}}
      if(marker>=0 && run>16){const x=marker%canvas.width,y=Math.floor(marker/canvas.width)+4,end=x+run;let cyan=end;
        while(cyan<canvas.width){const p=(y*canvas.width+cyan)*4;if(pixels[p]<90&&pixels[p+1]>170&&pixels[p+2]>170)break;cyan++;}
        if(cyan<canvas.width)clock={x:end,y,width:cyan-end};
      }
      }
      if(clock){
        // Read only the clock strip after locating it, rather than stalling
        // the guest renderer with a full-frame GPU readback on every sample.
        ctx.drawImage(video,clock.x,clock.y,clock.width,1,0,0,clock.width,1);
        const pixels=ctx.getImageData(0,0,clock.width,1).data,width=clock.width/24;let value=0;
        for(let bit=0;bit<24;bit++){const p=Math.round(width*(bit+0.5))*4;if(pixels[p]+pixels[p+1]+pixels[p+2]>384)value+=2**bit;}
        const age=((displayTime%2**24)-value+2**24)%2**24;if(age<5000 && performance.now()-start>1200){
          ages.push(age);
          if(previousDisplay!==undefined)frameIntervals.push(displayTime-previousDisplay);previousDisplay=displayTime;firstDisplay ??= displayTime;lastDisplay=displayTime;
          if(Number.isFinite(metadata.receiveTime)){const delay=metadata.expectedDisplayTime-metadata.receiveTime;receiveToDisplay.push(delay);sourceToReceive.push(age-delay);}
          if(Number.isFinite(metadata.processingDuration))processing.push(metadata.processingDuration*1000);
        }
      }
      if(performance.now()-start>6500){clearTimeout(timer);resolve();}else video.requestVideoFrameCallback(sample);
    };video.requestVideoFrameCallback(sample);});
    rawDone=true;await rawReader?.cancel();rawTrack?.stop();
    const stats=[...(await window.latencyPC.getStats()).values()].find(s=>s.type==='inbound-rtp'&&s.kind==='video');
    const median=values=>{values.sort((a,b)=>a-b);return values.length?values[Math.floor(values.length*.5)]:null;};
    const playoutDelayNegotiated=window.latencyPC.getReceivers().find(receiver=>receiver.track.kind==='video')?.getParameters().headerExtensions?.some(extension=>extension.uri.endsWith('/playout-delay'));
    const medianMs=median(ages),frameIntervalMedianMs=median(frameIntervals);return {samples:ages.length,medianMs,p95Ms:ages[Math.floor(ages.length*.95)],frameIntervalMedianMs,frameIntervalP95Ms:frameIntervals[Math.floor(frameIntervals.length*.95)],measuredFPS:lastDisplay>firstDisplay?(ages.length-1)*1000/(lastDisplay-firstDisplay):null,sourceToReceiveMs:median(sourceToReceive),receiveToDisplayMs:median(receiveToDisplay),frameProcessingMs:median(processing),rawFrameAvailableMs:median(rawAges),playoutDelayNegotiated,fps:stats.framesPerSecond,bufferMs:stats.jitterBufferEmittedCount?stats.jitterBufferDelay/stats.jitterBufferEmittedCount*1000:null,decodeMs:stats.framesDecoded?stats.totalDecodeTime/stats.framesDecoded*1000:null};
  },{rawFrames:process.env.LATENCY_RAW_FRAMES==='1'});
  assert.ok(result.samples>30,`Not enough readable clock frames: ${JSON.stringify(result)}`);
  if(process.env.LATENCY_MAX_MS)assert.ok(result.medianMs<Number(process.env.LATENCY_MAX_MS),`Preview delay exceeded budget: ${JSON.stringify(result)}`);
  if(throughUI){assert.match(await page.locator('#hostPreviewStats').textContent(),browserCapture?/fps/:/fps.*playback buffer/);await fs.mkdir('.local/screenshots',{recursive:true});await page.locator('#hostMonitor').screenshot({path:'.local/screenshots/preview-performance.png'});if(guestView && !comparison)await measured.locator('#clientStage').screenshot({path:'.local/screenshots/guest-performance.png'});}
  await measured.evaluate(()=>window.stopComparison?.());
  if(process.env.LATENCY_ENCODER && !browserCapture)assert.equal(offer.encoder,process.env.LATENCY_ENCODER,'Encoder comparison must not silently use a fallback');
  const nativeDelivery=engine?await Promise.all([...engine.peers.keys()].map(async id=>({preview:id==='preview',...await engine.rpc({type:'stats',peerId:id}).catch(()=>({}))}))):undefined;
  const decodedCodec=await measured.evaluate(async()=>{const stats=await window.latencyPC.getStats(),stream=[...stats.values()].find(value=>value.type==='inbound-rtp' && value.kind==='video');return stats.get(stream?.codecId)?.mimeType;});
  if(process.env.LATENCY_CODEC==='h265')assert.equal(decodedCodec,'video/H265','Codec test must decode actual H.265 rather than a fallback');
  const report={generatedAt:new Date().toISOString(),browser:process.env.LATENCY_BROWSER_CHANNEL || 'msedge',decodedCodec,nativeDelivery,captureMethod:browserCapture?'browser':'native',encoder:offer.encoder,scaling:offer.scaling,gpuScaling:engine?.preferredGPUScale,gpuScaleError:engine?.gpuScaleError,throughUI,guestView,receiverHint:throughUI || process.env.LATENCY_RECEIVER==='1',audio:offer.audioAvailable,requestedFPS:fps,resolution:process.env.LATENCY_RESOLUTION || 'default',qsvDepth:process.env.NATIVE_QSV_ASYNC_DEPTH || '1',nvencPreset:process.env.NATIVE_NVENC_PRESET || 'p1',comparison,...result};
  if(process.env.LATENCY_REPORT){
    assert.match(process.env.LATENCY_REPORT,/^[a-z0-9-]{1,60}$/,'Use a short alphanumeric report name');
    const folder=path.resolve('.local/benchmarks/guest');await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,process.env.LATENCY_REPORT+'.json'),JSON.stringify(report,null,2)+'\n');
  }
  console.log(JSON.stringify(report));
}finally{engine?.close();await browser?.close();await app?.close();child?.stdin.end();child?.kill();}
