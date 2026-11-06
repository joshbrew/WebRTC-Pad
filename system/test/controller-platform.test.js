import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../src/server.js';
import {controllerPlatform} from '../public/controller-platform.js';
import {macHidBuildArgs} from '../scripts/build-macos-hid.mjs';
import macHid from '../src/inject/macos-hid.js';
import {neutralState} from '../public/input.js';
test('Mac HID builds target Apple Silicon and Intel explicitly',()=>{
  assert.equal(macHidBuildArgs('arm64')[5],'arm64');assert.equal(macHidBuildArgs('x64')[5],'x86_64');assert.throws(()=>macHidBuildArgs('ia32'),/Apple Silicon and Intel/);
});
test('Mac HID reports preserve buttons, diagonal hat, axis direction and analog triggers',()=>{
  const state=neutralState(),neutral=Buffer.from(macHid.encode('p2',state).trim().split(' ')[1],'hex');assert.equal(neutral.length,10);assert.equal(neutral[2],8);assert.deepEqual([...neutral.subarray(3,7)],[128,128,128,128]);
  state.buttons.a=true;state.buttons.guide=true;state.buttons.up=true;state.buttons.right=true;state.axes.lx=-1;state.axes.ly=1;state.axes.lt=1;state.axes.rt=.5;
  const report=Buffer.from(macHid.encode('p2',state).trim().split(' ')[1],'hex');assert.equal(report.readUInt16LE(0),1025);assert.equal(report[2],1);assert.equal(report[3],0);assert.equal(report[4],0);assert.equal(report[7],255);assert.equal(report[8],128);
});
for(const platform of ['linux','darwin','win32'])test(`${platform} receiver config and local API expose only that platform's native endpoints`,async t=>{
  const app=createApp({platform,env:{INPUT_BACKEND:'none'},createInjector:async()=>({setState(){},close(){}})});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());const origin=`http://127.0.0.1:${app.server.address().port}`,config=await(await fetch(origin+'/config')).json();
  assert.equal(config.controllerReceiver.platform,platform);assert.deepEqual(config.controllerReceiver,controllerPlatform(platform));assert.deepEqual(config.controllerOutputs.map(v=>v.id),platform==='win32'?['auto','x360','ds4']:['native']);
  if(platform!=='win32')assert.doesNotMatch(config.controllerReceiver.help,/XInput|HidHide|Interception|ViGEm/);
  assert.equal((await fetch(origin+'/api/inputs')).status,200);assert.equal((await fetch(origin+'/input-api.js')).headers.get('access-control-allow-origin'),'*');
});
