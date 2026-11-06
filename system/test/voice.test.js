import {test} from 'node:test';
import assert from 'node:assert/strict';
import {voiceBudget,voiceDescription} from '../public/voice-quality.js';
import {VoiceRoom} from '../public/voice.js';

test('voice adapts per connection with a high quality floor and recovers gradually',()=>{
  let state=voiceBudget({},{});assert.equal(state.bitrate,128000);
  state=voiceBudget(state,{loss:.12,rttMs:450});assert.equal(state.bitrate,96000);
  state=voiceBudget(state,{loss:.12,rttMs:450});assert.equal(state.bitrate,64000);
  for(let i=0;i<10;i++)state=voiceBudget(state,{loss:.5,rttMs:900});assert.equal(state.bitrate,64000);
  for(let i=0;i<3;i++)state=voiceBudget(state,{loss:0,rttMs:35});assert.equal(state.bitrate,64000);
  state=voiceBudget(state,{loss:0,rttMs:35});assert.equal(state.bitrate,96000);
  assert.equal(voiceBudget(state,{loss:.4,rttMs:600},192000,false).bitrate,192000);
});
test('Opus negotiation preserves other codecs, requests full-band FEC and high bitrate, with stereo for game sound',()=>{
  const input={type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 0\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=0\r\na=rtpmap:0 PCMU/8000\r\n'};
  const voice=voiceDescription(input);assert.match(voice.sdp,/maxaveragebitrate=192000/);assert.match(voice.sdp,/maxplaybackrate=48000/);assert.match(voice.sdp,/useinbandfec=1/);assert.match(voice.sdp,/usedtx=0/);assert.match(voice.sdp,/minptime=10/);assert.match(voice.sdp,/PCMU\/8000/);assert.doesNotMatch(voice.sdp,/stereo=1/);
  const game=voiceDescription(input,192000,true);assert.match(game.sdp,/;stereo=1/);assert.match(game.sdp,/sprop-stereo=1/);assert.equal(voiceDescription(game,192000,true).sdp,game.sdp);assert.doesNotMatch(input.sdp,/maxaveragebitrate/);
});
test('voice signaling relay is scoped to registered participants and current join sessions',()=>{
  const sent=[],room=Object.create(VoiceRoom.prototype);room.members=new Map([['a',{session:'A'}],['b',{session:'B'}]]);room.controls=new Map([['b',m=>sent.push(m)]]);
  const message={action:'candidate',to:'b',session:'A',toSession:'B',candidate:{candidate:'candidate:test'},from:'forged'};
  room.route('a',message);assert.equal(sent[0].from,'a');
  room.route('unknown',message);room.route('a',{...message,session:'expired'});room.route('a',{...message,toSession:'expired'});room.route('a',{...message,to:'a'});assert.equal(sent.length,1);
});
test('personal voice mute removes only that listener’s outgoing microphone track',()=>{
  const track={},room=Object.create(VoiceRoom.prototype);Object.assign(room,{self:'speaker',muted:false,mic:{getAudioTracks:()=>[track]},canSpeak:()=>true,roster:[{id:'host',muted:['speaker']},{id:'friend',muted:[]}]});assert.equal(room.outgoingTrack('host'),null);assert.equal(room.outgoingTrack('friend'),track);room.roster[0].muted=[];assert.equal(room.outgoingTrack('host'),track);room.muted=true;assert.equal(room.outgoingTrack('host'),null);assert.equal(room.outgoingTrack('friend'),null);
});

test('a reconnect waits for the new host microphone policy before sharing prepared audio',()=>{
  const track={},room=Object.assign(Object.create(VoiceRoom.prototype),{host:false,ready:true,preparing:true,awaitingPolicy:true,guestMicAllowed:true,muted:false,mic:{getAudioTracks:()=>[track]},roster:[]});
  assert.equal(room.canSpeak(),false);assert.equal(room.outgoingTrack('host'),null);
  room.awaitingPolicy=false;assert.equal(room.outgoingTrack('host'),track);
  room.guestMicAllowed=false;assert.equal(room.outgoingTrack('host'),null);
});

test('cancelling a pending microphone keeps an active voice call listening',()=>{
  let stopped=0,synced=0,announced=0;const room=Object.assign(Object.create(VoiceRoom.prototype),{active:true,micBusy:true,mic:{getTracks:()=>[{stop(){stopped++;}}]},peers:new Map([['host',{}]]),syncSender:async()=>{synced++;},announce(){announced++;},status(){},render(){}});
  room.cancelMic();assert.equal(room.active,true);assert.equal(room.mic,null);assert.equal(room.micBusy,false);assert.equal(room.muted,true);assert.equal(stopped,1);assert.equal(synced,1);assert.equal(announced,1);assert.equal(room.peers.size,1);
});
