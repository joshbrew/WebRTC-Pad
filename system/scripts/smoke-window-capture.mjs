import {launchTestBrowser} from './browser-fixture.mjs';
// Opt-in integration test against a window the user has explicitly selected.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/server.js';
const title = process.env.CAPTURE_WINDOW_TITLE;
if (!title) throw new Error('Set CAPTURE_WINDOW_TITLE to the authorized open window title');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const app = createApp({ env: {}, createInjector: async () => ({ name: 'Window capture test (no OS input)', setState() {}, close() {} }) });
let browser;
try {
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  browser = await launchTestBrowser(chromium,{ channel: 'msedge', headless: false, args: [`--auto-select-window-capture-source-by-title=${title}`, '--disable-background-timer-throttling','--disable-renderer-backgrounding'] });
  const context = await browser.newContext();
  await context.addInitScript(() => {localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    localStorage.setItem('webrtc-pad:capture-method','browser');
    for (const role of ['host','client']) localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');
    const capture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async options => { const stream = await capture(options); window.__capture = stream.getVideoTracks()[0]; return stream; };
  });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const host = await context.newPage(), guest = await context.newPage();
  await host.goto(origin); await guest.goto(`${origin}/?mode=join`);
  await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostDynamicControllers').uncheck();await host.locator('#hostCreate').click(); await host.waitForFunction(() => !document.querySelector('#createInvitation').disabled);
  await host.locator('#hostSettings').evaluate(el=>el.open=true);
  await host.locator('#streamPriority').selectOption('resolution');
  await host.locator('#hostAutoThrottle').uncheck();
  await host.locator('#createInvitation').click(); await host.waitForFunction(() => !!document.querySelector('#hostInvitation').value);
  await guest.locator('#clientInvitationFile').setInputFiles({ name:'invite.txt', mimeType:'text/plain', buffer:Buffer.from(await host.locator('#hostInvitation').inputValue()) });
  await guest.waitForFunction(() => !!document.querySelector('#clientReply').value);
  await host.locator('#hostReplyFile').setInputFiles({ name:'reply.txt', mimeType:'text/plain', buffer:Buffer.from(await guest.locator('#clientReply').inputValue()) });
  await guest.waitForFunction(() => !document.querySelector('#clientEnablePad').disabled);
  await host.locator('#hostCapture').click();
  try { await host.waitForFunction(() => !!window.__capture, null, { timeout:15000 }); }
  catch(error) { console.log('Capture status:',await host.locator('#hostStatus').textContent(),await host.locator('#captureStatus').textContent());throw error; }
  const source = await host.evaluate(() => ({ ...window.__capture.getSettings(), label:window.__capture.label }));
  assert.equal(source.displaySurface,'window');
  await guest.waitForFunction(() => document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames > 8, null, { timeout:20000 });
  await guest.waitForFunction(width=>document.querySelector('#clientVideo').videoWidth>=width*.9,source.width,{timeout:15000});
  const received = await guest.evaluate(() => {
    const video = document.querySelector('#clientVideo'), canvas = document.createElement('canvas'); canvas.width=64;canvas.height=64;
    const context=canvas.getContext('2d');context.drawImage(video,0,0,64,64);
    const pixels=context.getImageData(0,0,64,64).data; let visible=0;
    for(let i=0;i<pixels.length;i+=4) if(pixels[i]+pixels[i+1]+pixels[i+2]>40) visible++;
    return { width:video.videoWidth,height:video.videoHeight,frames:video.getVideoPlaybackQuality().totalVideoFrames,visiblePixels:visible };
  });
  assert.ok(received.visiblePixels > 100,'Captured window must contain visible pixels');
  await fs.mkdir('.local/screenshots',{recursive:true});
  await guest.locator('#clientVideo').screenshot({path:'.local/screenshots/window-stream.png'});
  console.log(JSON.stringify({result:'PASS: actual selected window captured and decoded over WebRTC',source,received}));
} finally { await browser?.close(); await app.close(); }
