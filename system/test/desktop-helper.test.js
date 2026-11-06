import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
test('desktop native watchdog releases without Node heartbeat; modifier order, display update and EOF cleanup', {skip:spawnSync(python,['--version'],{windowsHide:true}).status!==0}, async()=>{
  const child=spawn(python,['-u','system/test/desktop-helper-fixture.py'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const values=[];createInterface({input:child.stdout}).on('line',line=>values.push(JSON.parse(line)));
  const until=async predicate=>{const end=Date.now()+3500;while(!predicate()){if(Date.now()>end)throw new Error(JSON.stringify(values));await new Promise(r=>setTimeout(r,15));}};
  const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
  try{
    await until(()=>values.some(v=>v.ready));
    send({type:'state',keys:['KeyA','ControlLeft'],buttons:[0],x:.25,y:.6});
    await until(()=>values.some(v=>v.observed==='key'&&v.code==='KeyA'&&v.down));
    assert.deepEqual(values.filter(v=>v.observed==='key').slice(0,2).map(v=>v.code),['ControlLeft','KeyA']);
    // Unreliable mouse motion must never keep stuck key/button holds alive.
    const moving=setInterval(()=>send({type:'event',event:'move',x:.3,y:.4}),50);
    await until(()=>values.some(v=>v.observed==='button'&&!v.down));clearInterval(moving);
    assert.deepEqual(values.filter(v=>v.observed==='key'&&!v.down).map(v=>v.code),['KeyA','ControlLeft']);
    await until(()=>values.some(v=>v.event==='display'&&v.display.width===1280));
    send({type:'state',keys:['KeyB'],buttons:[2]});await until(()=>values.some(v=>v.code==='KeyB'&&v.down));
    child.stdin.end();await once(child,'exit');
    assert.ok(values.some(v=>v.code==='KeyB'&&!v.down));assert.ok(values.some(v=>v.observed==='button'&&v.button===2&&!v.down));
  }finally{if(child.exitCode===null)child.kill();}
});
