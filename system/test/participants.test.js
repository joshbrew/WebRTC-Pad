import {test} from 'node:test';
import assert from 'node:assert/strict';
import {participantRoster} from '../public/participants.js';
import {cameraLimit,boundedCamera,cameraBudget} from '../public/camera-quality.js';
import {VoiceRoom} from '../public/voice.js';
test('public participant roster excludes diagnostics, network data and duplicate identities',()=>{
  const roster=participantRoster([{id:'a',name:'Alex',mic:true,controllers:[{slot:'p2',name:'PS4\u0000 Controller'}],rttMs:50,privateDiagnostic:{remoteAddress:'private'}},{id:'a',name:'duplicate'},{id:'<script>',name:'bad'}]);
  assert.equal(roster.length,1);assert.equal(roster[0].controllers[0].name,'PS4 Controller');assert.equal(roster[0].controllers[0].slot,'P2');assert.equal('rttMs' in roster[0],false);assert.equal(JSON.stringify(roster).includes('private'),false);
});
test('camera limits are bounded by the source, session ceiling and per-guest ceiling',()=>{
  assert.deepEqual(cameraLimit({height:Infinity,fps:-1}),{height:1080,fps:30});assert.deepEqual(boundedCamera({height:720,fps:24},{height:360,fps:15},{height:240,fps:10}),{height:240,fps:10});assert.deepEqual(boundedCamera({height:240,fps:10},{height:1080,fps:30}),{height:240,fps:10});
  assert.equal(cameraBudget({}, {},{height:240,fps:10}).bitrate,150000);assert.equal(cameraBudget({}, {},{height:360,fps:15}).bitrate,350000);
});
test('personal voice mutes and host restrictions apply independently to each participant',()=>{
  const audioA={},audioB={},room=Object.assign(Object.create(VoiceRoom.prototype),{host:true,guestMicAllowed:true,localMuted:new Set(['a']),micBlocks:new Set(),peers:new Map([['a',{id:'a',audio:audioA}],['b',{id:'b',audio:audioB}]]),roster:[]});room.applyMutes();assert.equal(audioA.muted,true);assert.equal(audioB.muted,false);room.localMuted.clear();room.micBlocks.add('b');room.applyMutes();assert.equal(audioA.muted,false);assert.equal(audioB.muted,true);assert.equal(room.memberAllowed('host'),true);
});
