import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createApp} from '../src/server.js';
import {neutralState} from '../public/input.js';
test('local API has separate read/write credentials, snapshots, reset, origin isolation and no native input',{timeout:15000},async t=>{
  let writes=0;const app=createApp({env:{},createInjector:async()=>({setState(){writes++;},close(){}})});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const base=`http://127.0.0.1:${app.server.address().port}`,clients=[];t.after(async()=>{for(const ws of clients)ws.terminate();await app.close();});
  assert.equal((await fetch(base+'/api/inputs')).status,200);assert.equal((await fetch(base+'/api/inputs/sessions',{method:'POST',headers:{Origin:'https://bad.example'},body:'{}'})).status,403);
  const response=await fetch(base+'/api/inputs/sessions',{method:'POST',headers:{Origin:base},body:JSON.stringify({label:'Example game'})}),session=await response.json();assert.equal(response.status,201);assert.notEqual(session.readToken,session.writeToken);
  const connect=(route,token,origin=base)=>{const ws=new WebSocket(base.replace('http','ws')+`/api/inputs/${route}?session=${session.id}&token=${token}`,{origin});clients.push(ws);return ws;};
  await assert.rejects(once(connect('publish',session.readToken),'open'));await assert.rejects(once(connect('publish',session.writeToken,'https://bad.example'),'open'));
  const writer=connect('publish',session.writeToken);await once(writer,'open');writer.send(JSON.stringify({peerId:'alice',version:1,kind:'controller',device:'pad:1',seq:1,state:neutralState()}));await new Promise(r=>setTimeout(r,25));
  const reader=connect('subscribe',session.readToken,'https://compatible-game.example'),messages=[];reader.on('message',data=>messages.push(JSON.parse(data)));await once(reader,'open');await new Promise(r=>setTimeout(r,25));assert.equal(messages.find(m=>m.type==='snapshot').devices[0].peerId,'alice');assert.equal(writes,0);
  const reset=once(reader,'message');writer.close();assert.equal(JSON.parse((await reset)[0]).type,'reset-all');
  const denied=await fetch(base+'/api/inputs/sessions/'+session.id,{method:'DELETE',headers:{Authorization:'Bearer '+session.readToken}});assert.equal(denied.status,403);
  const closed=once(reader,'close');assert.equal((await fetch(base+'/api/inputs/sessions/'+session.id,{method:'DELETE',headers:{Authorization:'Bearer '+session.writeToken}})).status,200);await closed;
});
