import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HostHandoff,validHandoffMap,validHandoffMembers} from '../public/handoff.js';
import {VoiceRoom} from '../public/voice.js';

const members=[{id:'host'},{id:'guest-a'},{id:'guest-b'}],mapping={host:'new-a','guest-a':'host','guest-b':'new-b'};
test('host handoff membership requires every participant exactly once and one host',()=>{
  assert.ok(validHandoffMembers(members,'guest-a'));assert.ok(validHandoffMap(members,'guest-a',mapping));
  for(const invalid of [{...mapping,'guest-b':'new-a'},{...mapping,'guest-a':'wrong'},{host:'new-a','guest-a':'host'}, {...mapping,extra:'new-c'},null])assert.equal(validHandoffMap(members,'guest-a',invalid),false);
  assert.equal(validHandoffMembers([{id:'host'},{id:'host'}],'host'),false);assert.equal(validHandoffMembers([{id:'host'},null],'guest-a'),false);
});
test('host handoff accepts requests only from the current authenticated upstream and allows decline',async()=>{
  const sent=[],upstream={readyState:'open',send:raw=>sent.push(JSON.parse(raw))};let prompts=0;
  const handoff=new HostHandoff({isHost:()=>false,upstream:()=>upstream,canHost:()=>true,confirm:()=>{prompts++;return false;},snapshot:()=>({}),status(){},lock(){},rollback(){}});
  const request={type:'host-handoff',id:'request',action:'request',target:'guest-a',members};
  handoff.receive('host',request,{});assert.equal(prompts,0);
  handoff.receive('host',request,upstream);await Promise.resolve();assert.equal(prompts,1);assert.deepEqual(sent.map(message=>message.action),['prompted','declined']);assert.equal(handoff.busy,false);
});
test('cancelled preparation releases staged transports, rolls back the local room and unlocks UI',()=>{
  let closed=0,rolledBack=0;const locks=[],messages=[];
  const handoff=new HostHandoff({lock:value=>locks.push(value),status:()=>{},rollback:()=>rolledBack++});
  const state=handoff.startState({id:'request',target:'guest-a',members,links:new Map(),upstream:{readyState:'open',send:raw=>messages.push(JSON.parse(raw))}});
  state.stages.set('host',{transport:{close:()=>closed++}});handoff.cancel('Cancelled');
  assert.equal(closed,1);assert.equal(rolledBack,1);assert.deepEqual(locks,[true,false]);assert.equal(messages[0].action,'cancel');assert.equal(handoff.busy,false);
});
test('a local host switch keeps the other guests on their existing call until the backend transfers',async()=>{
  const messages=[],commits=[];
  const link=id=>({readyState:'open',send:raw=>messages.push([id,JSON.parse(raw).action])});
  let transferred;
  const pendingTransfer=new Promise(resolve=>{transferred=resolve;});
  const handoff=new HostHandoff({status(){},lock(){},rollback(){},interrupted(){},voiceRoster:()=>[],waitForTransfer:()=>pendingTransfer,commit:state=>commits.push(state.id)});
  const state=handoff.startState({id:'switch',target:'guest-a',members,links:new Map([['guest-a',link('guest-a')],['guest-b',link('guest-b')]]),coordinator:true,local:true});
  state.client={transport:{close(){}}};
  try {
    const pending=handoff.handle(state,'guest-a',{action:'prepared',mapping});
    assert.deepEqual(messages,[['guest-a','commit']]);
    assert.deepEqual(commits,[]);
    transferred();await pending;
    assert.deepEqual(messages,[['guest-a','commit'],['guest-b','commit']]);
    assert.deepEqual(commits,['switch']);
  } finally { handoff.interrupted(state,'Test finished',true); }
});
test('voice rebasing preserves microphone tracks, peer connections, sessions and playback elements',()=>{
  const mic={getTracks(){throw Error('Must not stop or replace the mic');}},pc={close(){throw Error('Must not close a live voice PC');}},audio={};
  const p={id:'guest-b',session:'voice-b',pc,audio},voice=Object.assign(Object.create(VoiceRoom.prototype),{self:'guest-a',host:false,active:true,session:'voice-a',mic,localMuted:new Set(['guest-b']),micBlocks:new Set(),peers:new Map([['guest-b',p]]),root:{hidden:true},render(){}});
  const controls=new Map([['new-b',()=>{}]]);voice.rebase({host:true,mapping,roster:[{id:'guest-a',session:'voice-a'},{id:'guest-b',session:'voice-b'}],controls});
  assert.equal(voice.self,'host');assert.equal(voice.mic,mic);assert.equal(voice.peers.get('new-b'),p);assert.equal(p.pc,pc);assert.equal(p.audio,audio);assert.equal(p.session,'voice-b');assert.equal(p.id,'new-b');assert.equal(voice.members.get('host').session,'voice-a');assert.equal(voice.controls,controls);
  assert.deepEqual([...voice.localMuted],['new-b']);
});
