import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../src/server.js';

const until = async predicate => {
  const end = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > end) throw new Error('Condition timed out'); await new Promise(r => setTimeout(r, 20)); }
};
async function fixture(t, options = {}) {
  const {createMessage={type:'create'},...appOptions}=options;
  const writes = [];
  const driver = { name: 'Test gamepad', setState(slot, state) { writes.push({ slot, state }); }, close() {} };
  const app = createApp({ createInjector: async () => driver, env: {}, staleMs: 100, ...appOptions });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const connections = [];
  t.after(async () => { connections.forEach(ws => ws.terminate()); await app.close(); });
  async function connect(route = '/ws', customOrigin = origin) {
    const ws = new WebSocket(origin.replace('http', 'ws') + route, { origin: customOrigin });
    const messages = []; ws.on('message', raw => messages.push(JSON.parse(raw))); connections.push(ws);
    await once(ws, 'open');
    ws.post = msg => ws.send(JSON.stringify(route === '/inject' && msg.type === 'state' ? { source: 'gamepad', ...msg } : msg));
    ws.next = async type => { await until(() => messages.some(m => m.type === type)); return messages.splice(messages.findIndex(m => m.type === type), 1)[0]; };
    return ws;
  }
  const host = await connect(); host.post(createMessage); const room = await host.next('created');
  async function join(role = 'p1') { const ws = await connect(); ws.post({ type: 'join', roomId: room.roomId, role }); const member = await ws.next('joined'); await host.next('peer-joined'); return { ws, ...member }; }
  async function bridge() { const ws = await connect('/inject'); ws.post({ type: 'auth', roomId: room.roomId, token: room.injectToken }); await ws.next('driver-status'); return ws; }
  return { app, writes, driver, host, room, connect, join, bridge, origin };
}

test('server serves the real app and missing drivers leave video rooms available', async t => {
  const f = await fixture(t, { createInjector: async () => { throw new Error('Install driver'); } });
  assert.equal(f.room.driver.ready, false); assert.equal(f.room.driver.error, 'Install driver');
  const page = await fetch(f.origin).then(r => r.text()); assert.match(page, /hostCreate/); assert.doesNotMatch(page, /Hello World/);
  assert.equal((await fetch(f.origin + '/%ZZ')).status, 400);
  assert.equal((await fetch(f.origin + '/server.js')).status, 404);
  assert.equal((await f.join()).slot, 'p1');
});

test('desktop overlay is host-controlled, accepts registered cursor coordinates only, and cleans up on disconnect/end', async t => {
  const calls=[]; let created=0;
  const overlay=Object.assign(new EventEmitter(),{send(value){calls.push(value);},close(){calls.push({type:'closed'});}});
  const f=await fixture(t,{createOverlay:async()=>{created++;return overlay;}}), p=await f.join();
  p.ws.post({type:'cursor-overlay',enabled:true}); await new Promise(r=>setTimeout(r,40)); assert.equal(created,0);
  f.host.post({type:'overlay-cursor',peerId:p.peerId,cursor:{x:.4,y:.5}}); await new Promise(r=>setTimeout(r,40)); assert.equal(calls.length,0);
  f.host.post({type:'cursor-overlay',enabled:true}); assert.equal((await f.host.next('cursor-overlay')).enabled,true);
  f.host.post({type:'overlay-cursor',peerId:'unknown',cursor:{x:.4,y:.5}});
  f.host.post({type:'overlay-cursor',peerId:p.peerId,cursor:{x:2,y:.5}});
  f.host.post({type:'overlay-cursor',peerId:p.peerId,cursor:{x:.4,y:.5,color:'#81d8ff'},labels:false});
  await until(()=>calls.length===1); assert.equal(calls[0].id,p.peerId); assert.equal(calls[0].label,'Player 1');
  f.host.post({type:'overlay-cursor',peerId:p.peerId,cursor:{x:.4,y:.5,pressed:true}});f.host.post({type:'overlay-cursor',peerId:p.peerId,cursor:{x:.4,y:.5,pressed:false}});await until(()=>calls.length===3);assert.equal(calls[1].pressed,true);assert.equal(calls[2].pressed,false,'Click release must not be lost to movement throttling');
  p.ws.close(); await until(()=>calls.some(v=>v.type==='remove' && v.id===p.peerId));
  f.host.post({type:'end'}); await until(()=>calls.some(v=>v.type==='closed'));
});

test('simulated desktop reports its scope and cannot create a desktop overlay', async t => {
  let created=0;
  const f=await fixture(t,{desktopSimulation:true,platform:'win32',createOverlay:async()=>{created++;throw new Error('Must not start');}});
  const config=await (await fetch(f.origin+'/config')).json();
  assert.equal(config.desktopSimulation,true); assert.equal(config.cursorOverlay,false);
  f.host.post({type:'cursor-overlay',enabled:true});
  const result=await f.host.next('cursor-overlay'); assert.equal(result.enabled,false); assert.match(result.error,/confined to the test screen/); assert.equal(created,0);
  f.host.post({type:'input-policy',allowKeyboard:true,desktopMouse:false,desktopKeyboard:false});
  assert.equal((await f.host.next('input-policy')).desktopSimulated,true);
});

test('visual overlays are advertised only for a verified uncropped source without enabling input',async t=>{
  let starts=0;const target={kind:'window',id:'1234',pid:55,processStart:'test',label:'Test window'};
  const f=await fixture(t,{platform:'win32',getCaptureTargets:async()=>[target],createDesktop:async()=>{starts++;throw Error('Pointers must not initialize OS input');}});
  async function capture(value){f.host.post({type:'capture-source',requestId:'pointer-source',...value});await f.host.next('native-result');return f.host.next('input-policy');}
  let policy=await capture({kind:'browser',surface:'window',label:'Unknown window'});assert.equal(policy.pointerOverlaySafe,false);
  policy=await capture({kind:'browser',surface:'window',label:'window:1234:0'});assert.equal(policy.pointerOverlaySafe,true);assert.equal(policy.desktopMouse,false);assert.equal(policy.desktopKeyboard,false);assert.equal(starts,0);
  policy=await capture({kind:'browser',surface:'window',label:'window:1234:0',region:{x:0,y:0,width:200,height:100}});assert.equal(policy.pointerOverlaySafe,false);assert.equal(starts,0);
});

test('mouse follows the selected window; desktop access is additional and source changes revoke it', async t => {
  const scopes=[], target={kind:'window',id:'1234',pid:55,label:'Safe test window',width:600,height:440};let helper;
  const f=await fixture(t,{platform:'win32',getCaptureTargets:async()=>[target],createDesktop:async()=>helper=Object.assign(new EventEmitter(),{display:{width:600,height:440},async setScope(s){scopes.push(s);},setState(){},close(){}})});
  f.host.post({type:'input-policy',allowKeyboard:true,desktopMouse:true});assert.match((await f.host.next('error')).error,/full-screen mouse\/keyboard access/);
  f.host.post({type:'input-policy',allowKeyboard:true,desktopKeyboard:true});assert.match((await f.host.next('error')).error,/full-screen mouse\/keyboard access/);
  f.host.post({type:'capture-source',kind:'native',id:'1234',requestId:'source'});await f.host.next('native-result');await f.host.next('input-policy');
  f.host.post({type:'input-policy',allowKeyboard:true,desktopMouse:true});let policy=await f.host.next('input-policy');assert.equal(policy.desktopScope,'window');assert.equal(policy.desktopFullAccess,false);assert.equal(scopes.at(-1).pid,55);
  helper.emit('scope-lost');assert.equal((await f.host.next('input-policy')).desktopMouse,false);await f.host.next('error');
  f.host.post({type:'input-policy',allowKeyboard:true,desktopMouse:true,desktopFullAccess:true});policy=await f.host.next('input-policy');assert.equal(policy.desktopScope,'desktop');assert.equal(scopes.at(-1).kind,'desktop');
  f.host.post({type:'capture-source',kind:'native',id:'1234',requestId:'changed'});await f.host.next('native-result');policy=await f.host.next('input-policy');assert.equal(policy.desktopMouse,false);assert.equal(policy.desktopFullAccess,false);
});
test('native media commands are restricted to the local host and registered peers, and close with the room', async t => {
  const calls = [];
  class Media extends EventEmitter {
    async offer(id, quality, ice) { calls.push(['offer', id, quality, ice]); return { sdp: { type: 'offer', sdp: 'test' } }; }
    async answer(id) { calls.push(['answer', id]); }
    async closePeer(id) { calls.push(['closePeer', id]); }
    close() { calls.push(['close']); }
  }
  const f = await fixture(t, { createNativeMedia: () => new Media() }), p = await f.join();
  const quality = { width: 1280, height: 720, frameRate: 60, maxBitrate: 5000000 };
  p.ws.post({ type: 'native-offer', peerId: p.peerId, quality, requestId: 'forged' });
  await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(calls.length, 0);
  f.host.post({ type: 'native-offer', peerId: 'missing', quality, requestId: 'missing' });
  assert.match((await f.host.next('native-result')).error, /no longer/); assert.equal(calls.length, 0);
  f.host.post({ type: 'native-offer', peerId: p.peerId, quality: { ...quality, frameRate: 999 }, requestId: 'invalid' });
  assert.match((await f.host.next('native-result')).error, /Invalid/); assert.equal(calls.length, 0);
  f.host.post({ type: 'native-offer', peerId: p.peerId, quality, requestId: 'valid' });
  assert.equal((await f.host.next('native-result')).result.sdp.type, 'offer'); assert.equal(calls[0][1], p.peerId);
  f.host.post({ type: 'native-answer', peerId: p.peerId, sdp: { type: 'answer', sdp: 'test' }, requestId: 'answer' });
  await f.host.next('native-result'); assert.equal(calls.at(-1)[0], 'answer');
  f.host.post({ type: 'end' }); await until(() => calls.at(-1)?.[0] === 'close');
});
test('assigned slots govern injection; forged slot and watcher inputs cannot take over', async t => {
  const f = await fixture(t); const p = await f.join(); const watcher = await f.join('watch'); const bridge = await f.bridge();
  f.writes.length = 0;
  bridge.post({ type: 'state', peerId: p.peerId, slot: 'p2', state: { buttons: { a: true } } });
  await until(() => f.writes.some(w => w.state.buttons.a)); assert.equal(f.writes.at(-1).slot, 'p1');
  bridge.post({ type: 'state', peerId: watcher.peerId, slot: 'p2', state: { buttons: { b: true } } });
  bridge.post({ type: 'state', peerId: p.peerId, state: { axes: { lx: 'bad' } } });
  bridge.post({ type: 'state', peerId: p.peerId, state: { buttons: { x: true } } });
  await until(() => f.writes.some(w => w.state.buttons.x));
  assert.equal(f.writes.some(w => w.state.buttons.b), false); assert.ok(f.app.rooms.get(f.room.roomId).injector);
});

test('one guest owns several lanes; capacity, reassignments and disconnect release all owned pads', async t => {
  const f=await fixture(t,{staleMs:5000}), one=await f.join(), two=await f.join('p2'), watcher=await f.join('watch'), bridge=await f.bridge();
  f.host.post({type:'controller-count',peerId:one.peerId,count:3});
  let group=await f.host.next('slot-update');assert.deepEqual(group.slots,['p1','p3','p4']);
  const state=(controller,button,generation=group.generation)=>bridge.post({type:'state',peerId:one.peerId,controller,generation,slot:'p2',state:{buttons:{[button]:true}}});
  f.writes.length=0;state(0,'a');state(1,'b');state(2,'x');state(3,'y');
  await until(()=>f.writes.some(w=>w.slot==='p4' && w.state.buttons.x));
  assert.ok(f.writes.some(w=>w.slot==='p1' && w.state.buttons.a));assert.ok(f.writes.some(w=>w.slot==='p3' && w.state.buttons.b));assert.ok(!f.writes.some(w=>w.slot==='p2' || w.state.buttons.y));
  watcher.ws.post({type:'controller-count',count:4});f.host.post({type:'controller-count',peerId:watcher.peerId,count:4});
  f.host.post({type:'controller-count',peerId:two.peerId,count:3});assert.deepEqual((await f.host.next('slot-update')).slots,['p2']);
  f.writes.length=0;f.host.post({type:'force-assign',peerId:two.peerId,slot:'p3'});
  group=await f.host.next('slot-update');assert.deepEqual(group.slots,['p1','p4']);await f.host.next('slot-update');
  state(1,'y',group.generation-1);state(1,'b',group.generation);await until(()=>f.writes.some(w=>w.slot==='p4' && w.state.buttons.b));assert.ok(!f.writes.some(w=>w.state.buttons.y));
  f.writes.length=0;bridge.post({type:'release',peerId:one.peerId});await until(()=>f.writes.length===2);assert.deepEqual(f.writes.map(w=>w.slot),['p1','p4']);
  one.ws.close();await f.host.next('peer-left');const next=await f.join('play');assert.equal(next.slot,'p1');
});

test('session chooses its own controller count before creating native devices', async t => {
  const f=await fixture(t);f.host.post({type:'end'});await once(f.host,'close');
  let count=0;const app=createApp({env:{},createInjector:async options=>{count=options.playerCount;return {name:'Test',setState(slot){assert.ok(['p1','p2','p3'].includes(slot));},close(){}};}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const origin=`http://127.0.0.1:${app.server.address().port}`,ws=new WebSocket(origin.replace('http','ws')+'/ws',{origin});t.after(()=>ws.terminate());await once(ws,'open');
  const reply=once(ws,'message');ws.send(JSON.stringify({type:'create',playerCount:3}));const room=JSON.parse((await reply)[0]);
  assert.equal(count,3);assert.deepEqual(room.config.slots,['p1','p2','p3']);assert.equal(room.config.maxRemoteControllers,3);
  ws.send(JSON.stringify({type:'end'}));await once(ws,'close');
});

test('a playing invitation made before disconnect can claim freed spots; spectators cannot', async t => {
  const f=await fixture(t,{env:{PLAYER_COUNT:'1'}}), old=await f.join(), waiting=await f.join('play'), watcher=await f.join('watch');
  assert.equal(waiting.slot,null);f.host.post({type:'kick',peerId:old.peerId});await f.host.next('peer-left');
  f.host.post({type:'controller-count',peerId:watcher.peerId,count:1});
  f.host.post({type:'controller-count',peerId:waiting.peerId,count:1});
  const group=await f.host.next('slot-update');assert.equal(group.peerId,waiting.peerId);assert.deepEqual(group.slots,['p1']);
  assert.equal(f.app.rooms.get(f.room.roomId).peers.get(watcher.peerId).slot,null);
});

test('press-to-join creates no idle devices; claims, per-controller removal and failures preserve other players',async t=>{
  const devices=new Set(),writes=[];let initial;
  const f=await fixture(t,{platform:'win32',createMessage:{type:'create',controllerType:'ds4',dynamicControllers:true},createInjector:async options=>{initial=options.playerCount;return {name:'Dynamic test',async addController(slot){if(slot==='p4')throw new Error('Test driver limit');devices.add(slot);},async removeController(slot){devices.delete(slot);},setState(slot,state){assert.ok(devices.has(slot));writes.push({slot,state});},close(){devices.clear();}};}});
  assert.equal(initial,0);const one=await f.join('play'),two=await f.join('play'),watch=await f.join('watch');assert.equal(one.slot,null);assert.equal(devices.size,0);
  f.host.post({type:'controller-count',peerId:one.peerId,count:3});let assigned=await f.host.next('slot-update');assert.deepEqual(assigned.slots,['p1','p2','p3']);assert.equal(devices.size,3);
  f.host.post({type:'controller-count',peerId:watch.peerId,count:1});
  f.host.post({type:'controller-remove',peerId:one.peerId,controller:1,generation:assigned.generation});assigned=await f.host.next('slot-update');assert.equal(assigned.removedController,1);assert.deepEqual(assigned.slots,['p1','p3']);await until(()=>!devices.has('p2'));
  f.host.post({type:'controller-count',peerId:two.peerId,count:3});assert.match((await f.host.next('controller-error')).error,/driver limit/);const second=await f.host.next('slot-update');assert.deepEqual(second.slots,['p2']);assert.ok(f.app.rooms.get(f.room.roomId).injector);
  const bridge=await f.bridge();bridge.post({type:'state',peerId:one.peerId,controller:1,generation:assigned.generation,state:{buttons:{x:true}}});await until(()=>writes.some(w=>w.slot==='p3' && w.state.buttons.x));
  f.host.post({type:'controller-count',peerId:one.peerId,count:0});await f.host.next('slot-update');await until(()=>devices.size===1);assert.ok(devices.has('p2'));
  f.host.post({type:'controller-count',peerId:one.peerId,count:1});assert.deepEqual((await f.host.next('slot-update')).slots,['p1']);one.ws.close();await f.host.next('peer-left');await until(()=>devices.size===1);
});
test('only the host can disable keyboard controller input, releasing held keys while gamepads stay active', async t => {
  const f = await fixture(t), keyboard = await f.join('p1'), gamepad = await f.join('p2'), bridge = await f.bridge();
  bridge.post({ type: 'state', peerId: keyboard.peerId, source: 'keyboard', state: { buttons: { a: true } } });
  bridge.post({ type: 'state', peerId: gamepad.peerId, source: 'gamepad', state: { buttons: { x: true } } });
  await until(() => f.writes.some(w => w.slot === 'p2' && w.state.buttons.x)); f.writes.length = 0;
  f.host.post({ type: 'input-policy', allowKeyboard: false }); await f.host.next('input-policy');
  assert.ok(f.writes.some(w => w.slot === 'p1' && !w.state.buttons.a)); assert.ok(!f.writes.some(w => w.slot === 'p2'));
  keyboard.ws.post({ type: 'input-policy', allowKeyboard: true });
  bridge.post({ type: 'state', peerId: keyboard.peerId, source: 'keyboard', state: { buttons: { b: true } } });
  bridge.post({ type: 'state', peerId: keyboard.peerId, source: 'unknown', state: { buttons: { b: true } } });
  bridge.post({ type: 'state', peerId: gamepad.peerId, source: 'gamepad', state: { buttons: { y: true } } });
  await until(() => f.writes.some(w => w.slot === 'p2' && w.state.buttons.y)); assert.ok(!f.writes.some(w => w.state.buttons.b));
  f.host.post({ type: 'input-policy', allowKeyboard: true }); await f.host.next('input-policy');
  bridge.post({ type: 'state', peerId: keyboard.peerId, source: 'keyboard', state: { buttons: { b: true } } }); await until(() => f.writes.some(w => w.state.buttons.b));
});
test('desktop control defaults off, works without video, aggregates guests, and revokes independently', async t => {
  const states = [], events = []; let started = 0, closed = 0;
  const f = await fixture(t, { staleMs: 1000, createDesktop: async () => { started++; return { display: { width: 1920, height: 1080 }, setState(value) { states.push(value); }, event(value) { events.push(value); }, close() { closed++; } }; } });
  const one = await f.join('p1'), two = await f.join('p2'), bridge = await f.bridge();
  const packet = (peerId, seq, keys, buttons = []) => ({ type: 'desktop-state', peerId, state: { seq, keys, buttons } });
  bridge.post(packet(one.peerId,0,['KeyA'],[0])); await new Promise(resolve => setTimeout(resolve,30)); assert.equal(started,0); assert.equal(states.length,0);
  f.host.post({ type:'input-policy', allowKeyboard:true, desktopMouse:true, desktopKeyboard:true,desktopFullAccess:true });
  const permission = await f.host.next('input-policy'); assert.equal(permission.desktopMouse,true); assert.deepEqual(permission.desktopSize,{width:1920,height:1080}); assert.equal(permission.desktopVideoMatches,false);
  const room = f.app.rooms.get(f.room.roomId); room.native = { peers: new Map([['preview',true]]), sourceSize: { width:1920,height:1080 }, close() {} };
  bridge.post(packet(one.peerId,1,['KeyA'],[0])); bridge.post(packet(two.peerId,1,['KeyA','KeyB'],[2])); await until(() => states.at(-1)?.keys.includes('KeyB'));
  assert.deepEqual(new Set(states.at(-1).buttons),new Set([0,2]));
  bridge.post({ type:'desktop-release', peerId:one.peerId, seq:2 }); await until(() => states.at(-1)?.buttons.length===1); assert.ok(states.at(-1).keys.includes('KeyA'),'Releasing one guest must preserve the other guest’s held key');
  bridge.post(packet(one.peerId,1,['KeyC'])); await new Promise(resolve => setTimeout(resolve,20)); assert.ok(!states.at(-1).keys.includes('KeyC'));
  bridge.post({type:'desktop-move',peerId:two.peerId,seq:1,x:.25,y:.75}); await until(() => events.length>0); assert.deepEqual(events.at(-1),{event:'move',x:.25,y:.75});
  f.host.post({ type:'input-policy',allowKeyboard:true,desktopMouse:false,desktopKeyboard:true }); await f.host.next('input-policy'); assert.deepEqual(states.at(-1).buttons,[]); assert.ok(states.at(-1).keys.includes('KeyB'));
  f.host.post({ type:'native-stop',peerId:'preview',requestId:'stop' }); await f.host.next('native-result'); assert.equal((await f.host.next('input-policy')).desktopKeyboard,true); assert.equal(closed,0);
  f.host.post({type:'input-policy',allowKeyboard:true,desktopMouse:false,desktopKeyboard:false}); assert.equal((await f.host.next('input-policy')).desktopKeyboard,false); assert.equal(closed,1);
});
test('stale inputs, bridge disconnect and player disconnect release held controls', async t => {
  const f = await fixture(t); const p = await f.join(); const bridge = await f.bridge();
  const press = () => bridge.post({ type: 'state', peerId: p.peerId, state: { buttons: { a: true } } });
  f.writes.length = 0; press(); await until(() => f.writes.some(w => w.state.buttons.a));
  await until(() => f.writes.at(-1).state.buttons.a === false);
  f.writes.length = 0; press(); await until(() => f.writes.some(w => w.state.buttons.a)); bridge.close();
  await until(() => f.writes.at(-1).state.buttons.a === false);
  const second = await f.bridge(); f.writes.length = 0;
  second.post({ type: 'state', peerId: p.peerId, state: { buttons: { a: true } } });
  await until(() => f.writes.some(w => w.state.buttons.a)); p.ws.close();
  await until(() => f.writes.at(-1).state.buttons.a === false);
});
test('force assignment updates displaced players, releases old slot, and supports watchers', async t => {
  const f = await fixture(t); const first = await f.join(); const watcher = await f.join('watch');
  f.host.post({ type: 'force-assign', peerId: watcher.peerId, slot: 'p1' });
  assert.equal((await first.ws.next('slot-update')).slot, null);
  assert.equal((await watcher.ws.next('slot-update')).slot, 'p1');
  assert.equal(f.app.rooms.get(f.room.roomId).peers.get(first.peerId).role, 'watch');
});
test('signaling uses authenticated peer identity and routes offers, answers and ICE', async t => {
  const f = await fixture(t); const p = await f.join();
  p.ws.post({ type: 'offer', peerId: 'forged', sdp: { type: 'offer', sdp: 'example' } });
  assert.equal((await f.host.next('offer')).peerId, p.peerId);
  f.host.post({ type: 'answer', peerId: p.peerId, sdp: { type: 'answer', sdp: 'answer' } });
  assert.equal((await p.ws.next('answer')).sdp.sdp, 'answer');
  p.ws.post({ type: 'ice', candidate: { candidate: 'test' } }); assert.equal((await f.host.next('ice')).candidate.candidate, 'test');
});
test('fresh local sessions replace disconnected rooms but cannot replace a live host', async t => {
  const f=await fixture(t), p=await f.join(), replacement=await f.connect();
  replacement.post({type:'create'});assert.match((await replacement.next('error')).error,/already running/);
  const closed=once(f.host,'close');f.host.close();await closed;
  await until(()=>f.app.rooms.get(f.room.roomId)?.hostWs.readyState===WebSocket.CLOSED);
  replacement.post({type:'create'});const next=await replacement.next('created');
  assert.notEqual(next.roomId,f.room.roomId);assert.equal(f.app.rooms.has(f.room.roomId),false);
  await until(()=>p.ws.readyState===WebSocket.CLOSED);
  assert.equal(f.app.rooms.size,1);
});

test('host resume replaces the old host without closing the resumed room', async t => {
  const f = await fixture(t); const p = await f.join(); const replacement = await f.connect();
  replacement.post({ type: 'resume', roomId: f.room.roomId, hostKey: f.room.hostKey });
  const resumed = await replacement.next('resumed'); assert.equal(resumed.peers.length, 1);
  await p.ws.next('host-resumed');
  await until(() => f.host.readyState === WebSocket.CLOSED);
  assert.equal(f.app.rooms.get(f.room.roomId).hostWs.readyState, WebSocket.OPEN);
  replacement.post({ type: 'create' }); assert.match((await replacement.next('error')).error, /Already/);
});
test('rejects foreign origins and unauthenticated injection sockets', async t => {
  const f = await fixture(t);
  await assert.rejects(f.connect('/ws', 'https://foreign.example'));
  const bad = await f.connect('/inject'); const closed = once(bad, 'close'); bad.post({ type: 'auth', roomId: f.room.roomId, token: 'wrong' }); await closed;
  assert.ok(f.app.rooms.get(f.room.roomId).injector);
});
test('driver write failures are reported to the host without crashing the room', async t => {
  const f = await fixture(t); const p = await f.join(); const bridge = await f.bridge();
  f.driver.setState = () => { throw new Error('Device disconnected'); };
  bridge.post({ type: 'state', peerId: p.peerId, state: {} });
  const report = await f.host.next('driver-status'); assert.equal(report.ready, false); assert.match(report.error, /Device disconnected/);
});
test('manual peers register locally and use the same authorized injection and cleanup', async t => {
  const f = await fixture(t); f.host.post({ type: 'register-peer', role: 'p2', requestId: 'manual' });
  const p = await f.host.next('peer-registered'); assert.equal(p.slot, 'p2'); assert.equal(p.requestId, 'manual');
  const bridge = await f.bridge(); f.writes.length = 0;
  bridge.post({ type: 'state', peerId: p.peerId, state: { buttons: { a: true } } });
  await until(() => f.writes.some(w => w.slot === 'p2' && w.state.buttons.a));
  f.host.post({ type: 'kick', peerId: p.peerId }); await f.host.next('peer-left');
  assert.equal(f.app.rooms.get(f.room.roomId).peers.size, 0);
  assert.equal(f.writes.at(-1).state.buttons.a, false);
  f.host.post({ type: 'end' }); await until(() => f.app.rooms.size === 0);
});
test('eight configured players route independently, extra participants watch, and slots are reusable', async t => {
  const f = await fixture(t, { env: { PLAYER_COUNT: '8' }, platform: 'linux' });
  const peers = [];
  for (let i = 0; i < 9; i++) peers.push(await f.join('play'));
  assert.deepEqual(peers.map(p => p.slot), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', null]);
  const bridge = await f.bridge(); f.writes.length = 0;
  bridge.post({ type: 'state', peerId: peers[6].peerId, slot: 'p1', state: { buttons: { a: true } } });
  await until(() => f.writes.some(w => w.slot === 'p7' && w.state.buttons.a));
  peers[3].ws.close(); await f.host.next('peer-left');
  assert.equal((await f.join('play')).slot, 'p4');
});
test('no configured participant limit permits more than the old 24-peer ceiling', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 26; i++) await f.join('watch');
  assert.equal(f.app.rooms.get(f.room.roomId).peers.size, 26);
});
test('an explicit participant cap is enforced for file and server joins', async t => {
  const f = await fixture(t, { env: { MAX_PEERS: '1' } }); await f.join();
  f.host.post({ type: 'register-peer', role: 'play', requestId: 'full' }); assert.equal((await f.host.next('error')).error, 'Room full');
  const extra = await f.connect(); extra.post({ type: 'join', roomId: f.room.roomId, role: 'watch' }); assert.equal((await extra.next('error')).error, 'Room full');
});
test('fallback authenticates one invited peer, routes signaling, and revokes access on removal', async t => {
  const f = await fixture(t, { env: { PUBLIC_URL: 'https://play.example.com', SIGNALING_FALLBACK: '1' } });
  f.host.post({ type: 'register-peer', role: 'p4', requestId: 'fallback' }); const p = await f.host.next('peer-registered');
  assert.equal(p.slot, 'p4'); assert.equal(p.fallback.token.length, 64);
  const bad = await f.connect('/fallback', 'http://localhost:1234'); const denied = once(bad, 'close');
  bad.post({ type: 'auth', ...p.fallback, token: 'wrong' }); await denied;
  const ws = await f.connect('/fallback', 'http://localhost:1234'); ws.post({ type: 'auth', ...p.fallback });
  await ws.next('ready'); assert.equal((await f.host.next('fallback-connected')).peerId, p.peerId);
  ws.post({ type: 'restart', peerId: 'forged' }); assert.equal((await f.host.next('fallback-restart')).peerId, p.peerId);
  f.host.post({ type: 'fallback-offer', peerId: p.peerId, id: 'update', sdp: { type: 'offer', sdp: 'v=0' }, ice: { iceServers: [] } });
  assert.equal((await ws.next('offer')).slot, 'p4');
  ws.post({ type: 'answer', peerId: 'forged', id: 'update', sdp: { type: 'answer', sdp: 'v=0' } });
  assert.equal((await f.host.next('fallback-answer')).peerId, p.peerId);
  f.writes.length = 0; ws.post({ type: 'state', slot: 'p4', state: { buttons: { a: true } } });
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(f.writes.length, 0);
  f.host.post({ type: 'kick', peerId: p.peerId }); await f.host.next('peer-left'); await until(() => ws.readyState === WebSocket.CLOSED);
  const stale = await f.connect('/fallback'); const closed = once(stale, 'close'); stale.post({ type: 'auth', ...p.fallback }); await closed;
});


test('adaptive groups grow past four and sixty-four, reuse freed slots, and XInput-only retains its own limit',async t=>{
  const devices=new Set(),writes=[];
  const f=await fixture(t,{platform:'win32',createMessage:{type:'create',controllerType:'auto',dynamicControllers:true},createInjector:async ({playerCount})=>{
    assert.equal(playerCount,0);return {async addController(slot){devices.add(slot);},async removeController(slot){devices.delete(slot);},setState(slot,state){writes.push({slot,state});},close(){devices.clear();}};
  }});
  assert.equal(f.room.config.adaptiveControllers,true);assert.equal(f.room.config.maxRemoteControllers,null);assert.deepEqual(f.room.config.slots,[]);
  const one=await f.join('play'),two=await f.join('play'),watch=await f.join('watch');
  for(const count of [16,32,48,64,70]){f.host.post({type:'controller-count',peerId:one.peerId,count});const update=await f.host.next('slot-update');assert.equal(update.slots.length,count);assert.equal(update.capacity,null);}
  assert.equal(devices.size,70);assert.ok(devices.has('p70'));
  f.host.post({type:'controller-count',peerId:watch.peerId,count:2});
  f.host.post({type:'controller-count',peerId:two.peerId,count:3});let assigned=await f.host.next('slot-update');assert.deepEqual(assigned.slots,['p71','p72','p73']);
  const bridge=await f.bridge();bridge.post({type:'state',peerId:two.peerId,controller:2,generation:assigned.generation,source:'gamepad',state:{buttons:{a:true}}});
  await until(()=>writes.some(w=>w.slot==='p73' && w.state.buttons.a));
  f.host.post({type:'controller-remove',peerId:two.peerId,controller:1,generation:assigned.generation});await f.host.next('slot-update');await until(()=>!devices.has('p72'));
  f.host.post({type:'controller-count',peerId:one.peerId,count:71});assigned=await f.host.next('slot-update');assert.equal(assigned.slots.at(-1),'p72');
  assert.equal(f.app.rooms.get(f.room.roomId).peers.get(watch.peerId).slots.length,0);
  const x=await fixture(t,{platform:'win32',createMessage:{type:'create',controllerType:'x360',dynamicControllers:true}});
  assert.equal(x.room.config.adaptiveControllers,false);assert.equal(x.room.config.maxRemoteControllers,4);
});

test('additional native views are independent, lazy, video-only and cleaned up on removal or room end',async t=>{
  const calls=[];let serial=0;
  class Media extends EventEmitter{
    constructor(env){super();this.number=++serial;this.env=env;}
    async offer(id,q){calls.push(['offer',this.number,id,this.env.NATIVE_WINDOW_HANDLE,this.env.NATIVE_AUDIO]);return {sdp:{type:'offer',sdp:'fixture'}};}
    async answer(id){calls.push(['answer',this.number,id]);}
    async closePeer(id){calls.push(['peer-close',this.number,id]);}
    close(){calls.push(['close',this.number]);}
  }
  const targets=[{kind:'window',id:'123',pid:42,processStart:'first',label:'Game'},{kind:'window',id:'456',pid:43,processStart:'second',label:'Scoreboard'}];
  const f=await fixture(t,{getCaptureTargets:async()=>targets,createNativeMedia:env=>new Media(env)}),peer=await f.join();
  const command=async(type,values={})=>{f.host.post({type,peerId:peer.peerId,requestId:type,...values});return f.host.next('native-result');};
  const a=(await command('native-source-add',{id:'123'})).result,b=(await command('native-source-add',{id:'456'})).result;
  assert.notEqual(a.sourceId,b.sourceId);assert.equal(calls.length,0,'Adding a view does not start capture or encoding');
  const q={width:1280,height:720,frameRate:60,maxBitrate:5000000};
  await command('native-offer',{sourceId:a.sourceId,quality:q});await command('native-offer',{sourceId:b.sourceId,quality:q});
  assert.deepEqual(calls.filter(c=>c[0]==='offer').map(c=>c.slice(3)),[['123','0'],['456','0']]);
  assert.equal((await command('native-audio',{sourceId:a.sourceId,enabled:true})).error,'Additional screens use video only');
  await command('native-answer',{sourceId:b.sourceId,sdp:{type:'answer',sdp:'fixture'}});assert.deepEqual(calls.at(-1),['answer',2,peer.peerId]);
  await command('native-source-remove',{sourceId:a.sourceId});assert.deepEqual(calls.at(-1),['close',1]);
  assert.match((await command('native-offer',{sourceId:a.sourceId,quality:q})).error,/no longer/);
  targets[1]={...targets[1],pid:999};assert.match((await command('native-offer',{sourceId:b.sourceId,quality:q})).error,/changed/);
  f.host.post({type:'end'});await until(()=>calls.some(c=>c[0]==='close' && c[1]===2));
});

test('host role stops local input blocking before opening a virtual controller driver',async t=>{
  const order=[];const f=await fixture(t,{guestInputService:{capability:{available:false},async setHosting(active){order.push(active?'release input':'allow guest');},close(){}},createInjector:async()=>{assert.deepEqual(order,['release input']);order.push('host driver');return {name:'Recording',setState(){},close(){}};}});
  f.host.post({type:'end'});await until(()=>order.includes('allow guest'));
});

test('viewing an additional screen blocks desktop input for that guest while preserving controllers',async t=>{
  const events=[];
  const f=await fixture(t,{desktopSimulation:true,createDesktop:async()=>Object.assign(new EventEmitter(),{simulatedSurface:true,display:{width:1280,height:720},setState(){},event(value){events.push(value);},close(){}})}),peer=await f.join(),bridge=await f.bridge();
  f.host.post({type:'input-policy',allowKeyboard:true,desktopMouse:true,desktopKeyboard:false,desktopFullAccess:true});await f.host.next('input-policy');
  bridge.post({type:'desktop-move',peerId:peer.peerId,seq:1,x:.1,y:.2});await until(()=>events.length===1);
  f.host.post({type:'peer-view',peerId:peer.peerId,additional:true});await until(()=>f.app.rooms.get(f.room.roomId).peers.get(peer.peerId).viewOnly===true);events.length=0;f.writes.length=0;
  bridge.post({type:'desktop-move',peerId:peer.peerId,seq:2,x:.8,y:.9});bridge.post({type:'state',peerId:peer.peerId,state:{buttons:{a:true}}});
  await until(()=>f.writes.some(w=>w.state.buttons.a));assert.equal(events.length,0,'The extra view cannot move or click on the main desktop surface');
  f.host.post({type:'peer-view',peerId:peer.peerId,additional:false});await until(()=>!f.app.rooms.get(f.room.roomId).peers.get(peer.peerId).viewOnly);
  bridge.post({type:'desktop-move',peerId:peer.peerId,seq:3,x:.3,y:.4});await until(()=>events.length===1);
});


test('crop selection revokes desktop access and native pop-outs have separate peer identities',async t=>{
  const calls=[];
  class Media extends EventEmitter {
    constructor(env){super();this.env=env;this.sourceSize=env.NATIVE_CAPTURE_REGION?{width:641,height:361}:{width:1920,height:1080};}
    async offer(id){calls.push(['offer',id,this.env.NATIVE_CAPTURE_REGION]);return {sdp:{type:'offer',sdp:'fixture'},ice:{iceServers:[]},sourceSize:this.sourceSize};}
    async answer(id){calls.push(['answer',id]);}
    async closePeer(id){calls.push(['close-peer',id]);}
    close(){}
  }
  const f=await fixture(t,{platform:'win32',getCaptureTargets:async()=>[{kind:'desktop',id:'desktop',width:1920,height:1080,label:'Screen'}],createNativeMedia:env=>new Media(env)}),peer=await f.join();
  const command=async(type,values={})=>{f.host.post({type,peerId:peer.peerId,requestId:type,...values});return f.host.next('native-result');};
  const region={x:17,y:23,width:641,height:361};
  assert.ok(!(await command('capture-source',{kind:'native',id:'desktop',audio:false,region})).error);
  let policy=await f.host.next('input-policy');assert.equal(policy.desktopMouse,false);assert.equal(policy.desktopVideoMatches,false);
  f.host.post({type:'input-policy',allowKeyboard:true,desktopMouse:true,desktopKeyboard:false,desktopFullAccess:true});assert.match((await f.host.next('error')).error,/selected area/);
  const quality={width:1280,height:720,frameRate:60,maxBitrate:5000000};
  await command('native-offer',{quality});await command('native-offer',{quality,viewer:true});
  assert.deepEqual(calls.filter(c=>c[0]==='offer').map(c=>c[1]),[peer.peerId,`${peer.peerId}:view:main`]);
  assert.equal(calls[0][2],'17,23,641,361');
  await command('native-answer',{viewer:true,sdp:{type:'answer',sdp:'fixture'}});assert.deepEqual(calls.at(-1),['answer',`${peer.peerId}:view:main`]);
  await command('native-close',{viewer:true});assert.deepEqual(calls.at(-1),['close-peer',`${peer.peerId}:view:main`]);
  assert.match((await command('capture-source',{kind:'native',id:'desktop',region:{x:1900,y:0,width:100,height:100}})).error,/outside/);
  assert.ok(!(await command('capture-source',{kind:'browser',surface:'monitor',label:'screen:0:fixture',region})).error);await f.host.next('input-policy');
  f.host.post({type:'input-policy',allowKeyboard:true,desktopMouse:false,desktopKeyboard:true,desktopFullAccess:false});assert.match((await f.host.next('error')).error,/selected area/);
});


test('extra window input requires explicit host approval, binds each view and rejects stale view tokens',async t=>{
  const targets=[{kind:'window',id:'101',pid:1,label:'A',width:800,height:600},{kind:'window',id:'202',pid:2,label:'B',width:700,height:500},{kind:'desktop',id:'desktop',label:'Screen'}],helpers=[];
  const f=await fixture(t,{platform:'win32',staleMs:5000,getCaptureTargets:async()=>targets,createDesktop:async()=>{
    const helper=Object.assign(new EventEmitter(),{display:{width:800,height:600},states:[],events:[],async setScope(scope){this.scope=scope;},setState(value){this.states.push(value);},event(value){this.events.push(value);},close(){this.closed=true;}});helpers.push(helper);return helper;
  }}),peer=await f.join(),bridge=await f.bridge();
  const command=async(type,values={})=>{f.host.post({type,requestId:type,...values});return f.host.next('native-result');};
  const a=(await command('native-source-add',{id:'101'})).result.sourceId,b=(await command('native-source-add',{id:'202'})).result.sourceId;
  const room=f.app.rooms.get(f.room.roomId),member=room.peers.get(peer.peerId);
  const select=async(sourceId,token)=>{f.host.post({type:'peer-control-view',peerId:peer.peerId,sourceId,token});await until(()=>member.desktopToken===token);};
  const state=(sourceId,token,seq)=>bridge.post({type:'desktop-state',peerId:peer.peerId,sourceId,desktopToken:token,state:{seq,keys:['KeyA'],buttons:[0],x:.5,y:.5}});
  await select(a,'one');state(a,'one',1);await new Promise(r=>setTimeout(r,40));assert.equal(helpers.length,0);
  assert.equal((await command('native-window-control',{sourceId:a,enabled:true})).result.policy.desktopScope,'window');
  assert.equal(helpers[0].scope.id,'101');state(a,'one',2);await until(()=>helpers[0].states.some(s=>s.keys.includes('KeyA')));
  assert.ok(!(await command('native-window-control',{sourceId:b,enabled:true})).error);
  await select(b,'two');assert.deepEqual(helpers[0].states.at(-1).keys,[]);
  state(a,'one',3);state(b,'one',4);await new Promise(r=>setTimeout(r,40));assert.equal(helpers[1].states.some(s=>s.keys.includes('KeyA')),false);
  state(b,'two',5);await until(()=>helpers[1].states.some(s=>s.keys.includes('KeyA')));
  await select(a,'three');const n=helpers[0].states.length;state(a,'one',6);await new Promise(r=>setTimeout(r,40));assert.equal(helpers[0].states.length,n);
  helpers[0].emit('scope-lost');const revoked=await f.host.next('view-input-policy');assert.equal(revoked.policy.desktopMouse,false);assert.equal(helpers[0].closed,true);
  const screen=(await command('native-source-add',{id:'desktop'})).result.sourceId;assert.match((await command('native-window-control',{sourceId:screen,enabled:true})).error,/native window/);
  await command('native-source-remove',{sourceId:b});assert.equal(helpers[1].closed,true);
});

test('Windows cropped native windows pass bounded input areas while full-desktop permission remains denied',async t=>{
  const scopes=[],target={kind:'window',id:'123',pid:7,label:'Cropped app',width:800,height:600};
  const f=await fixture(t,{platform:'win32',getCaptureTargets:async()=>[target],createDesktop:async()=>Object.assign(new EventEmitter(),{display:{width:320,height:200},async setScope(scope){scopes.push(scope);},setState(){},close(){}})});
  const region={x:100,y:150,width:320,height:200};
  f.host.post({type:'capture-source',kind:'native',id:target.id,region,requestId:'crop'});await f.host.next('native-result');await f.host.next('input-policy');
  f.host.post({type:'input-policy',allowKeyboard:true,desktopMouse:true,desktopKeyboard:true});const policy=await f.host.next('input-policy');
  assert.equal(policy.desktopMouse,true);assert.equal(policy.desktopVideoMatches,true);assert.deepEqual(scopes.at(-1).region,region);
  f.host.post({type:'input-policy',allowKeyboard:true,desktopMouse:true,desktopFullAccess:true});assert.match((await f.host.next('error')).error,/selected area/);
});


test('closing the host while an extra window helper starts cannot leave input enabled',async t=>{
  let release,entered;const started=new Promise(resolve=>entered=resolve);
  const helper=Object.assign(new EventEmitter(),{display:{width:800,height:600},async setScope(){},setState(){},close(){this.closed=true;}});
  const f=await fixture(t,{platform:'win32',getCaptureTargets:async()=>[{kind:'window',id:'12',pid:3,label:'Test',width:800,height:600}],createDesktop:async()=>{entered();return new Promise(resolve=>release=resolve);}});
  f.host.post({type:'native-source-add',id:'12',requestId:'source'});const sourceId=(await f.host.next('native-result')).result.sourceId;
  f.host.post({type:'native-window-control',sourceId,enabled:true,requestId:'enable'});await started;
  f.host.close();await once(f.host,'close');release(helper);await until(()=>helper.closed===true);
  assert.notEqual(f.app.rooms.get(f.room.roomId)?.extraCaptures?.get(sourceId)?.desktopMouse,true);
});
