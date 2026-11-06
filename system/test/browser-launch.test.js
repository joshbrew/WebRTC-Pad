import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openBrowser } from '../scripts/install-utils.mjs';

function opener(results) {
  const calls = [];
  return { calls, start(command, args, options) {
    const child = new EventEmitter(); child.unref = () => { child.unreferenced = true; };
    calls.push({ command, args, options, child });
    const result = results[calls.length - 1];
    if (result !== 'timeout') setImmediate(() => result === 'error' ? child.emit('error', Error('Opener unavailable')) : child.emit('exit', result));
    return child;
  } };
}

test('Windows default-browser handoff preserves the complete URL as data and waits for success', async () => {
  const stub = opener([0]), messages = [], url = 'http://localhost:8787/?ui=call&mode=join&capture=native';
  assert.equal(await openBrowser(url, { platform: 'win32', start: stub.start, env: { KEEP: 'value' }, report: text => messages.push(text) }), true);
  assert.equal(stub.calls.length, 1);
  const call = stub.calls[0];
  assert.equal(call.command, 'powershell.exe');
  assert.ok(call.args.includes('-NoProfile')); assert.ok(call.args.includes('-NonInteractive'));
  assert.match(call.args.at(-1), /Start-Process -FilePath \$env:WEBRTC_PAD_BROWSER_URL -ErrorAction Stop/);
  assert.ok(!call.args.some(arg => arg.includes(url)));
  assert.equal(call.options.env.WEBRTC_PAD_BROWSER_URL, url); assert.equal(call.options.env.KEEP, 'value');
  assert.equal(call.options.windowsHide, true); assert.ok(!call.options.shell); assert.ok(!call.child.unreferenced);
  assert.deepEqual(messages, []);
});

test('Windows browser launch retries failed OS handoffs and reports a usable URL if both fail', async () => {
  const url = 'http://localhost:8787/?ui=call&mode=join';
  for (const failure of ['error', 1]) {
    const stub = opener([failure, 0]);
    assert.equal(await openBrowser(url, { platform: 'win32', start: stub.start }), true);
    assert.equal(stub.calls[1].command, 'rundll32.exe');
    assert.deepEqual(stub.calls[1].args, ['url.dll,FileProtocolHandler', url]);
  }
  const failed = opener([1, 'error']), messages = [];
  assert.equal(await openBrowser(url, { platform: 'win32', start: failed.start, report: text => messages.push(text) }), false);
  assert.equal(messages.length, 1); assert.ok(messages[0].includes(url));
});

test('Windows PowerShell receives ampersands and quotes without treating the URL as commands', { skip: process.platform !== 'win32' }, async () => {
  const stub = opener([0]), url = "http://localhost:8787/?ui=call&mode=join&example='quoted'";
  await openBrowser(url, { platform: 'win32', start: stub.start });
  const call = stub.calls[0], args = [...call.args];
  args[args.length - 1] = 'function Start-Process { [CmdletBinding()] param([string]$FilePath) Write-Output $FilePath }; ' + args.at(-1);
  const result = spawnSync(call.command, args, { env: { ...process.env, WEBRTC_PAD_BROWSER_URL: url }, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message); assert.equal(result.stdout.trim(), url);
});

test('slow browser launch is bounded without killing a browser or opening duplicate tabs', async () => {
  const stub = opener(['timeout']), messages = [];
  assert.equal(await openBrowser('http://localhost:8787/', { platform: 'win32', start: stub.start, timeoutMs: 20, report: text => messages.push(text) }), false);
  assert.equal(stub.calls.length, 1); assert.equal(stub.calls[0].child.unreferenced, true); assert.equal(messages.length, 1);
  // A late result must not retry or report another failure.
  stub.calls[0].child.emit('exit', 0); assert.equal(messages.length, 1);
});

test('Mac and Linux keep their platform openers and handle spawn failures', async () => {
  for (const [platform, command] of [['darwin', 'open'], ['linux', 'xdg-open']]) {
    const stub = opener([0]);
    assert.equal(await openBrowser('http://localhost:8787/', { platform, start: stub.start }), true);
    assert.equal(stub.calls[0].command, command); assert.deepEqual(stub.calls[0].args, ['http://localhost:8787/']);
  }
  const messages = [];
  assert.equal(await openBrowser('http://localhost:8787/', { platform: 'linux', start: () => { throw Error('Missing opener'); }, report: text => messages.push(text) }), false);
  assert.equal(messages.length, 1);
});

test('real launcher opens after readiness, reopens an existing app in the requested role, and honors no-browser', async t => {
  // Use real child-process handoffs but a recording opener: no user browser,
  // dependencies, OS input or drivers are touched by this integration test.
  const parent = path.resolve('.local/browser-launch-tests'); await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'app with spaces '));
  let server;
  t.after(async () => {
    if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
    assert.ok(root.startsWith(parent + path.sep)); await fs.rm(root, { recursive: true, force: true });
  });
  async function put(file, value) { const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, value); }
  await put('package.json', '{"type":"module"}');
  await put('.local/install.json', '{"role":"player"}');
  await put('system/scripts/launch.mjs', await fs.readFile(new URL('../scripts/launch.mjs', import.meta.url), 'utf8'));
  const original = new URL('../scripts/install-utils.mjs', import.meta.url).href;
  await put('system/scripts/install-utils.mjs', `
    export { supportedNode, localAddress, runningApp, roleFromArgs, savedRole } from ${JSON.stringify(original)};
    import { openBrowser as realOpenBrowser } from ${JSON.stringify(original)};
    import { spawn } from 'node:child_process';
    import { fileURLToPath } from 'node:url';
    export const openBrowser = url => realOpenBrowser(url, { platform: 'win32', start: (command, args, options) =>
      spawn(process.execPath, [fileURLToPath(new URL('../../record-opener.mjs', import.meta.url)), command, JSON.stringify(args)], options) });
  `);
  await put('record-opener.mjs', `
    import fs from 'node:fs/promises';
    const url = process.env.WEBRTC_PAD_BROWSER_URL;
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    await new Promise(resolve => setTimeout(resolve, 100));
    await fs.appendFile(new URL('opened.jsonl', import.meta.url), JSON.stringify({ url, ready: response.ok, command: process.argv[2] }) + '\\n');
  `);
  await put('system/src/server.js', `
    import { createServer } from 'node:http';
    export function createApp() {
      const server = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ app: 'webrtc-pad' })); });
      return { server, close: () => new Promise(resolve => server.close(resolve)) };
    }
  `);
  const env = { ...process.env, PORT: '0', HOST: '127.0.0.1', TLS_CERT: '' };
  const args = [path.join(root, 'system/scripts/launch.mjs')];
  server = spawn(process.execPath, args, { cwd: root, env, windowsHide: true });
  let output = ''; server.stdout.on('data', data => { output += data; }); server.stderr.on('data', data => { output += data; });
  const records = async () => { try { return (await fs.readFile(path.join(root, 'opened.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
  let opened = [];
  const deadline = Date.now() + 10000;
  while ((opened = await records()).length < 1 && Date.now() < deadline) await delay(25);
  assert.equal(opened.length, 1, output); assert.equal(opened[0].ready, true);
  const url = new URL(opened[0].url); assert.equal(url.searchParams.get('mode'), 'join');
  async function relaunch(extra) {
    const child = spawn(process.execPath, [...args, ...extra], { cwd: root, env: { ...env, PORT: url.port }, windowsHide: true });
    let text = ''; child.stdout.on('data', data => { text += data; }); child.stderr.on('data', data => { text += data; });
    const timeout = setTimeout(() => child.kill(), 10000);
    const [code] = await once(child, 'exit'); clearTimeout(timeout); assert.equal(code, 0, text); assert.match(text, /already running/);
  }
  await relaunch(['--host', '--native']);
  opened = await records(); assert.equal(opened.length, 2);
  const hostUrl = new URL(opened[1].url); assert.equal(hostUrl.searchParams.get('mode'), 'host'); assert.equal(hostUrl.searchParams.get('capture'), 'native');
  await relaunch(['--player']);
  opened = await records(); assert.equal(opened.length, 3); assert.equal(new URL(opened[2].url).searchParams.get('mode'), 'join');
  await relaunch(['--no-browser']); assert.equal((await records()).length, 3);
  await relaunch(['--player','--remember-page']);opened=await records();assert.equal(new URL(opened[3].url).searchParams.get('mode'),null,'Generic Start lets the browser restore its last page');
});
