import {launchTestBrowser} from './browser-fixture.mjs';
// Real local capture and OS clicks, confined to harmless windows created by this test.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const fixture=spawn(process.env.PYTHON || 'python',['-u','system/scripts/mouse-target-fixture.py'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
let info,fixtureError='',fixtureCommand;const counts={A:0,B:0},errors=[];
fixture.stderr.on('data',b=>{fixtureError+=b;});
createInterface({input:fixture.stdout}).on('line',line=>{const v=JSON.parse(line);if(v.event==='ready'){info=v.windows;fixtureCommand=v.command;}if(v.event==='click'){counts[v.name]=v.count;console.log(`Native window ${v.name}: ${v.count} real OS clicks`);}});
const until=async(fn,label)=>{const end=Date.now()+15000;while(!fn()){if(Date.now()>end)throw new Error(label+' '+fixtureError);await new Promise(r=>setTimeout(r,30));}};
const app=createApp({env:{...process.env},createInjector:async()=>({name:'Mouse acceptance test',setState(){},close(){}})});
let hostBrowser,guestBrowser,host,guest;
try {
  await until(()=>info,'Test windows did not open');
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`;
  hostBrowser=await launchTestBrowser(chromium,{channel:'msedge',headless:true});
  guestBrowser=await launchTestBrowser(chromium,{channel:'msedge',headless:false,args:['--window-position=850,40','--window-size=1450,1300','--force-device-scale-factor=1','--disable-background-timer-throttling']});
  const hc=await hostBrowser.newContext(),gc=await guestBrowser.newContext({viewport:null});
  for(const ctx of [hc,gc])await ctx.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:hostPreviewAutoPause','false');});
  host=await hc.newPage();guest=await gc.newPage();for(const page of [host,guest]){page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));}
  await host.goto(origin);await guest.goto(origin+'/?mode=join');await guest.evaluate(()=>document.title='WebRTC real mouse test client');
  await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostDynamicControllers').uncheck();await host.locator('#hostCreate').click();await host.locator('#hostSettings').evaluate(el=>el.open=true);
  await host.locator('#captureOptions').evaluate(el=>el.open=true);
  await host.locator('#captureBackend').selectOption('native');await host.locator('#streamFramerate').selectOption('30');await host.locator('#hostAutoThrottle').uncheck();await host.locator('#hostPreviewToggle').uncheck();
  await host.locator('#createInvitation').click();await host.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);
  await guest.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});
  await guest.waitForFunction(()=>!!document.querySelector('#clientReply').value);
  await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await guest.locator('#clientReply').inputValue())});
  await guest.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Connected');
  await host.waitForFunction(id=>[...document.querySelector('#captureTarget').options].some(o=>o.value===id),info.A.id);
  await host.locator('#captureTarget').selectOption(info.A.id);
  await guest.waitForFunction(()=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>8,null,{timeout:45000});
  await host.locator('#hostDesktopMouse').check();await guest.locator('#clientDesktopMouse').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await guest.locator('#clientDesktopMouse').check();
  async function click(x,y){
    await guest.bringToFront();await guest.locator('#clientStage').focus();
    const point=await guest.locator('#clientVideo').evaluate((v,p)=>{const r=v.getBoundingClientRect(),s=Math.min(r.width/v.videoWidth,r.height/v.videoHeight);return {x:r.x+(r.width-v.videoWidth*s)/2+p.x*v.videoWidth*s,y:r.y+(r.height-v.videoHeight*s)/2+p.y*v.videoHeight*s};},{x,y});
    await guest.mouse.click(point.x,point.y,{delay:100});
  }
  await click(info.A.x/info.A.width,info.A.y/info.A.height);await until(()=>counts.A>=1,'Window-only click did not reach A');assert.equal(counts.B,0);
  fixture.stdin.write(JSON.stringify({type:'move'})+'\n');await until(()=>info.A.width===560,'Moved window metadata unavailable');
  await guest.waitForFunction(()=>document.querySelector('#clientDesktopNote').textContent.includes('560 × 400'));
  await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoWidth===560 && document.querySelector('#clientVideo').videoHeight===400,null,{timeout:30000});
  await click(info.A.x/info.A.width,info.A.y/info.A.height);await until(()=>counts.A>=2,'Moved/resized window click failed');
  console.log('PASS: real shared-window clicks and live move/resize mapping');
  fixture.stdin.write(JSON.stringify({type:'cover'})+'\n');await until(()=>fixtureCommand==='cover','Occluding test window did not move');
  assert.ok(info.B.left<=info.A.left+info.A.x && info.B.top<=info.A.top+info.A.y && info.B.left+info.B.width>info.A.left+info.A.x && info.B.top+info.B.height>info.A.top+info.A.y,'Unshared test window must actually cover the target button');
  const beforeA=counts.A;await click(info.A.x/info.A.width,info.A.y/info.A.height);await new Promise(r=>setTimeout(r,500));assert.equal(counts.A,beforeA);assert.equal(counts.B,0,'Covered shared window must not click the covering app');
  fixture.stdin.write(JSON.stringify({type:'uncover'})+'\n');await until(()=>fixtureCommand==='uncover','Cover did not move away');
  console.log('PASS: window-only mouse cannot click an overlapping unshared window');
  await host.locator('#hostStopCapture').click();await guest.waitForFunction(()=>document.querySelector('#clientDesktopMouse').disabled);assert.equal(await host.locator('#hostDesktopMouse').isChecked(),false);
  await host.locator('#captureTarget').selectOption('desktop');
  await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoWidth>1000,null,{timeout:45000});
  // Screen sharing alone must not grant mouse control.
  assert.equal(await host.locator('#hostDesktopFull').isChecked(),false);assert.equal(await guest.locator('#clientDesktopMouse').isDisabled(),true);
  await host.locator('#hostDesktopScope').selectOption('desktop');await host.locator('#hostDesktopMouse').check();await guest.locator('#clientDesktopMouse').check();
  const display=[...app.rooms.values()][0].desktop.display;
  await click((info.B.left+info.B.x)/display.width,(info.B.top+info.B.y)/display.height);await until(()=>counts.B>=1,'Full-screen client click did not reach B');
  console.log('PASS: entire screen streamed over real WebRTC; separate full-screen permission required; client click reached native window B');
  await host.locator('#hostDesktopScope').selectOption('window');await guest.waitForFunction(()=>document.querySelector('#clientDesktopMouse').disabled);
  await host.locator('#hostStopCapture').click();await host.locator('#captureTarget').selectOption(info.A.id);
  await guest.waitForFunction(()=>document.querySelector('#clientVideo').videoWidth===560,null,{timeout:30000});
  await host.locator('#hostDesktopMouse').check();await guest.locator('#clientDesktopMouse').check();
  fixture.stdin.write(JSON.stringify({type:'close'})+'\n');await guest.waitForFunction(()=>document.querySelector('#clientDesktopMouse').disabled);
  assert.equal(await host.locator('#hostDesktopMouse').isChecked(),false);
  assert.equal(await guest.locator('#clientConnectionText').textContent(),'Connected');assert.equal(await guest.locator('#clientEnablePad').isEnabled(),true);
  console.log('PASS: closing the shared native window revokes mouse access and stops its capture');
  assert.deepEqual(errors,[]);console.log('PASS: permission revocation disables guest mouse; no page errors');
} catch(error) {console.error(error);console.log('Counts:',counts);if(host)console.log('Host:',await host.evaluate(()=>({status:document.querySelector('#hostStatus').textContent,capture:document.querySelector('#captureStatus').textContent,source:document.querySelector('#captureTarget').value})));if(guest)console.log('Guest:',await guest.evaluate(()=>({status:document.querySelector('#clientStatus').textContent,note:document.querySelector('#clientVideoNote')?.textContent})));console.log('Errors:',errors);throw error;}
finally {await guestBrowser?.close();await hostBrowser?.close();await app.close();if(!fixture.stdin.destroyed)fixture.stdin.end();setTimeout(()=>fixture.kill(),1000).unref();}
