import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createApp} from '../src/server.js';
test('local input bridge requires session token and local origin, is read-only, and releases on host loss',{timeout:15000},async t=>{
  let injections=0;const app=createApp({env:{INPUT_BACKEND:'none'},createInjector:async()=>({name:'Recording fixture',setState(){injections++;},close(){}})}),clients=[];
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`,base=origin.replace('http','ws');
  t.after(async()=>{for(const ws of clients)ws.terminate();await app.close();});
  const connect=(url,headers)=>{const ws=new WebSocket(url,{headers});clients.push(ws);return ws;},host=connect(base+'/ws',{Origin:origin});await once(host,'open');const created=once(host,'message');host.send(JSON.stringify({type:'create',dynamicControllers:true,controllerType:'auto'}));const room=JSON.parse((await created)[0]);assert.equal(room.type,'created');assert.ok(room.appInputToken);assert.notEqual(room.appInputToken,room.hostKey);
  const url=base+`/app-input?room=${room.roomId}&token=${room.appInputToken}`;
  for(const [bad,headers] of [[url.replace(room.appInputToken,'invalid'),{}],[url,{Origin:'https://elsewhere.example'}],[url,{Host:'remote.example'}]])await assert.rejects(once(connect(bad,headers),'open'));
  const reader=connect(url),messages=[];reader.on('message',raw=>messages.push(JSON.parse(raw)));await once(reader,'open');
  const next=once(reader,'message');host.send(JSON.stringify({type:'app-input',peerId:'guest-a',packet:{version:1,kind:'keyboard',device:'keyboard',seq:1,keys:['KeyA'],native:true}}));const input=JSON.parse((await next)[0]);assert.equal(input.kind,'keyboard');assert.equal(input.peerId,'guest-a');assert.equal(input.native,undefined);assert.equal(injections,0);
  const rejected=once(reader,'close');reader.send(JSON.stringify({type:'desktop-event'}));assert.equal((await rejected)[0],1008);assert.equal(injections,0);
  const another=connect(url);await once(another,'open');const closed=once(another,'close');host.close();await closed;
  for(const file of ['/app-inputs.js','/app-input-wire.js','/app-inputs'])assert.equal((await fetch(origin+file)).status,200);
  assert.equal((await fetch(origin+'/.local/input-driver-choice.json')).status,404);
});
