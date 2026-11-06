import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createApp} from '../src/server.js';

test('guest device access requires the local app hostname and exact page origin',async t=>{
  let attached=0,closed=false;
  const app=createApp({env:{},guestInputService:{attach(ws){attached++;ws.send(JSON.stringify({type:'capability',available:false}));},close(){closed=true;}}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const origin=`http://127.0.0.1:${app.server.address().port}`,clients=[];
  t.after(async()=>{for(const ws of clients)ws.terminate();await app.close();assert.equal(closed,true);});
  function connect(headers){const ws=new WebSocket(origin.replace('http','ws')+'/guest-input',{headers});clients.push(ws);return ws;}
  const local=connect({Origin:origin});await once(local,'open');assert.equal(attached,1);
  await assert.rejects(once(connect({Origin:'https://another-site.example'}),'open'));
  await assert.rejects(once(connect({Host:'remote.example',Origin:'http://remote.example'}),'open'));
  await assert.rejects(once(connect({}),'open'));
  assert.equal(attached,1);
  const module=await fetch(origin+'/guest-input.js');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
  assert.equal((await fetch(origin+'/.local/tools/guest-input/webrtc-pad-guest.exe')).status,404);
});
