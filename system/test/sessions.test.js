import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {once} from 'node:events';
import http from 'node:http';
import {WebSocket} from 'ws';
import {createApp} from '../src/server.js';
import {sessionSettings,createSessionServer} from '../src/session-server.js';
import {pairingPacket} from '../public/pairing.js';
import {inviteLink,parseSessionLink,SessionInvites} from '../public/sessions.js';

async function fixture(t){
  const app=createApp({env:{SESSION_SERVER_ENABLED:'1',SESSION_SERVER_ONLY:'1'},createInjector:()=>{throw Error('A signaling server must never initialize a controller driver');}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  async function peer(name,resume){
    const ws=new WebSocket(origin.replace('http:','ws:')+'/sessions'),backlog=[],waiting=[];
    ws.on('message',raw=>{const value=JSON.parse(raw);const index=waiting.findIndex(item=>item.type===value.type);if(index<0)backlog.push(value);else{const item=waiting.splice(index,1)[0];clearTimeout(item.timer);item.resolve(value);}});
    const next=type=>{const index=backlog.findIndex(value=>value.type===type);if(index>=0)return Promise.resolve(backlog.splice(index,1)[0]);return new Promise((resolve,reject)=>{const item={type,resolve};item.timer=setTimeout(()=>reject(Error('Missing '+type)),3000);waiting.push(item);});};
    await once(ws,'open');const send=value=>ws.send(JSON.stringify(value));
    if(name!==undefined || resume)send({type:'hello',name,resume});
    return {ws,send,next};
  }
  return {app,origin,peer};
}
test('hosted invite features are opt-in and public mode exposes no local hardware configuration',async t=>{
  assert.deepEqual(sessionSettings({}),{enabled:false,hosted:false,url:null});
  assert.throws(()=>sessionSettings({SESSION_SERVER_URL:'http://remote.example'}));
  assert.throws(()=>sessionSettings({SESSION_SERVER_ONLY:'1'}));
  assert.equal(sessionSettings({SESSION_SERVER_URL:'https://invite.example'}).url,'https://invite.example');
  const {origin}=await fixture(t),config=await fetch(origin+'/config').then(r=>r.json());
  assert.deepEqual(config,{app:'webrtc-pad',sessionServer:{hosted:true,url:null}});
  for(const route of ['/capture-targets','/encoder-check','/ice'])assert.equal((await fetch(origin+route)).status,403);
  const key='a'.repeat(64),link=inviteLink(origin,key);assert.equal(parseSessionLink(link,origin),key);
  assert.throws(()=>parseSessionLink(link,'https://another.example'));
  assert.throws(()=>parseSessionLink('not a link',origin),/Paste the full session link/);
});
test('session links require host acceptance, isolate signals, and expire when the host ends the call',async t=>{
  const {app,peer}=await fixture(t),host=await peer('Host'),guest=await peer('Friend'),other=await peer('Other');
  const h=await host.next('welcome'),g=await guest.next('welcome'),o=await other.next('welcome');
  host.send({type:'create'});const room=await host.next('session-created');
  guest.send({type:'join',token:room.token});const request=await host.next('join-request');await guest.next('join-waiting');assert.equal(request.guestId,g.userId);
  const id=crypto.randomUUID(),offer=pairingPacket('offer',id,{type:'offer',sdp:'v=0'}, {iceServers:[]},null);
  guest.send({type:'signal',roomId:room.roomId,payload:pairingPacket('answer',id,{type:'answer',sdp:'v=0'})});assert.match((await guest.next('session-error')).error,/accept/);
  other.send({type:'accept',roomId:room.roomId,guestId:g.userId});assert.match((await other.next('session-error')).error,/unavailable/);
  host.send({type:'accept',roomId:room.roomId,guestId:g.userId});await host.next('guest-accepted');
  host.send({type:'signal',roomId:room.roomId,guestId:g.userId,payload:offer});assert.equal((await guest.next('signal')).payload.kind,'offer');
  other.send({type:'join',token:room.token});await host.next('join-request');await other.next('join-waiting');host.send({type:'accept',roomId:room.roomId,guestId:o.userId});await host.next('guest-accepted');
  other.send({type:'signal',roomId:room.roomId,payload:pairingPacket('answer',id,{type:'answer',sdp:'v=0'})});assert.match((await other.next('session-error')).error,/current connection offer/);
  other.send({type:'leave',roomId:room.roomId});await host.next('guest-left');
  other.send({type:'signal',roomId:room.roomId,guestId:g.userId,payload:pairingPacket('answer',id,{type:'answer',sdp:'v=0'})});assert.match((await other.next('session-error')).error,/accept/);
  guest.send({type:'signal',roomId:room.roomId,payload:pairingPacket('answer',id,{type:'answer',sdp:'v=0'})});assert.equal((await host.next('signal')).guestId,g.userId);
  guest.send({type:'leave',roomId:room.roomId});await host.next('guest-left');
  guest.send({type:'join',token:room.token});await host.next('join-request');await guest.next('join-waiting');
  host.send({type:'leave',roomId:room.roomId});await guest.next('session-ended');assert.equal(app.sessions.rooms.size,0);
  guest.send({type:'join',token:room.token});assert.match((await guest.next('session-error')).error,/unavailable/);
  assert.equal(app.rooms.size,0);assert.ok(h.resume);
});
test('direct invites bind to a temporary sign-in, reject name impersonation and revoke on removal',async t=>{
  const {peer}=await fixture(t),host=await peer('Host'),guest=await peer('Friend'),other=await peer('Other');
  await host.next('welcome');const identity=await guest.next('welcome');await other.next('welcome');
  const collision=await peer('friend');assert.match((await collision.next('session-error')).error,/in use/);
  const anonymous=await peer('');assert.match((await anonymous.next('welcome')).name,/^Guest-/);
  host.send({type:'create'});const room=await host.next('session-created');
  host.send({type:'invite',roomId:room.roomId,to:'Friend'});await host.next('invite-sent');const invite=await guest.next('invited');
  other.send({type:'join',token:invite.token});assert.match((await other.next('session-error')).error,/another temporary/);
  guest.send({type:'join',token:invite.token});await host.next('guest-accepted');await guest.next('join-waiting');
  host.send({type:'reject',roomId:room.roomId,guestId:identity.userId});await guest.next('join-rejected');
  guest.send({type:'join',token:invite.token});assert.match((await guest.next('session-error')).error,/unavailable/);
  guest.ws.close();await once(guest.ws,'close');
  const resumed=await peer(undefined,identity.resume);assert.equal((await resumed.next('welcome')).userId,identity.userId);
});

test('an abandoned host expires its temporary identity and all session links after the reconnect grace',async t=>{
  const service=createSessionServer({disconnectGraceMs:20}),server=http.createServer();
  server.on('upgrade',(req,socket,head)=>service.wss.handleUpgrade(req,socket,head,ws=>service.wss.emit('connection',ws,req)));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{service.close();await new Promise(resolve=>server.close(resolve));});
  const address=`ws://127.0.0.1:${server.address().port}/sessions`;
  const host=new WebSocket(address);await once(host,'open');
  const request=async(ws,message)=>{const response=once(ws,'message');ws.send(JSON.stringify(message));return JSON.parse((await response)[0]);};
  const identity=await request(host,{type:'hello',name:'Temporary'});
  const room=await request(host,{type:'create'});assert.ok(room.token);
  host.close();await once(host,'close');await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(service.rooms.size,0);assert.equal(service.users.size,0);
  const guest=new WebSocket(address);await once(guest,'open');
  assert.equal((await request(guest,{type:'hello',resume:identity.resume})).type,'session-error');
  assert.equal((await request(guest,{type:'hello',name:'Temporary'})).type,'welcome');
  assert.equal((await request(guest,{type:'join',token:room.token})).type,'session-error');
});

test('declining a pending invitation leaves an existing accepted call connected',async()=>{
  let ended=0;const status={textContent:''},state={joinedRoom:'pending',activeGuestRoom:'playing',callbacks:{ended(){ended++;}},$:()=>status,update(){}};
  await SessionInvites.prototype.receive.call(state,{type:'join-rejected',roomId:'pending'});
  assert.equal(ended,0);assert.equal(state.activeGuestRoom,'playing');assert.equal(state.joinedRoom,'playing');
  await SessionInvites.prototype.receive.call(state,{type:'session-ended',roomId:'playing'});
  assert.equal(ended,1);assert.equal(state.activeGuestRoom,null);assert.equal(state.joinedRoom,null);
});

test('cancelling a pending request withdraws only that request and preserves a different active call',()=>{
  const session=new SessionInvites({}),sent=[],status={textContent:''};
  session.joinedRoom='pending';session.activeGuestRoom='playing';session.pendingJoin=true;
  session.send=message=>sent.push(message);session.update=()=>{};session.notify=()=>{};session.$=()=>status;
  session.cancelJoin();assert.deepEqual(sent,[{type:'leave',roomId:'pending'}]);
  assert.equal(session.joinedRoom,'playing');assert.equal(session.activeGuestRoom,'playing');assert.equal(session.pendingJoin,false);
  assert.match(status.textContent,/cancelled/);session.cancelJoin();assert.equal(sent.length,1);
});

test('leaving during asynchronous reply preparation cannot restore the abandoned hosted connection',async()=>{
  let finish;const ready=new Promise(resolve=>finish=resolve),sent=[];
  const session=new SessionInvites({answer:()=>ready});session.joinedRoom='pending';
  session.update=()=>{};session.send=message=>sent.push(message);
  const receive=session.receive({type:'signal',roomId:'pending',payload:{kind:'offer'}});
  session.leaveGuest();finish({kind:'answer'});await receive;
  assert.equal(session.activeGuestRoom,null);assert.equal(session.joinedRoom,null);
  assert.deepEqual(sent,[{type:'leave',roomId:'pending'}]);
});

test('invitation presence expiry preserves accepted peer connections; explicit ending still disconnects',async()=>{
  let ended=0,removed=0;const status={textContent:''},session=new SessionInvites({ended(){ended++;},remove(){removed++;}});
  session.$=id=>id==='sessionJoinRequests'?{children:[]}:status;session.update=()=>{};
  session.activeGuestRoom='playing';session.joinedRoom='playing';
  await session.receive({type:'session-ended',roomId:'playing',reason:'host-offline'});
  assert.equal(ended,0);assert.equal(session.activeGuestRoom,null);assert.match(status.textContent,/game connection stays open/);
  session.roomId='hosting';await session.receive({type:'guest-left',roomId:'hosting',guestId:'guest',reason:'guest-offline'});assert.equal(removed,0);
  await session.receive({type:'guest-left',roomId:'hosting',guestId:'guest'});assert.equal(removed,1);
  session.activeGuestRoom='playing';session.joinedRoom='playing';await session.receive({type:'session-ended',roomId:'playing',reason:'host-ended'});assert.equal(ended,1);
});

test('clearing an expired invitation resets link controls without ending the local host session',()=>{
  const session=new SessionInvites({}),fields=new Map();for(const id of ['sessionShareLink','sessionCopyLink','sessionCreateLink','sessionLinkReady'])fields.set(id,{value:'old link',disabled:false,hidden:false});
  let cleared=false;fields.set('sessionJoinRequests',{replaceChildren(){cleared=true;}});
  session.uiReady=true;session.hostActive=true;session.roomId='expired';session.$=id=>fields.get(id);session.clearHostInvite();
  assert.equal(session.roomId,null);assert.equal(session.hostActive,true);assert.equal(fields.get('sessionShareLink').value,'');assert.equal(fields.get('sessionCopyLink').disabled,true);assert.equal(fields.get('sessionCreateLink').hidden,false);assert.equal(fields.get('sessionLinkReady').hidden,true);assert.equal(cleared,true);
});

test('a delayed invite cannot survive Stop or revoke the next host session',async()=>{
  const session=new SessionInvites({}),calls=[],fields=new Map();
  session.url='https://invites.example';session.update=()=>{};session.notify=()=>{};session.status=()=>{};session.connect=async()=>{};
  session.$=id=>{if(!fields.has(id))fields.set(id,{value:'',classList:{add(){}}});return fields.get(id);};
  let reply,started;const waiting=new Promise(resolve=>started=resolve);
  session.request=async()=>{calls.push('create');if(calls.filter(x=>x==='create').length===1){started();return new Promise(resolve=>reply=resolve);}return {roomId:'new',token:'b'.repeat(64)};};
  session.send=msg=>calls.push(msg.roomId);
  session.hostStarted();const old=session.createRoom();const rejected=assert.rejects(old,/Hosting stopped/);await waiting;
  session.endHosting();session.hostStarted();const fresh=session.createRoom();reply({roomId:'old',token:'a'.repeat(64)});
  await rejected;await fresh;
  assert.deepEqual(calls,['create','old','create']);assert.equal(session.roomId,'new');assert.equal(session.hostActive,true);
  assert.equal(fields.get('sessionShareLink').value,inviteLink(session.url,'b'.repeat(64)));
});
