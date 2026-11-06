import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientQuality, effectiveQuality, adaptQuality, nativeEncodingKey, qualityFloor } from '../public/quality.js';
import { streamSettings } from '../public/media.js';
test('client requests are bounded independently by host limits and actual capture size', () => {
  const host = { ...streamSettings('1080', 60), autoThrottle: false }, source = { width: 1920, height: 1080, frameRate: 60 };
  const slow = effectiveQuality(host, { resolution: '480', frameRate: 15, automatic: false }, source);
  const fast = effectiveQuality(host, { resolution: '2160', frameRate: 120 }, source);
  assert.equal(slow.width, 852); assert.equal(slow.height, 480); assert.equal(slow.frameRate, 15); assert.equal(slow.autoThrottle, false);
  assert.equal(fast.width, 1920); assert.equal(fast.height, 1080); assert.equal(fast.frameRate, 60); assert.equal(fast.autoThrottle, false);
  assert.equal(effectiveQuality(host, {}, { width: 1280, height: 720 }).height, 720);
  assert.equal(clientQuality({ resolution: '-1', frameRate: Infinity }).resolution, 'host');
});

test('automatic resolution respects host/guest floors without exceeding actual source or requested maximum',()=>{
  const host={...streamSettings('1080',60),minHeight:480};
  let state={};for(let n=0;n<100;n++)state=adaptQuality(state,{loss:.2,bufferMs:400},1080,1000+n*1000,qualityFloor(host));
  assert.equal(state.height,480);
  assert.equal(qualityFloor(host,{minHeight:720}),720);
  assert.equal(effectiveQuality(host,{minHeight:720},{width:1920,height:1080},360).height,720);
  assert.equal(effectiveQuality(host,{resolution:'480',minHeight:720},{width:1920,height:1080},360).height,480);
  assert.equal(effectiveQuality(host,{minHeight:720},{width:640,height:360},240).height,360);
  assert.equal(clientQuality({minHeight:Infinity}).minHeight,0);
});

test('either side can require fixed resolution and stale adaptive state cannot override it',()=>{
  const host=streamSettings('1080',60),source={width:1920,height:1080};
  for(const [policy,request] of [[host,{automatic:false,resolution:'720'}],[{...host,autoThrottle:false},{resolution:'720'}]]){
    const fixed=effectiveQuality(policy,request,source,360);
    assert.equal(fixed.height,720);assert.equal(fixed.autoThrottle,false);
  }
  assert.equal(effectiveQuality(host,{automatic:true},source,720).height,720);
  assert.equal(nativeEncodingKey('window',{...host,minHeight:480}),nativeEncodingKey('window',{...host,minHeight:720}),'Floor policy alone is not an encoder change');
});
test('automatic quality steps down after sustained loss and recovers slowly without affecting another peer', () => {
  let slow = adaptQuality({}, { loss: .1 }, 1080, 10000);
  slow = adaptQuality(slow, { loss: .1 }, 1080, 12000); assert.equal(slow.height, 720);
  const fast = adaptQuality({}, { loss: 0, rttMs: 10 }, 1080, 12000); assert.equal(fast.height, undefined);
  assert.equal(adaptQuality(slow, { loss: .1 }, 1080, 14000).height, 720);
  for (let n = 0; n < 30; n++) slow = adaptQuality(slow, { loss: 0, rttMs: 10 }, 1080, 24000 + n * 2000);
  assert.equal(slow.height, undefined);
});

test('a distant but healthy route does not continually shrink the picture; recovery waits for sustained headroom',()=>{
  let state={};for(let i=0;i<30;i++)state=adaptQuality(state,{rttMs:300,loss:0,bufferMs:25},1080,10000+i*1000);
  assert.equal(state.height,undefined);
  state=adaptQuality({height:720,changedAt:10000},{loss:0,bufferMs:10},1080,22000);
  for(let i=0;i<7;i++)state=adaptQuality(state,{loss:0,bufferMs:10},1080,23000+i*1000);
  assert.equal(state.height,720,'Do not immediately bounce back after a short improvement');
});

test('native transport identity ignores policy-only changes but tracks encoder changes',()=>{
  const base=streamSettings('1080',60);
  assert.equal(nativeEncodingKey('window1',base),nativeEncodingKey('window1',{...base,autoThrottle:false,priority:'detail'}));
  assert.equal(nativeEncodingKey('window1',{...base,codec:'auto'}),nativeEncodingKey('window1',{...base,codec:'h264'}));
  for(const changed of [{frameRate:30},{width:1280,height:720},{maxBitrate:4000000},{codec:'h265'},{encoderPreset:'p2'}])assert.notEqual(nativeEncodingKey('window1',base),nativeEncodingKey('window1',{...base,...changed}));
  assert.notEqual(nativeEncodingKey('window1',base),nativeEncodingKey('window2',base));
});
test('main picture holds dimensions for twenty seconds and moderate congestion cannot trigger recovery',()=>{
  let state={height:720,changedAt:1000};
  for(let n=0;n<18;n++)state=adaptQuality(state,{loss:.2},1080,2000+n*1000);
  assert.equal(state.height,720);
  state=adaptQuality(state,{loss:.2},1080,21000);assert.equal(state.height,480);
  for(let n=0;n<40;n++)state=adaptQuality(state,{loss:.03,bufferMs:70},1080,22000+n*1000);
  assert.equal(state.height,480);
});
