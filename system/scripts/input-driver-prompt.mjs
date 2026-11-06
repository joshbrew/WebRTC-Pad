import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createInterface} from 'node:readline/promises';
import {readInputDriverPreferences} from '../src/input-driver-choice.js';
import {windowsBootStartedAt} from './guest-setup-cache.mjs';
import {installedInputDrivers} from './input-driver-status.mjs';
import {interceptionReconnectWarning} from '../public/guest-platform.js';

export const driverSetupShortcut='windows/shortcuts/09-Guest-Exclusive-Setup.cmd';
export async function chooseInputDrivers(root,{force=false,yes=false,controllersOnly=false,interactive=!!process.stdin.isTTY,ask,log=console.log,detectInstalled=installedInputDrivers}={}){
  const saved=readInputDriverPreferences(root);
  if(!force && !yes && saved)return saved;
  let found;try{found=await detectInstalled(root);}catch{}
  const installed={hidHide:found?.checked===true && found.hidHide===true,interception:found?.checked===true && found.interception===true};
  const disabled={hidHide:false,interception:false};
  if(!force && !yes)for(const [kind,file] of [['hidHide','hidhide-disabled'],['interception','interception-disabled']]){try{await fs.access(path.join(root,'.local',file));disabled[kind]=true;}catch{}}
  const choice={hidHide:installed.hidHide && !disabled.hidHide,interception:controllersOnly?(saved?.interception || false):installed.interception && !disabled.interception};
  const requested=controllersOnly?['hidHide']:['hidHide','interception'],missing=requested.filter(kind=>!choice[kind] && !disabled[kind]);
  const warnInterception=()=>log(interceptionReconnectWarning+' Choose No for focused browser input; Windows shortcuts may still run locally.');
  if(yes && !controllersOnly)warnInterception();
  for(const kind of requested){const label=kind==='hidHide'?'HidHide':'Interception';
    if(choice[kind])log(`${label} is already installed. Reusing the existing driver.`);
    else if(disabled[kind])log(`${label} setup remains off. Use ${driverSetupShortcut} to enable it later.`);
  }
  if(yes){choice.hidHide=true;if(!controllersOnly)choice.interception=true;}
  else if(missing.length){
    if(found?.checked!==true)log('Existing input drivers could not be verified. The installer will check again before making changes.');
    log('\nOptional: use your inputs only on your friend’s computer');
    log('HidHide (controllers) and Interception (keyboards/mice) can block local input while you play remotely.');
    log('Regular controller sharing, video and voice work without these drivers.');
    log('Installation needs Windows administrator approval and a computer restart. Setup will not restart it for you.');
    log(`You can skip this and install later with ${driverSetupShortcut}.`);
    if(!interactive && !ask){
      log('No interactive console: skipping installation of missing optional drivers.');
      if(saved)return choice;
    }else{
      const rl=ask?null:createInterface({input:process.stdin,output:process.stdout});
      const question=ask || (text=>rl.question(text));
      try{for(const kind of missing){if(kind==='interception')warnInterception();const label=kind==='hidHide'?'HidHide for controller blocking':'Interception for keyboard/mouse blocking';choice[kind]=/^(y|yes)$/i.test((await question(`Install ${label}? [y/N] `)).trim());}}
      finally{rl?.close();}
    }
  }
  await fs.mkdir(path.join(root,'.local'),{recursive:true});
  await fs.writeFile(path.join(root,'.local/input-driver-choice.json'),JSON.stringify(choice)+'\n');
  return choice;
}

export async function showInputRestartNotice(root,bootId,{log=console.log,getBootTime=windowsBootStartedAt}={}){
  const file=path.join(root,'.local/input-drivers-restart.json');
  let saved;try{saved=JSON.parse(await fs.readFile(file,'utf8'));}catch{return;}
  if(saved.bootId && bootId && saved.bootId!==bootId){await fs.rm(file,{force:true});return;}
  let installedAt;try{installedAt=(await fs.stat(file)).mtimeMs;}catch{return;}
  // A stale/reused registry BootId must not trap a reminder forever. Uptime
  // only decides whether to query Windows; clearing still needs its real boot time.
  if(!saved.bootId || !bootId || Date.now()-os.uptime()*1000>installedAt){
    const lastBoot=getBootTime();
    if(lastBoot && lastBoot>installedAt){await fs.rm(file,{force:true});return;}
  }
  const drivers=Array.isArray(saved.drivers)?saved.drivers.filter(name=>['HidHide','Interception'].includes(name)).join(' and '):'';
  log(saved.action==='remove'?'\n*** RESTART YOUR COMPUTER to finish removing input-blocking drivers. ***':'\n*** RESTART YOUR COMPUTER to finish input-blocking driver setup. ***');
  if(drivers)log(`${drivers} ${saved.action==='remove'?'removal':'installation'} is waiting for Windows to restart.`);
  if(saved.bootId && saved.bootId===bootId)log('These driver changes were made after Windows last started.');
  log(saved.action==='remove'?'Save your work and restart Windows when convenient. Removed filters may remain loaded until then.':'Save your work and restart Windows when convenient. Regular sharing is available now; input blocking may need the restart.');
  log('Use Start > Power > Restart. Closing and reopening the app or command window does not restart Windows.');
  log('Setup will never restart Windows automatically.\n');
}
