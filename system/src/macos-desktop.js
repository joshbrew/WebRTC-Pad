import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export function macDesktopCapability(env=process.env){
  const helper=env.NATIVE_MAC_HELPER || fileURLToPath(new URL('../../.local/tools/webrtc-pad-mac',import.meta.url));
  const supported=process.platform!=='darwin' || Number(os.release().split('.')[0])>=22;
  const available=supported && fs.existsSync(helper);
  return {available,helper,error:!supported?'Mac native capture requires macOS 13 or later.':!available?'Run mac/shortcuts/07-Host-Native.command to build the Mac helper. Apple Command Line Tools and FFmpeg are required.':null};
}
export async function macPermissions(action='status',env=process.env){
  const modes={status:'permissions',screen:'request-screen',input:'request-input'};
  if(!Object.hasOwn(modes,action))throw new Error('Invalid Mac permission request');
  const capability=macDesktopCapability(env);if(!capability.available)throw new Error(capability.error);
  const {stdout}=await execute(capability.helper,[modes[action]],{env:{...process.env,...env},timeout:action==='status'?8000:60000,maxBuffer:8192});
  const value=JSON.parse(stdout);return {screen:value.screen===true,input:value.input===true};
}
