import {launchTestBrowser} from './browser-fixture.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/server.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const writes = [], errors = [];
const app = createApp({ env: {...(process.env.NATIVE_MEDIA_HELPER?{NATIVE_MEDIA_HELPER:process.env.NATIVE_MEDIA_HELPER}:{})}, createInjector: async () => ({ name: 'Native UI test', setState(slot, state) { writes.push({ slot, state }); }, close() {} }) });
let browser;
try {
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  browser = await launchTestBrowser(chromium,{ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    localStorage.setItem('webrtc-pad:capture-method', 'browser'); localStorage.setItem('webrtc-pad:tour-v1:host', 'seen'); localStorage.setItem('webrtc-pad:tour-v1:client', 'seen');
    const Original = window.RTCPeerConnection; window.__pcs = []; window.__channels = [];
    const record = channel => {
      window.__channels.push(channel); channel.__send = channel.send.bind(channel);
      channel.send = value => { if (window.__suppressMetrics && typeof value === 'string' && JSON.parse(value).type === 'stream-metrics') return; channel.__send(value); };
    };
    window.RTCPeerConnection = class extends Original {
      constructor(...args) { super(...args); window.__pcs.push(this); this.addEventListener('datachannel', event => record(event.channel)); }
      createDataChannel(...args) { const channel = super.createDataChannel(...args); record(channel); return channel; }
    };
  });
  const page = async () => { const value = await context.newPage(); value.on('pageerror', error => errors.push(error.message)); await value.goto(origin); return value; };
  const host = await page();
  await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostDynamicControllers').uncheck();await host.locator('#hostCreate').click(); await host.waitForFunction(() => !document.querySelector('#createInvitation').disabled);
  await host.locator('#hostSettings').evaluate(el => { el.open = true; });
  await host.locator('#hostPreviewAutoPause').uncheck();
  await host.locator('#captureOptions').evaluate(el=>el.open=true);
  await host.locator('#captureBackend').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});
  await host.locator('#captureBackend').selectOption('native'); await host.locator('#streamFramerate').selectOption('30'); await host.locator('#hostAutoThrottle').uncheck();
  await host.locator('#captureTarget').selectOption('desktop');
  try { await host.waitForFunction(() => document.querySelector('#hostPreview').videoHeight === 1080, null, { timeout: 45000 }); }
  catch(error) { console.log('Native preview:',await host.evaluate(()=>({width:document.querySelector('#hostPreview').videoWidth,height:document.querySelector('#hostPreview').videoHeight,status:document.querySelector('#hostStatus').textContent,capture:document.querySelector('#captureStatus').textContent})));throw error; }
  async function join() {
    const previous = await host.locator('#hostInvitation').inputValue();await host.locator(previous?'#newInvitation':'#createInvitation').click();
    await host.waitForFunction(previous => !!document.querySelector('#hostInvitation').value && document.querySelector('#hostInvitation').value !== previous, previous, { timeout: 45000 });
    const player = await page(); await player.locator('#modeClient').click();
    await player.locator('#clientAutoThrottle').evaluate(el => { el.closest('details').open = true; });
    await player.locator('#clientAutoThrottle').uncheck();
    await player.locator('#clientInvitationFile').setInputFiles({ name: 'native-invite.txt', mimeType: 'text/plain', buffer: Buffer.from(await host.locator('#hostInvitation').inputValue()) });
    await player.waitForFunction(() => !!document.querySelector('#clientReply').value, null, { timeout: 45000 });
    await host.locator('#hostReplyFile').setInputFiles({ name: 'native-reply.txt', mimeType: 'text/plain', buffer: Buffer.from(await player.locator('#clientReply').inputValue()) });
    try { await player.waitForFunction(() => document.querySelector('#clientVideo').videoHeight === 1080, null, { timeout: 35000 }); }
    catch (error) {
      console.log('HOST', await host.evaluate(() => ({ status: document.querySelector('#hostStatus').textContent, capture: document.querySelector('#captureStatus').textContent, states: window.__pcs.map(pc => pc.connectionState) })));
      console.log('PLAYER', await player.evaluate(async () => ({ status: document.querySelector('#clientStatus').textContent, width: document.querySelector('#clientVideo').videoWidth, tracks: document.querySelector('#clientVideo').srcObject?.getTracks().map(track => ({ kind: track.kind, muted: track.muted, id: track.id })), peers: await Promise.all(window.__pcs.map(async pc => ({ state: pc.connectionState, media: [...(await pc.getStats()).values()].filter(stat => stat.type === 'inbound-rtp').map(stat => ({ bytes: stat.bytesReceived, frames: stat.framesDecoded, width: stat.frameWidth })) }))) })));
      console.log('Native profiles', [...app.rooms.values()][0]?.native?.profiles.size, 'browser errors', errors); throw error;
    }
    return player;
  }
  const player = await join();
  await player.waitForFunction(() => document.querySelector('#clientVideoStats').textContent.includes('1080'));
  await host.locator('#streamFramerate').selectOption('60');
  await player.waitForFunction(async () => {
    const peers = window.__pcs.filter(pc => pc.connectionState === 'connected' && pc.getTransceivers().length);
    return (await Promise.all(peers.map(pc => pc.getStats()))).some(stats => [...stats.values()].some(s => s.type === 'inbound-rtp' && s.kind === 'video' && s.framesPerSecond > 45));
  }, null, { timeout: 45000 });
  console.log('PASS: changing native host capture from 30 to 60 fps produces more than 45 decoded frames/sec on the client');
  await host.locator('#streamFramerate').selectOption('30');
  await player.waitForFunction(() => document.querySelector('#clientHostLimit').textContent.includes('30 fps'), null, { timeout: 45000 });
  await player.locator('#clientResolution').selectOption('720'); await player.locator('#clientFramerate').selectOption('15');
  await player.waitForFunction(() => document.querySelector('#clientVideo').videoHeight === 720, null, { timeout: 45000 });
  const second = await join();
  assert.equal(await player.locator('#clientVideo').evaluate(video => video.videoHeight), 720);
  assert.equal(await second.locator('#clientVideo').evaluate(video => video.videoHeight), 1080);
  const native = [...app.rooms.values()][0].native;
  assert.equal(native.profiles.size, 2, 'Same full-HD quality must share one encoder with preview; lower client gets another profile');
  await host.locator('#hostPreviewToggle').uncheck();
  const previewDeadline=Date.now()+10000; while(native.peers.has('preview') && Date.now()<previewDeadline) await new Promise(r=>setTimeout(r,30));
  assert.equal(native.peers.has('preview'),false,'Preview off releases its local native receiving connection');
  const frames=await second.locator('#clientVideo').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames);
  await second.waitForFunction(n=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>n+12,frames);
  await host.locator('#hostPreviewToggle').check(); await host.waitForFunction(()=>document.querySelector('#hostPreview').videoHeight===1080 && !!document.querySelector('#hostPreview').srcObject);
  assert.equal(native.peers.has('preview'),true);
  console.log('PASS: disabling native host preview releases only preview; both guest streams continue and preview reconnects');
  await host.locator('#modeClient').click();
  const modeDeadline=Date.now()+10000;while(native.peers.has('preview') && Date.now()<modeDeadline)await new Promise(r=>setTimeout(r,30));
  assert.equal(native.peers.has('preview'),false,'Join tab releases the native preview receiver');
  const modeFrames=await second.locator('#clientVideo').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames);
  await second.waitForFunction(n=>document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>n+12,modeFrames);
  await host.locator('#modeHost').click();await host.waitForFunction(()=>document.querySelector('#hostPreview').videoHeight===1080 && !!document.querySelector('#hostPreview').srcObject);
  assert.equal(native.peers.has('preview'),true);assert.equal(native.profiles.size,2,'Returning to Host reuses the matching native encoder');
  console.log('PASS: tab changes release and restore only the native preview while guest frames keep advancing');
  await player.bringToFront(); await player.locator('#inputSource').selectOption('keyboard'); await player.locator('#clientEnablePad').click(); await player.locator('#clientVideo').click(); await player.keyboard.down('z');
  const deadline = Date.now() + 5000; while (!writes.some(write => write.slot === 'p1' && write.state.buttons.a) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(writes.some(write => write.slot === 'p1' && write.state.buttons.a)); await player.keyboard.up('z');
  await player.waitForFunction(() => document.querySelector('#clientDecode').textContent !== '—');
  console.log('PASS: native screen capture integrates with text pairing, live latency/decoder stats, controller input, and independent 720p/1080p client limits; matching profiles share encoding');
  const beforeRefresh=await player.evaluate(()=>window.__pcs.length),controlDescription=await player.evaluate(()=>window.__pcs[0].localDescription.sdp);
  await player.locator('#clientRefreshVideo').click();
  await player.waitForFunction(count=>window.__pcs.length>count && document.querySelector('#clientVideo').videoHeight===720 && window.__pcs.at(-1).connectionState==='connected',beforeRefresh,{timeout:45000});
  assert.equal(await player.evaluate(()=>window.__pcs[0].localDescription.sdp),controlDescription);assert.equal(native.profiles.size,2);
  console.log('PASS: manual native picture refresh keeps the control peer and matching encoder profiles');
  await player.evaluate(() => { window.__suppressMetrics = true; });
  await host.locator('#hostAutoThrottle').check();
  await player.waitForTimeout(8500);
  for (let i = 0; i < 2; i++) { await player.evaluate(() => window.__channels.find(channel => channel.label === 'control').__send(JSON.stringify({ type: 'stream-metrics', metrics: { loss: .2, rttMs: 300, bufferMs: 200 } }))); await player.waitForTimeout(1200); }
  await player.waitForFunction(() => document.querySelector('#clientVideo').videoHeight < 720, null, { timeout: 45000 });
  try{await second.waitForFunction(()=>document.querySelector('#clientVideo').videoHeight===1080,null,{timeout:15000});}
  catch(error){
    console.log('Other guest after adaptation:',await second.evaluate(async()=>({status:document.querySelector('#clientStatus').textContent,peers:await Promise.all(window.__pcs.map(async pc=>({state:pc.connectionState,video:[...(await pc.getStats()).values()].filter(s=>s.type==='inbound-rtp'&&s.kind==='video').map(s=>({width:s.frameWidth,frames:s.framesDecoded,bytes:s.bytesReceived}))})))})));
    console.log('Profiles:',[...native.profiles].map(([key,p])=>({key,refs:p.refs,exit:p.child?.exitCode})));throw error;
  }
  assert.equal(await second.locator('#clientVideo').evaluate(video => video.videoHeight), 1080);
  console.log('PASS: host automatic throttling downscales only the slow native client while the other client retains full HD');
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await app.close(); }
