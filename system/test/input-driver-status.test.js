import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installedInputDrivers} from '../scripts/input-driver-status.mjs';

test('driver discovery is a bounded read-only Windows check and validates results',()=>{
  let called=0;
  const invoke=(command,args,options)=>{called++;assert.match(command,/powershell.exe$/);assert.match(args.at(-1),/input-driver-status.ps1$/);assert.equal(options.windowsHide,true);assert.equal(options.timeout,5000);assert.ok(!args.includes('-Verb'));return {status:0,stdout:'{"hidHide":true,"interception":false}\r\n'};};
  assert.deepEqual(installedInputDrivers('C:/app',{platform:'win32',invoke}),{hidHide:true,interception:false,checked:true});assert.equal(called,1);
  assert.equal(installedInputDrivers('C:/app',{platform:'linux',invoke}).checked,false);assert.equal(called,1);
  for(const result of [{status:1},{status:0,stdout:'invalid'},{status:0,stdout:'{"hidHide":"true","interception":true}'}])assert.equal(installedInputDrivers('C:/app',{platform:'win32',invoke:()=>result}).checked,false);
  assert.equal(installedInputDrivers('C:/app',{platform:'win32',invoke:()=>{throw Error('Unavailable');}}).checked,false);
});

test('Windows discovery recognizes pending registrations and rejects partial, missing, disabled or detached drivers',{skip:process.platform!=='win32'},async t=>{
  const temporaryRoot=await fs.realpath(os.tmpdir()),folder=await fs.mkdtemp(path.join(temporaryRoot,'pad-driver-status-'));
  t.after(async()=>{const resolved=await fs.realpath(folder);assert.equal(path.dirname(resolved),temporaryRoot);assert.ok(path.basename(resolved).startsWith('pad-driver-status-'));await fs.rm(resolved,{recursive:true,force:true});});
  const script=fileURLToPath(new URL('../scripts/input-driver-status.ps1',import.meta.url));
  for(const scenario of ['installed','missing','partial','disabled','detached','missing-file']){
    const wrapper=path.join(folder,'check.ps1');await fs.writeFile(wrapper,`
$ErrorActionPreference='Stop'
function Get-ItemProperty { [CmdletBinding()]param($LiteralPath,$Name)
  if('${scenario}' -eq 'missing'){return}
  if($LiteralPath -like '*Services*'){
    if('${scenario}' -eq 'partial' -and $LiteralPath -like '*Services\\mouse'){return}
    [pscustomobject]@{Type=1;Start=$(if('${scenario}' -eq 'disabled'){4}else{3})}
  }else{[pscustomobject]@{UpperFilters=$(if('${scenario}' -eq 'detached'){@('kbdclass','mouclass')}else{@('keyboard','mouse')})}}
}
function Test-Path { [CmdletBinding()]param($LiteralPath) return ('${scenario}' -ne 'missing-file') }
function Get-CimInstance {throw 'CIM must not be required for pending registrations'}
function Start-Process {throw 'Discovery must never launch an installer'}
& '${script.replaceAll("'","''")}'
`);
    const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',wrapper],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(result.status,0,result.stderr);
    const status=JSON.parse(result.stdout);assert.equal(status.hidHide,['installed','partial','detached'].includes(scenario),scenario);assert.equal(status.interception,scenario==='installed',scenario);
  }
});
