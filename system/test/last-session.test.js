import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanLastSession,loadLastSession,storeLastSession,matchLastSource,sessionPage,browserSourceLabel} from '../public/last-session.js';
test('automatic setup memory keeps share choices and excludes desktop permissions, captures and private connection data',()=>{
  const saved=cleanLastSession({version:1,fields:{captureBackend:'native',nativeCaptureAudio:false,hostAudioOnly:false,streamFramerate:'60',hostAllowGuestVideo:false,hostControllerCount:'3',hostDesktopMouse:true,hostDesktopScope:'desktop',hostCallMic:true,hostCallCamera:true,TURN_PASSWORD:'secret'},source:{kind:'window',label:'Game',id:'123',pid:42,token:'private'},area:{x:10,y:20,width:640,height:360},bounds:{width:1280,height:720}});
  assert.deepEqual(saved.fields,{captureBackend:'native',streamFramerate:'60',nativeCaptureAudio:false,hostAudioOnly:false,hostAllowGuestVideo:false,hostControllerCount:'3'});
  assert.deepEqual(saved.source,{kind:'window',label:'Game'});assert.deepEqual(saved.area,{x:10,y:20,width:640,height:360});
  assert.ok(!JSON.stringify(saved).includes('secret'));assert.equal(cleanLastSession({version:2}),null);
});
test('last sources must be unique; invalid areas stay marked for review instead of expanding to full source',()=>{
  const source={kind:'window',label:'Game'},a={...source,id:'1'},b={...source,id:'2'};
  assert.equal(matchLastSource(source,[a]),a);assert.equal(matchLastSource(source,[a,b]),null);assert.equal(matchLastSource(source,[]),null);
  const saved=cleanLastSession({version:1,fields:{streamResolution:'9999',captureBackend:'execute'},source,area:{x:0,y:0,width:9999,height:720},bounds:{width:1280,height:720}});
  assert.deepEqual(saved.fields,{});assert.equal(saved.area,null);assert.equal(saved.needsAreaReview,true);assert.equal(cleanLastSession(saved).needsAreaReview,true);
});
test('setup storage is optional and round-trips without named profiles',()=>{
  let data;const storage={setItem:(key,value)=>{data=value;},getItem:()=>data};
  storeLastSession({version:1,fields:{nativeCaptureAudio:true},source:{kind:'desktop',label:'Main screen'}},storage);
  assert.equal(loadLastSession(storage).fields.nativeCaptureAudio,true);
  assert.equal(loadLastSession({getItem(){throw Error('blocked');}}),null);assert.doesNotThrow(()=>storeLastSession({version:1,fields:{}},{setItem(){throw Error('blocked');}}));
  storeLastSession({version:1,fields:{streamMinimumResolution:'720',hostAutoThrottle:false}},storage);
  assert.deepEqual(loadLastSession(storage).fields,{streamMinimumResolution:'720',hostAutoThrottle:false});
});
test('the last page is remembered unless a host/join shortcut or invitation explicitly chooses a page',()=>{
  assert.equal(sessionPage('/?ui=call','client'),'client');assert.equal(sessionPage('/','invalid'),'host');
  assert.equal(sessionPage('/?mode=host','client'),'host');assert.equal(sessionPage('/?mode=join','host'),'client');assert.equal(sessionPage('/?room=abc','host'),'client');assert.equal(sessionPage('/#invite=abc','host'),'client');
});
test('remembered browser sources use readable names instead of opaque track identifiers',()=>{
  assert.equal(browserSourceLabel('abcdefgh12345678'.repeat(5),'window'),'Browser window');assert.equal(browserSourceLabel('screen:0:0','monitor'),'Browser screen');assert.equal(browserSourceLabel('My emulator','window'),'My emulator');
});
