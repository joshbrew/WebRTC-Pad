import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureRegion} from '../src/capture-region.js';
import {captureArguments,NativeMedia} from '../src/native-media.js';
import {effectiveQuality} from '../public/quality.js';

test('capture areas validate integer pixel bounds and reject invalid sources',()=>{
  assert.equal(captureRegion(null),null);assert.deepEqual(captureRegion('17,23,641,361'),{x:17,y:23,width:641,height:361});
  for(const value of ['1,2,3,4:unsafe',{}, {x:0,y:0,width:NaN,height:20},{x:-1,y:0,width:20,height:20},{x:0,y:0,width:1,height:20},{x:32000,y:0,width:1000,height:20},{x:0.5,y:0,width:20,height:20}])assert.throws(()=>captureRegion(value));
  assert.throws(()=>captureRegion({x:90,y:0,width:20,height:20},{width:100,height:100}),/outside/);
});
test('Windows native GPU crop happens before scaling without a CPU frame copy',()=>{
  const q={width:1280,height:720,frameRate:60,maxBitrate:8000000};
  const env={NATIVE_WINDOWS_CAPTURE:'wgc',NATIVE_GPU_SCALING:'1',NATIVE_CAPTURE_SOURCE_SIZE:'1920x1080',NATIVE_CAPTURE_REGION:'100,120,800,600'};
  const result=captureArguments(q,5004,env,'win32'),input=result.args[result.args.indexOf('-i')+1];
  assert.match(input,/crop_left=100:crop_top=120:crop_right=1020:crop_bottom=360/);assert.match(input,/width=800:height=600/);assert.ok(!result.args.includes('-vf'));
  assert.throws(()=>captureArguments(q,5004,{...env,NATIVE_CAPTURE_REGION:'1900,0,100,100'},'win32'),/outside/);
});
test('DDA and Linux crop the source before encoder scaling; invalid areas fail closed',()=>{
  const q={width:1280,height:720,frameRate:60,maxBitrate:8000000},region='17,23,641,361';
  for(const [platform,env] of [['win32',{NATIVE_WINDOWS_CAPTURE:'dda',NATIVE_CAPTURE_SOURCE_SIZE:'1920x1080'}],['linux',{DISPLAY:':0',NATIVE_SCREEN_SIZE:'1920x1080',NATIVE_CAPTURE_SOURCE_SIZE:'1920x1080'}]]){
    const result=captureArguments(q,5004,{...env,NATIVE_CAPTURE_REGION:region},platform),filter=result.args[result.args.indexOf('-vf')+1];assert.ok(filter.indexOf('crop=641:361:17:23:exact=1')<filter.indexOf('scale='));
    assert.throws(()=>captureArguments(q,5004,{...env,NATIVE_CAPTURE_REGION:'bad'},platform));
  }
});
test('native guest cleanup closes every independent pop-out but preserves other guests',async()=>{
  const media=new NativeMedia({},'win32'),closed=[];media.peers=new Map([['guest-a','main'],['guest-a:view:main','main'],['guest-a:view:extra','extra'],['guest-b:view:extra','extra']]);
  media.closePeer=async id=>{closed.push(id);media.peers.delete(id);};await media.closeGuest('guest-a');assert.deepEqual(closed.sort(),['guest-a','guest-a:view:extra','guest-a:view:main']);assert.ok(media.peers.has('guest-b:view:extra'));
});
test('small and narrow areas retain valid encoder dimensions',()=>{
  const host={width:1920,height:1080,frameRate:60,maxBitrate:8000000};
  for(const size of [{width:2,height:2000},{width:100,height:60},{width:11,height:9}]){const q=effectiveQuality(host,{},size);assert.ok(q.width>=2 && q.height>=2);assert.equal(q.width%2,0);assert.equal(q.height%2,0);}
});
test('native pop-out offers reserve video only and never start an extra audio capture',async()=>{
  const media=new NativeMedia({},'win32'),calls=[];media.startEncoder=async()=>{};media.ensureAudio=async()=>{throw new Error('Audio must not start');};
  media.rpc=async(message,prepare)=>{calls.push(message);const result={port:5004,codec:'h264'};prepare?.(result);return result;};
  const offer=await media.offer('guest:view:main',{frameRate:60,maxBitrate:8000000},{iceServers:[]},{videoOnly:true});assert.equal(calls[0].audio,false);assert.equal(offer.audioAvailable,false);
});
