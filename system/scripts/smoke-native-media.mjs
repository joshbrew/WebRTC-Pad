import {launchTestBrowser} from './browser-fixture.mjs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { NativeMedia } from '../src/native-media.js';
import { streamSettings } from '../public/media.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const engine = new NativeMedia(); const app = createApp({ env: {}, createInjector: async () => ({ name: 'Video test', setState() {}, close() {} }) });
let browser;
try {
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  browser = await launchTestBrowser(chromium,{ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.locator('#helpDone').click();
  await page.locator('#modeClient').click();
  await page.locator('#helpDone').click();
  const offer = await engine.offer('test', streamSettings('1080', 30), { iceServers: [] });
  const answer = await page.evaluate(async offer => {
    const pc = new RTCPeerConnection(); window.__nativeTestPC = pc;
    const video = document.querySelector('#clientVideo'); video.muted = true;
    pc.ontrack = event => { video.srcObject = new MediaStream([event.track]); video.play().catch(() => {}); };
    await pc.setRemoteDescription(offer.sdp); await pc.setLocalDescription(await pc.createAnswer());
    if (pc.iceGatheringState !== 'complete') await new Promise(resolve => { pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') resolve(); }; });
    return pc.localDescription.toJSON();
  }, offer);
  await engine.answer('test', answer);
  try { await page.waitForFunction(() => document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames > 10, null, { timeout: 15000 }); }
  catch (error) {
    console.log(await page.evaluate(async () => ({ connection: window.__nativeTestPC.connectionState, ice: window.__nativeTestPC.iceConnectionState, video: { width: document.querySelector('#clientVideo').videoWidth, ready: document.querySelector('#clientVideo').readyState }, media: [...(await window.__nativeTestPC.getStats()).values()].filter(s => ['inbound-rtp', 'codec'].includes(s.type)) })));
    throw error;
  }
  await page.waitForTimeout(3500);
  const result = await page.evaluate(async () => [...(await window.__nativeTestPC.getStats()).values()].filter(s => s.type === 'inbound-rtp' && s.kind === 'video').map(s => ({ width: s.frameWidth, height: s.frameHeight, frames: s.framesDecoded, fps: s.framesPerSecond })));
  assert.ok(result[0].width > 0 && result[0].width <= 1920); assert.ok(result[0].height > 0 && result[0].height <= 1080);
  assert.ok(Math.abs(result[0].width/result[0].height-engine.sourceSize.width/engine.sourceSize.height)<.01,'Preserve the actual source aspect ratio');
  console.log(`PASS: native desktop capture → ${offer.encoder} → encoded RTP → Pion WebRTC → browser: ${JSON.stringify(result)}`);
} finally { engine.close(); await browser?.close(); await app.close(); }
