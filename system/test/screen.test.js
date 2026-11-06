import {test} from 'node:test';import assert from 'node:assert/strict';
import {screenSettings,screenLimit,boundedScreen,screenBudget} from '../public/screen-quality.js';
import {ScreenRoom} from '../public/screen-room.js';import {CameraRoom} from '../public/camera.js';
test('screen settings and host ceilings remain independent from camera limits',()=>{
 assert.deepEqual(screenSettings(),{height:1080,fps:60,bitrate:8000000,automatic:true,priority:'motion'});assert.equal(screenSettings({fps:Infinity,height:-1,bitrate:NaN}).height,1080);assert.equal(screenLimit({fps:60,height:2160}).fps,60);
 assert.deepEqual(boundedScreen(screenSettings({height:2160,fps:120,bitrate:20000000}),{height:720,fps:30,bitrate:4000000}),{height:720,fps:30,bitrate:4000000,automatic:true,priority:'motion'});
});
test('screen upload budgets are shared, back off promptly and recover cautiously; manual mode holds its limits',()=>{
 const settings=screenSettings();let budget=screenBudget({}, {},settings,3);assert.ok(budget.bitrate*3<=settings.bitrate);budget=screenBudget(budget,{bufferMs:90},settings,3);assert.equal(budget.level,1);budget=screenBudget(budget,{loss:.2},settings,3);assert.equal(budget.height,1080);
 for(let n=0;n<5;n++)budget=screenBudget(budget,{},settings,3);assert.equal(budget.level,2);budget=screenBudget(budget,{},settings,3);assert.equal(budget.level,1);const manual=screenBudget(budget,{bufferMs:90},screenSettings({automatic:false}),2);assert.equal(manual.level,0);assert.equal(manual.fps,60);assert.equal(manual.bitrate,4000000);
});
test('screen SDP accepts screen video plus audio, while camera SDP stays video-only',()=>{
 const sdp={type:'offer',sdp:'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'};assert.equal(ScreenRoom.prototype.validDescription(sdp),true);assert.equal(CameraRoom.prototype.validDescription(sdp),false);assert.equal(ScreenRoom.prototype.validDescription({...sdp,sdp:sdp.sdp+'m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'}),false);
});

test('screen dimensions survive transient pressure and recipient changes; fixed quality clears backoff',()=>{
 const settings=screenSettings();let budget=screenBudget({}, {},settings,1,true,0);
 for(let now=2000;now<=4000;now+=2000)budget=screenBudget(budget,{loss:.2},settings,1,true,now);
 assert.equal(budget.height,1080);
 budget=screenBudget(budget,{loss:.2},settings,1,true,6000);assert.equal(budget.height,720);
 const changed=screenBudget(budget,{},settings,3,false,8000);assert.equal(changed.height,720);assert.ok(changed.bitrate<budget.bitrate);
 const fixed=screenBudget(changed,{loss:.4},screenSettings({automatic:false}),1,true,9000);assert.equal(fixed.height,1080);
});
