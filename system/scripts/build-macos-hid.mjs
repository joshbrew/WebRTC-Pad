import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
export function macHidBuildArgs(arch){if(!['arm64','x64'].includes(arch))throw Error('macOS HID builds support Apple Silicon and Intel');return ['clang','-O2','-Wall','-Wextra','-arch',arch==='arm64'?'arm64':'x86_64','system/native/macos-gamepad.c','-framework','IOKit','-framework','CoreFoundation','-o','system/native/webrtc-pad-hid'];}
export async function buildMacHid(){if(process.platform!=='darwin')throw Error('Build the virtual HID helper on macOS with Apple Command Line Tools.');await new Promise((resolve,reject)=>{const child=spawn('xcrun',macHidBuildArgs(process.arch),{cwd:root,stdio:'inherit'});child.on('error',()=>reject(Error('Install Apple Command Line Tools with xcode-select --install, then retry.')));child.on('exit',code=>code===0?resolve():reject(Error('Mac HID build failed. Check Apple Command Line Tools; virtual HID use may also require Apple-approved signing.')));});}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))buildMacHid().catch(error=>{console.error(error.message);process.exitCode=1;});
