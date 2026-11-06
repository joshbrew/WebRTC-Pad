import {launchTestBrowser} from './browser-fixture.mjs';
// Two real Node processes and two isolated browser windows, paired by text files.
// Only the screen chooser is replaced with a clearly labeled synthetic game.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const hostPort = Number(process.env.DEMO_HOST_PORT || 8788), playerPort = Number(process.env.DEMO_CLIENT_PORT || 8789);
const hostUrl = `http://localhost:${hostPort}/?ui=call`, playerUrl = `http://localhost:${playerPort}/?ui=call&mode=join`;
const children = [], browsers = [], errors = [];
const fakeMouse=process.argv.includes('--mouse');
const mouseState={x:.5,y:.5,keys:[],buttons:[],wheel:0},mouseHistory=[];
let mouseDirty=false,mousePage;
const mouseMonitor=setInterval(()=>{if(mouseDirty&&mousePage&&!mousePage.isClosed()){mouseDirty=false;mousePage.evaluate(value=>{window.__demoMouse=value;},mouseState).catch(()=>{});}},33);
const readPads = async () => JSON.parse((await exec(process.env.PYTHON || 'python', ['system/scripts/read-xinput.py'], { cwd: root, windowsHide: true })).stdout);
let stopping = false, monitor;
const stop = async () => {
  if (stopping) return; stopping = true; clearTimeout(monitor);clearInterval(mouseMonitor);
  for (const browser of browsers) await browser.close().catch(() => {});
  for (const child of children) if (child.exitCode === null) child.kill();
};
for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => { stop().then(() => process.exit()); });
async function startApp(port, player) {
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'Demo port must be valid');
  try { await fetch(`http://localhost:${port}/config`, { signal: AbortSignal.timeout(300) }); throw new Error(`Demo port ${port} is already occupied`); }
  catch (error) { if (error.message.includes('occupied')) throw error; }
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', fakeMouse?'system/scripts/demo-server.mjs':'system/src/server.js'], {
    cwd: root, windowsHide: true, env: { ...process.env, DEMO_MOUSE:fakeMouse?'1':'0', HOST: '127.0.0.1', PORT: String(port), PLAYER_COUNT: process.env.DEMO_PLAYERS || '1', SIGNALING_FALLBACK: '0', PUBLIC_URL: '', TLS_CERT: '', TLS_KEY: '', ICE_TRANSPORT_POLICY: 'all', ICE_JSON: JSON.stringify({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }), ...(player ? { INPUT_BACKEND: 'none' } : {}) }
  });
  children.push(child); let output = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  if(fakeMouse&&!player)createInterface({input:child.stdout}).on('line',line=>{
    if(!line.startsWith('DEMO_MOUSE '))return;
    try{const value=JSON.parse(line.slice(11));if(value.type==='state')Object.assign(mouseState,value.state);else if(value.event?.event==='wheel')mouseState.wheel+=value.event.dy;
      mouseHistory.push(structuredClone(mouseState));if(mouseHistory.length>1000)mouseHistory.shift();mouseDirty=true;
    }catch{/* Startup diagnostics aren't input. */}
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(output || 'Demo app exited');
    try { const response = await fetch(`http://localhost:${port}/config`); if ((await response.json()).app === 'webrtc-pad') return child.pid; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Demo app startup timed out');
}
try {
  const hostPid = await startApp(hostPort, false), playerPid = await startApp(playerPort, true);
  const headed = !process.argv.includes('--headless');
  for (const x of [0, 900]) browsers.push(await launchTestBrowser(chromium,{ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: !headed, args: [`--window-position=${x},40`, '--window-size=1000,900', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] }));
  const pages = [];
  for (const browser of browsers) {
    const context = await browser.newContext({ viewport: { width: 960, height: 800 } });
    await context.addInitScript(() => {localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    localStorage.setItem('webrtc-pad:capture-method', 'browser'); localStorage.setItem('webrtc-pad:tour-v1:host', 'seen'); localStorage.setItem('webrtc-pad:tour-v1:client', 'seen');
      const Original = window.RTCPeerConnection; window.__pcs = []; window.__channels = [];
      window.RTCPeerConnection = class extends Original {
        constructor(...args) { super(...args); window.__pcs.push(this); this.addEventListener('datachannel', event => window.__channels.push(event.channel)); }
      };
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); pages.push(page);
  }
  const [host, player] = pages;
  // The demo keeps both pictures visible to compare source motion with received motion.
  await host.addInitScript(() => localStorage.setItem('webrtc-pad:hostPreviewAutoPause','false'));
  mousePage=host;
  if(fakeMouse)await host.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');window.__demoMouseEnabled=true;});
  await host.addInitScript(() => {localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
      const stream = canvas.captureStream(120), track = stream.getVideoTracks()[0];
      const ctx = canvas.getContext('2d'); ctx.scale(1.5, 1.5); let x = 640, y = 420, frame = 0, last = performance.now();
      const draw = () => {
        const now = performance.now(), elapsed = Math.min(100, now - last); last = now; frame++;
        const pad = window.__demoPad || {}, buttons = pad.buttons || 0;
        x = Math.max(80, Math.min(1200, x + ((buttons & 8 ? 1 : 0) - (buttons & 4 ? 1 : 0)) * elapsed * .3));
        y = Math.max(330, Math.min(610, y + ((buttons & 2 ? 1 : 0) - (buttons & 1 ? 1 : 0)) * elapsed * .3));
        ctx.fillStyle = '#101b23'; ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = '#d0f79b'; ctx.font = 'bold 42px sans-serif'; ctx.fillText('LOCAL CONNECTION TEST', 70, 85);
        ctx.fillStyle = '#b7c9d3'; ctx.font = '25px sans-serif'; ctx.fillText('Simulated game screen • real WebRTC video + controller', 70, 132);
        ctx.fillText('In the CLIENT window: arrows move • Z = A • 1 = left trigger', 70, 192);
        ctx.fillStyle = window.__demoVerified ? '#d0f79b' : '#f2cb80';
        ctx.fillText(window.__demoVerified ? '✓ Windows XInput press and release verified' : 'Checking the virtual controller…', 70, 252);
        ctx.strokeStyle = '#35505c'; ctx.lineWidth = 2; ctx.strokeRect(50, 300, 1180, 340);
        const sweep = 70 + (now % 2000) / 2000 * 1130;
        ctx.fillStyle = '#7ecba1'; ctx.fillRect(sweep, 305, 8, 328);
        ctx.fillStyle = '#d0f79b'; ctx.beginPath(); ctx.arc(640 + Math.sin(now / 450) * 450, 580 + Math.sin(now / 220) * 35, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = buttons & 4096 ? '#ffb87a' : '#233944'; ctx.fillRect(1000, 340, 190, 100);
        ctx.fillStyle = '#e7f5ec'; ctx.font = 'bold 28px monospace'; ctx.fillText(buttons & 4096 ? 'A PRESSED' : 'PRESS Z', 1010, 400);
        ctx.fillStyle = buttons & 4096 ? '#ffb87a' : '#c0e8fc'; ctx.beginPath(); ctx.arc(x, y, 36 + (pad.lt || 0) / 20, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8aa9b7'; ctx.font = '19px monospace'; ctx.fillText(`Host: ${Date.now()} ms • frame ${frame} • buttons=${buttons} LT=${pad.lt || 0}`, 70, 683);
        if(window.__demoMouseEnabled){
          const mouse=window.__demoMouse||{x:.5,y:.5,buttons:[],keys:[],wheel:0};
          ctx.fillStyle='#101b23';ctx.fillRect(60,206,1190,78);ctx.fillStyle='#81d8ff';ctx.font='bold 22px sans-serif';ctx.fillText('SIMULATED DESKTOP MOUSE • no clicks or typing reach your OS',70,233);
          ctx.font='18px monospace';ctx.fillText(`Mouse ${Math.round(mouse.x*1920)},${Math.round(mouse.y*1080)} • Buttons ${mouse.buttons.join(',')||'none'} • Wheel ${Math.round(mouse.wheel)} • Keys ${mouse.keys.join(',')||'none'}`,70,270);
          const mx=mouse.x*1280,my=mouse.y*720;ctx.strokeStyle=mouse.buttons.length?'#ffb795':'#81d8ff';ctx.lineWidth=4;
          ctx.beginPath();ctx.arc(mx,my,mouse.buttons.length?22:14,0,Math.PI*2);ctx.moveTo(mx-30,my);ctx.lineTo(mx+30,my);ctx.moveTo(mx,my-30);ctx.lineTo(mx,my+30);ctx.stroke();
        }
        const rate = track.getConstraints().frameRate?.max || 60;
        // Draw ahead of the capture cap so timer granularity does not turn a
        // requested 60 fps stream into a 30–50 fps synthetic source.
        setTimeout(draw, Math.max(1, 1000 / Math.min(240, rate * 2) - (performance.now() - now)));
      }; draw();
      return stream;
    };
  });
  await host.goto(hostUrl); await player.goto(playerUrl);
  await host.evaluate(() => { document.title = 'HOST — local WebRTC test'; });
  await player.evaluate(() => { document.title = 'CLIENT — local WebRTC test'; });
  await host.waitForFunction(count=>document.querySelector('#hostControllerCount').options.length>=count,Number(process.env.DEMO_PLAYERS || 1));
  await host.locator('#hostPlayerOptions').evaluate(el=>el.open=true);await host.locator('#hostDynamicControllers').uncheck();
  await host.locator('#hostControllerCount').selectOption(process.env.DEMO_PLAYERS || '1');
  await host.locator('#hostCreate').click(); await host.waitForFunction(() => !document.querySelector('#createInvitation').disabled);
  await host.locator('#hostSettings').evaluate(el => { el.open = true; });
  await host.locator('#streamFramerate').selectOption('60');
  await host.locator('#streamPriority').selectOption('resolution');
  await host.locator('#createInvitation').click(); await host.waitForFunction(() => !!document.querySelector('#hostInvitation').value, null, { timeout: 45000 });
  const offer = await host.locator('#hostInvitation').inputValue();
  await player.locator('#clientInvitationFile').setInputFiles({ name: 'local-host-invite.txt', mimeType: 'text/plain', buffer: Buffer.from(offer) });
  await player.waitForFunction(() => !!document.querySelector('#clientReply').value, null, { timeout: 45000 });
  const reply = await player.locator('#clientReply').inputValue();
  await host.locator('#hostReplyFile').setInputFiles({ name: 'local-client-reply.txt', mimeType: 'text/plain', buffer: Buffer.from(reply) });
  await player.waitForFunction(() => !document.querySelector('#clientEnablePad').disabled);
  await host.locator('#hostCapture').click();
  await player.waitForFunction(() => document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames > 5);
  await player.locator('#inputSource').selectOption('keyboard'); await player.locator('#clientEnablePad').click();
  await player.locator('#clientVideo').click(); await player.keyboard.down('z');
  let pad;
  if (process.platform === 'win32') {
    const deadline = Date.now() + 7000;
    while (!pad && Date.now() < deadline) { pad = (await readPads()).find(p => p.buttons & 0x1000); if (!pad) await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.ok(pad, 'Client Z must reach an actual host XInput A button');
  }
  await player.keyboard.up('z');
  if (pad) {
    const deadline = Date.now() + 5000; let released = false;
    while (!released && Date.now() < deadline) { released = (await readPads()).find(p => p.index === pad.index)?.buttons === 0; if (!released) await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.ok(released, 'Client release must neutralize XInput');
    await host.evaluate(() => { window.__demoVerified = true; });
    const reader = spawn(process.env.PYTHON || 'python', ['system/scripts/read-xinput.py', '--watch'], { cwd: root, windowsHide: true }); children.push(reader);
    let updating = false;
    createInterface({ input: reader.stdout }).on('line', line => {
      if (stopping || host.isClosed() || updating) return;
      try {
        const value = JSON.parse(line).find(p => p.index === pad.index); updating = true;
        host.evaluate(value => { window.__demoPad = value; }, value).catch(() => {}).finally(() => { updating = false; });
      } catch { /* Monitor shutdown. */ }
    });
  }
  if(fakeMouse){
    host.on('dialog',dialog=>dialog.accept());player.on('dialog',dialog=>dialog.accept());
    await host.locator('#hostDesktopMouse').check();await host.locator('#hostDesktopKeyboard').check();
    await player.waitForFunction(()=>!document.querySelector('#clientDesktopMouse').disabled);
    await player.locator('#clientDesktopMouse').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});
    await player.locator('#clientDesktopMouse').check();
    assert.match(await host.locator('#hostOverlayNote').textContent(),/stay inside/,'Simulated mouse must stay inside the test screen');
    const box=await player.locator('#clientStage').boundingBox();await player.mouse.move(box.x+box.width*.4,box.y+box.height*.6);await player.mouse.down();
    const until=async predicate=>{const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw new Error('Simulated desktop input did not arrive');await new Promise(r=>setTimeout(r,20));}};
    await until(()=>mouseHistory.some(state=>state.buttons.includes(0)));await player.mouse.up();await until(()=>!mouseState.buttons.length);
    await player.mouse.wheel(0,120);await until(()=>mouseState.wheel>0);
    await player.locator('#inputSource').selectOption('desktop');await player.locator('#clientStage').focus();await player.keyboard.down('m');await until(()=>mouseState.keys.includes('KeyM'));await player.keyboard.up('m');await until(()=>!mouseState.keys.length);
    await player.locator('#inputSource').selectOption('keyboard');
    console.log('PASS: real WebRTC mouse positions, click/release, wheel and typing reach the simulated host desktop; no OS mouse/keyboard injection.');
  }
  const presented=await player.locator('#clientVideo').evaluate(video=>video.getVideoPlaybackQuality().totalVideoFrames);
  await player.waitForFunction(frames=>!document.querySelector('#clientVideo').paused&&document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames>frames+15,presented,{timeout:5000});
  const result = await player.evaluate(async () => {
    const stats = await window.__pcs.at(-1).getStats(), transport = [...stats.values()].find(s => s.type === 'transport' && s.selectedCandidatePairId), pair = stats.get(transport?.selectedCandidatePairId);
    const inbound = [...stats.values()].find(s => s.type === 'inbound-rtp' && s.kind === 'video');
    return { frames: document.querySelector('#clientVideo').getVideoPlaybackQuality().totalVideoFrames, width: inbound?.frameWidth, height: inbound?.frameHeight, fps: inbound?.framesPerSecond, localCandidate: stats.get(pair?.localCandidateId)?.candidateType, remoteCandidate: stats.get(pair?.remoteCandidateId)?.candidateType };
  });
  assert.deepEqual(errors, []);
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  await fs.writeFile(path.join(root, '.local/demo.json'), JSON.stringify({ hostUrl, playerUrl, hostPid, playerPid, ...result, nativeXInputVerified: !!pad, syntheticCapture: true, simulatedDesktopInput:fakeMouse }, null, 2));
  console.log(`PASS: separate Node host (${hostPid}) and client (${playerPid}), text-file pairing, ${result.frames} decoded video frames, ${pad ? 'actual XInput press/release' : 'connected controller channel'}; ICE ${result.localCandidate}/${result.remoteCandidate}`);
  console.log(`HOST: ${hostUrl}\nCLIENT: ${playerUrl}\nUse arrows/Z/1 in the client video. Close either test browser or press Ctrl+C here to stop both demo runs.`);
  createInterface({ input: process.stdin }).on('line', async line => {
    if(line.trim()==='mouse-stats'){console.log(JSON.stringify(mouseState));return;}
    if (line.trim() === 'dolphin') {
      // Pause normal polling, then send a brief, visibly alternating fixture
      // through the real guest data channel while Dolphin has keyboard focus.
      if (await player.locator('#clientEnablePad').getAttribute('aria-pressed') === 'true') await player.locator('#clientEnablePad').click();
      await player.evaluate(() => {
        const channel = window.__channels.find(ch => ch.label === 'input');
        window.__fixtureSequence ??= 1000000; const began = performance.now();
        const timer = setInterval(() => {
          const age = performance.now() - began, pressed = age < 60000 && Math.floor(age / 4000) % 2 === 0;
          if (channel?.readyState === 'open') channel.send(JSON.stringify({ seq: window.__fixtureSequence++, source: 'gamepad', state: { buttons: { a: pressed }, axes: { lx: pressed ? .8 : 0, ly: pressed ? .6 : 0, lt: pressed ? .7 : 0 } } }));
          if (age >= 60000) clearInterval(timer);
        }, 1000 / 60);
      });
      console.log('Dolphin fixture: guest A, left stick and left trigger alternate for 60 seconds over WebRTC, then release. Reconnect before resuming normal input.');
      return;
    }
    if (line.trim() !== 'stats') return;
    const received = await player.evaluate(async () => {
      const video=document.querySelector('#clientVideo');
      return (await Promise.all(window.__pcs.filter(pc=>pc.connectionState==='connected').map(pc=>pc.getStats()))).flatMap(stats=>[...stats.values()].filter(s => s.type === 'inbound-rtp' && s.kind === 'video').map(s => ({ width: s.frameWidth, height: s.frameHeight, fps: s.framesPerSecond, frames: s.framesDecoded, paused:video.paused,presentedFrames:video.getVideoPlaybackQuality().totalVideoFrames,currentTime:video.currentTime })));
    });
    const sent = await host.evaluate(async () => {
      return (await Promise.all(window.__pcs.filter(pc=>pc.connectionState==='connected').map(pc=>pc.getStats()))).flatMap(stats=>[...stats.values()].filter(s => s.type === 'outbound-rtp' && s.kind === 'video').map(s => ({ width: s.frameWidth, height: s.frameHeight, fps: s.framesPerSecond, qualityLimitationReason: s.qualityLimitationReason, targetBitrate: s.targetBitrate, encoder: s.encoderImplementation })));
    });
    console.log(JSON.stringify({ received, sent }));
  });
  if (!process.argv.includes('--exit')) await Promise.race(browsers.map(browser => once(browser, 'disconnected')));
} catch (error) { console.error(`Local demo failed: ${error.message}`); process.exitCode = 1; }
finally { await stop(); }
