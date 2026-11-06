import {GuestTiles} from '../public/guest-tiles.js';
import {mediaCaption,accessCaption,controllersReady} from '../public/call-comfort.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readiness,guestCaption,cleanGuestView,ReconnectGrace,rememberControls,readPreference,writePreference} from '../public/call-comfort.js';

test('controller onboarding respects viewers, desktop sessions and every connected player',()=>{
  const player={state:'connected',wantsController:true,count:1},waiting={...player,count:0},viewer={...waiting,wantsController:false};
  assert.equal(controllersReady([]),false);
  assert.equal(controllersReady([viewer]),true);
  assert.equal(controllersReady([player,waiting]),false,'One joined player must not hide instructions needed by another guest');
  assert.equal(controllersReady([player,viewer]),true);
  assert.equal(controllersReady([waiting],{desktopControl:true}),true,'Desktop sharing does not require a gamepad');
  assert.equal(controllersReady([{...waiting,error:true}],{desktopControl:true}),false,'An actual controller setup failure stays visible');
  assert.equal(controllersReady([{...waiting,state:'new'}]),false);
});

test('setup checks respect controller-only sessions and never imply uncaptured sound is ready',()=>{
  const rows=readiness({side:'host',driver:null,picture:false,audio:false});
  assert.equal(rows[0].value,'Checked when room starts');assert.equal(rows[1].level,'optional');assert.equal(rows[2].level,'optional');
  const failed=readiness({side:'host',driver:false,picture:true,audio:false});assert.equal(failed[0].fix,'driverStatus');assert.equal(failed[2].value,'No audio captured');
  assert.equal(readiness({side:'client',count:3,connected:true,picture:true})[1].value,'3 detected');
  assert.equal(guestCaption({state:'connected',count:3}),'3 controllers playing');assert.equal(guestCaption({state:'connected',count:1,enabled:false}),'1 controller paused');assert.equal(guestCaption({state:'connected',count:0,wantsController:false}),'Watching');
  assert.equal(guestCaption({state:'connected',detected:1}),'1 controller detected · not joined');
  assert.equal(guestCaption({state:'connected',detected:3}),'3 controllers detected · not joined');
  assert.equal(guestCaption({state:'connected',detected:3,enabled:false}),'Controller sharing paused');
  assert.equal(guestCaption({state:'connected',detected:1,setupRequired:true}),'Guest controller setup needed');
});
test('guest view accepts only small JPEG data and bounded numeric measurements',()=>{
  const clean=cleanGuestView({image:'javascript:alert(1)',metrics:{width:Infinity,height:-100,fps:'secret',bufferMs:1e9},audio:{loss:100,receiving:1,muted:true},password:'secret'});
  assert.equal(clean.image,null);assert.equal(clean.metrics.width,null);assert.equal(clean.metrics.height,0);assert.equal(clean.metrics.fps,null);assert.equal(clean.metrics.bufferMs,10000);assert.equal(clean.audio.loss,1);assert.equal(clean.audio.receiving,false);assert.equal(clean.audio.muted,true);assert.ok(!('password' in clean));
  assert.equal(cleanGuestView({image:'data:image/jpeg;base64,a'}).image,null);assert.equal(cleanGuestView({image:'data:image/jpeg;base64,YWJj'}).image,'data:image/jpeg;base64,YWJj');assert.equal(cleanGuestView({image:'data:image/jpeg;base64,'+'a'.repeat(15000)}).image,null);
});
test('brief outages recover once, expiry is bounded and ending cancels recovery',async()=>{
  const calls=[],grace=new ReconnectGrace({duration:15,waiting:()=>calls.push('waiting'),recovered:()=>calls.push('recovered'),expired:()=>calls.push('expired')});
  grace.update('disconnected');grace.update('disconnected');grace.update('connected');await new Promise(r=>setTimeout(r,25));assert.deepEqual(calls,['waiting','recovered']);
  grace.update('disconnected');await new Promise(r=>setTimeout(r,25));grace.update('disconnected');assert.deepEqual(calls,['waiting','recovered','waiting','expired']);grace.update('connected');assert.equal(calls.at(-1),'recovered');
  grace.update('disconnected');grace.update('closed');await new Promise(r=>setTimeout(r,25));assert.equal(calls.at(-1),'waiting');
});
test('preferences restore supported choices and tolerate unavailable browser storage',()=>{
  const previous=globalThis.localStorage,values=new Map();globalThis.localStorage={getItem:key=>values.get(key) ?? null,setItem:(key,value)=>values.set(key,value)};
  try{writePreference('camera:fps','24');writePreference('camera:watch',false);writePreference('camera:device','old-camera');const handlers={};const elements={fps:{tagName:'SELECT',value:'10',options:[{value:'10'},{value:'24'}],addEventListener:(_,fn)=>handlers.fps=fn},watch:{type:'checkbox',checked:true,addEventListener:()=>{}},device:{tagName:'SELECT',value:'default',options:[{value:'default'}],addEventListener:()=>{}}};
    rememberControls({querySelector:selector=>elements[selector.match(/="([^"]+)"/)[1]]},'camera',['fps','watch','device']);assert.equal(elements.fps.value,'24');assert.equal(elements.watch.checked,false);assert.equal(elements.device.value,'default');elements.fps.value='10';handlers.fps();assert.equal(readPreference('camera:fps'),'10');
    globalThis.localStorage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};assert.equal(readPreference('x','default'),'default');assert.doesNotThrow(()=>writePreference('x',true));
  }finally{globalThis.localStorage=previous;}
});

test('remembered multi-view layout resumes only with multiple sources and updates input scope',()=>{
  const changed=[],tiles=Object.create(GuestTiles.prototype);Object.assign(tiles,{mode:'single',preferred:'stacked',cameras:[],liveScreens:[],primary:'game',featured:'game',render(){},changed:(...args)=>changed.push(args)});
  tiles.update({selected:'game',sources:[{id:'game',label:'Game'}]});assert.equal(tiles.active,false);assert.equal(tiles.preferred,'stacked');
  tiles.update({selected:'game',sources:[{id:'game',label:'Game'},{id:'second',label:'Second screen'}]});assert.equal(tiles.mode,'stacked');assert.deepEqual(changed.at(-1),[true,'game']);
  tiles.update({selected:'game',sources:[{id:'game',label:'Game'}]});assert.equal(tiles.mode,'single');assert.equal(tiles.preferred,'stacked');assert.deepEqual(changed.at(-1),[false,'game']);
  tiles.update({selected:'game',sources:[{id:'game',label:'Game'},{id:'new',label:'New window'}]});assert.equal(tiles.mode,'stacked');
  tiles.liveScreens=[{id:'screen-guest',label:'Guest screen',stream:{}}];tiles.update({selected:'',sources:[]});assert.equal(tiles.active,true);assert.equal(tiles.localSingle,'screen-guest');assert.deepEqual(changed.at(-1),[true,'screen-guest']);
});

test('call status distinguishes live media, listening, pointers and actual desktop access',()=>{
  assert.equal(mediaCaption(),'Camera off · Mic off');
  assert.equal(mediaCaption({camera:true,voice:true}),'Camera sharing · Mic muted');
  assert.equal(mediaCaption({mic:true}),'Camera off · Mic on');
  assert.equal(mediaCaption({camera:'true',mic:1}),'Camera off · Mic off');
  assert.equal(accessCaption(),'Desktop control off · guest cursors off');
  assert.equal(accessCaption({pointers:true}),'Guest cursors only · no desktop control');
  assert.equal(accessCaption({scope:'window',mouse:true,pointers:true}),'Window control · system mouse · colored cursors');
  assert.equal(accessCaption({scope:'desktop',mouse:true,keyboard:true}),'Desktop control · system mouse + typing');
});
