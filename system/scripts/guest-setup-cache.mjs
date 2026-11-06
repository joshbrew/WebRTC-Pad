import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

// BootId is cheap to read and changes on Windows boot. If it is unavailable,
// keep checking normally rather than guessing from wall clock/uptime.
export function windowsBootId({env=process.env,invoke=spawnSync}={}){
  try{
    const result=invoke(path.join(env.WINDIR || 'C:\\Windows','System32/reg.exe'),['query','HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters','/v','BootId'],{encoding:'utf8',windowsHide:true,timeout:3000});
    const match=result.status===0 && result.stdout?.match(/\bBootId\s+REG_DWORD\s+(0x[\da-f]+)/i);
    return match?`${env.COMPUTERNAME || 'local'}:${parseInt(match[1],16)}`:null;
  }catch{return null;}
}

// Used only for legacy restart notices without a usable boot identifier.
export function windowsBootStartedAt({env=process.env,invoke=spawnSync}={}){
  try{
    const result=invoke(path.join(env.WINDIR || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-Command',"(Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime.ToUniversalTime().ToString('o')"],{encoding:'utf8',windowsHide:true,timeout:5000});
    const value=result.status===0?Date.parse(result.stdout.trim()):NaN;
    return Number.isFinite(value)?value:null;
  }catch{return null;}
}

export async function guestSetupCache(root,{mode,sourceHash,bootId,force=false}){
  const file=path.join(root,'.local/tools/guest-input/setup-check.json');
  if(!bootId)return {file,key:null,valid:false};
  const fingerprint=crypto.createHash('sha256');
  for(const script of ['setup-guest-input.mjs','install-guest-drivers.ps1','hidhide-updater.ps1','input-driver-status.ps1'])fingerprint.update(await fs.readFile(path.join(root,'system/scripts',script)));
  let disabled=false;try{await fs.access(path.join(root,'.local/hidhide-disabled'));disabled=true;}catch{}
  let interceptionDisabled=false;try{await fs.access(path.join(root,'.local/interception-disabled'));interceptionDisabled=true;}catch{}
  let choice=null;try{choice=JSON.parse(await fs.readFile(path.join(root,'.local/input-driver-choice.json'),'utf8'));}catch{}
  const key=JSON.stringify({bootId,mode,sourceHash,disabled,interceptionDisabled,choice,setup:fingerprint.digest('hex')});
  let saved;try{saved=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
  return {file,key,valid:!force && saved?.key===key};
}

export async function saveGuestSetupCache(cache){
  if(!cache.key)return;
  await fs.mkdir(path.dirname(cache.file),{recursive:true});
  await fs.writeFile(cache.file,JSON.stringify({key:cache.key})+'\n');
}
