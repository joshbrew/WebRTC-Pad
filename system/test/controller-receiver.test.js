import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {ControllerReceiver} from '../src/controller-receiver.js';
import {neutralState} from '../public/input.js';
const flush=()=>new Promise(r=>setTimeout(r,20));
test('guest native receiver requires explicit supported endpoint and releases pads on stop, disconnect and timeout',async t=>{
  let now=0,closed=0;const writes=[],added=[],removed=[],options=[];const receiver=new ControllerReceiver({outputs:[{id:'ds4',maxPlayers:2}],now:()=>now,createInjector:async value=>{options.push(value);return {setState:(...v)=>writes.push(v),addController:v=>added.push(v),removeController:v=>removed.push(v),close:()=>closed++};}});t.after(()=>receiver.close());
  const ws=new EventEmitter();ws.readyState=1;ws.send=()=>{};ws.close=()=>ws.emit('close');receiver.attach(ws);const post=value=>ws.emit('message',JSON.stringify(value)),state=neutralState();state.buttons.a=true;const packet={version:1,kind:'controller',device:'host:pad',seq:1,state};post({packet});await flush();assert.equal(writes.length,0);
  post({type:'start',endpoint:'ds4'});await flush();assert.deepEqual(options,[{playerCount:0,controllerType:'ds4'}]);post({packet});await flush();assert.equal(added[0],'p1');assert.equal(writes.at(-1)[1].buttons.a,true);
  now=1000;await new Promise(r=>setTimeout(r,120));assert.equal(writes.at(-1)[1].buttons.a,false);assert.equal(removed[0],'p1');post({type:'stop'});await flush();assert.equal(closed,1);ws.close();
});
