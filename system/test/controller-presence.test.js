import {test} from 'node:test';
import assert from 'node:assert/strict';
import {controllerPresence} from '../public/controller-presence.js';
test('guest controller labels are bounded display metadata, independent of player allocation',()=>{
  assert.equal(controllerPresence(null),null);
  const result=controllerPresence({detected:999,enabled:1,controllers:[{index:0,name:'PS4\u0000 Controller',connected:true},{index:1,name:'<b>Pro Controller</b>',connected:false},{index:-1,name:'bad'},{index:2,name:'x'.repeat(300),keyboard:true,connected:true}]});
  assert.equal(result.detected,256);assert.equal(result.enabled,false);assert.equal(result.controllers.length,3);assert.equal(result.controllers[0].name,'PS4 Controller');assert.equal(result.controllers[1].connected,false);assert.equal(result.controllers[2].name.length,80);assert.equal(result.controllers[2].keyboard,true);
  assert.equal(controllerPresence({controllers:[],setupRequired:'yes'}).setupRequired,false);assert.equal(controllerPresence({controllers:[],setupRequired:true}).setupRequired,true);
});
