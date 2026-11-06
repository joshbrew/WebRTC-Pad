import {test} from 'node:test';import assert from 'node:assert/strict';
import {clampUnit,splitTracks} from '../public/tile-adjustments.js';
test('tile dividers preserve adjacent total size and keep both tracks usable',()=>{
  assert.deepEqual(splitTracks([300,200,100],0,75),[375,125,100]);assert.deepEqual(splitTracks([300,200],0,10000),[452,48]);assert.deepEqual(splitTracks([300,200],0,-10000),[48,452]);assert.deepEqual(splitTracks([30,30],0,1000),[40,20]);
});
test('camera overlay coordinates remain in bounds and reject invalid stored coordinates',()=>{assert.equal(clampUnit(-2),0);assert.equal(clampUnit(4),1);assert.equal(clampUnit(NaN),.98);assert.equal(clampUnit(Infinity),.98);assert.equal(clampUnit(.35),.35);});
