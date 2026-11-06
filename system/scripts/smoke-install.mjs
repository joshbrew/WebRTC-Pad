// Install into a disposable folder with spaces; never change this working app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const source = fileURLToPath(new URL('../../', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'webrtc pad setup '));
const env = { ...process.env, PORT: '0', HOST: '127.0.0.1', INPUT_BACKEND: 'none', npm_config_offline: 'true' };
for (const key of Object.keys(env)) if (/^(METERED_|TURN_|ICE_|TLS_|PUBLIC_URL|SIGNALING_FALLBACK|SESSION_SERVER_|PLAYER_COUNT|MAX_PEERS)/.test(key)) delete env[key];
let launcher;
async function execute(args, extraEnv = {}, command = process.execPath) {
  const child = spawn(command, args, { cwd: temp, env: { ...env, ...extraEnv }, windowsHide: true, detached: process.platform !== 'win32' });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const timer = setTimeout(() => {
    if(process.platform==='win32') spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    else { try { process.kill(-child.pid,'SIGTERM'); } catch { /* Already exited. */ } }
  }, 120000);
  const [code] = await once(child, 'exit'); clearTimeout(timer); return { code, output };
}
try {
  for (const folder of ['system', 'windows', 'linux', 'mac']) await fs.cp(path.join(source, folder), path.join(temp, folder), { recursive: true });
  for (const file of ['package.json', 'package-lock.json', '.env.example', 'Start-Windows.cmd', 'Start-Linux.sh', 'Start-Mac.command']) await fs.copyFile(path.join(source, file), path.join(temp, file));
  const first = process.platform==='win32'
    ? await execute(['/d','/s','/c','windows\\shortcuts\\08-Install-Only.cmd -Role player -SkipNodeInstall -SkipDriverInstall'],{},process.env.ComSpec || 'cmd.exe')
    : await execute([`${process.platform==='darwin'?'mac':'linux'}/shortcuts/08-Install-Only.${process.platform==='darwin'?'command':'sh'}`,'--player'],{},'sh');
  assert.equal(first.code, 0, first.output);
  assert.ok(await fs.readFile(path.join(temp, 'node_modules/ws/package.json'), 'utf8'));
  assert.ok(await fs.readFile(path.join(temp, 'node_modules/uplot-webgpu/scripts/uPlot.js'), 'utf8'));
  const localConfig = path.join(temp, '.env');
  await fs.appendFile(localConfig, '\n# Preserve this private user configuration across setup\n');
  const before = await fs.readFile(localConfig, 'utf8');
  const sentinel = path.join(temp, 'node_modules/keep-existing-module.txt'); await fs.writeFile(sentinel, 'keep');
  const again = await execute(['system/scripts/run.mjs', 'join', '--setup-only']);
  assert.equal(again.code, 0, again.output); assert.match(again.output, /Setup is current/);
  assert.equal(await fs.readFile(localConfig, 'utf8'), before);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep');
  assert.equal(JSON.parse(await fs.readFile(path.join(temp, '.local/install.json'), 'utf8')).role, 'player');
  assert.equal((await execute(['system/scripts/setup.mjs', 'host', 'player', '--no-start'])).code, 1);
  if (process.platform === 'win32') {
    const wrapper = await execute(['/d', '/s', '/c', 'windows\\shortcuts\\08-Install-Only.cmd -Role player -SkipNodeInstall -SkipDriverInstall'], {}, process.env.ComSpec || 'cmd.exe');
    assert.equal(wrapper.code, 0, wrapper.output); assert.match(wrapper.output, /Setup is current/);
    assert.equal(await fs.readFile(localConfig, 'utf8'), before);
    console.log('PASS: Windows double-click installer wrapper executes setup without reinstalling Node or touching OS drivers');
  } else {
    const platform=process.platform==='darwin'?'mac':'linux', ext=process.platform==='darwin'?'command':'sh';
    const wrapper=await execute([`${platform}/shortcuts/08-Install-Only.${ext}`,'--player'],{},'sh');
    assert.equal(wrapper.code,0,wrapper.output); assert.match(wrapper.output,/Setup is current/);
  }
  console.log('PASS: clean player install in a path with spaces; repeated setup preserves configuration and installed optional modules');
  // Launch directly here so Windows cleanup owns the server rather than a wrapper tree.
  launcher = spawn(process.execPath, ['--env-file-if-exists=.env', 'system/scripts/launch.mjs', '--no-browser'], { cwd: temp, env, windowsHide: true });
  let output = ''; launcher.stdout.on('data', b => { output += b; }); launcher.stderr.on('data', b => { output += b; });
  let match; const deadline = Date.now() + 10000;
  while (!(match = output.match(/WebRTC Pad is ready: (http:\/\/\S+)/)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(match, output);
  const url = new URL(match[1]); assert.equal(url.searchParams.get('mode'), 'join');
  assert.match(await (await fetch(url)).text(), /clientPopout/);
  const config = await (await fetch(new URL('/config', url))).json(); assert.equal(config.app, 'webrtc-pad');
  const duplicate = await execute(['--env-file-if-exists=.env', 'system/scripts/run.mjs', 'join', '--no-browser'], { PORT: url.port });
  assert.equal(duplicate.code, 0, duplicate.output); assert.match(duplicate.output, /already running/);
  if (process.platform === 'win32') {
    const wrapper = await execute(['/d', '/s', '/c', 'Start-Windows.cmd -NoBrowser -SkipNodeInstall -SkipDriverInstall'], { PORT: url.port }, process.env.ComSpec || 'cmd.exe');
    assert.equal(wrapper.code, 0, wrapper.output); assert.match(wrapper.output, /already running/);
  } else {
    const platform=process.platform==='darwin'?'mac':'linux', ext=process.platform==='darwin'?'command':'sh';
    const wrapper=await execute([platform==='mac'?'Start-Mac.command':'Start-Linux.sh','--no-browser'],{PORT:url.port},'sh');
    assert.equal(wrapper.code,0,wrapper.output); assert.match(wrapper.output,/already running/);
  }
  const busy = await execute(['system/scripts/setup.mjs', 'player', '--no-start'], { PORT: url.port });
  assert.equal(busy.code, 1); assert.match(busy.output, /already running/);
  console.log('PASS: launcher serves the app in the saved role, reuses an active app, and setup refuses to replace dependencies while it is running');
} finally {
  if (launcher && launcher.exitCode === null) { const exited = once(launcher, 'exit'); launcher.kill(); await exited; }
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'webrtc pad setup '));
  await fs.rm(temp, { recursive: true, force: true });
}
