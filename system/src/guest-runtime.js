import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
export const posixSources=['guest-input-posix.py','guest_input_common.py','guest_input_linux.py','guest_input_macos.py'];
export function guestSourceHash(platform,root=projectRoot){
  const hash=crypto.createHash('sha256');
  for(const file of platform==='win32'?['guest-input.cs']:posixSources)hash.update(fs.readFileSync(path.join(root,'system/native',file)));
  return hash.digest('hex');
}
export function guestLaunchPlan(platform=process.platform,root=projectRoot){
  const folder=path.join(root,'.local/tools/guest-input');
  if(platform==='win32'){
    const command=path.join(folder,'webrtc-pad-guest.exe');
    if(!fs.existsSync(command) || fs.readFileSync(path.join(folder,'source.sha256'),'utf8').trim()!==guestSourceHash(platform,root))throw new Error('Guest reader needs setup.');
    return {command,args:[],options:{windowsHide:true,stdio:['pipe','pipe','pipe']}};
  }
  if(!['linux','darwin'].includes(platform))throw new Error('Native guest input is unavailable on this platform.');
  const manifest=JSON.parse(fs.readFileSync(path.join(folder,'posix-build.json'),'utf8'));
  if(manifest.platform!==platform || manifest.sourceHash!==guestSourceHash(platform,root) || !path.isAbsolute(manifest.python || '') || !fs.existsSync(manifest.python))throw new Error('Guest reader needs setup.');
  return {command:manifest.python,args:['-B',path.join(root,'system/native/guest-input-posix.py')],options:{detached:true,stdio:['pipe','pipe','pipe']}};
}
