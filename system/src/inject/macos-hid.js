"use strict";
const path = require('node:path');
const { startHelper } = require('./helper.js');
const { BUTTONS } = require('./state.js');
function encode(slot, state) {
  const report = Buffer.alloc(10);
  let mask = 0;
  BUTTONS.slice(0, 11).forEach((key, i) => { if (state.buttons[key]) mask |= 1 << i; });
  report.writeUInt16LE(mask, 0);
  const b = state.buttons;
  const x = Number(b.right) - Number(b.left), y = Number(b.down) - Number(b.up);
  const hats = { '0,-1': 0, '1,-1': 1, '1,0': 2, '1,1': 3, '0,1': 4, '-1,1': 5, '-1,0': 6, '-1,-1': 7 };
  report[2] = hats[`${x},${y}`] ?? 8;
  ['lx', 'ly', 'rx', 'ry'].forEach((key, i) => { const v = state.axes[key] * (key.endsWith('y') ? -1 : 1); report[3 + i] = Math.round((v + 1) * 127.5); });
  report[7] = Math.round(state.axes.lt * 255); report[8] = Math.round(state.axes.rt * 255);
  return `${slot} ${report.toString('hex')}\n`;
}
async function createInjector({ playerCount = 4,env=process.env } = {}) {
  const helper = await startHelper(env.MACOS_HID_HELPER || path.join(__dirname, '../../native/webrtc-pad-hid'), [String(playerCount)], encode,message=>`${message.type} ${message.id} ${message.slot}\n`,{env});
  return { ...helper, addController:slot=>helper.command('add',slot),removeController:slot=>helper.command('remove',slot),name: `macOS virtual HID gamepads` };
}
module.exports = { createInjector, encode };
