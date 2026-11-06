import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const supportedNode = (version = process.versions.node) => {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 9);
};
export async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
export async function openBrowser(url, { platform = process.platform, start = spawn, env = process.env, timeoutMs = 10000, report = console.log } = {}) {
  // ShellExecute honors Windows' default browser association. Keep the URL out
  // of shell code: join/native links contain ampersands and must stay intact.
  const attempts = platform === 'win32' ? [
    ['powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; Start-Process -FilePath $env:WEBRTC_PAD_BROWSER_URL -ErrorAction Stop"]],
    ['rundll32.exe', ['url.dll,FileProtocolHandler', url]],
  ] : [[platform === 'darwin' ? 'open' : 'xdg-open', [url]]];
  for (const [command, args] of attempts) {
    const result = await new Promise(resolve => {
      let child, timer, settled = false;
      const finish = result => {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve(result);
      };
      try {
        child = start(command, args, { stdio: 'ignore', windowsHide: true, env: { ...env, WEBRTC_PAD_BROWSER_URL: url } });
        child.once('error', () => finish('failed'));
        child.once('exit', code => finish(code === 0 ? 'opened' : 'failed'));
        // Await the OS handoff even when reusing an app and this launcher has
        // nothing else keeping it alive. Never terminate the user's browser.
        timer = setTimeout(() => { child.unref(); finish('timeout'); }, timeoutMs);
      } catch { finish('failed'); }
    });
    if (result === 'opened') return true;
    // A slow handoff may still succeed; retrying it could open a duplicate tab.
    if (result === 'timeout') break;
  }
  report(`The browser did not open automatically. Open this address in your browser: ${url}`);
  return false;
}
export function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Installation step failed (exit ${code ?? 'interrupted'}).`)));
  });
}
export function runNpm(args, cwd) {
  // All npm arguments are fixed literals selected inside setup.mjs.
  if (process.platform === 'win32') return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`], cwd);
  return run('npm', args, cwd);
}
export function localAddress(port, tls = false) { return `${tls ? 'https' : 'http'}://localhost:${port}`; }
export async function runningApp(port, tls = false) {
  try {
    const response = await fetch(`${localAddress(port, tls)}/config`, { signal: AbortSignal.timeout(800) });
    return response.ok && (await response.json()).app === 'webrtc-pad';
  } catch { return false; }
}
export function roleFromArgs(args) {
  const roles = args.filter(arg => ['host', 'player', '--host', '--player'].includes(arg)).map(arg => arg.replace(/^--/, ''));
  if (new Set(roles).size > 1) throw new Error('Choose either host or player.');
  return roles[0];
}
export async function savedRole(root) {
  try { return JSON.parse(await fs.readFile(path.join(root, '.local/install.json'), 'utf8')).role === 'player' ? 'player' : 'host'; }
  catch { return 'player'; }
}
