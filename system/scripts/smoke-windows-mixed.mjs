import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import injection from '../src/inject/index.js';
import states from '../src/inject/state.js';
const xinput=async()=>JSON.parse((await promisify(execFile)('python',['system/scripts/read-xinput.py'])).stdout);
const holder=await injection.createInjector({playerCount:2,controllerType:'x360'});
let driver,reader,heartbeat,latest=[];
const until=async predicate=>{const end=Date.now()+10000;while(!predicate()){if(Date.now()>end)throw new Error('Mixed output state timed out');await new Promise(r=>setTimeout(r,30));}};
try {
  driver=await injection.createInjector({playerCount:0,controllerType:'auto'});
  reader=spawn('python',['system/scripts/read-hid-gamepads.py','--watch'],{windowsHide:true,stdio:['ignore','pipe','inherit']});
  createInterface({input:reader.stdout}).on('line',line=>latest=JSON.parse(line).filter(p=>p.vendor===0x054c && p.product===0x05c4));
  const before=new Set(JSON.parse((await promisify(execFile)('python',['system/scripts/read-hid-gamepads.py'])).stdout).filter(p=>p.vendor===0x054c && p.product===0x05c4).map(p=>p.index));
  const types=[];for(let i=1;i<=6;i++)types.push(await driver.addController(`p${i}`));
  assert.deepEqual(types,['x360','x360','ds4','ds4','ds4','ds4']);
  const send=()=>['a','b','x','y','lb','rb'].forEach((button,i)=>driver.setState(`p${i+1}`,states.normalizeState({buttons:{[button]:true}})));
  send();heartbeat=setInterval(send,40);
  await until(()=>latest.filter(p=>!before.has(p.index) && p.buttons).length===4);
  const xbox=await xinput();assert.equal(xbox.length,4);assert.ok(xbox.some(p=>p.buttons===0x1000));assert.ok(xbox.some(p=>p.buttons===0x2000));
  assert.deepEqual(latest.filter(p=>!before.has(p.index)).map(p=>p.buttons).sort((a,b)=>a-b),[1,8,16,32]);
  clearInterval(heartbeat);
  await driver.removeController('p1');assert.equal(await driver.addController('p7'),'x360');
  console.log('PASS: automatic output respects two existing local Xbox devices, adds two Xbox plus four HID pads, and reuses an XInput slot after removal');
}finally{clearInterval(heartbeat);reader?.kill();driver?.close();holder.close();}
