import {test} from 'node:test';
import assert from 'node:assert/strict';
import backend from '../src/inject/windows-vigem.js';
import {packGamepadState} from '../public/input.js';

test('incoming controller brand does not change standardized face positions or sticks',()=>{
  for(const id of ['Xbox controller','Nintendo Switch Pro Controller','DualSense','Generic USB gamepad']) {
    const gp={id,mapping:'standard',buttons:Array.from({length:17},(_,i)=>({pressed:i===0,value:i===6?.75:0})),axes:[1,-1,0,0]};
    const state=packGamepadState(gp);assert.equal(state.buttons.a,true);assert.equal(state.axes.lx,1);assert.equal(state.axes.ly,1);assert.equal(state.axes.lt,.75);
  }
});
test('HID output maps canonical face positions, sticks, triggers and diagonals independently of Xbox buttons',()=>{
  const values={};const input=name=>({setValue:value=>values[name]=value});
  const names=['CROSS','CIRCLE','SQUARE','TRIANGLE','SHOULDER_LEFT','SHOULDER_RIGHT','SHARE','OPTIONS','THUMB_LEFT','THUMB_RIGHT','SPECIAL_PS','TRIGGER_LEFT','TRIGGER_RIGHT'];
  const pad={button:Object.fromEntries(names.map(n=>[n,input(n)])),axis:Object.fromEntries(['leftX','leftY','rightX','rightY','leftTrigger','rightTrigger','dpadHorz','dpadVert'].map(n=>[n,input(n)]))};
  backend.applyToPad(pad,{buttons:{a:true,x:true,up:true,right:true,start:true},axes:{lx:.75,ly:-1,lt:.6,rt:0}},'ds4');
  assert.equal(values.CROSS,true);assert.equal(values.SQUARE,true);assert.equal(values.CIRCLE,false);assert.equal(values.OPTIONS,true);assert.equal(values.leftY,-1);assert.equal(values.leftTrigger,.6);assert.equal(values.TRIGGER_LEFT,true);assert.equal(values.TRIGGER_RIGHT,false);assert.equal(values.dpadHorz,1);assert.equal(values.dpadVert,1);
  backend.applyToPad(pad,{},'ds4');assert.ok(Object.values(values).every(v=>v===0 || v===false));
});
