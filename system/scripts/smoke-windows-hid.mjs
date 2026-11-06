import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import injection from '../src/inject/index.js';
import states from '../src/inject/state.js';
if(process.platform!=='win32')throw new Error('This test requires Windows and ViGEmBus');
const read=async()=>JSON.parse((await promisify(execFile)(process.env.PYTHON || 'python',['system/scripts/read-hid-gamepads.py'],{encoding:'utf8',windowsHide:true})).stdout).filter(p=>p.vendor===0x054c && p.product===0x05c4);
const before=new Set((await read()).map(p=>p.index));
const driver=await injection.createInjector({playerCount:8,controllerType:'ds4'});
const reader=spawn(process.env.PYTHON || 'python',['system/scripts/read-hid-gamepads.py','--watch'],{windowsHide:true,stdio:['ignore','pipe','inherit']});
let latest=[];
createInterface({input:reader.stdout}).on('line',line=>{latest=JSON.parse(line).filter(p=>p.vendor===0x054c && p.product===0x05c4 && !before.has(p.index));});
let heartbeat;
const wait=async predicate=>{const end=Date.now()+8000;while(true){const pads=latest;if(predicate(pads))return pads;if(Date.now()>end)throw new Error(`HID states not observed: ${JSON.stringify(pads)}`);await new Promise(r=>setTimeout(r,30));}};
try {
  await wait(pads=>pads.length===8 && pads.every(p=>p.buttons===0 && p.pov===65535));
  const send=()=>{for(let i=0;i<8;i++)driver.setState(`p${i+1}`,states.normalizeState({buttons:{[['x','a','b','y','lb','rb','back','start'][i]]:true},axes:i===0?{lx:1,ly:1,lt:.5,rt:1}:i===1?{rx:-1,ry:-1}:{}}));};
  send();heartbeat=setInterval(send,40);
  const pads=await wait(pads=>pads.length===8 && new Set(pads.map(p=>p.buttons)).size===8 && pads.every(p=>p.buttons!==0));
  assert.ok(pads.some(p=>p.x>64000 && p.y<1000));assert.ok(pads.some(p=>p.z<1000 && p.r>64000));
  console.log('PASS: eight real Windows HID / PlayStation virtual pads enumerate and carry independent buttons and sticks beyond four XInput slots');
  clearInterval(heartbeat);
  await wait(pads=>pads.length===8 && pads.every(p=>p.buttons===0 && p.pov===65535 && p.x>32000 && p.x<33500 && p.y>32000 && p.y<33500));
  console.log('PASS: HID helper watchdog releases all eight controllers');
}finally{clearInterval(heartbeat);reader.kill();driver.close();}
