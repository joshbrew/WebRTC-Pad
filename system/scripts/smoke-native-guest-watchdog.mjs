// Exercises the actual compiled C# guardian, with harmless child processes.
// No controller hiding or keyboard/mouse filter is enabled.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
const executable=fileURLToPath(new URL('../../.local/tools/guest-input/webrtc-pad-guest.exe',import.meta.url));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(){
  const owner=spawn(process.execPath,['-e',"process.title='WebRTCPadNativeWatchdogFixture';setInterval(()=>{},1000)"],{windowsHide:true,stdio:'ignore'});
  const guard=spawn(executable,['--guard',String(owner.pid)],{windowsHide:true,stdio:['pipe','pipe','inherit']});
  const lines=createInterface({input:guard.stdout}),ready=once(lines,'line');guard.stdin.write(JSON.stringify({paths:[]})+'\n');
  const reply=JSON.parse((await ready)[0]);if(reply.type!=='ready'){owner.kill();guard.kill();throw new Error(reply.error || 'Guardian did not become ready');}return {owner,guard};
}
let f;
try{
  f=await fixture();const exited=once(f.guard,'exit');f.guard.stdin.end();await exited;assert.equal(f.owner.exitCode,null,'Clean stop must not kill the reader');f.owner.kill();await once(f.owner,'exit');
  f=await fixture();const ownerExit=once(f.owner,'exit'),guardExit=once(f.guard,'exit');
  for(let i=0;i<4;i++){f.guard.stdin.write('alive\n');await delay(250);assert.equal(f.owner.exitCode,null);}
  const start=performance.now();await ownerExit;await guardExit;assert.ok(performance.now()-start<2200,'A stalled reader is terminated promptly');
  f.guard.stdin.destroy();
  console.log('PASS: actual native guardian preserves a healthy reader, leaves it alive on clean stop, and kills a stalled reader after its heartbeat expires; no OS devices were blocked');
}finally{f?.owner.kill();f?.guard.kill();}
