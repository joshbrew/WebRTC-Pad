import {test} from 'node:test';
import assert from 'node:assert/strict';
import {videoHealth} from '../public/video-health.js';
test('receiving packets with no decoded frames triggers a bounded picture refresh',()=>{
  let state=videoHealth(null,{id:'a',packets:0,frames:10},1000);
  for(let n=1;n<=3;n++)state=videoHealth(state,{id:'a',packets:n*100,frames:10},1000+n*1500);
  assert.equal(state.recover,true);
  for(let n=4;n<=8;n++){state=videoHealth(state,{id:'a',packets:n*100,frames:10},1000+n*1500);assert.equal(state.recover,false);}
  state=videoHealth(state,{id:'a',packets:900,frames:11},15000);assert.equal(state.stalled,0);
});
test('idle windows, normal frame progression and replacement receivers do not look like a decoder failure',()=>{
  let state=videoHealth(null,{id:'a',packets:10,frames:1},1000);
  for(let n=1;n<20;n++){state=videoHealth(state,{id:'a',packets:10,frames:1},1000+n*1500);assert.equal(state.recover,false);}
  state=videoHealth(state,{id:'a',packets:20,frames:2},40000);assert.equal(state.recover,false);
  state=videoHealth(state,{id:'b',packets:1,frames:0},41500);assert.equal(state.stalled,0);assert.equal(state.recover,false);
});
