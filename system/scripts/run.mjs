import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exists, run, runningApp, savedRole, supportedNode } from './install-utils.mjs';
import {nativeSourceHash} from './native-version.mjs';
import windowsBinding from '../src/inject/windows-binding.js';
import {windowsHostDriverInstalled} from './host-driver-status.mjs';
import {guestLaunchPlan} from '../src/guest-runtime.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const modes = ['start','host','join','native','configure','relay','recovery','install','guest-input','session-server'];
try {
  if (!supportedNode()) throw new Error('Node.js 22.9 or newer is required. Use the shortcut in your platform folder to install it.');
  if (await exists(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
  const stateFile = path.join(root, '.local/install.json');
  let state = {}; try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch { /* First run. */ }
  const lockHash = crypto.createHash('sha256').update(await fs.readFile(path.join(root, 'package-lock.json'))).digest('hex');
  const runtime = `${process.platform}/${process.arch}/${process.versions.modules}`;
  const baseReady = state.lockHash === lockHash && state.runtime === runtime && await exists(path.join(root, 'node_modules/ws/package.json')) && await exists(path.join(root,'node_modules/uplot-webgpu/scripts/uPlot.js')) && await exists(path.join(root, '.env'));
  const macHelperCurrent=process.platform!=='darwin' || process.env.MACOS_HID_HELPER && await exists(process.env.MACOS_HID_HELPER) || state.runtime===runtime && state.hidSourceHash===crypto.createHash('sha256').update(await fs.readFile(path.join(root,'system/native/macos-gamepad.c'))).digest('hex') && await exists(path.join(root,'system/native/webrtc-pad-hid'));
  const hostControllers=process.env.INPUT_BACKEND!=='none';
  const hostDriverReady=process.platform!=='win32' || !hostControllers || windowsHostDriverInstalled();
  const hostReady = baseReady && (!hostControllers || state.hostReady === true && hostDriverReady && (process.platform !== 'win32' || windowsBinding.inspectBinding().state==='ready') && macHelperCurrent);
  if(args[0]==='--status')console.log(JSON.stringify({baseReady,hostReady,hostControllers,hostDriverReady,busy:await runningApp(Number(process.env.PORT || 8787),!!process.env.TLS_CERT)}));
  else if (args[0] === '--ready') { process.exitCode = (args[1] === 'host' ? hostReady : baseReady) ? 0 : 1; }
  else {
    const mode = modes.includes(args[0]) ? args.shift() : 'start';
    if (args.some(a => !['--host','--player','--no-browser','--setup-only','--skip-guest-input'].includes(a))) throw new Error('Use start, host, join, native, configure, relay, recovery, session-server or install; optional --no-browser.');
    if (args.includes('--host') && args.includes('--player')) throw new Error('Choose host or player.');
    const role = mode==='session-server'?'player':mode === 'host' || mode === 'native' || args.includes('--host') ? 'host' : ['join','guest-input'].includes(mode) || args.includes('--player') ? 'player' : await savedRole(root);
    // Generic Start prepares both roles while retaining the user's saved view.
    const prepareHost=hostControllers && (role==='host' || mode==='start'),setupRole=prepareHost?'host':'player';
    const needsSetup = !(prepareHost ? hostReady : baseReady);
    const busy = await runningApp(Number(process.env.PORT || 8787), !!process.env.TLS_CERT);
    if (['configure','relay','recovery'].includes(mode)) {
      if (mode === 'configure') await run(process.execPath, ['system/scripts/configure.mjs'], root);
      if (mode === 'relay') {
        try { await run('docker',['--version'],root); } catch { throw new Error('Install Docker and start Docker Desktop before using Run Relay. See system/docs/self-hosted-turn.md.'); }
        if (!await exists(path.join(root, '.local/coturn/turnserver.conf'))) await run(process.execPath, ['system/scripts/configure.mjs','--mode','relay'], root);
        await run('docker', ['compose','-f','system/config/coturn.compose.yml','up'], root);
      }
      if (mode === 'recovery') {
        try { await run('caddy',['version'],root); } catch { throw new Error('Install Caddy before using Run Recovery. See system/docs/port-forwarding.md.'); }
        if (!await exists(path.join(root, '.local/caddy/Caddyfile'))) await run(process.execPath, ['system/scripts/configure.mjs','--mode','recovery'], root);
        console.log('Keep the host app running in another window. Forward TCP 80/443 to this computer.');
        await run('caddy', ['run','--config','.local/caddy/Caddyfile','--adapter','caddyfile'], root);
      }
    } else {
      // Reusing a running app never replaces packages underneath it.
      if (!busy && needsSetup) await run(process.execPath, ['system/scripts/setup.mjs', setupRole, '--no-start'], root);
      else console.log(mode==='session-server'?'Dependencies are ready; starting the invite service.':busy ? 'Reusing the running app.' : 'Setup is current; starting immediately.');
      if (busy && needsSetup && prepareHost) console.log('Controller setup needs a check. Close the app and run Start again to repair it.');
      if(!busy && ['start','host','join','native','install'].includes(mode) && !args.includes('--setup-only') && !args.includes('--skip-guest-input')){
        let guestCurrent=false;try{guestLaunchPlan();guestCurrent=true;}catch{/* Missing or outdated optional reader. */}
        if(process.platform==='win32' || !guestCurrent)try{await run(process.execPath,['system/scripts/setup-guest-input.mjs'],root);}catch(error){console.log(`Optional input blocking setup could not finish: ${error.message}\nStarting with browser controller support; local input is not blocked.`);}
      }
      if (!busy && mode!=='session-server') {
        const next = JSON.parse(await fs.readFile(stateFile, 'utf8')); next.role = role;
        await fs.writeFile(stateFile, JSON.stringify(next, null, 2) + '\n');
      }
      if(mode==='guest-input') {await run(process.execPath,['system/scripts/setup-guest-input.mjs',...(process.platform==='win32'?['--install-drivers']:[])],root);console.log('Restart if requested. Then open Only control my friend’s computer in Join and refresh the devices.');}
      if (mode === 'native') {
        const { nativeCapability } = await import('../src/native-media.js');
        let nativeBuild;try{nativeBuild=JSON.parse(await fs.readFile(path.join(root,'.local/tools/native-build.json'),'utf8'));}catch{}
        if (!nativeCapability().available || nativeBuild?.sourceHash!==nativeSourceHash()) {
          if(busy)throw new Error('Close the running app, then run Host Native again to update its capture/audio helpers.');
          await run(process.execPath, ['system/scripts/setup-native.mjs'], root);
        }
        else console.log('Native capture tools are already ready.');
      }
      if(mode==='session-server' && !args.includes('--setup-only'))await run(process.execPath,['--env-file-if-exists=.env','system/scripts/session-server.mjs'],root);
      else if (!['install','guest-input'].includes(mode) && !args.includes('--setup-only')) await run(process.execPath, ['--env-file-if-exists=.env','system/scripts/launch.mjs',`--${role}`, ...(mode==='start' && !args.includes('--host') && !args.includes('--player')?['--remember-page']:[]), ...(mode === 'native' ? ['--native'] : []), ...(args.includes('--no-browser') ? ['--no-browser'] : [])], root);
    }
  }
} catch (error) { console.error(`Start: ${error.message}`); process.exitCode = 1; }
