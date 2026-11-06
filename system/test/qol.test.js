import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FileTransfers,fileOffer,filePacket,readFilePacket,fileLimit,fileChunk,fileUploadAllowed} from '../public/file-transfer.js';
import {calibrationFromSamples,cleanCalibration,packGamepadState,standardProfile} from '../public/input.js';
import {portableProfile} from '../public/keyboard-mapping.js';
import {cleanPreset} from '../public/session-presets.js';
import {cleanRumble,playRumble} from '../public/rumble.js';
import {connectionCheck} from '../public/connection-check.js';
import {relativeDelta} from '../public/relative-mouse.js';
import {voiceVolume} from '../public/voice-controls.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let n=0;n<200;n++){if(predicate())return;await delay(10);}assert.fail('Transfer did not complete');}
function connect(a,aid,b,bid){const channels=[0,1].map(()=>({readyState:'open',bufferedAmount:0,sent:[],close(){this.readyState='closed';}}));channels.forEach((ch,i)=>ch.send=data=>{ch.sent.push(data);queueMicrotask(()=>channels[1-i].onmessage?.({data:structuredClone(data)}));});a.attach(aid,channels[0],aid);b.attach(bid,channels[1],bid);return channels;}
test('chat attachments transfer exact bytes from guest to guest through host without auto-downloading or caching at host',async t=>{
  const host=new FileTransfers({host:true}),a=new FileTransfers(),b=new FileTransfers();t.after(()=>{a.reset();b.reset();host.reset();});connect(host,'a',a,'host');connect(host,'b',b,'host');await delay(0);
  const bytes=Uint8Array.from({length:fileChunk*3+7},(_,i)=>i%251),file=new File([bytes],'save.dat'),id=a.offer(file);await until(()=>b.offers.has(id));
  assert.equal(b.offers.get(id).url,undefined);assert.equal(host.routes.size,0);b.request(id);await until(()=>!!b.offers.get(id).url);
  assert.deepEqual(new Uint8Array(await b.offers.get(id).blob.arrayBuffer()),bytes);assert.equal(host.offers.get(id).blob,undefined);assert.equal(host.routes.size,0);assert.equal(a.routes.size,0);
  const late=new FileTransfers();t.after(()=>late.reset());connect(host,'late',late,'host');await until(()=>late.offers.has(id));assert.equal(late.offers.get(id).url,undefined);a.withdraw(id);await until(()=>!b.offers.has(id) && !late.offers.has(id));
});
test('file receiver rejects unsolicited chunks, sequence gaps and oversized offers; host policy cancels active work',async t=>{
  const host=new FileTransfers({host:true}),guest=new FileTransfers();t.after(()=>{host.reset();guest.reset();});const channels=connect(host,'guest',guest,'host');await delay(0);
  assert.equal(fileOffer({id:crypto.randomUUID(),name:'huge',size:fileLimit+1}),null);assert.equal(readFilePacket(new ArrayBuffer(fileChunk+41)),null);assert.equal(fileOffer({id:crypto.randomUUID(),name:'../../safe\u0000.txt',size:0}).name,'safe.txt');
  const id=host.offer(new File([new Uint8Array(fileChunk*3)],'file.bin'));await until(()=>guest.offers.has(id));host.paused=true;guest.request(id);await until(()=>host.routes.size===1);
  const route=[...guest.routes.keys()][0];guest.chunk('stranger',filePacket(route,0,new Uint8Array([1]).buffer));assert.equal(guest.routes.get(route).bytes,0);
  guest.chunk('host',filePacket(route,1,new Uint8Array([1]).buffer));assert.equal(guest.routes.size,0);assert.equal(guest.offers.get(id).url,undefined);
  host.setPolicy({files:false,clipboard:false});await until(()=>!guest.policy.files);assert.equal(host.offers.size,0);assert.equal(guest.offers.size,0);assert.equal(channels[0].readyState,'open');
});
test('clipboard is explicit, permission-gated, bounded, and authors are assigned by the host',async t=>{
  const got=[],host=new FileTransfers({host:true}),a=new FileTransfers(),b=new FileTransfers({clipboard:value=>got.push(value)});t.after(()=>{a.reset();b.reset();host.reset();});connect(host,'Alice',a,'host');connect(host,'Bob',b,'host');await delay(0);assert.throws(()=>a.shareClipboard('secret'),/not enabled/);host.setPolicy({files:true,clipboard:true});await delay(0);a.shareClipboard('copied text');await until(()=>got.length===1);assert.equal(got[0].author,'Alice');assert.equal(got[0].text,'copied text');assert.throws(()=>a.shareClipboard('x'.repeat(8001)),/8,000/);
});
test('portable profiles validate schema and preserve measured calibration without accepting arbitrary settings',()=>{
  const rest={axes:{lx:.08}},samples=[{axes:{lx:-.8}},{axes:{lx:.9}}],calibration=calibrationFromSamples(rest,samples);
  assert.deepEqual(cleanCalibration({lx:{center:5,min:0,max:10}}),{});assert.throws(()=>portableProfile({version:2}),/profile/);
  const exported=portableProfile({version:1,kind:'gamepad',template:'generic',profile:{...standardProfile,calibration},allowDesktop:true});assert.ok(!('allowDesktop' in exported));assert.deepEqual(exported.profile.calibration.lx,calibration.lx);
  const pad={mapping:'standard',axes:[.08,0,0,0],buttons:[]};assert.equal(packGamepadState(pad,exported.profile,0).axes.lx,0);pad.axes[0]=.9;assert.equal(packGamepadState(pad,exported.profile,0).axes.lx,1);
});
test('session presets cannot restore permissions, microphone activation, credentials or device grabs',()=>{
  const preset=cleanPreset({version:1,fields:{streamResolution:'1080',nativeCaptureAudio:true,hostDesktopMouse:true,hostAllowClipboard:true,TURN_PASSWORD:'private',hostCallMic:true},source:{method:'native',label:'Game',pid:123}});assert.deepEqual(preset.fields,{streamResolution:'1080',nativeCaptureAudio:true});assert.ok(!('pid' in preset.source));
});
test('feedback, relative movement and voice volume are bounded',()=>{
  assert.equal(cleanRumble({controller:0,generation:0,large:2,small:0}),null);assert.ok(cleanRumble({controller:2,generation:1,large:1,small:.2}));let effect;assert.equal(playRumble({vibrationActuator:{playEffect:(...args)=>{effect=args;return Promise.resolve();}}},{large:1,small:.5}),true);assert.equal(effect[1].duration,180);assert.equal(playRumble({},{}),false);assert.deepEqual(relativeDelta(1000,-1000),{dx:500,dy:-500});assert.equal(relativeDelta(NaN,1),null);assert.equal(voiceVolume(.8,.5),.4);
});
test('file uploads yield to controller backlog and fresh video congestion measurements',()=>{
  const peer={pc:{connectionState:'connected'},channel:{bufferedAmount:0},control:{bufferedAmount:0},cameraPressureAt:100,cameraPressure:{loss:0,bufferMs:40,rttMs:30}};assert.equal(fileUploadAllowed(peer,101),true);peer.channel.bufferedAmount=9000;assert.equal(fileUploadAllowed(peer,101),false);peer.channel.bufferedAmount=0;peer.cameraPressure.loss=.08;assert.equal(fileUploadAllowed(peer,101),false);assert.equal(fileUploadAllowed(peer,10000),true);peer.pc.connectionState='disconnected';assert.equal(fileUploadAllowed(peer,10001),false);
});
test('connection self-test reports route kinds without addresses and always closes its temporary peer',async()=>{
  let instance;class Peer{constructor(){instance=this;}createDataChannel(){}async createOffer(){return {};}async setLocalDescription(){queueMicrotask(()=>{for(const type of ['host','srflx','relay'])this.onicecandidate({candidate:{type,protocol:'udp',address:'private'}});this.onicecandidate({candidate:null});});}close(){this.closed=true;}}
  const result=await connectionCheck({iceServers:[{urls:'turn:example.org',credential:'secret'}]},{Peer});assert.equal(result.relay,1);assert.equal(result.reflexive,1);assert.equal(result.direct,1);assert.equal(result.turnConfigured,true);assert.ok(instance.closed);assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes('secret'));
  const abort=new AbortController();abort.abort();await assert.rejects(connectionCheck({}, {Peer,signal:abort.signal}),{name:'AbortError'});
});
