import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientQuality, effectiveQuality, adaptQuality, nativeEncodingKey, qualityFloor, screenQuality } from '../public/quality.js';
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
  assert.equal(effectiveQuality(host,{minHeight:720},{width:1920,height:1080},{height:360}).height,720);
  assert.equal(effectiveQuality(host,{resolution:'480',minHeight:720},{width:1920,height:1080},{height:360}).height,480);
  assert.equal(effectiveQuality(host,{minHeight:720},{width:640,height:360},{height:240}).height,360);
  assert.equal(clientQuality({minHeight:Infinity}).minHeight,0);
});

test('either side can require fixed resolution and stale adaptive state cannot override it',()=>{
  const host=streamSettings('1080',60),source={width:1920,height:1080};
  for(const [policy,request] of [[host,{automatic:false,resolution:'720'}],[{...host,autoThrottle:false},{resolution:'720'}]]){
    const fixed=effectiveQuality(policy,request,source,{height:360,frameRate:15});
    assert.equal(fixed.height,720);assert.equal(fixed.frameRate,60);assert.equal(fixed.autoThrottle,false);
  }
  assert.equal(effectiveQuality(host,{automatic:true},source,{height:720}).height,720);
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

test('adaptive priorities choose different tradeoffs under sustained load',()=>{
  const source={width:1920,height:1080,frameRate:60},pressure={loss:.08,bufferMs:125,decodeMs:14};
  function run(priority){
    const host={...streamSettings('1080',60,priority),minHeight:480};
    const step=(state,now,metrics=pressure)=>adaptQuality(state,metrics,1080,now,480,host);
    const tuning=step(step({},10000),12000);
    const profile=state=>{const {height,frameRate}=effectiveQuality(host,{},source,state);return [height,frameRate];};
    return {initial:profile(tuning),later:profile(step(step(tuning,32000),34000))};
  }
  assert.deepEqual(run('motion'),{initial:[720,60],later:[480,60]});
  assert.deepEqual(run('resolution'),{initial:[1080,30],later:[1080,15]});
  assert.deepEqual(run('balanced'),{initial:[720,60],later:[720,30]});
});

test('low latency keeps cadence on a healthy route and caps adaptive changes per viewer',()=>{
  const host=streamSettings('1080',120,'balanced'),source={width:1920,height:1080,frameRate:120};
  const healthy={rttMs:350,bufferMs:20,decodeMs:2},delayed={bufferMs:130,decodeMs:12};
  const step=(state,metrics,now)=>adaptQuality(state,metrics,1080,now,480,host);
  const initial=step(step({},healthy,1000),3000);
  assert.equal(initial.height,undefined);assert.equal(initial.frameRate,undefined);
  const reduced=step(step(initial,delayed,4000),delayed,6000);
  assert.equal(reduced.height,undefined);assert.equal(reduced.frameRate,60);
  assert.equal(step(reduced,delayed,8000).height,undefined);
  assert.equal(effectiveQuality(host,{frameRate:30},source,reduced).frameRate,30);
  assert.equal(effectiveQuality({...host,priority:'motion'},{},source,reduced).frameRate,120);
  let recovered=reduced;
  for(let n=0;n<30;n++)recovered=step(recovered,healthy,27000+n*1000);
  assert.equal(effectiveQuality(host,{},source,recovered).frameRate,120);
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

test('secondary screens adapt inside their own cap and return to it in fixed mode',()=>{
  const host={...streamSettings('1080',60),minHeight:360,secondaryResolution:'720'};
  const source={width:1920,height:1080,frameRate:60};
  const extra=screenQuality(host,'window');
  assert.equal(effectiveQuality(screenQuality(host,''),{},source).height,1080);
  assert.equal(extra.height,720);
  assert.ok(extra.maxBitrate<host.maxBitrate);
  const poor={loss:.2,bufferMs:240};
  const pressure=adaptQuality(adaptQuality({},poor,720,10000,360),poor,720,11500,360);
  assert.equal(effectiveQuality(extra,{},source,pressure).height,480);
  assert.equal(effectiveQuality(extra,{automatic:false},source,pressure).height,720);
  assert.equal(effectiveQuality({...extra,autoThrottle:false},{},source,pressure).height,720);
  assert.equal(effectiveQuality(extra,{resolution:'480'},source).height,480);
  assert.equal(screenQuality({...host,secondaryResolution:'1440'},'window').height,1080);
});

test('a screen override has its own cap, frame rate, adaptive mode and floor',()=>{
  const global={...streamSettings('720',60),minHeight:480,autoThrottle:true,codec:'h264'};
  const override={resolution:'1080',frameRate:30,minHeight:1440,autoThrottle:false,priority:'resolution'};
  const screen=screenQuality(global,'extra',override);
  assert.equal(screen.height,1080);
  assert.equal(screen.frameRate,30);
  assert.equal(screen.autoThrottle,false);
  assert.equal(screen.minHeight,1080);
  assert.equal(screen.codec,'h264');
  assert.equal(screenQuality(global,'extra').height,720);
});
