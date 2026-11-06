import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// Read registration and the binary only; never opens the driver or creates pads.
export function windowsHostDriverInstalled({env=process.env,query=spawnSync,fileExists=fs.existsSync}={}){
  try{
    const windows=env.WINDIR || 'C:\\Windows';
    const result=query(path.win32.join(windows,'System32/reg.exe'),['query','HKLM\\SYSTEM\\CurrentControlSet\\Services\\ViGEmBus','/v','ImagePath'],{encoding:'utf8',windowsHide:true,timeout:1500});
    if(result.status!==0)return false;
    let image=result.stdout?.match(/ImagePath\s+REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/i)?.[1]?.trim().replace(/^"|"$/g,'');
    if(!image)return false;
    image=image.replace(/^\\\?\?\\/,'').replace(/^\\SystemRoot(?=\\)/i,windows).replace(/%SystemRoot%|%windir%/gi,windows);
    if(!path.win32.isAbsolute(image))image=path.win32.join(windows,image);
    return fileExists(image);
  }catch{return false;}
}
