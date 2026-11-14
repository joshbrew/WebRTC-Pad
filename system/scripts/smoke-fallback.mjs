import {launchTestBrowser} from './browser-fixture.mjs';
// Test-only self-signed TLS endpoint stands in for a forwarded Caddy/WSS listener.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/server.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'webrtc-pad-tls-'));
const certPath = path.join(temp, 'cert.pem'), keyPath = path.join(temp, 'key.pem'),configPath=path.join(temp,'openssl.cnf');
let hostApp, playerApp, browser; const writes = [], errors = [];
const until = async predicate => { const end = Date.now() + 15000; while (!predicate()) { if (Date.now() > end) throw new Error('Recovered input did not arrive'); await new Promise(r => setTimeout(r, 20)); } };
try {
  await fs.writeFile(configPath,'[req]\ndistinguished_name=dn\n[dn]\n');
  execFileSync(process.env.OPENSSL_BIN || 'openssl', ['req', '-config',configPath,'-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'pipe', windowsHide: true });
  const reserve = net.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening'); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const hostOrigin = `https://127.0.0.1:${port}`;
  hostApp = createApp({ platform: 'linux', env: { PLAYER_COUNT: '8', PUBLIC_URL: hostOrigin, SIGNALING_FALLBACK: '1', TLS_CERT: certPath, TLS_KEY: keyPath }, createInjector: async () => ({ name: 'Eight-slot test driver', setState(slot, state) { writes.push({ slot, state }); }, close() {} }) });
  playerApp = createApp({ env: {}, createInjector: async () => { throw new Error('Player does not need a driver'); } });
  hostApp.server.listen(port, '127.0.0.1'); await once(hostApp.server, 'listening');
  playerApp.server.listen(0, '127.0.0.1'); await once(playerApp.server, 'listening');
  const playerOrigin = `http://127.0.0.1:${playerApp.server.address().port}`;
  browser = await launchTestBrowser(chromium,{ ...(process.env.BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.BROWSER_CHANNEL || 'msedge'}), headless: true, args: ['--ignore-certificate-errors', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.route('**/ice?*',route=>route.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.addInitScript(() => {localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    localStorage.setItem('webrtc-pad:capture-method', 'browser'); localStorage.setItem('webrtc-pad:tour-v1:host', 'seen'); localStorage.setItem('webrtc-pad:tour-v1:client', 'seen');
    const Original = window.RTCPeerConnection; window.__pcs = [];
    window.RTCPeerConnection = class extends Original { constructor(...args) { super(...args); window.__pcs.push(this); } };
    const send=RTCDataChannel.prototype.send;
    window.qualityRequests=[];
    window.viewMessages=[];
    RTCDataChannel.prototype.send=function(value){
      if(typeof value==='string' && value.includes('"view-quality-request"'))window.qualityRequests.push(JSON.parse(value));
      if(typeof value==='string' && /"view-(open|offer|answer|error)"/.test(value)){
        const {type,sourceId,requestId,token,error}=JSON.parse(value);
        window.viewMessages.push({type,sourceId,requestId,token,error});
      }
      return send.call(this,value);
    };
  });
  const host = await context.newPage(); host.on('pageerror', e => errors.push(e.message));
  await host.addInitScript(() => {localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    let captures=0;
    navigator.mediaDevices.getDisplayMedia = async ({audio}) => {
      const canvas=document.createElement('canvas');
      [canvas.width,canvas.height]=captures++?[640,480]:[640,360];
      const ctx=canvas.getContext('2d');let n=0;
      setInterval(()=>{ctx.fillStyle=`hsl(${n++ % 360},70%,30%)`;ctx.fillRect(0,0,canvas.width,canvas.height);},30);
      const stream=canvas.captureStream(30);
      if(audio){
        const context=new AudioContext(),oscillator=context.createOscillator(),output=context.createMediaStreamDestination();
        oscillator.connect(output);oscillator.start();await context.resume();
        stream.addTrack(output.stream.getAudioTracks()[0]);
      }
      return stream;
    };
  });
  await host.goto(hostOrigin); await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostDynamicControllers').uncheck();await host.locator('#hostControllerCount').selectOption('8');await host.locator('#hostCreate').click(); await host.waitForFunction(() => !document.querySelector('#createInvitation').disabled);
  await host.locator('#invitationRole').evaluate(el=>el.add(new Option('Protocol fixture: player 8','p8')));
  await host.locator('#invitationRole').selectOption('p8'); await host.locator('#createInvitation').click();
  await host.waitForFunction(() => !!document.querySelector('#hostInvitation').value, null, { timeout: 45000 });
  const invitation = await host.locator('#hostInvitation').inputValue(); assert.equal(JSON.parse(invitation).slot, 'p8'); assert.ok(JSON.parse(invitation).fallback);
  const player = await context.newPage(); player.on('pageerror', e => errors.push(e.message));
  await player.goto(playerOrigin); await player.locator('#modeClient').click();
  await player.locator('#clientInvitationFile').setInputFiles({ name: 'invite.txt', mimeType: 'text/plain', buffer: Buffer.from(invitation) });
  await player.waitForFunction(() => !!document.querySelector('#clientReply').value, null, { timeout: 45000 });
  await host.locator('#hostReplyFile').setInputFiles({ name: 'reply.txt', mimeType: 'text/plain', buffer: Buffer.from(await player.locator('#clientReply').inputValue()) });
  await player.waitForFunction(() => document.querySelector('#clientConnectionText').textContent === 'Connected');
  await player.waitForFunction(() => document.querySelector('#clientFallbackStatus').textContent.includes('automatic recovery available'));
  await host.locator('#hostCapture').click(); await player.waitForFunction(() => document.querySelector('#clientVideo').videoWidth > 0);
  await host.locator('#hostCallAddScreen').click();
  if(await host.locator('#hostExtraSource').isVisible())await host.locator('#hostExtraShares').getByRole('button',{name:'Choose with browser…'}).click();
  await player.waitForFunction(()=>document.querySelector('#clientSharedView').options.length===2);
  const secondary=await player.locator('#clientSharedView option').nth(1).getAttribute('value');
  await player.locator('#clientStage .single-view-picker select').selectOption(secondary);
  await player.waitForFunction(()=>document.querySelector('#clientVideo').videoHeight===480);
  await host.locator('#hostShareStrip .share-chip-sound').last().click();
  await player.waitForFunction(()=>document.querySelector('#clientAudio').srcObject?.getAudioTracks().length>0);
  const quick=player.getByRole('dialog',{name:'Screen quick controls'});
  await player.locator('#clientStage > .single-screen-quick').click();
  await quick.getByRole('button',{name:'Mute sound',exact:true}).click();
  await quick.getByLabel('Resolution limit').selectOption('360');
  await quick.getByLabel('Adaptive quality').uncheck();
  await player.waitForFunction(()=>document.querySelector('#clientVideo').videoHeight===360 && document.querySelector('#clientHostLimit').textContent.includes('Fixed quality'));
  await player.keyboard.press('Escape');
  await player.locator('#clientCallControllers').click();
  await player.locator('#controllerAdvanced').evaluate(el=>el.open=true);
  await player.locator('#inputSource').selectOption('keyboard');
  if(await player.locator('#clientEnablePad').getAttribute('aria-pressed')!=='true')await player.locator('#clientEnablePad').click();
  await player.locator('#controllersSheet .help-button').click();
  await player.locator('#clientStage').focus();
  await player.keyboard.down('z');
  await until(()=>writes.some(w=>w.slot==='p8' && w.state.buttons.a));
  await player.keyboard.up('z');
  await player.locator('#clientTileControls [data-layout=grid]').click();
  const [grid]=await Promise.all([player.waitForEvent('popup'),player.locator('#clientFloatScreens').click()]);
  const stacked=grid.getByRole('button',{name:'Top and bottom'});
  await stacked.focus();await stacked.press('Enter');
  await grid.waitForFunction(()=>[...document.querySelectorAll('.floating-screen video')].filter(video=>video.readyState>=2).length===2);
  await grid.evaluate(()=>{
    const source=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'srcObject');
    const cards=[...document.querySelectorAll('.floating-screen')];
    window.originalCards=cards;
    window.emptyVideoWrites=0;
    for(const card of cards){
      const video=card.querySelector('video');
      video.originalTrack=video.srcObject.getVideoTracks()[0];
      Object.defineProperty(video,'srcObject',{...source,set(value){
        if(!value?.getVideoTracks().length)window.emptyVideoWrites++;
        source.set.call(this,value);
      }});
    }
  });
  await player.locator('#clientTileControls [data-layout=single]').click();
  await player.locator('#clientViewPopouts').evaluate(el=>el.open=true);
  const popoutButton=player.locator('#clientViewPopouts button').nth(1);
  const [popout]=await Promise.all([player.waitForEvent('popup'),popoutButton.evaluate(el=>el.click())]);
  await popout.waitForFunction(()=>(document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames || 0)>3);
  await popout.evaluate(()=>{
    const source=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'srcObject');
    const video=document.querySelector('video');
    window.previousTrack=video.srcObject.getVideoTracks()[0];
    window.emptyVideoWrites=0;
    Object.defineProperty(video,'srcObject',{...source,set(value){
      if(!value?.getVideoTracks().length)window.emptyVideoWrites++;
      source.set.call(this,value);
    }});
  });
  const before = await player.evaluate(() => window.__pcs.length);
  await player.evaluate(()=>{window.qualityRequests.length=0;});
  await player.evaluate(() => window.__pcs.find(pc => pc.getTransceivers().length === 0 && pc.connectionState === 'connected').close());
  await player.waitForFunction(n => window.__pcs.length > n && window.__pcs.at(-1).connectionState === 'connected', before, { timeout: 45000 });
  await player.waitForFunction(() => document.querySelector('#clientVideo').videoWidth > 0 && !document.querySelector('#clientEnablePad').disabled);
  assert.equal(await player.locator('#clientSlot').textContent(), 'P8');
  await player.waitForFunction(id=>document.querySelector('#clientSharedView').value===id &&
    document.querySelector('#clientHostLimit').textContent.includes('Fixed quality') &&
    document.querySelector('#clientVideo').videoHeight===360 &&
    window.qualityRequests.some(request=>request.sourceId===id && request.quality.resolution==='360'),secondary);
  await popout.waitForFunction(()=>{
    const video=document.querySelector('video');
    return video.srcObject?.getVideoTracks()[0]!==window.previousTrack && video.readyState>=2 &&
      video.videoHeight===360 && document.querySelector('[role=status]').hidden;
  }).catch(async error=>{
    console.log('Pop-out recovery state',await popout.evaluate(()=>({
      picture:document.querySelector('video').videoHeight,
      track:document.querySelector('video').srcObject?.getVideoTracks()[0]?.id,
      status:document.querySelector('[role=status]').textContent,
    })),await player.evaluate(()=>window.viewMessages),await host.evaluate(()=>window.viewMessages));
    throw error;
  });
  assert.equal(await popout.evaluate(()=>window.emptyVideoWrites),0,'Recovery keeps the existing pop-out attached until replacement is ready');
  await grid.waitForFunction(()=>window.originalCards.every(card=>{
    const video=card.querySelector('video');
    return card.isConnected && video.readyState>=2 &&
      video.srcObject?.getVideoTracks()[0]!==video.originalTrack &&
      card.querySelector('[role=status]').hidden;
  }));
  assert.equal(await grid.locator('.floating-screens-grid').getAttribute('data-layout'),'stacked');
  assert.equal(await grid.evaluate(()=>window.emptyVideoWrites),0,'The multi-screen window keeps both pictures attached during recovery');
  await player.locator('#clientTileControls [data-layout=single]').evaluate(el=>el.click());
  await player.locator('#clientStage > .single-screen-quick').click();
  assert.equal(await quick.getByLabel('Resolution limit').inputValue(),'360');
  assert.equal(await quick.getByLabel('Adaptive quality').isChecked(),false);
  assert.equal(await quick.getByRole('button',{name:'Unmute sound',exact:true}).isVisible(),true);
  await player.keyboard.press('Escape');
  await player.bringToFront();
  await player.waitForFunction(()=>document.hasFocus() && !document.hidden &&
    document.querySelector('#clientEnablePad').getAttribute('aria-pressed')==='true');
  await player.locator('#clientStage').focus();writes.length=0;
  await player.keyboard.down('z');
  await until(()=>writes.some(w=>w.slot==='p8' && w.state.buttons.a)).catch(async error=>{
    console.log('Recovered controller state',await player.evaluate(()=>({
      focused:document.hasFocus(),source:document.querySelector('#inputSource').value,
      enabled:document.querySelector('#clientEnablePad').getAttribute('aria-pressed'),
      status:document.querySelector('#clientStatus').textContent,
    })),writes.slice(-2));
    throw error;
  });
  await player.keyboard.up('z');
  await Promise.all([popout.waitForEvent('close',{timeout:4000}),grid.waitForEvent('close',{timeout:4000}),player.locator('#clientDisconnect').evaluate(el=>el.click())]);
  assert.deepEqual(errors, []);
  console.log('PASS: higher player slot P8 receives video and input after a complete RTC connection is replaced via authenticated WSS fallback');
  console.log('PASS: both apps stay on their own localhost; no new pairing files are exchanged during recovery');
  console.log('PASS: the selected secondary screen, fixed resolution and local mute survive connection replacement');
  console.log('PASS: the same pop-out resumes at the requested quality and closes when leaving the call');
  console.log('PASS: the multi-screen pop-out keeps both views and its stacked layout through recovery');
} finally {
  await browser?.close(); await hostApp?.close(); await playerApp?.close();
  await fs.unlink(certPath).catch(() => {}); await fs.unlink(keyPath).catch(() => {});await fs.unlink(configPath).catch(()=>{}); await fs.rmdir(temp);
}
