import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packGamepadState, neutralState, standardProfile, keyboardState, inputPacer,defaultKeyboardBindings,cleanKeyboardBindings } from '../public/input.js';
import { acceptInput, setRemote, addCandidate, replaceCapture, preferLowLatency, applySenderQuality } from '../public/rtc.js';
import {cleanGamepadProfile,mappingTemplates} from '../public/keyboard-mapping.js';

test('stream floors keep spatial changes in the app and unsupported tuning hints retain real sender limits',async()=>{
  const calls=[],peer={quality:{width:1280,height:720,minHeight:480,maxBitrate:5000000,frameRate:60},senders:{video:{track:{getSettings:()=>({width:1920,height:1080})},getParameters:()=>({encodings:[{}]}),async setParameters(params){calls.push(structuredClone(params));if(calls.length===1)throw new Error('Unsupported priority hint');}}}};
  await applySenderQuality(peer);
  assert.equal(calls[0].degradationPreference,'maintain-resolution');
  assert.equal(calls[1].degradationPreference,undefined);
  assert.deepEqual(calls[1].encodings,[{maxBitrate:5000000,maxFramerate:60,scaleResolutionDownBy:1.5}]);
});

test('generic profiles map axis-backed buttons, signed and half-range triggers, and bound device indices',()=>{
  const profile=cleanGamepadProfile({...standardProfile,buttons:{...standardProfile.buttons,up:{axis:4,invert:true},a:4},triggers:{lt:{axis:5,half:true},rt:{axis:6}},deadzone:.08});
  const gp={mapping:'',buttons:Array.from({length:17},(_,i)=>({pressed:i===4,value:i===4?1:0})),axes:[.5,-.5,0,0,-1,.75,-1]};
  const state=packGamepadState(gp,profile,profile.deadzone);assert.equal(state.buttons.a,true);assert.equal(state.buttons.up,true);assert.equal(state.axes.lt,.75);assert.equal(state.axes.rt,0);assert.ok(state.axes.ly>0);
  gp.axes[5]=0;gp.axes[6]=1;const released=packGamepadState(gp,profile,.08);assert.equal(released.axes.lt,0);assert.equal(released.axes.rt,1);
  assert.equal(cleanGamepadProfile({buttons:{a:999,b:'0'},axes:{lx:{index:Infinity}},deadzone:100}).buttons.a,-1);assert.equal(cleanGamepadProfile({deadzone:100}).deadzone,.5);
  assert.deepEqual(Object.keys(mappingTemplates),['generic','xbox','playstation','switch']);
});

test('custom keyboard layouts map buttons, both sticks and triggers without losing neutral releases',()=>{
  const bindings=cleanKeyboardBindings({...defaultKeyboardBindings,a:'KeyV',lxNegative:'KeyA',lxPositive:'KeyD',lyPositive:'KeyW',lyNegative:'KeyS',rxPositive:'KeyL',ryNegative:'KeyK',guide:'KeyH'});
  const state=keyboardState(new Set(['KeyV','KeyD','KeyW','KeyL','KeyK','Digit2','KeyH']),bindings);
  assert.equal(state.buttons.a,true);assert.equal(state.buttons.guide,true);assert.equal(state.buttons.y,false);assert.deepEqual(state.axes,{lx:1,ly:1,rx:1,ry:-1,lt:0,rt:1});
  assert.equal(keyboardState(new Set(['KeyA','KeyD']),bindings).axes.lx,0);
  assert.deepEqual(keyboardState(new Set(),bindings),neutralState());
  assert.equal(cleanKeyboardBindings({a:'<script>',b:123,guide:'MetaLeft'}).a,'');assert.equal(cleanKeyboardBindings({a:'<script>',b:123,guide:'MetaLeft'}).guide,'');
  assert.equal(keyboardState(new Set(['KeyZ']),bindings).buttons.a,false,'Old mappings must not remain active');
});

test('input pacing sends fresh presses, releases and axes immediately between heartbeat ticks',()=>{
  const allow=inputPacer(),packet=state=>({generation:0,source:'gamepad',state});
  assert.equal(allow(0,packet({a:false,x:0}),100),true);
  assert.equal(allow(0,packet({a:false,x:0}),101),false,'Duplicate clocks must not flood unchanged snapshots');
  assert.equal(allow(0,packet({a:true,x:0}),102),true);
  assert.equal(allow(0,packet({a:false,x:0}),103),true,'A brief tap must not disappear between polling ticks');
  assert.equal(allow(0,packet({a:false,x:.2}),104),true);
  assert.equal(allow(0,packet({a:false,x:.2}),118),false);
  assert.equal(allow(0,packet({a:false,x:.2}),119),true,'Repeated state still repairs lost packets');
  assert.equal(allow(1,packet({a:false,x:.2}),119),true,'Controllers pace independently');
  assert.equal(allow(0,{generation:1,source:'gamepad',state:{a:false,x:.2}},120),true,'New assignments must never inherit a stale heartbeat gate');
});

test('low-latency receivers support standard, legacy, unavailable and rejecting browser hints',()=>{
  const modern={jitterBufferTarget:200};preferLowLatency(modern);assert.equal(modern.jitterBufferTarget,0);
  const legacy={playoutDelayHint:.2};preferLowLatency(legacy);assert.equal(legacy.playoutDelayHint,0);
  const mixed={playoutDelayHint:.2,set jitterBufferTarget(_){throw new Error('Browser rejected hint');}};
  preferLowLatency(mixed);assert.equal(mixed.playoutDelayHint,0,'A rejected hint cannot prevent the fallback or track setup');
  const unsupported={};preferLowLatency(unsupported);assert.deepEqual(unsupported,{});preferLowLatency(null);
});

test('independent controller lanes accept reordered packets and reject stale assignments', () => {
  const peer={slot:'p1',slots:['p1','p2','p3'],generation:2,lastSeq:-1};
  const packet=(controller,seq,generation=2)=>({controller,seq,generation,state:{}});
  assert.equal(acceptInput(peer,packet(2,12)),true);
  assert.equal(acceptInput(peer,packet(0,10)),true);
  assert.equal(acceptInput(peer,packet(1,11)),true);
  assert.equal(acceptInput(peer,packet(1,9)),false);
  assert.equal(acceptInput(peer,packet(3,13)),false);
  assert.equal(acceptInput(peer,packet(-1,13)),false);
  assert.equal(acceptInput(peer,packet(0,14,1)),false);
  assert.equal(acceptInput(peer,packet(0,15)),true);
});
import states from '../src/inject/state.js';
import mac from '../src/inject/macos-hid.js';

const pad = () => ({ mapping: 'standard', axes: [0.03, -1, 1, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
test('standard controllers normalize sticks, deadzone, buttons and analog triggers', () => {
  const gp = pad(); gp.buttons[0].pressed = true; gp.buttons[6].value = 0.45;
  const state = packGamepadState(gp);
  assert.equal(state.axes.lx, 0); assert.equal(state.axes.ly, 1); assert.equal(state.axes.rx, 1);
  assert.equal(state.axes.lt, 0.45); assert.equal(state.buttons.a, true);
});
test('nonstandard controllers require an explicit mapping; saved remaps are honored', () => {
  const gp = pad(); gp.mapping = ''; gp.buttons[2].pressed = true;
  assert.throws(() => packGamepadState(gp), /Map this controller/);
  const mapping = structuredClone(standardProfile); mapping.buttons.a = 2;
  mapping.triggers.lt = { axis: 1, invert: true };
  const state = packGamepadState(gp, mapping); assert.equal(state.buttons.a, true); assert.equal(state.axes.lt, 1);
});
test('remote state validation rejects non-finite and nonnumeric axes and bounds values', () => {
  assert.throws(() => states.normalizeState({ axes: { lx: NaN } }));
  assert.throws(() => states.normalizeState({ axes: { lx: '1' } }));
  const result = states.normalizeState({ axes: { lx: 5, lt: -1 }, buttons: { a: 'false' } });
  assert.equal(result.axes.lx, 1); assert.equal(result.axes.lt, 0); assert.equal(result.buttons.a, false);
});
test('input ignores out-of-order packets and watchers', () => {
  const p = { slot: 'p1', lastSeq: -1 };
  assert.equal(acceptInput(p, { seq: 10, state: {} }), true);
  assert.equal(acceptInput(p, { seq: 9, state: {} }), false);
  assert.equal(acceptInput(p, { seq: 10, state: {} }), false);
  p.slot = null; assert.equal(acceptInput(p, { seq: 11, state: {} }), false);
});
test('early ICE candidates are applied after the remote description', async () => {
  const calls = [], p = { candidates: [], pc: { async setRemoteDescription(sdp) { calls.push(sdp); this.remoteDescription = sdp; }, async addIceCandidate(c) { calls.push(c); } } };
  await addCandidate(p, 'early'); assert.deepEqual(calls, []);
  await setRemote(p, 'offer'); await addCandidate(p, 'late'); assert.deepEqual(calls, ['offer', 'early', 'late']);
});
test('late capture and stop replace reserved senders without adding media sections', async () => {
  const calls = [], p = { senders: {} };
  for (const kind of ['video', 'audio']) p.senders[kind] = { setStreams() {}, async replaceTrack(t) { calls.push([kind, t]); }, getParameters() { return {}; } };
  const track = { kind: 'video' };
  await replaceCapture(p, { getTracks: () => [track] }); await replaceCapture(p, null);
  assert.deepEqual(calls, [['video', track], ['audio', null], ['video', null], ['audio', null]]);
});

test('ended capture tracks are detached while live video stays attached', async () => {
  const calls=[],video={kind:'video',readyState:'live'},audio={kind:'audio',readyState:'ended'};
  const peer={senders:{
    video:{setStreams(){},async replaceTrack(track){calls.push(['video',track]);},getParameters(){return {};}},
    audio:{setStreams(){},async replaceTrack(track){calls.push(['audio',track]);}}
  }};
  await replaceCapture(peer,{getTracks:()=>[video,audio]});
  assert.deepEqual(calls,[['video',video],['audio',null]]);
});
test('macOS HID reports encode neutral, diagonals, triggers and stick polarity', () => {
  assert.equal(mac.encode('p1', states.neutralState()), 'p1 00000880808080000000\n');
  const state = states.normalizeState({ axes: { ly: 1, rt: 1 }, buttons: { a: true, up: true, right: true } });
  const bytes = Buffer.from(mac.encode('p2', state).trim().split(' ')[1], 'hex');
  assert.equal(bytes.length, 10); assert.equal(bytes[0], 1); assert.equal(bytes[2], 1); assert.equal(bytes[4], 0); assert.equal(bytes[8], 255);
});
test('keyboard controls produce full snapshots with released states', () => {
  const state = keyboardState(new Set(['KeyZ', 'ArrowLeft', 'Digit2']));
  assert.equal(state.buttons.a, true); assert.equal(state.buttons.left, true); assert.equal(state.axes.rt, 1);
  assert.deepEqual(keyboardState(new Set()), neutralState());
});

test('mouse buttons and wheel directions map only to canonical controller state',()=>{
  const bindings=cleanKeyboardBindings({a:'Mouse2',b:'WheelDown',lxNegative:'Mouse3',lxPositive:'Mouse4',rt:'WheelUp',guide:'Mouse99',x:'PointerEvent'});
  const state=keyboardState(new Set(['Mouse2','Mouse3','WheelUp']),bindings);
  assert.equal(state.buttons.a,true);assert.equal(state.axes.lx,-1);assert.equal(state.axes.rt,1);assert.equal(state.buttons.b,false);
  assert.equal(bindings.guide,'');assert.equal(bindings.x,'');assert.deepEqual(keyboardState(new Set(),bindings),neutralState());
});
