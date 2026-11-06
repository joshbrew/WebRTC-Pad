"use strict";
const path = require('node:path');
const { startHelper } = require('./helper.js');
async function createInjector({ playerCount = 4,env=process.env } = {}) {
  const helper = await startHelper(env.PYTHON || 'python3', [path.join(__dirname, '../../native/linux-gamepad.py'), String(playerCount)],undefined,undefined,{env});
  return { ...helper, addController:slot=>helper.command('add',slot),removeController:slot=>helper.command('remove',slot), name: `Linux uinput gamepads` };
}
module.exports = { createInjector };
