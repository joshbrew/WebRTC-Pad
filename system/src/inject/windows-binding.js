"use strict";
// Loading the binding checks its Node ABI without creating a virtual controller.
function inspectBinding(loader = require) {
  try { loader.resolve('vigemclient'); } catch { return { state: 'missing' }; }
  try { return { state: 'ready', Binding: loader('vigemclient') }; }
  catch { return { state: 'broken' }; }
}
function loadBinding() {
  const result = inspectBinding();
  if (result.state === 'ready') return result.Binding;
  throw new Error(`Host controller support (vigemclient) ${result.state === 'missing' ? 'is missing' : 'cannot load with this Node.js version'}. On the HOST computer, close the app and run windows/shortcuts/01-Host.cmd to repair it. The guest does not need this package.`);
}
module.exports = { inspectBinding, loadBinding };
