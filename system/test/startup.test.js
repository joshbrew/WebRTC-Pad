import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {windowsHostDriverInstalled} from '../scripts/host-driver-status.mjs';

test('Windows host readiness detects removed registration or driver binaries without opening devices',()=>{
  const image='C:\\Windows\\System32\\drivers\\ViGEmBus.sys';let checked,queried;
  for(const value of ['\\SystemRoot\\System32\\drivers\\ViGEmBus.sys','%SystemRoot%\\System32\\drivers\\ViGEmBus.sys','System32\\drivers\\ViGEmBus.sys','\\??\\'+image]){
    assert.equal(windowsHostDriverInstalled({env:{WINDIR:'C:\\Windows'},query:(...args)=>{queried=args;return {status:0,stdout:'    ImagePath    REG_EXPAND_SZ    '+value+'\r\n'};},fileExists:file=>{checked=file;return true;}}),true);
    assert.equal(checked,image);assert.equal(queried[2].windowsHide,true);assert.ok(queried[2].timeout<=1500);
  }
  assert.equal(windowsHostDriverInstalled({query:()=>({status:1}),fileExists:()=>assert.fail('Missing registration')}),false);
  assert.equal(windowsHostDriverInstalled({query:()=>({status:0,stdout:'ImagePath REG_SZ '+image}),fileExists:()=>false}),false);
  assert.equal(windowsHostDriverInstalled({query:()=>{throw Error('Registry unavailable');}}),false);
});

// Executes the real launcher orchestration with stub installers and device probes.
// No network, package installation, driver access or user app process is involved.
async function startup(t,scenario,args=['start','--no-browser']){
  const parent=path.resolve('.local/startup-tests');await fs.mkdir(parent,{recursive:true});const root=await fs.mkdtemp(path.join(parent,'case-'));
  t.after(async()=>{assert.ok(root.startsWith(parent+path.sep));await fs.rm(root,{recursive:true,force:true});});
  async function put(file,value){const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,value);}
  const lock='{"packages":{}}',source='fixture';
  const state={lockHash:crypto.createHash('sha256').update(lock).digest('hex'),runtime:`${process.platform}/${process.arch}/${process.versions.modules}`,role:'player',hostReady:scenario.hostReady===true,hidSourceHash:crypto.createHash('sha256').update(source).digest('hex')};
  await put('package.json','{"type":"module"}');await put('package-lock.json',lock);await put('.env',`INPUT_BACKEND=${scenario.videoOnly?'none':'auto'}\n`);await put('.local/install.json',JSON.stringify(state));await put('scenario.json',JSON.stringify(scenario));
  await put('system/native/macos-gamepad.c',source);await put('system/native/webrtc-pad-hid','fixture');
  if(scenario.baseReady!==false){await put('node_modules/ws/package.json','{}');await put('node_modules/uplot-webgpu/scripts/uPlot.js','');}
  await put('system/scripts/run.mjs',await fs.readFile(new URL('../scripts/run.mjs',import.meta.url),'utf8'));
  await put('system/scripts/native-version.mjs','export const nativeSourceHash=()=>"fixture";');
  await put('system/scripts/host-driver-status.mjs','import fs from "node:fs";const s=JSON.parse(fs.readFileSync(new URL("../../scenario.json",import.meta.url)));export const windowsHostDriverInstalled=()=>s.driver!==false;');
  await put('system/src/guest-runtime.js','import fs from "node:fs";const s=JSON.parse(fs.readFileSync(new URL("../../scenario.json",import.meta.url)));export function guestLaunchPlan(){if(s.guestCurrent===false)throw Error("stale");return {};};');
  await put('system/src/inject/package.json','{"type":"commonjs"}');
  await put('system/src/inject/windows-binding.js','const fs=require("node:fs"),path=require("node:path");const s=JSON.parse(fs.readFileSync(path.join(__dirname,"../../../scenario.json")));exports.inspectBinding=()=>({state:s.binding || "ready"});');
  await put('system/scripts/install-utils.mjs',`
    import fs from 'node:fs/promises';import path from 'node:path';
    const root=new URL('../../',import.meta.url),s=JSON.parse(await fs.readFile(new URL('scenario.json',root),'utf8')),calls=[];
    export const exists=async file=>{try{await fs.access(file);return true;}catch{return false;}};
    export const supportedNode=()=>true, runningApp=async()=>s.busy===true;
    export const savedRole=async()=>JSON.parse(await fs.readFile(new URL('.local/install.json',root),'utf8')).role;
    export async function run(command,args){calls.push(args);if(args.includes('system/scripts/setup.mjs')){const state=JSON.parse(await fs.readFile(new URL('.local/install.json',root),'utf8'));state.hostReady=true;state.role=args[1];await fs.writeFile(new URL('.local/install.json',root),JSON.stringify(state));}if(s.failGuest && args.includes('system/scripts/setup-guest-input.mjs'))throw Error('Optional reader failed');}
    process.on('exit',()=>console.log('TRACE '+JSON.stringify(calls)));
  `);
  const result=spawnSync(process.execPath,[path.join(root,'system/scripts/run.mjs'),...args],{cwd:root,encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr || result.error?.message || result.stdout);
  const calls=JSON.parse(result.stdout.split(/\r?\n/).find(line=>line.startsWith('TRACE ')).slice(6));
  return {calls,output:result.stdout,state:JSON.parse(await fs.readFile(path.join(root,'.local/install.json'),'utf8')),original:state};
}

test('generic Start repairs host support even with a saved guest view and preserves that view',async t=>{
  const result=await startup(t,{hostReady:false});
  assert.ok(result.calls.some(args=>args[0]==='system/scripts/setup.mjs' && args[1]==='host'));
  assert.equal(result.state.role,'player');assert.ok(result.calls.some(args=>args.includes('system/scripts/launch.mjs') && args.includes('--player')));
  assert.ok(result.calls.some(args=>args.includes('system/scripts/launch.mjs') && args.includes('--remember-page')));
});

test('Windows Start wrapper leaves page choice to the browser while role shortcuts remain explicit',{skip:process.platform!=='win32'},async t=>{
  const parent=path.resolve('.local/startup-tests');await fs.mkdir(parent,{recursive:true});const root=await fs.mkdtemp(path.join(parent,'wrapper-'));
  t.after(async()=>{assert.ok(root.startsWith(parent+path.sep));await fs.rm(root,{recursive:true,force:true});});
  await fs.mkdir(path.join(root,'system/scripts'),{recursive:true});await fs.mkdir(path.join(root,'.local'),{recursive:true});
  await fs.writeFile(path.join(root,'.local/install.json'),JSON.stringify({role:'player'}));
  await fs.copyFile(new URL('../scripts/run.ps1',import.meta.url),path.join(root,'system/scripts/run.ps1'));
  await fs.writeFile(path.join(root,'system/scripts/run.mjs'),`const args=process.argv.slice(2);console.log(args.includes('--status')?JSON.stringify({busy:true,hostControllers:false}):'MACRO_ARGS '+JSON.stringify(args));`);
  const invoke=extra=>{const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'system/scripts/run.ps1'),...extra,'-SkipNodeInstall','-SkipDriverInstall','-NoBrowser'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(result.status,0,result.stderr || result.stdout);return JSON.parse(result.stdout.split(/\r?\n/).find(line=>line.startsWith('MACRO_ARGS ')).slice(11));};
  const generic=invoke(['-Macro','start']);assert.ok(generic.includes('start'));assert.ok(!generic.some(a=>['--host','--player'].includes(a)));
  assert.ok(invoke(['-Macro','start','-Role','host']).includes('--host'));
  assert.ok(invoke(['-Macro','join']).includes('--player'));
});
test('cached generic Start skips dependency repairs and explicit Join keeps host setup optional',async t=>{
  const ready=await startup(t,{hostReady:true});assert.ok(!ready.calls.some(args=>args.includes('system/scripts/setup.mjs')));
  const joining=await startup(t,{hostReady:false},['join','--no-browser']);assert.ok(!joining.calls.some(args=>args.includes('system/scripts/setup.mjs')));
  assert.ok(joining.calls.some(args=>args.includes('system/scripts/launch.mjs') && !args.includes('--remember-page')));
});
test('Windows Start invalidates host cache when the binding breaks or its driver disappears',{skip:process.platform!=='win32'},async t=>{
  for(const missing of [{binding:'broken'},{driver:false}]){const result=await startup(t,{hostReady:true,...missing});assert.ok(result.calls.some(args=>args[0]==='system/scripts/setup.mjs' && args[1]==='host'));}
});
test('reusing a running app performs no setup or state writes despite missing prerequisites',async t=>{
  const result=await startup(t,{hostReady:false,busy:true,guestCurrent:false});assert.equal(result.calls.length,1);assert.ok(result.calls[0].includes('system/scripts/launch.mjs'));assert.deepEqual(result.state,result.original);
});
test('optional reader failures do not stop browser sharing from launching',async t=>{
  const result=await startup(t,{hostReady:true,guestCurrent:false,failGuest:true});assert.match(result.output,/Starting with browser controller support/);assert.ok(result.calls.some(args=>args.includes('system/scripts/launch.mjs')));
});
test('startup status is read-only and reports a busy app for the Windows bootstrap',async t=>{
  const result=await startup(t,{hostReady:false,busy:true},['--status']);assert.deepEqual(JSON.parse(result.output.split(/\r?\n/)[0]),{baseReady:true,hostReady:false,hostControllers:true,hostDriverReady:true,busy:true});assert.deepEqual(result.calls,[]);assert.deepEqual(result.state,result.original);
});
test('explicit video-only configuration does not install host controller prerequisites',async t=>{
  const result=await startup(t,{hostReady:false,driver:false,binding:'missing',videoOnly:true});assert.ok(!result.calls.some(args=>args.includes('system/scripts/setup.mjs')));
});
