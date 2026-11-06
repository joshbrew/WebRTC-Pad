import {launchTestBrowser} from './browser-fixture.mjs';
// Two separate local app instances exchange only the user-visible text packets.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/server.js';
import injection from '../src/inject/index.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const writes = [], errors = [];
const native = process.env.REAL_DRIVER === '1' ? await injection.createInjector() : null;
const hostEnv = process.env.TEST_RELAY === '1' ? { ...process.env, ICE_TRANSPORT_POLICY: 'relay' } : {};
const hostApp = createApp({ env: hostEnv, createInjector: async () => ({ name: native?.name || 'Pairing test driver', setState(slot, state) { native?.setState(slot, state); writes.push({ slot, state }); }, close() { native?.close(); } }) });
const playerApp = createApp({ env: {}, createInjector: async () => { throw new Error('A player should never initialize a driver'); } });
let browser;
const until = async predicate => { const end = Date.now() + 10000; while (!predicate()) { if (Date.now() > end) throw new Error('Input did not arrive'); await new Promise(r => setTimeout(r, 20)); } };
try {
  for (const app of [hostApp, playerApp]) { app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); }
  const hostOrigin = `http://127.0.0.1:${hostApp.server.address().port}`, playerOrigin = `http://127.0.0.1:${playerApp.server.address().port}`;
  if (process.env.TEST_RELAY === '1') {
    const relayConfig = await fetch(`${hostOrigin}/ice`).then(r => r.json());
    assert.ok(!relayConfig.warning && !relayConfig.error, 'Relay configuration must succeed for the integration test');
  }
  browser = await launchTestBrowser(chromium,{ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const context = await browser.newContext();
  await context.addInitScript(() => {localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    localStorage.setItem('webrtc-pad:capture-method', 'browser'); localStorage.setItem('webrtc-pad:tour-v1:host', 'seen'); localStorage.setItem('webrtc-pad:tour-v1:client', 'seen');
    const Original = window.RTCPeerConnection; window.__pcs = [];
    window.__iceErrors = [];
    window.RTCPeerConnection = class extends Original { constructor(...args) { super(...args); window.__pcs.push(this); this.addEventListener('icecandidateerror', e => window.__iceErrors.push({ url: e.url, code: e.errorCode, text: e.errorText })); } };
  });
  const host = await context.newPage(); host.on('pageerror', e => errors.push(e.message));
  await host.addInitScript(() => {localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360; const ctx = canvas.getContext('2d'); let frame = 0;
      setInterval(() => { ctx.fillStyle = `hsl(${frame++ % 360},80%,40%)`; ctx.fillRect(0, 0, 640, 360); }, 30);
      const stream = canvas.captureStream(30);
      const audio = new AudioContext(); const source = audio.createOscillator(); const destination = audio.createMediaStreamDestination();
      source.connect(destination); source.start(); await audio.resume(); stream.addTrack(destination.stream.getAudioTracks()[0]);
      return stream;
    };
  });
  await host.goto(hostOrigin); await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostDynamicControllers').uncheck();await host.locator('#hostControllerCount').selectOption('2');await host.locator('#hostCreate').click(); await host.waitForFunction(() => !document.querySelector('#createInvitation').disabled);
  await host.locator('#createInvitation').click();
  try { await host.waitForFunction(() => !!document.querySelector('#hostInvitation').value, null, { timeout: 45000 }); }
  catch (error) { console.log(await host.evaluate(() => ({ status: document.querySelector('#hostPairStatus').textContent, iceErrors: window.__iceErrors, gathering: window.__pcs.map(pc => ({ state: pc.iceGatheringState, candidates: (pc.localDescription?.sdp || '').split('\r\n').filter(l => l.startsWith('a=candidate:')).map(l => l.match(/ typ (\S+)/)?.[1]) })) }))); throw error; }
  const offer = await host.locator('#hostInvitation').inputValue();
  assert.ok(JSON.parse(offer).sdp.sdp.includes('a=candidate:'), 'Invitation must contain gathered ICE candidates');
  if (hostEnv.METERED_API_KEY) assert.ok(!offer.includes(hostEnv.METERED_API_KEY), 'API key must not be in the file');
  const player = await context.newPage(); player.on('pageerror', e => errors.push(e.message));
  const playerSockets = [];
  player.on('websocket', ws => playerSockets.push(ws.url()));
  await player.goto(playerOrigin); await player.locator('#modeClient').click(); await player.locator('#clientInvitation').evaluate(el => { for (let node = el.parentElement; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true; }); await player.locator('#clientInvitation').fill(offer); await player.locator('#createReply').click();
  await player.waitForFunction(() => !!document.querySelector('#clientReply').value, null, { timeout: 45000 });
  const reply = await player.locator('#clientReply').inputValue();
  assert.ok(JSON.parse(reply).sdp.sdp.includes('a=candidate:'), 'Reply must contain gathered ICE candidates');
  await host.locator('#hostReply').evaluate(el => { for (let node = el.parentElement; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true; }); await host.locator('#hostReply').fill(reply); await host.locator('#acceptReply').click();
  await player.waitForFunction(() => !document.querySelector('#clientEnablePad').disabled, null, { timeout: 20000 });
  assert.deepEqual(playerSockets, [], 'Manual player pairing must not use any signaling WebSocket');
  assert.equal(playerApp.rooms.size, 0, 'Player app must not need a room or driver');
  console.log('PASS: independent localhost apps pair using invitation/reply text, without a shared signaling server');
  await host.locator('#hostCapture').click(); await player.waitForFunction(() => document.querySelector('#clientVideo').videoWidth === 640);
  await player.waitForFunction(() => document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames > 3);
  console.log('PASS: video starts after manual pairing and arrives as decoded frames');
  await player.waitForFunction(async () => [...(await window.__pcs.at(-1).getStats()).values()].some(s => s.type === 'inbound-rtp' && s.kind === 'audio' && s.bytesReceived > 0));
  console.log('PASS: shared audio is encoded and received over WebRTC');
  await player.bringToFront(); await player.locator('#inputSource').selectOption('keyboard'); await player.locator('#clientEnablePad').click(); await player.locator('h2').last().click();
  writes.length = 0; await player.keyboard.down('z'); await until(() => writes.some(w => w.slot === 'p1' && w.state.buttons.a));
  if (native && process.platform === 'win32') {
    const pads = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['system/scripts/read-xinput.py'], { encoding: 'utf8', windowsHide: true }));
    assert.ok(pads.some(p => p.buttons === 0x1000)); console.log('PASS: text-paired browser input reaches the actual Windows virtual controller');
  }
  await player.keyboard.up('z'); await until(() => writes.at(-1)?.state.buttons.a === false);
  console.log('PASS: text-paired controller press and release reach the host backend');
  if (process.env.TEST_RELAY === '1') {
    const selected = await player.evaluate(async () => {
      const pc = window.__pcs.at(-1), stats = await pc.getStats();
      const transport = [...stats.values()].find(s => s.type === 'transport' && s.selectedCandidatePairId);
      const pair = stats.get(transport.selectedCandidatePairId);
      return { local: stats.get(pair.localCandidateId).candidateType, remote: stats.get(pair.remoteCandidateId).candidateType };
    });
    assert.equal(selected.local, 'relay'); assert.equal(selected.remote, 'relay');
    console.log(`PASS: ${process.env.TEST_SELF_HOSTED === '1' ? 'self-hosted coturn with temporary credentials' : 'Metered credential API'} and forced TURN relay carry the actual video and controller connection`);
  }
  await host.locator('.peerRow').getByRole('combobox', { name: 'Player assignment' }).selectOption('watch');
  await player.waitForFunction(() => document.querySelector('#clientSlot').textContent === 'Watching'); assert.equal(await player.locator('#clientEnablePad').isDisabled(), true);
  await host.locator('.peerRow').getByRole('combobox', { name: 'Player assignment' }).selectOption('p2');
  await player.waitForFunction(() => document.querySelector('#clientSlot').textContent === 'P2');
  await player.bringToFront(); writes.length = 0; await player.keyboard.down('x'); await until(() => writes.some(w => w.slot === 'p2' && w.state.buttons.b)); await player.keyboard.up('x');
  console.log('PASS: reliable peer control channel updates player assignment without exchanging files again');
  await host.locator('.peerRow').getByRole('button', { name: 'Refresh connection', exact: true }).click();
  try { await host.waitForFunction(() => document.querySelector('#hostStatus').textContent.includes('refreshed over WebRTC'), null, { timeout: 45000 }); }
  catch (error) { console.log(await host.evaluate(() => ({ status: document.querySelector('#hostStatus').textContent, states: window.__pcs.map(pc => ({ connection: pc.connectionState, signaling: pc.signalingState, ice: pc.iceConnectionState })), iceErrors: window.__iceErrors }))); throw error; }
  await player.waitForFunction(() => window.__pcs.at(-1).connectionState === 'connected');
  console.log('PASS: offers, answers and ICE restart update over the peer control channel');
  await host.locator('#hostStopCapture').click(); await host.locator('#hostCapture').click(); await player.waitForFunction(() => document.querySelector('#clientVideo').videoWidth === 640);
  await host.locator('#hostReply').evaluate(el => { for (let node = el.parentElement; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true; }); await host.locator('#hostReply').fill(reply); await host.locator('#acceptReply').click(); await host.waitForFunction(() => document.querySelector('#hostPairStatus').textContent.includes('earlier session'));
  console.log('PASS: used pairing replies cannot be replayed');
  await host.locator('#invitationRole').selectOption('play'); await host.locator('#createInvitation').click();
  await host.waitForFunction(previous => document.querySelector('#hostInvitation').value !== previous, offer, { timeout: 45000 });
  const secondOffer = await host.locator('#hostInvitation').inputValue();
  const secondPlayer = await context.newPage(); secondPlayer.on('pageerror', e => errors.push(e.message));
  await secondPlayer.goto(playerOrigin); await secondPlayer.locator('#modeClient').click(); await secondPlayer.locator('#clientInvitation').evaluate(el => { for (let node = el.parentElement; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true; }); await secondPlayer.locator('#clientInvitation').fill(secondOffer); await secondPlayer.locator('#createReply').click();
  await secondPlayer.waitForFunction(() => !!document.querySelector('#clientReply').value, null, { timeout: 45000 });
  await host.locator('#hostReply').fill(await secondPlayer.locator('#clientReply').inputValue()); await host.locator('#acceptReply').click();
  await secondPlayer.waitForFunction(() => !document.querySelector('#clientEnablePad').disabled && document.querySelector('#clientVideo').videoWidth === 640);
  assert.equal(await player.locator('#clientSlot').textContent(), 'P2'); assert.equal(await secondPlayer.locator('#clientSlot').textContent(), 'P1');
  console.log('PASS: multiple text-paired players receive video with independent P1/P2 assignments');
  await fs.mkdir('.local/screenshots', { recursive: true });
  await player.screenshot({ path: '.local/screenshots/pairing.png', fullPage: true });
  assert.deepEqual(errors, []); console.log('PASS: no browser runtime errors');
} finally { await browser?.close(); await hostApp.close(); await playerApp.close(); }
