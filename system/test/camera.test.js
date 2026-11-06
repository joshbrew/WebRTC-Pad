import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cameraSettings,cameraBudget,stableDimensions,cameraLimit,boundedCamera} from '../public/camera-quality.js';
import {CameraRoom} from '../public/camera.js';

test('camera defaults are independent 480p24 and invalid choices stay bounded',()=>{
  assert.deepEqual(cameraSettings(),{height:480,fps:24});assert.equal(cameraBudget(null).bitrate,600000);
  assert.deepEqual(cameraSettings(720,30),{height:720,fps:30});
  assert.deepEqual(cameraSettings(Infinity,-1),{height:480,fps:24});
});
test('camera backs off immediately for game delay and recovers slowly',()=>{
  let budget=cameraBudget({}, {rttMs:20});assert.equal(budget.bitrate,600000);
  budget=cameraBudget(budget,{bufferMs:80,rttMs:25});assert.equal(budget.level,1);assert.equal(budget.height,480);assert.equal(budget.fps,15);
  budget=cameraBudget(budget,{loss:.1});budget=cameraBudget(budget,{decodeMs:40});assert.equal(budget.level,3);assert.equal(budget.bitrate,60000);assert.equal(budget.fps,5);
  for(let i=0;i<5;i++)budget=cameraBudget(budget,{});assert.equal(budget.level,3);
  budget=cameraBudget(budget,{});assert.equal(budget.level,2);const held=cameraBudget(budget,{},cameraSettings(),1,false);assert.equal(held.healthy,budget.healthy);
  assert.equal(cameraBudget({baseline:20},{rttMs:100}).level,1);
});
test('camera upload allowance is shared across recipients and respects lower limits',()=>{
  const budgets=Array.from({length:8},()=>cameraBudget({}, {},cameraSettings(1080,30),8));
  assert.ok(budgets.reduce((s,b)=>s+b.bitrate,0)<=1200000);
  const low=cameraBudget({}, {},cameraSettings(240,10));assert.equal(low.height,240);assert.equal(low.fps,10);
});
test('camera signaling cannot spoof another call participant or stale session',()=>{
  const sent=[],room=Object.create(CameraRoom.prototype);room.members=new Map([['a',{session:'A'}],['b',{session:'B'}]]);room.controls=new Map([['b',m=>sent.push(m)]]);
  const msg={action:'candidate',to:'b',session:'A',toSession:'B',from:'forged'};room.route('a',msg);assert.equal(sent[0].from,'a');assert.equal(sent[0].type,'camera');
  room.route('unknown',msg);room.route('a',{...msg,session:'expired'});room.route('a',{...msg,toSession:'expired'});room.route('a',{...msg,action:'screen-control'});assert.equal(sent.length,1);
});

test('fixed camera quality clears prior backoff and survives session and member ceilings',()=>{
  const settings=boundedCamera({...cameraSettings(1080,30),automatic:true},cameraLimit({height:720,fps:24,automatic:false}),{height:480,fps:15});
  assert.deepEqual(settings,{height:480,fps:15,automatic:false});
  const fixed=cameraBudget({level:3,healthy:2},{loss:.5,bufferMs:100,rttMs:900},settings,8);
  assert.equal(fixed.level,0);assert.equal(fixed.height,480);assert.equal(fixed.fps,15);assert.equal(fixed.bitrate,600000);
  assert.equal(cameraBudget(fixed,{loss:.5},cameraSettings()).level,1);
});

test('pixel dimensions ignore join spikes, hold for fifteen seconds, and recover after thirty healthy seconds',()=>{
  let state=stableDimensions({},0,false,true,0);
  state=stableDimensions(state,3,true,true,2000);state=stableDimensions(state,3,true,true,4000);
  assert.equal(state.spatialLevel,0);
  state=stableDimensions(state,3,true,true,6000);assert.equal(state.spatialLevel,1);
  for(let now=8000;now<21000;now+=2000)state=stableDimensions(state,3,true,true,now);
  assert.equal(state.spatialLevel,1);
  state=stableDimensions(state,3,true,true,22000);assert.equal(state.spatialLevel,2);
  for(let now=24000;now<52000;now+=2000)state=stableDimensions(state,0,false,true,now);
  assert.equal(state.spatialLevel,2);
  state=stableDimensions(state,0,false,true,52000);assert.equal(state.spatialLevel,1);
  assert.deepEqual(stableDimensions(state,3,true,false,60000),state,'Roster changes are not network samples');
});
