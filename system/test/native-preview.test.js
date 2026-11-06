import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once,EventEmitter} from 'node:events';
import {WebSocket} from 'ws';
import {createApp} from '../src/server.js';
import {audioArguments,nativeAudioCapability} from '../src/native-audio.js';
test('native preview allocates no room or controller, adopts once, and closes on disconnect',async t=>{
  const engines=[];let controllers=0;
  const app=createApp({env:{NATIVE_AUDIO_HELPER:process.execPath},platform:'win32',createInjector:async()=>{controllers++;return {setState(){},close(){}};},createNativeMedia:captureEnv=>{
    const engine=Object.assign(new EventEmitter(),{captureEnv,closed:false,offers:[],iceCandidates:[],async ice(id,candidate){this.iceCandidates.push({id,candidate});},audioChanges:[],async setAudio(enabled,pid){this.audioChanges.push({enabled,pid});return {audioAvailable:enabled};},async offer(id,q,ice){this.offers.push({id,q,ice});return {sourceSize:{width:640,height:360}};},async closePeer(){},close(){this.closed=true;}});engines.push(engine);return engine;
  }});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`,sockets=[];
  t.after(async()=>{for(const ws of sockets)ws.terminate();await app.close();});
  async function connect(host) {
    const ws=new WebSocket(origin.replace('http','ws')+'/ws',{origin:host?'http://other.example':origin,headers:host?{Host:host}:undefined});sockets.push(ws);
    const messages=[];ws.on('message',data=>messages.push(JSON.parse(data)));await once(ws,'open');
    ws.request=async value=>{const id=crypto.randomUUID();ws.send(JSON.stringify({...value,requestId:id}));const deadline=Date.now()+3000;while(!messages.some(message=>message.requestId===id)){if(Date.now()>deadline)throw new Error('No preview response');await new Promise(resolve=>setTimeout(resolve,10));}return messages.splice(messages.findIndex(message=>message.requestId===id),1)[0];};
    ws.messages=messages;return ws;
  }
  const denied=await connect('other.example');assert.match((await denied.request({type:'preview-source',id:'desktop'})).error,/Local pre-session/);assert.equal(engines.length,0);
  const host=await connect();await host.request({type:'preview-source',id:'desktop',audio:false});
  assert.match((await host.request({type:'preview-offer',quality:{frameRate:999}})).error,/quality/);assert.equal(engines.length,0);
  const quality={frameRate:30,width:640,height:360,maxBitrate:2000000};
  await host.request({type:'preview-offer',quality,peerId:'not-a-guest'});
  assert.equal(app.rooms.size,0);assert.equal(controllers,0);assert.deepEqual(engines[0].offers[0].ice,{iceServers:[]});assert.equal(engines[0].offers[0].id,'preview');
  const candidate={candidate:'candidate:1 1 udp 2130706431 127.0.0.1 54321 typ host',sdpMid:'0',sdpMLineIndex:0};
  assert.equal((await host.request({type:'preview-ice',candidate})).error,undefined);
  assert.deepEqual(engines[0].iceCandidates,[{id:'preview',candidate}]);
  assert.match((await host.request({type:'preview-ice',peerId:'guest',candidate})).error,/Invalid preview ICE/);
  assert.match((await host.request({type:'preview-ice',candidate:{candidate:'x'.repeat(4097)}})).error,/Invalid preview ICE/);
  assert.equal((await host.request({type:'preview-audio',enabled:true})).result.audioAvailable,true);
  assert.equal((await host.request({type:'preview-audio',enabled:false})).result.audioAvailable,false);
  assert.equal(engines.length,1);assert.equal(engines[0].offers.length,1);assert.equal(engines[0].closed,false);
  assert.deepEqual(engines[0].audioChanges,[{enabled:true,pid:0},{enabled:false,pid:0}]);
  assert.match((await host.request({type:'preview-audio',enabled:'yes'})).error,/Invalid audio/);
  host.send(JSON.stringify({type:'create',dynamicControllers:true}));
  const deadline=Date.now()+3000;while(!host.messages.some(message=>message.type==='created')){if(Date.now()>deadline)throw new Error('Room not created');await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(host.messages.find(message=>message.type==='created').previewAdopted,true);assert.equal([...app.rooms.values()][0].native,engines[0]);assert.equal(controllers,1);
  assert.match((await host.request({type:'preview-offer',quality})).error,/Local pre-session/);
  assert.equal((await host.request({type:'native-audio',enabled:true})).result.audioAvailable,true);
  assert.equal([...app.rooms.values()][0].native,engines[0]);assert.equal(engines[0].offers.length,1);assert.equal(engines[0].closed,false);
  host.close();await once(host,'close');await new Promise(resolve=>setTimeout(resolve,30));assert.equal(engines[0].closed,true);
  const preview=await connect();await preview.request({type:'preview-source',id:'desktop'});await preview.request({type:'preview-offer',quality});preview.close();await once(preview,'close');await new Promise(resolve=>setTimeout(resolve,30));assert.equal(engines[1].closed,true);
});
test('native audio uses Opus over loopback RTP and unsupported platforms never claim support',()=>{
  const args=audioArguments(5005);assert.ok(args.includes('libopus'));assert.ok(args.includes('lowdelay'));assert.match(args.at(-1),/^rtp:\/\/127\.0\.0\.1:5005/);assert.throws(()=>audioArguments(0));
  assert.equal(nativeAudioCapability({NATIVE_AUDIO_LIBPULSE:'/missing/libpulse'},'linux').available,false);assert.equal(nativeAudioCapability({NATIVE_MAC_HELPER:'/missing/mac/helper'},'darwin').window,false);
});


test('standalone audio is local-only, adopts into the room and cannot alter desktop scope',async t=>{
  const engines=[];let injectors=0,currentPid=20;
  const app=createApp({platform:'win32',env:{NATIVE_AUDIO_HELPER:process.execPath},getCaptureTargets:async()=>[{kind:'window',id:'10',pid:currentPid,label:'Browser picture'}],
    createInjector:async()=>{injectors++;return {close(){},setState(){}};},
    createNativeMedia:env=>{const engine=Object.assign(new EventEmitter(),{env,closed:false,offers:[],async offer(id,q,ice){this.offers.push({id,q,ice});return {audioOnly:true,audioAvailable:true};},async setAudio(enabled){return {audioAvailable:enabled};},close(){this.closed=true;},async closePeer(){}});engines.push(engine);return engine;}
  });
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`,sockets=[];
  t.after(async()=>{for(const ws of sockets)ws.terminate();await app.close();});
  async function connect(foreign=false){
    const ws=new WebSocket(origin.replace('http','ws')+'/ws',{origin:foreign?'http://other.example':origin,headers:foreign?{Host:'other.example'}:undefined});sockets.push(ws);await once(ws,'open');
    const messages=[];ws.on('message',data=>messages.push(JSON.parse(data)));
    ws.command=async value=>{const requestId=crypto.randomUUID();ws.send(JSON.stringify({...value,requestId}));const end=Date.now()+3000;let index;while((index=messages.findIndex(message=>message.requestId===requestId || value.type==='create' && message.type==='created'))<0){if(Date.now()>end)throw new Error('No audio response');await new Promise(r=>setTimeout(r,10));}return messages.splice(index,1)[0];};return ws;
  }
  const foreign=await connect(true);assert.match((await foreign.command({type:'audio-source',sourceId:'desktop',enabled:true})).error,/Local host/);
  const host=await connect();assert.match((await host.command({type:'audio-source',enabled:true})).error,/Choose an audio/);
  await host.command({type:'audio-source',sourceId:'desktop',enabled:true});assert.equal(injectors,0);assert.equal(engines.length,0);
  assert.match((await host.command({type:'audio-offer',peerId:'someone'})).error,/Player/);
  await host.command({type:'audio-offer',peerId:'preview'});assert.equal(engines[0].env.NATIVE_AUDIO_ONLY,'1');assert.deepEqual(engines[0].offers[0].ice,{iceServers:[]});
  assert.equal(app.rooms.size,0);
  const created=await host.command({type:'create',dynamicControllers:true});assert.equal(created.type,'created');const room=app.rooms.get(created.roomId);
  assert.equal(room.audioCapture.native,engines[0]);assert.equal(injectors,1);
  // A browser picture may have a different window scope from its sound source.
  host.send(JSON.stringify({type:'capture-source',kind:'browser',surface:'window',label:'Browser picture',requestId:'scope'}));
  await new Promise(r=>setTimeout(r,30));assert.equal(room.captureTarget.id,'10');const target=room.captureTarget;
  host.send(JSON.stringify({type:'audio-source',enabled:false,requestId:'off'}));await new Promise(r=>setTimeout(r,30));
  assert.equal(room.captureTarget,target);assert.equal(room.desktopMouse,false);assert.equal(engines[0].closed,false);
  if(nativeAudioCapability({NATIVE_AUDIO_HELPER:process.execPath},'win32').window){
    await host.command({type:'audio-source',sourceId:'10',enabled:true});await host.command({type:'audio-offer',peerId:'preview'});
    currentPid=21;assert.match((await host.command({type:'audio-source',sourceId:'10',enabled:true})).error,/application changed/);
    assert.equal(room.captureTarget,target);
  }
  host.close();await once(host,'close');await new Promise(r=>setTimeout(r,30));assert.equal(engines.every(engine=>engine.closed),true,'Host disconnect must stop native audio immediately');
});
