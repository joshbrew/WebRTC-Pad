import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
if (process.platform !== 'win32') { console.log('Windows desktop overlay test skipped on this platform.'); process.exit(0); }
const child=spawn(process.env.PYTHON || 'python',['-u','system/native/cursor-overlay.py'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
const lines=createInterface({input:child.stdout}); let stderr=''; child.stderr.on('data',b=>{stderr+=b;});
const pending=[]; lines.on('line',line=>{pending.push(JSON.parse(line));});
const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
async function next(event) { const end=Date.now()+7000; while(!pending.some(v=>event?v.event===event:v.ready)) { if(Date.now()>end) throw new Error(stderr || 'Overlay timed out'); await new Promise(r=>setTimeout(r,25)); } return pending.splice(pending.findIndex(v=>event?v.event===event:v.ready),1)[0]; }
try {
  await next();
  send({type:'cursor',id:'one',x:.93,y:.93,color:'#81d8ff',visible:true});
  send({type:'cursor',id:'two',x:.97,y:.93,color:'hsl(202 85% 70%)',visible:true,labels:true,label:'Player 2'});
  await new Promise(r=>setTimeout(r,300)); send({type:'inspect'}); const value=await next('inspect');
  assert.equal(value.focusUnchanged,true,'Overlay must not activate over the current app'); assert.equal(value.cursors.length,2);
  for(const c of value.cursors) { assert.equal(c.visible,true); assert.equal((c.style & 0x80800a0),0x80800a0,'Layered/click-through/tool/no-activate flags'); assert.equal(c.captureExcluded,true); }
  assert.equal(value.cursors[0].items,1); assert.equal(value.cursors[1].items,2);
  send({type:'labels',enabled:false}); await new Promise(r=>setTimeout(r,100)); send({type:'inspect'}); assert.ok((await next('inspect')).cursors.every(c=>c.items===1));
  send({type:'remove',id:'one'}); await new Promise(r=>setTimeout(r,100)); send({type:'inspect'}); assert.equal((await next('inspect')).cursors.length,1);
  await new Promise(r=>setTimeout(r,4100)); send({type:'inspect'}); assert.equal((await next('inspect')).cursors[0].visible,false,'Stale cursors must disappear');
  send({type:'clear'}); await new Promise(r=>setTimeout(r,100)); send({type:'inspect'}); assert.equal((await next('inspect')).cursors.length,0);
  const done=once(child,'exit'); child.stdin.end(); assert.equal((await done)[0],0,stderr);
  console.log('PASS: two native overlay cursors render without stealing focus; click-through, no-activate and capture-exclusion flags; label toggle, removal, stale timeout and EOF cleanup');
} finally { if(child.exitCode===null) child.kill(); }
