"use strict";
async function createInjector({env=process.env,platform=process.platform,playerCount = Number(env.PLAYER_COUNT || 4), controllerType = env.WINDOWS_CONTROLLER_TYPE || 'auto' } = {}) {
  if (env.INPUT_BACKEND === 'none') return { name: 'Video only', setState() {}, addController(){},removeController(){},close() {} };
  if (platform === 'win32') return require('./windows-vigem.js').createInjector({ playerCount, controllerType });
  if (platform === 'linux') return require('./linux-uinput.js').createInjector({ playerCount,env });
  if (platform === 'darwin') return require('./macos-hid.js').createInjector({ playerCount,env });
  throw new Error(`No virtual gamepad backend for ${platform}`);
}
module.exports = { createInjector };
