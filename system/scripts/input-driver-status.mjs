import path from 'node:path';
import {spawnSync} from 'node:child_process';

export function installedInputDrivers(root,{platform=process.platform,env=process.env,invoke=spawnSync}={}){
  const unknown={hidHide:false,interception:false,checked:false};
  if(platform!=='win32')return unknown;
  try{
    const result=invoke(path.join(env.WINDIR || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'system/scripts/input-driver-status.ps1')],{encoding:'utf8',windowsHide:true,timeout:5000});
    if(result.status!==0)return unknown;
    const value=JSON.parse(result.stdout.trim());
    return typeof value.hidHide==='boolean' && typeof value.interception==='boolean'?{hidHide:value.hidHide,interception:value.interception,checked:true}:unknown;
  }catch{return unknown;}
}
