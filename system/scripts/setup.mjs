import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import windowsBinding from '../src/inject/windows-binding.js';
import {windowsHostDriverInstalled} from './host-driver-status.mjs';
import { supportedNode, exists, run, runNpm, runningApp, roleFromArgs } from './install-utils.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
try {
  const allowed = ['host', 'player', '--host', '--player', '--no-start', '--check', '--help'];
  if (args.some(arg => !allowed.includes(arg))) throw new Error('Unknown option. Use node system/scripts/setup.mjs --help.');
  if (args.includes('--help')) {
    console.log('WebRTC Pad setup\n  node system/scripts/setup.mjs player [--no-start]\n  node system/scripts/setup.mjs host [--no-start]\n  node system/scripts/setup.mjs --check\nPlayer setup needs no controller driver. Host setup also installs/checks its native backend.');
  } else {
    if (!supportedNode()) throw new Error('Install Node.js 22.9 or newer from https://nodejs.org/en/download and run setup again.');
    const role = roleFromArgs(args) || 'player';
    if (args.includes('--check')) {
      console.log(`Runtime supported: Node ${process.versions.node} (${process.platform}/${process.arch})`);
      console.log(`App dependencies: ${await exists(path.join(root, 'node_modules/ws/package.json')) && await exists(path.join(root,'node_modules/uplot-webgpu/scripts/uPlot.js')) ? 'installed' : 'run setup to install'}`);
      if(process.platform==='win32')console.log(`Windows host controller binding: ${windowsBinding.inspectBinding().state}. Host setup repairs missing or incompatible bindings.`);
      console.log(`Local configuration: ${await exists(path.join(root, '.env')) ? 'present; setup preserves it' : 'created on first setup'}`);
    } else {
      if (await exists(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
      if (await runningApp(Number(process.env.PORT || 8787), !!process.env.TLS_CERT)) throw new Error('The app is already running. Close its launcher window before installing or updating. Use the Start shortcut in your platform folder to open it again.');
      console.log(`Setting up WebRTC Pad for ${role === 'host' ? 'hosting a game' : 'joining a friend'}…`);
      const stateFile = path.join(root, '.local/install.json');
      const lockHash = crypto.createHash('sha256').update(await fs.readFile(path.join(root, 'package-lock.json'))).digest('hex');
      const runtime = `${process.platform}/${process.arch}/${process.versions.modules}`;
      let previous;
      try { previous = JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch { /* First install. */ }
      const hidSourceHash=process.platform==='darwin'?crypto.createHash('sha256').update(await fs.readFile(path.join(root,'system/native/macos-gamepad.c'))).digest('hex'):null;
      const macHelperCurrent=process.platform!=='darwin' || process.env.MACOS_HID_HELPER && await exists(process.env.MACOS_HID_HELPER) || previous?.runtime===runtime && previous?.hidSourceHash===hidSourceHash && await exists(path.join(root,'system/native/webrtc-pad-hid'));
      let existingTree = false;
      try {
        const expected=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8')).packages;
        const installed=JSON.parse(await fs.readFile(path.join(root,'node_modules/.package-lock.json'),'utf8')).packages;
        existingTree=true;
        for(const [location,entry] of Object.entries(expected))if(location.startsWith('node_modules/') && !entry.dev && !entry.optional){
          const actual=JSON.parse(await fs.readFile(path.join(root,location,'package.json'),'utf8'));
          if(!entry.integrity || installed[location]?.integrity!==entry.integrity || installed[location]?.version!==entry.version || actual.version!==entry.version)existingTree=false;
        }
      }catch{existingTree=false;/* Missing or changed dependencies need repair. */}
      const unchanged = existingTree && (!previous || previous.lockHash===lockHash && previous.runtime===runtime);
      if (!unchanged) await runNpm(['ci'], root);
      else console.log('App dependencies are already up to date.');
      try { await fs.copyFile(path.join(root, '.env.example'), path.join(root, '.env'), fs.constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.writeFile(stateFile, JSON.stringify({ lockHash, runtime, role,hidSourceHash:previous?.hidSourceHash, hostReady: unchanged && previous?.hostReady === true && macHelperCurrent }, null, 2) + '\n');
      if (role === 'host' && !(unchanged && previous?.hostReady === true && (process.platform !== 'win32' || windowsBinding.inspectBinding().state==='ready' && windowsHostDriverInstalled()) && macHelperCurrent)) {
        await fs.writeFile(stateFile, JSON.stringify({ lockHash, runtime, role,hidSourceHash:previous?.hidSourceHash, hostReady: false }, null, 2) + '\n');
        try {
          if (process.platform === 'win32') {
            const binding=windowsBinding.inspectBinding();
            if (binding.state==='missing') await runNpm(['install', '--no-save', '--package-lock=false', 'vigemclient@1.5.3'], root);
            else if(binding.state==='broken'){console.log('Repairing the Windows controller binding for this Node.js version…');await runNpm(['rebuild','vigemclient'],root);}
          }
          if (process.platform === 'darwin' && !macHelperCurrent) await runNpm(['run', 'driver:macos:build'], root);
          await run(process.execPath, ['--env-file-if-exists=.env', 'system/scripts/check-driver.js'], root);
          await fs.writeFile(stateFile, JSON.stringify({ lockHash, runtime, role,hidSourceHash, hostReady: true }, null, 2) + '\n');
        } catch {
          console.log('\nThe app is installed; host controller setup still needs attention. Video and joining remain available.');
          if (process.platform === 'win32') console.log('See system/docs/install.md for ViGEmBus and the C++/Python build tools if the native binding failed.');
          if (process.platform === 'linux') console.log('Install Python 3, load uinput, and grant this user /dev/uinput access. See README.md.');
          if (process.platform === 'darwin') console.log('macOS hosting is experimental and may require Apple-authorized HID signing. See README.md.');
        }
      }
      console.log('\nReady. Next time, use Host or Join in your platform folder; setup is skipped when current.');
      if (role === 'host') console.log('For remote networks that need a relay, add your own TURN settings to .env. Your keys are never bundled in the download.');
      if (!args.includes('--no-start')) await run(process.execPath, ['--env-file-if-exists=.env', 'system/scripts/launch.mjs', `--${role}`], root);
    }
  }
} catch (error) { console.error(`Setup: ${error.message}`); process.exitCode = 1; }
