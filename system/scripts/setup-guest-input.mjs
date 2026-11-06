import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {run,exists} from './install-utils.mjs';
import {spawnSync} from 'node:child_process';
import {guestSourceHash,posixSources} from '../src/guest-runtime.js';
import {windowsBootId,guestSetupCache,saveGuestSetupCache} from './guest-setup-cache.mjs';
import {chooseInputDrivers,showInputRestartNotice,driverSetupShortcut} from './input-driver-prompt.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=path.join(root,'.local/tools/guest-input');
async function download(url,file,sha){
  if(await exists(file) && crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')===sha)return;
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error('Optional input runtime download failed.');
  const bytes=Buffer.from(await response.arrayBuffer());if(crypto.createHash('sha256').update(bytes).digest('hex')!==sha)throw new Error('Optional input runtime checksum did not match.');await fs.writeFile(file,bytes);
}
async function extract(file,dest){await run('powershell.exe',['-NoProfile','-Command','Expand-Archive -LiteralPath $env:PAD_GUEST_ARCHIVE -DestinationPath $env:PAD_GUEST_DEST -Force'],rootWithEnv(file,dest));}
// Use environment values rather than interpolating filesystem paths into code.
function rootWithEnv(file,dest){process.env.PAD_GUEST_ARCHIVE=file;process.env.PAD_GUEST_DEST=dest;return root;}
try{
  if(process.argv.includes('--help'))console.log('Prepare guest input blocking. Windows asks separately about HidHide (controllers) and Interception (keyboard/mouse), remembering each answer. --install-drivers checks Windows again and asks about missing drivers; it can re-enable removed drivers after approval. --yes accepts both driver installations without console questions (Windows may still ask for administrator approval). --controllers-only skips Interception; --reader-only skips driver installation. --all-devices remains supported. Restart Windows after driver installation; setup never restarts automatically. Linux/macOS use Python 3.9+ and per-device OS access. No devices are blocked during setup.');
  else if(['linux','darwin'].includes(process.platform)){
    const probe=spawnSync('python3',['-c','import json,sys,struct; print(json.dumps({"python":sys.executable,"version":list(sys.version_info[:2]),"bits":struct.calcsize("P")*8}))'],{encoding:'utf8'});
    if(probe.status!==0)throw new Error('Install Python 3.9 or newer, then run this setup again. See system/docs/guest-device-isolation.md.');
    const runtime=JSON.parse(probe.stdout);
    if(runtime.version[0]<3 || runtime.version[0]===3 && runtime.version[1]<9 || runtime.bits!==64)throw new Error('Native guest input needs 64-bit Python 3.9 or newer.');
    const check=spawnSync(runtime.python,['-B','-c','import ast,sys; [ast.parse(open(p,encoding="utf-8").read(),p) for p in sys.argv[1:]]',...posixSources.map(file=>path.join(root,'system/native',file))],{encoding:'utf8'});
    if(check.status!==0)throw new Error('The native reader could not be checked: '+(check.stderr || check.error?.message || 'Python failed.'));
    // Read-only inventory verifies OS APIs without grabbing any input device.
    const scan=spawnSync(runtime.python,['-B',path.join(root,'system/native/guest-input-posix.py'),'--scan'],{encoding:'utf8',timeout:15000});
    if(scan.status!==0)throw new Error('Device check failed: '+(scan.stdout || scan.stderr || scan.error?.message || 'OS input API unavailable.'));
    const inventory=JSON.parse(scan.stdout);
    await fs.mkdir(folder,{recursive:true});
    await fs.writeFile(path.join(folder,'posix-build.json'),JSON.stringify({platform:process.platform,python:runtime.python,sourceHash:guestSourceHash(process.platform)},null,2)+'\n');
    console.log(`Native guest reader ready. Found ${inventory.devices.length} devices; none were isolated.`);
    for(const note of inventory.notes || [])console.log(note);
    console.log('Run 02-Join. Block local controller input is on by default; check Controller status & advanced input. Setup and permissions: system/docs/guest-device-isolation.md.');
  }else {
    if(process.platform!=='win32' || process.arch!=='x64')throw new Error('Native guest input supports Windows x64 and 64-bit Linux/macOS with Python 3.9+.');
    if(process.argv.includes('--controllers-only') && process.argv.includes('--all-devices'))throw new Error('Choose --controllers-only or --all-devices, not both.');
    let driverMode=process.argv.includes('--reader-only')?'None':process.argv.includes('--controllers-only')?'Controllers':'All';
    const bootId=windowsBootId();
    if(driverMode!=='None'){
      const choices=await chooseInputDrivers(root,{force:process.argv.includes('--install-drivers'),yes:process.argv.includes('--yes'),controllersOnly:process.argv.includes('--controllers-only')});
      const interception=!process.argv.includes('--controllers-only') && choices.interception;
      driverMode=choices.hidHide?(interception?'All':'Controllers'):(interception?'Interception':'None');
    }
    if(driverMode==='None' && !process.argv.includes('--reader-only')){
      console.log(`Optional input-blocking drivers skipped. Share normally, or install them later with ${driverSetupShortcut}.`);
      await showInputRestartNotice(root,bootId);
      process.exit(0);
    }
    console.log(`Guest input setup: ${driverMode==='Controllers'?'controllers only (HidHide)':driverMode==='Interception'?'keyboard/mouse only (Interception)':driverMode==='All'?'controllers + keyboard/mouse (HidHide + Interception)':'reader only (no driver installation)'}.`);
    await fs.mkdir(folder,{recursive:true});
    let readerCurrent=false;
    try{readerCurrent=(await fs.readFile(path.join(folder,'source.sha256'),'utf8')).trim()===guestSourceHash('win32') && await exists(path.join(folder,'webrtc-pad-guest.exe')) && await exists(path.join(folder,'SDL3.dll')) && await exists(path.join(folder,'interception.dll'));}catch{}
    const cacheOptions={mode:driverMode,sourceHash:guestSourceHash('win32'),bootId,force:process.argv.includes('--install-drivers')};
    let cache=await guestSetupCache(root,cacheOptions);
    if(readerCurrent && cache.valid){console.log('Input setup already checked this Windows boot; starting immediately. Use 09-Guest-Exclusive-Setup to force a fresh check.');await showInputRestartNotice(root,bootId);process.exit(0);}
    const {runningApp}=await import('./install-utils.mjs');
    if(!readerCurrent && await runningApp(Number(process.env.PORT || 8787),!!process.env.TLS_CERT))throw new Error('The input reader needs an update. Close the app console and run this shortcut again. No drivers were installed.');
    if(!readerCurrent){
    const sdl=path.join(folder,'SDL3-3.4.18.zip'),interception=path.join(folder,'Interception.zip');
    await download('https://github.com/libsdl-org/SDL/releases/download/release-3.4.18/SDL3-3.4.18-win32-x64.zip',sdl,'75c2c0fc74e7d1206aaedc22893a35887332f4f85f5c8b74fddc10d177985f2c');
    await extract(sdl,path.join(folder,'sdl-upstream'));
    await download('https://github.com/oblitum/Interception/releases/download/v1.0.1/Interception.zip',interception,'ad038963d6413055765128b0b931f6e765147c9916dba79e65d872b261f9af10');
    await extract(interception,path.join(folder,'interception-upstream'));
    async function find(dir,name){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isFile() && entry.name===name)return file;if(entry.isDirectory()){const found=await find(file,name);if(found)return found;}}}
    await fs.copyFile(await find(path.join(folder,'sdl-upstream'),'SDL3.dll'),path.join(folder,'SDL3.dll'));
    await fs.copyFile(path.join(folder,'interception-upstream/Interception/library/x64/interception.dll'),path.join(folder,'interception.dll'));
    const compiler=path.join(process.env.WINDIR || 'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    await run(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/r:System.Web.Extensions.dll',`/out:${path.join(folder,'webrtc-pad-guest.exe')}`,path.join(root,'system/native/guest-input.cs')],root);
    await fs.writeFile(path.join(folder,'source.sha256'),crypto.createHash('sha256').update(await fs.readFile(path.join(root,'system/native/guest-input.cs'))).digest('hex'));
    console.log('Native guest reader built. Opening Join with Block local controller input on automatically reserves ready controllers.');
    }else console.log('The input reader is already ready; skipping downloads and rebuild.');
    if(driverMode!=='None'){
      if(['All','Interception'].includes(driverMode) && !await exists(path.join(folder,'interception-upstream/Interception/command line installer/install-interception.exe'))){
        const archive=path.join(folder,'Interception.zip');
        await download('https://github.com/oblitum/Interception/releases/download/v1.0.1/Interception.zip',archive,'ad038963d6413055765128b0b931f6e765147c9916dba79e65d872b261f9af10');
        await extract(archive,path.join(folder,'interception-upstream'));
      }
      console.log('Checking input blocking drivers. Windows may ask for administrator access. Interception has separate non-commercial/commercial license terms in the downloaded licenses folder.');
      const script=path.join(root,'system/scripts/install-guest-drivers.ps1');
      await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Devices',driverMode,'-InstallChoice','Install',...(bootId?['-BootId',bootId]:[]),...(process.argv.includes('--install-drivers')?['-EnableHidHide','-EnableInterception']:[])],root);
      // A failed install never reaches this point. Re-read the opt-out after
      // explicit repair, which may have just enabled HidHide again.
      cache=await guestSetupCache(root,{...cacheOptions,force:false});
      await saveGuestSetupCache(cache);
      console.log('Input setup is ready. Controller blocking follows your HidHide choice; select keyboard/mouse devices under Advanced when you want to share them.');
    }else console.log('Drivers skipped. Run this shortcut without --reader-only to set up controller input blocking.');
    await showInputRestartNotice(root,bootId);
  }
}catch(error){console.error(`Guest input setup: ${error.message}`);process.exitCode=1;}
