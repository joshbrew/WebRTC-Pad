import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {desktopCapabilities,desktopSession} from './desktop-capabilities.js';
import {macDesktopCapability} from './macos-desktop.js';
const helper = fileURLToPath(new URL('../native/desktop-input.py', import.meta.url));
export async function captureTargets(env=process.env,platform=process.platform) {
  if(!desktopCapabilities(env,platform).windowMouse) return [];
  if(platform==='darwin'){const {stdout}=await promisify(execFile)(macDesktopCapability(env).helper,['sources'],{env:{...process.env,...env},timeout:8000,maxBuffer:256*1024});return JSON.parse(stdout);}
  const {stdout}=await promisify(execFile)(env.PYTHON || (platform==='win32'?'python':'python3'),['-B',fileURLToPath(new URL(platform==='win32'?'../native/windows_scope.py':'../native/linux_scope.py',import.meta.url))],{env:{...process.env,...env},windowsHide:true,timeout:8000,maxBuffer:256*1024});
  return JSON.parse(stdout);
}
export async function createDesktopInjector(env = process.env, platform = process.platform) {
  if(platform==='darwin' && !macDesktopCapability(env).available)throw new Error(macDesktopCapability(env).error);
  const child = spawn(platform==='darwin'?macDesktopCapability(env).helper:env.PYTHON || (platform === 'win32' ? 'python' : 'python3'), platform==='darwin'?['desktop']:['-B','-u', helper], { env:{...process.env,...env},stdio: ['pipe','pipe','pipe'], windowsHide: true });
  let stderr = '', failure, result; const requests=new Map();
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
  const lines = createInterface({ input: child.stdout });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Desktop input helper did not start. Approve the system permission dialog when prompted.')); }, desktopSession(env,platform)==='wayland'?60000:8000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(stderr || 'Desktop input helper exited')); });
    lines.once('line', line => { clearTimeout(timer); try { const value = JSON.parse(line); if (!value.ready) throw new Error(value.error || 'Desktop input is unavailable'); if (![value.display?.width,value.display?.height].every(n => Number.isInteger(n) && n > 0 && n <= 32768)) throw new Error('Could not read the host desktop dimensions'); resolve(value); } catch (error) { child.kill(); reject(error); } });
  });
  child.on('exit', () => { failure = new Error(stderr || 'Desktop input helper stopped'); result?.emit('failure', failure); });
  child.stdin.on('error', error => { failure = error; result?.emit('failure', failure); });
  result = Object.assign(new EventEmitter(), {
    display: ready.display,relativeMouse:ready.relativeMouse===true,
    async setScope(scope) {
      const key=JSON.stringify([scope.kind,scope.id,scope.pid,scope.processStart,scope.region]);if(result.scopeKey===key)return result.display;
      const display=await new Promise((resolve,reject)=>{const requestId=crypto.randomUUID(),timer=setTimeout(()=>{requests.delete(requestId);reject(new Error('Mouse scope did not update'));},5000); requests.set(requestId,{resolve,reject,timer});child.stdin.write(JSON.stringify({type:'scope',requestId,scope})+'\n');});
      result.scopeKey=key;return display;
    },
    setState(state) { if (failure || child.exitCode !== null) throw failure || new Error('Desktop input helper stopped'); if (child.stdin.writableLength < 32768) child.stdin.write(JSON.stringify({ type: 'state', ...state }) + '\n'); },
    event(event) { if (failure) throw failure; if (child.stdin.writableLength < 32768) child.stdin.write(JSON.stringify({ type: 'event', ...event }) + '\n'); },
    close() { for(const p of requests.values()){clearTimeout(p.timer);p.reject(new Error('Mouse access stopped'));}requests.clear();child.stdin.end(); const timer = setTimeout(() => child.kill(), 1000); timer.unref(); child.once('exit', () => clearTimeout(timer)); }
  });
  lines.on('line', line => { try { const value = JSON.parse(line);if(value.event==='scope-lost')result.emit('scope-lost'); if(value.event==='scope'){const p=requests.get(value.requestId);if(p){clearTimeout(p.timer);requests.delete(value.requestId);if(value.error)p.reject(new Error(value.error));else {result.display=value.display;p.resolve(value.display);}}} if (value.event === 'display' && [value.display?.width,value.display?.height].every(n => Number.isInteger(n) && n > 0 && n <= 32768)) { result.display = value.display; result.emit('display', value.display); } } catch { /* Diagnostics are not input. */ } });
  return result;
}
