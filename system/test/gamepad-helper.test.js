import test from 'node:test';
import assert from 'node:assert/strict';
import helperModule from '../src/inject/helper.js';
const {startHelper}=helperModule;
const program=`const r=require('node:readline').createInterface({input:process.stdin});console.log('READY');r.on('line',line=>{const v=JSON.parse(line);if(process.argv[1]==='crash'){process.stderr.write('fixture device disconnected');process.exit(17);}if(process.argv[1]!=='hang')console.log(JSON.stringify({id:v.id,value:process.env.PAD_HELPER_ENV}));});`;
test('native controller helper uses explicit environment and supports dynamic devices',async()=>{
  const helper=await startHelper(process.execPath,['-e',program,'normal'],undefined,undefined,{env:{PAD_HELPER_ENV:'platform-fixture'}});try{assert.equal(await helper.command('add','p1'),'platform-fixture');assert.equal(await helper.command('remove','p1'),'platform-fixture');}finally{helper.close();}
});
test('native controller command timeout releases the process and reports failure',async()=>{
  const helper=await startHelper(process.execPath,['-e',program,'hang'],undefined,undefined,{commandMs:200}),failures=[];helper.on('failure',error=>failures.push(error.message));try{await assert.rejects(helper.command('add','p1'),/timed out/);assert.equal(failures.length,1);assert.throws(()=>helper.setState('p1',{}),/timed out/);}finally{helper.close();}
});
test('Linux/macOS helper exit is immediately visible to the native receiver',async()=>{
  const helper=await startHelper(process.execPath,['-e',program,'crash']),failures=[];helper.on('failure',error=>failures.push(error.message));try{await assert.rejects(helper.command('add','p1'),/fixture device disconnected/);assert.equal(failures.length,1);}finally{helper.close();}
});
