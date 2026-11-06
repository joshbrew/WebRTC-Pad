import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import {desktopCapabilities} from './desktop-capabilities.js';
import {macDesktopCapability} from './macos-desktop.js';
const helper = fileURLToPath(new URL('../native/cursor-overlay.py', import.meta.url));
export async function createCursorOverlay(env = process.env, platform = process.platform) {
  if (!desktopCapabilities(env,platform).cursorOverlay) throw new Error(platform==='linux'?'Desktop cursor overlays require an X11 login session. In-app cursors remain available.':'Desktop cursor overlays are unavailable on this platform. In-app cursors remain available.');
  const script=platform==='linux'?fileURLToPath(new URL('../native/linux_overlay.py',import.meta.url)):helper;
  const child = spawn(platform==='darwin'?macDesktopCapability(env).helper:env.PYTHON || (platform==='win32'?'python':'python3'), platform==='darwin'?['overlay']:['-B','-u', script], { env:{...process.env,...env}, stdio:['pipe','pipe','pipe'], windowsHide:true });
  const lines = createInterface({input:child.stdout}); let stderr='', result, failure;
  child.stderr.on('data', b => { stderr=(stderr+b).slice(-2000); });
  const failed = error => { failure=error; result?.emit('failure', error); };
  child.stdin.on('error', failed);
  const ready = await new Promise((resolve,reject) => {
    const timer=setTimeout(() => { child.kill(); reject(new Error(platform==='linux'?'Desktop overlay did not start. Check Python, X11 and libXext.':'Desktop overlay did not start. Install Python with tkinter support.')); },8000);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(stderr || 'Desktop overlay stopped')); });
    lines.once('line', line => { clearTimeout(timer); try { const v=JSON.parse(line); if (!v.ready) throw new Error('Desktop overlay failed'); resolve(v); } catch(e) { child.kill(); reject(e); } });
  });
  result=Object.assign(new EventEmitter(), {
    target:ready.target,
    send(value) { if (failure) throw failure; if (child.exitCode === null && child.stdin.writableLength < 32768) child.stdin.write(JSON.stringify(value)+'\n'); },
    close() { child.stdin.end(); const timer=setTimeout(() => child.kill(),1000); timer.unref(); child.once('exit',()=>clearTimeout(timer)); }
  });
  child.on('exit', () => failed(new Error(stderr || 'Desktop overlay stopped')));
  return result;
}
