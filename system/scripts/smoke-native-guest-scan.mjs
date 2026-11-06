// Real SDL/Windows enumeration only; no hiding or interception.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createInjector}=require('../src/inject/windows-vigem.js');
async function scan(){
  const reader=spawn('.local/tools/guest-input/webrtc-pad-guest.exe',[],{windowsHide:true,stdio:['pipe','pipe','inherit']});
  try{return await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Native scan timed out')),5000);
    createInterface({input:reader.stdout}).on('line',line=>{const value=JSON.parse(line);if(value.type==='devices'){clearTimeout(timeout);resolve(value);}if(value.type==='error'){clearTimeout(timeout);reject(new Error(value.error));}});
  });}finally{const exited=once(reader,'exit');reader.stdin.end();await exited;}
}
let driver;
try{
  const before=await scan();driver=await createInjector({playerCount:1,controllerType:'ds4'});const after=await scan();
  const identities=value=>value.devices.map(d=>JSON.stringify({kind:d.kind,label:d.label,available:d.available})).sort();
  assert.deepEqual(identities(after),identities(before),'Host virtual output must not be offered as a guest input');
  console.log('PASS: real native SDL/Windows ancestry scan excludes a live ViGEm host controller while retaining the original device inventory; no hiding/filtering was enabled');
}finally{await driver?.close();}
