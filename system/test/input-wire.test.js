import {test} from 'node:test';
import assert from 'node:assert/strict';
import {neutralState} from '../public/input.js';
import {inputPacketBytes,inputWireVersion,inputPayload,encodeInputPacket,decodeInputPacket} from '../public/input-wire.js';
import {acceptInput} from '../public/rtc.js';
const packet=()=>({seq:2**40+3,controller:70000,generation:2**32+1,source:'gamepad',state:neutralState()});

test('compact input preserves every button, exact analog values, large counters and controller lanes',()=>{
  const value=packet();for(const key of Object.keys(value.state.buttons))value.state.buttons[key]=true;
  value.state.axes={lx:1/3,ly:-.12345678912345678,rx:1,ry:-1,lt:.0000000000001,rt:.99999999999999};
  const encoded=encodeInputPacket(value);assert.equal(encoded.byteLength,inputPacketBytes);assert.deepEqual(decodeInputPacket(encoded),value);
  value.source='keyboard';assert.deepEqual(decodeInputPacket(encodeInputPacket(value)),value);
  assert.deepEqual(JSON.parse(inputPayload(value,undefined)),value,'Old hosts receive ordinary JSON');
  assert.deepEqual(JSON.parse(inputPayload(value,99)),value,'Unknown versions fall back to JSON');
  assert.ok(inputPayload(value,inputWireVersion) instanceof ArrayBuffer);
  const padded=new Uint8Array(inputPacketBytes+10);padded.set(new Uint8Array(encoded),5);assert.deepEqual(decodeInputPacket(padded.subarray(5,-5)),{...value,source:'gamepad'});
});

test('compact input rejects truncated, malformed, unsupported and nonfinite snapshots',()=>{
  for(const bad of [null,'text',{},new ArrayBuffer(75),new ArrayBuffer(77)])assert.equal(decodeInputPacket(bad),null);
  const detached=encodeInputPacket(packet());structuredClone(detached,{transfer:[detached]});assert.equal(decodeInputPacket(detached),null);
  for(const [offset,write] of [[0,v=>v.setUint8(0,0)],[1,v=>v.setUint8(1,2)],[2,v=>v.setUint8(2,2)],[3,v=>v.setUint8(3,1)],[8,v=>v.setFloat64(8,-1,true)],[16,v=>v.setFloat64(16,Infinity,true)],[24,v=>v.setUint32(24,0x80000000,true)],[28,v=>v.setFloat64(28,NaN,true)]]){
    const data=encodeInputPacket(packet());write(new DataView(data));assert.equal(decodeInputPacket(data),null,`Reject corruption at ${offset}`);
  }
  assert.equal(encodeInputPacket({...packet(),seq:2**53}),null);
  assert.equal(encodeInputPacket({...packet(),controller:-1}),null);
  const bad=packet();bad.state.axes.lx=NaN;assert.equal(encodeInputPacket(bad),null);
});

test('binary snapshots retain sequence, reassignment and stale-state rejection',()=>{
  const peer={slot:'p1',slots:['p1','p2'],generation:3};
  const wire=(seq,generation=3,controller=0)=>decodeInputPacket(encodeInputPacket({...packet(),seq,generation,controller}));
  assert.equal(acceptInput(peer,wire(10)),true);assert.equal(acceptInput(peer,wire(9)),false);
  assert.equal(acceptInput(peer,wire(9,3,1)),true,'Each controller keeps its own sequence');
  assert.equal(acceptInput(peer,wire(11,2)),false,'Old assignment cannot control a new player');
  assert.equal(acceptInput(peer,wire(11,3,2)),false,'Unassigned lanes remain rejected');
});
