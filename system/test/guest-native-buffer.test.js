import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const compiler=path.join(process.env.WINDIR || 'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
test('native HidHide reads size nonempty lists exactly and bound returned configuration without opening a driver',{skip:process.platform!=='win32' || !fs.existsSync(compiler)},t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pad-hide-buffer-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const output=path.join(folder,'reader.exe'),source=fileURLToPath(new URL('../native/guest-input.cs',import.meta.url));
  const build=spawnSync(compiler,['/nologo','/target:exe','/platform:x64','/r:System.Web.Extensions.dll',`/out:${output}`,source],{encoding:'utf8',timeout:30000,windowsHide:true});assert.equal(build.status,0,build.stdout+build.stderr);
  const paths=spawnSync(output,['--controller-path-selftest'],{encoding:'utf8',timeout:5000,windowsHide:true});assert.equal(paths.status,0,paths.stdout+paths.stderr);assert.equal(JSON.parse(paths.stdout).passed,true);
  const run=spawnSync(output,['--hidhide-buffer-selftest'],{encoding:'utf8',timeout:5000,windowsHide:true});assert.equal(run.status,0,run.stdout+run.stderr);assert.equal(JSON.parse(run.stdout).passed,true);
});
