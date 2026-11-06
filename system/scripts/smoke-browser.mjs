import {launchTestBrowser} from './browser-fixture.mjs';
import fs from 'node:fs/promises';
await fs.mkdir('.local/screenshots', { recursive: true });
// Run with PLAYWRIGHT_MODULE pointing to Playwright's index.mjs if it is not
// installed locally. No test browser or tooling is bundled into the product.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/server.js';
import injection from '../src/inject/index.js';
import { execFileSync } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const writes = [];
const realDriver = process.env.REAL_DRIVER === '1' ? await injection.createInjector() : null;
const app = createApp({ env: {}, createInjector: async () => ({ name: realDriver?.name || 'Browser test driver', setState(slot, state) { realDriver?.setState(slot, state); writes.push({ slot, state }); if (writes.length > 2000) writes.shift(); }, close() { realDriver?.close(); } }) });
const until = async predicate => {
  const end = Date.now() + 10000;
  while (!predicate()) { if (Date.now() > end) throw new Error('Input did not reach test driver'); await new Promise(r => setTimeout(r, 30)); }
};
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const origin = `http://127.0.0.1:${app.server.address().port}`;
let browser;
const errors = [];
try {
  browser = await launchTestBrowser(chromium,{ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const context = await browser.newContext();
  await context.addInitScript(() => {localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    localStorage.setItem('webrtc-pad:capture-method', 'browser'); localStorage.setItem('webrtc-pad:tour-v1:host', 'seen'); localStorage.setItem('webrtc-pad:tour-v1:client', 'seen');
    localStorage.setItem('webrtc-pad:stream-quality',JSON.stringify({resolution:'1080',frameRate:60,priority:'motion',autoThrottle:false}));
    const Original = window.RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = class extends Original { constructor(...args) { super(...args); window.__pcs.push(this); } };
  });
  const host = await context.newPage();
  host.on('pageerror', error => errors.push(error.message));
  // A changing canvas supplies actual video frames to the real WebRTC encoder.
  // Only the OS capture chooser is substituted; media negotiation is real.
  await host.addInitScript(() => {localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const ctx = canvas.getContext('2d'); let frame = 0;
      setInterval(() => { ctx.fillStyle = `hsl(${frame++ % 360},70%,45%)`; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = 'white'; ctx.fillText(`WebRTC ${frame}`, 30, 40); }, 30);
      return canvas.captureStream(30);
    };
  });
  await host.goto(origin); await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostDynamicControllers').uncheck();await host.locator('#hostCreate').click();
  await host.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);
  const client = await context.newPage(); client.on('pageerror', error => errors.push(error.message));await client.goto(origin+'/?mode=join');
  async function pair(page,role='play'){
    await page.locator('#clientAutoThrottle').evaluate(el=>el.checked=false);const oldReply=await page.locator('#clientReply').inputValue();
    await host.locator('#invitationRole').selectOption(role);const old=await host.locator('#hostInvitation').inputValue();await host.locator(old?'#newInvitation':'#createInvitation').click();
    await host.waitForFunction(old=>document.querySelector('#hostInvitation').value && document.querySelector('#hostInvitation').value!==old,old);
    await page.locator('#clientInvitationFile').setInputFiles({name:'invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});
    await page.waitForFunction(old=>document.querySelector('#clientReply').value && document.querySelector('#clientReply').value!==old,oldReply);
    await host.locator('#hostReplyFile').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from(await page.locator('#clientReply').inputValue())});
    await page.waitForFunction(()=>document.querySelector('#clientConnectionText').textContent==='Connected');
  }
  await pair(client);
  await client.waitForFunction(() => !document.querySelector('#clientEnablePad').disabled);
  // Regression: capture starts AFTER the viewer has already negotiated.
  await host.locator('#hostCapture').click();
  try { await client.waitForFunction(() => document.querySelector('#clientVideo').videoWidth === 640, null, { timeout: 10000 }); }
  catch (error) {
    for (const page of [host, client]) console.log(JSON.stringify(await page.evaluate(async () => ({ status: document.querySelector('#hostStatus').textContent, client: document.querySelector('#clientStatus').textContent, peers: await Promise.all(window.__pcs.map(async pc => ({ state: pc.connectionState, transceivers: pc.getTransceivers().map(t => ({ direction: t.direction, currentDirection: t.currentDirection, track: t.sender.track?.readyState })), stats: [...(await pc.getStats()).values()].filter(s => ['outbound-rtp', 'inbound-rtp'].includes(s.type)) }))) })), null, 2));
    console.log(errors); throw error;
  }
  const frames = () => client.evaluate(() => document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames);
  const before = await frames();
  await client.waitForFunction(n => document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames > n + 3, before);
  console.log('PASS: late capture delivers decoded video frames');
  await host.locator('#hostStopCapture').click(); await host.locator('#hostCapture').click();
  const restart = await frames();
  await client.waitForFunction(n => document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames > n + 3, restart);
  console.log('PASS: capture stop/restart delivers new frames');
  await client.bringToFront(); await client.locator('#inputSource').selectOption('keyboard');
  await client.locator('#clientEnablePad').click(); await client.locator('h2').last().click();
  writes.length = 0; await client.keyboard.down('z');
  await until(() => writes.some(w => w.slot === 'p1' && w.state.buttons.a));
  if (realDriver && process.platform === 'win32') {
    const pads = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['system/scripts/read-xinput.py'], { encoding: 'utf8', windowsHide: true }));
    assert.ok(pads.some(p => p.buttons === 0x1000), 'Remote A must be visible to Windows XInput');
    console.log('PASS: browser WebRTC input is visible to Windows games through XInput');
  }
  await client.keyboard.up('z'); await until(() => writes.at(-1)?.state.buttons.a === false);
  console.log('PASS: keyboard -> WebRTC data channel -> host -> gamepad backend');
  await client.keyboard.down('z'); await until(() => writes.at(-1)?.state.buttons.a === true);
  await client.evaluate(() => window.dispatchEvent(new Event('blur')));
  await until(() => writes.at(-1)?.state.buttons.a === false); await client.keyboard.up('z');
  console.log('PASS: losing focus releases held buttons');
  const watcher = await context.newPage(); watcher.on('pageerror', error => errors.push(error.message));
  await watcher.goto(origin+'/?mode=join');await pair(watcher,'watch');
  await watcher.waitForFunction(() => document.querySelector('#clientVideo').videoWidth === 640);
  assert.equal(await watcher.locator('#clientEnablePad').isDisabled(), true);
  // Promote the watcher using the real host UI; the displaced player is notified.
  await host.locator('.peerRow').last().getByRole('combobox', { name: 'Player assignment' }).selectOption('p1');
  await watcher.waitForFunction(() => !document.querySelector('#clientEnablePad').disabled);
  await client.waitForFunction(() => document.querySelector('#clientSlot').textContent === 'Waiting for a free spot');
  await watcher.bringToFront(); await watcher.locator('#inputSource').selectOption('keyboard'); await watcher.locator('#clientEnablePad').click(); await watcher.locator('h2').last().click();
  writes.length = 0; await watcher.keyboard.down('x'); await until(() => writes.some(w => w.slot === 'p1' && w.state.buttons.b)); await watcher.keyboard.up('x');
  console.log('PASS: late viewer receives video and can be assigned a controller');
  await host.reload();await host.locator('#hostCreate').click();await host.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);
  await pair(watcher);await watcher.waitForFunction(()=>!document.querySelector('#clientEnablePad').disabled);
  await host.locator('#hostCapture').click(); await watcher.waitForFunction(() => document.querySelector('#clientVideo').videoWidth === 640);
  console.log('PASS: host reload starts a fresh session and reconnects using a fresh invite without room IDs or keys');
  const cancelling=await context.newPage();cancelling.on('pageerror',error=>errors.push(error.message));await cancelling.goto(origin+'/?mode=join');
  await cancelling.evaluate(()=>{
    window.__originalAnswer=RTCPeerConnection.prototype.createAnswer;
    RTCPeerConnection.prototype.createAnswer=async function(...args){
      window.__replyStarted=true;await new Promise(resolve=>window.__resumeReply=resolve);
      try{return await window.__originalAnswer.apply(this,args);}finally{window.__replyFinished=true;}
    };
  });
  const previousInvite=await host.locator('#hostInvitation').inputValue();await host.locator(previousInvite?'#newInvitation':'#createInvitation').click();
  await host.waitForFunction(old=>document.querySelector('#hostInvitation').value!==old,previousInvite);
  await cancelling.locator('#clientInvitationFile').setInputFiles({name:'cancel-invite.txt',mimeType:'text/plain',buffer:Buffer.from(await host.locator('#hostInvitation').inputValue())});
  await cancelling.waitForFunction(()=>window.__replyStarted);await cancelling.locator('#clientDisconnect').click();
  await cancelling.evaluate(()=>window.__resumeReply());await cancelling.waitForFunction(()=>window.__replyFinished);
  await cancelling.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await cancelling.locator('#clientStatus').textContent(),'Disconnected','A delayed reply must not overwrite Leave');
  assert.equal(await cancelling.locator('#clientReply').inputValue(),'');assert.equal(await cancelling.locator('#downloadReply').isDisabled(),true);assert.equal(await cancelling.locator('#createReply').isDisabled(),false);
  assert.match(await cancelling.locator('#createReply').textContent(),/Make my reply/);
  await cancelling.evaluate(()=>RTCPeerConnection.prototype.createAnswer=window.__originalAnswer);
  await pair(cancelling);await cancelling.waitForFunction(()=>!document.querySelector('#clientEnablePad').disabled);
  console.log('PASS: Leave during reply preparation ignores the delayed answer and allows a fresh invite immediately');
  await watcher.screenshot({ path: '.local/screenshots/browser-smoke.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: no browser runtime errors');
} finally { await browser?.close(); await app.close(); }
