import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {GuestInputService,guestInputCapability} from '../src/guest-input.js';
class Socket extends EventEmitter{readyState=1;bufferedAmount=0;messages=[];send(value){this.messages.push(JSON.parse(value));}post(value){this.emit('message',JSON.stringify(value));}}
function reader(){const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null});child.commands=[];let data='';child.stdin.on('data',part=>{data+=part;for(let end;(end=data.indexOf('\n'))>=0;){child.commands.push(JSON.parse(data.slice(0,end)));data=data.slice(end+1);}});child.kill=()=>{child.exitCode=1;child.emit('exit',1);};child.say=value=>child.stdout.write(JSON.stringify(value)+'\n');return child;}
test('native guest lease isolates ownership, validates selected devices, and releases on lost round trips or page close',t=>{
  let time=100,child;const service=new GuestInputService({capability:{available:true},launch:()=>child=reader(),now:()=>time,leaseMs:1000});t.after(()=>service.close());
  const a=new Socket(),b=new Socket();service.attach(a);service.attach(b);a.post({type:'list'});
  child.say({type:'devices',devices:[{id:'keyboard:1',available:true},{id:'mouse:11',available:true},{id:'pad:1',available:false}]});child.say({type:'ready'});
  a.post({type:'start',connected:true,devices:['pad:1']});assert.match(a.messages.at(-1).error,/available devices/);assert.equal(child.commands.length,0);
  a.post({type:'start',connected:false,devices:['keyboard:1']});assert.match(a.messages.at(-1).error,/Connect/);
  a.post({type:'start',connected:true,devices:['keyboard:1','keyboard:1']});assert.match(a.messages.at(-1).error,/available devices/);
  a.post({type:'start',connected:true,devices:['keyboard:1','mouse:11']});assert.deepEqual(child.commands.at(-1),{type:'start',devices:['keyboard:1','mouse:11']});child.say({type:'active',devices:['keyboard:1','mouse:11']});
  b.post({type:'stop'});assert.match(b.messages.at(-1).error,/Another local window/);assert.equal(service.active,true);
  time=900;a.post({type:'heartbeat',connected:true});assert.equal(child.commands.at(-1).type,'heartbeat');
  time=1500;service.tick();assert.equal(service.active,true);
  a.post({type:'heartbeat',connected:false});time=2001;service.tick();assert.equal(service.active,false);assert.equal(child.stdin.writableEnded,true);assert.match(a.messages.at(-1).reason,/stopped responding/);
  a.post({type:'list'});const second=child;child.say({type:'devices',devices:[{id:'keyboard:1',available:true}]});child.say({type:'ready'});a.post({type:'start',connected:true,devices:['keyboard:1']});a.emit('close');assert.equal(second.stdin.writableEnded,true);assert.equal(service.owner,null);
});
test('native guest reader failures, congested local delivery and unsupported platforms fail without browser fallback',t=>{
  assert.equal(guestInputCapability('freebsd').available,false);let child;const service=new GuestInputService({capability:{available:true},launch:()=>child=reader()});t.after(()=>service.close());
  const ws=new Socket();service.attach(ws);ws.post({type:'list'});child.say({type:'devices',devices:[]});ws.bufferedAmount=100000;child.say({type:'state',gamepads:[]});assert.equal(child.stdin.writableEnded,true);assert.equal(service.active,false);
  const noDriver=new GuestInputService({capability:{available:false,error:'Install the optional reader'},launch:()=>assert.fail('must not start a helper')});t.after(()=>noDriver.close());const denied=new Socket();noDriver.attach(denied);denied.post({type:'start',connected:true,devices:['mouse:11']});assert.equal(denied.messages.at(-1).error,'Install the optional reader');
});

test('local controller reservation works without a call but cannot capture keyboard/mouse or outlive its page lease',t=>{
  let time=0,child;const service=new GuestInputService({capability:{available:true},launch:()=>child=reader(),now:()=>time,leaseMs:1000});t.after(()=>service.close());
  const ws=new Socket(),other=new Socket();service.attach(ws);service.attach(other);ws.post({type:'list'});
  child.say({type:'devices',devices:[{id:'pad:1',kind:'gamepad',available:true},{id:'keyboard:1',kind:'keyboard',available:true},{id:'mouse:11',kind:'mouse',available:true}]});child.say({type:'ready'});
  ws.post({type:'start',local:true,connected:false,devices:['keyboard:1']});assert.match(ws.messages.at(-1).error,/controllers only/);
  ws.post({type:'start',local:true,connected:false,devices:['mouse:11']});assert.match(ws.messages.at(-1).error,/controllers only/);
  ws.post({type:'start',local:true,connected:false,devices:['pad:1']});child.say({type:'active',devices:['pad:1']});assert.equal(service.active,true);assert.equal(ws.messages.at(-1).local,true);
  time=800;ws.post({type:'heartbeat',local:true,connected:false});time=1500;service.tick();assert.equal(service.active,true,'No remote call is required');
  other.post({type:'stop'});assert.equal(service.active,true,'Another page cannot release the reservation');
  time=1900;service.tick();assert.equal(service.active,false);assert.equal(child.stdin.writableEnded,true,'Missing local heartbeat releases the reader');
});

test('hosting releases every local guest reservation and rejects reacquisition from other tabs',async t=>{
  let child,launches=0;const service=new GuestInputService({capability:{available:true},launch:()=>{launches++;return child=reader();}});t.after(()=>service.close());
  const guest=new Socket(),other=new Socket();service.attach(guest);service.attach(other);guest.post({type:'list'});
  child.say({type:'devices',devices:[{id:'pad:1',kind:'gamepad',available:true}]});child.say({type:'ready'});guest.post({type:'start',local:true,devices:['pad:1']});child.say({type:'active'});
  const stopping=service.stop();let complete=false;const hosting=service.setHosting(true).then(()=>{complete=true;});
  await Promise.resolve();assert.equal(complete,false,'Wait for the already-stopping helper to exit before starting a host driver');assert.equal(child.stdin.writableEnded,true);
  for(const type of ['list','identify','start','heartbeat'])other.post({type,local:true,devices:['pad:1']});
  assert.equal(launches,1);assert.deepEqual(other.messages.at(-1),{type:'hosting',active:true});
  child.kill();await stopping;await hosting;assert.equal(complete,true);
  const later=new Socket();service.attach(later);assert.deepEqual(later.messages.at(-1),{type:'hosting',active:true});
  await service.setHosting(false);other.post({type:'list'});assert.equal(launches,2,'Guest input is available again after the last host session ends');child.kill();
});
