import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function buildMacDesktop(){
  if(process.platform!=='darwin')throw new Error('Build the Mac helper on macOS 13 or later with Apple Command Line Tools installed.');
  const folder=path.join(root,'.local/tools'), output=path.join(folder,'webrtc-pad-mac');await fs.mkdir(folder,{recursive:true});
  const run=(cmd,args)=>new Promise((resolve,reject)=>{const child=spawn(cmd,args,{cwd:root,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${cmd} failed (${code}). Install Apple Command Line Tools with xcode-select --install, then retry.`)));});
  // Ad-hoc sign the local build. macOS may require renewing TCC permission
  // after a rebuild. No entitlements or permissions are granted by setup.
  await run('xcrun',['swiftc','-O','-swift-version','5','-parse-as-library','-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macosx13.0`,'system/native/macos/Desktop.swift','-o',output,'-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker','system/native/macos/Info.plist']);
  await run('codesign',['--force','--sign','-','--identifier','org.webrtc-pad.desktop',output]);
  await run(output,['self-test']);return output;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))buildMacDesktop().catch(error=>{console.error(error.message);process.exitCode=1;});
