import test from 'node:test';
import assert from 'node:assert/strict';
import {AppInputInbox,appInputPacket,midiData} from '../public/app-input-wire.js';
const packet=(kind,extra={})=>({version:1,kind,device:kind,seq:1,...extra});
test('MIDI validates complete channel messages and timing, excluding SysEx and programming traffic',()=>{
  for(const data of [[0x90,60,100],[0x80,60,0],[0xb0,64,127],[0xc2,20],[0xd2,100],[0xe0,0,64],[0xf8]])assert.deepEqual(midiData(data),data);
  for(const data of [[0xf0,1,0xf7],[0x90,60],[0x90,200,0],[60,127],[0xff],[],[0xb0,64,127,0]])assert.equal(midiData(data),null);
});
test('app events validate bounded complete keyboard/mouse snapshots and discard extra fields',()=>{
  assert.deepEqual(appInputPacket(packet('keyboard',{keys:['KeyA'],native:true})),packet('keyboard',{keys:['KeyA']}));
  assert.equal(appInputPacket(packet('keyboard',{keys:['KeyA','KeyA']})),null);assert.equal(appInputPacket(packet('keyboard',{keys:['inject-arbitrary-command']})),null);
  const mouse=packet('mouse',{x:.5,y:.1,buttons:[0,2],width:800,height:600});assert.equal(appInputPacket(mouse).dx,0);assert.equal(appInputPacket({...mouse,x:NaN}),null);assert.equal(appInputPacket({...mouse,width:0}),null);
});
test('independent guest identities, permissions, replay protection, releases and monotonic delivery',()=>{
  const events=[],inbox=new AppInputInbox(event=>events.push(event)),key=packet('keyboard',{keys:['KeyA']});
  assert.equal(inbox.receive('alice',key,{events:false,midi:true}),false);assert.equal(events.length,0);
  assert.equal(inbox.receive('alice',key,{events:true}),true);assert.equal(inbox.receive('bob',key,{events:true}),true);assert.equal(inbox.states.size,2);
  assert.equal(inbox.receive('alice',key,{events:true}),false);inbox.release('alice');assert.equal(events.at(-1).kind,'reset');assert.equal(inbox.states.size,1);assert.equal(events.at(-1).peerId,'alice');
  inbox.clear();assert.equal(inbox.states.size,0);assert.deepEqual(events.map(e=>e.seq),[0,1,2,3]);
});
test('device floods cannot grow the app inbox without a bound',()=>{
  const inbox=new AppInputInbox(()=>{});for(let i=0;i<1200;i++)inbox.receive('peer',packet('keyboard',{device:'key-'+i,keys:[]}),{events:true});assert.equal(inbox.states.size,1024);assert.equal(inbox.sequences.size,1024);
});
