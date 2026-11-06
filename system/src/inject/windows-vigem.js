"use strict";

function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function bool(v) {
  return !!v;
}

function dpadAxis(neg, pos) {
  if (neg && !pos) return -1;
  if (pos && !neg) return 1;
  return 0;
}

function applyToPad(pad, s, controllerType = 'x360') {
  const ax = s.axes || {};
  const bt = s.buttons || {};

  const lx = clamp(Number(ax.lx || 0), -1, 1);
  const ly = clamp(Number(ax.ly || 0), -1, 1);
  const rx = clamp(Number(ax.rx || 0), -1, 1);
  const ry = clamp(Number(ax.ry || 0), -1, 1);
  const lt = clamp(Number(ax.lt || 0), 0, 1);
  const rt = clamp(Number(ax.rt || 0), 0, 1);

  pad.axis.leftX.setValue(lx);
  pad.axis.leftY.setValue(ly);
  pad.axis.rightX.setValue(rx);
  pad.axis.rightY.setValue(ry);
  pad.axis.leftTrigger.setValue(lt);
  pad.axis.rightTrigger.setValue(rt);

  const dh = dpadAxis(bool(bt.left), bool(bt.right));
  const dv = dpadAxis(bool(bt.down), bool(bt.up));
  pad.axis.dpadHorz.setValue(dh);
  pad.axis.dpadVert.setValue(dv);

  if (controllerType === 'ds4') {
    const buttons={CROSS:'a',CIRCLE:'b',SQUARE:'x',TRIANGLE:'y',SHOULDER_LEFT:'lb',SHOULDER_RIGHT:'rb',SHARE:'back',OPTIONS:'start',THUMB_LEFT:'ls',THUMB_RIGHT:'rs',SPECIAL_PS:'guide'};
    for(const [output,input] of Object.entries(buttons))pad.button[output].setValue(bool(bt[input]));
    pad.button.TRIGGER_LEFT.setValue(lt > 0);
    pad.button.TRIGGER_RIGHT.setValue(rt > 0);
    return;
  }
  pad.button.A.setValue(bool(bt.a));
  pad.button.B.setValue(bool(bt.b));
  pad.button.X.setValue(bool(bt.x));
  pad.button.Y.setValue(bool(bt.y));
  pad.button.LEFT_SHOULDER.setValue(bool(bt.lb));
  pad.button.RIGHT_SHOULDER.setValue(bool(bt.rb));
  pad.button.BACK.setValue(bool(bt.back));
  pad.button.START.setValue(bool(bt.start));
  pad.button.LEFT_THUMB.setValue(bool(bt.ls));
  pad.button.RIGHT_THUMB.setValue(bool(bt.rs));
  pad.button.GUIDE.setValue(bool(bt.guide));
}

function validateOptions(playerCount,controllerType) {
  if(!['auto','x360','ds4'].includes(controllerType))throw new Error('Choose auto, x360 or ds4 controller output');
  if (!Number.isSafeInteger(playerCount) || playerCount < 0 || controllerType==='x360' && playerCount > 4) throw new Error(controllerType==='x360'?'XInput supports at most four controller indices; choose Automatic or HID for more':'Choose a non-negative initial controller count');
}
function createNativeInjector({ playerCount = 4, controllerType = 'auto', onFeedback = () => {} } = {}) {
  validateOptions(playerCount,controllerType);
  const ViGEmClient = require('./windows-binding.js').loadBinding();

  const client = new ViGEmClient();
  const err = client.connect();
  if (err) throw err;

  const pads = new Map();
  function addController(slot) {
    if(pads.has(slot))return pads.get(slot).type;
    if(!/^p[1-9]\d*$/.test(slot) || !Number.isSafeInteger(Number(slot.slice(1))) || controllerType==='x360' && Number(slot.slice(1))>4)throw new Error('Invalid player slot');
    const errors=[];
    const choices=controllerType==='auto'?[...([...pads.values()].filter(p=>p.type==='x360').length<4?['x360']:[]),'ds4']:[controllerType];
    for(const type of choices) {
      const pad=type==='ds4'?client.createDS4Controller():client.createX360Controller();
      try {
        const error=pad.connect();if(error)throw error;
        if(type==='x360' && (!Number.isInteger(pad.userIndex) || pad.userIndex<0 || pad.userIndex>3))throw new Error('No free XInput slot');
        pad.updateMode='manual';
        applyToPad(pad,{axes:{lx:type==='ds4'?1:3/65535}},type);
        const primed=pad.update();if(primed instanceof Error)throw primed;
        applyToPad(pad,{},type);const neutral=pad.update();if(neutral instanceof Error)throw neutral;
        pad.on?.('vibration',value=>{if(pads.get(slot)?.pad===pad)onFeedback({type:'rumble',slot,large:clamp(Number(value.large)||0,0,255)/255,small:clamp(Number(value.small)||0,0,255)/255});});
        pads.set(slot,{pad,type});return type;
      } catch(error) {try{pad.disconnect();}catch{}errors.push(`${type}: ${error.message}`);}
    }
    throw new Error(`Cannot add controller: ${errors.join('; ')}${controllerType==='x360'?'. XInput has only four slots, including other local XInput pads. Choose automatic output if the game supports HID.':''}`);
  }
  function removeController(slot) {
    const entry=pads.get(slot);if(!entry)return;
    applyToPad(entry.pad,{},entry.type);entry.pad.update();entry.pad.disconnect();pads.delete(slot);
  }
  try {
    for (let i = 1; i <= playerCount; i++) addController(`p${i}`);
  } catch (error) {
    close();
    throw new Error(`ViGEmBus driver unavailable: ${error.message}. Install the signed ViGEmBus driver and restart.`);
  }

  function setState(slot, state) {
    const entry = pads.get(slot);
    if (!entry) throw new Error('Invalid player slot');
    const {pad,type}=entry;
    applyToPad(pad, state,type);
    const error = pad.update(); if (error instanceof Error) throw error;
  }

  function close() {
    for (const {pad} of pads.values()) { try { pad.disconnect(); } catch {} }
    try {
      client.disconnect();
    } catch {}
  }

  return { name: `ViGEmBus (${controllerType==='auto'?'automatic mixed gamepads':controllerType==='ds4'?'HID / PlayStation':'Xbox / XInput'})`, setState, addController,removeController,close };
}

async function createInjector({ playerCount = 4, controllerType = 'auto' } = {}) {
  validateOptions(playerCount,controllerType);
  const { startHelper } = require('./helper.js');
  const helper = await startHelper(process.execPath, [require('node:path').join(__dirname, '../../native/windows-gamepad.cjs'), String(playerCount),controllerType]);
  return { ...helper, addController:slot=>helper.command('add',slot),removeController:slot=>helper.command('remove',slot), name: `ViGEmBus (${controllerType==='auto'?'automatic mixed gamepads':controllerType==='ds4'?'HID / PlayStation':'Xbox / XInput'})` };
}
module.exports = { createInjector, createNativeInjector, applyToPad };
