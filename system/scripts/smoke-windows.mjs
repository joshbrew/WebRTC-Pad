import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import inject from '../src/inject/index.js';
import states from '../src/inject/state.js';
if (process.platform !== 'win32') throw new Error('This test needs a Windows host and ViGEmBus');
const driver = await inject.createInjector();
const read = () => JSON.parse(execFileSync(process.env.PYTHON || 'python', ['system/scripts/read-xinput.py'], { encoding: 'utf8', windowsHide: true }));
const wait = async predicate => {
  const end = Date.now() + 5000;
  while (true) { const pads = read(); if (predicate(pads)) return pads; if (Date.now() > end) throw new Error(`XInput state not observed: ${JSON.stringify(pads)}`); await new Promise(r => setTimeout(r, 50)); }
};
let heartbeat;
try {
  await wait(pads => pads.length === 4 && pads.every(p => Object.entries(p).every(([key,value]) => key === 'index' || value === 0)));
  console.log('PASS: all four newly enumerated controllers start neutral, including unused seats');
  const send = () => {
    driver.setState('p1', states.normalizeState({ buttons: { a: true, lb: true }, axes: { lx: 1, ly: 1, lt: 0.5, rt: 1 } }));
    driver.setState('p2', states.normalizeState({ buttons: { b: true }, axes: { rx: -1, ry: -1 } }));
    driver.setState('p3', states.normalizeState({ buttons: { x: true } }));
    driver.setState('p4', states.normalizeState({ buttons: { y: true } }));
  };
  send(); heartbeat = setInterval(send, 50);
  const pads = await wait(pads => [0x1100, 0x2000, 0x4000, 0x8000].every(mask => pads.some(p => p.buttons === mask)));
  const first = pads.find(p => p.buttons === 0x1100), second = pads.find(p => p.buttons === 0x2000);
  assert.equal(first.lx, 32767); assert.equal(first.ly, 32767); assert.equal(first.rt, 255); assert.ok(first.lt >= 127 && first.lt <= 128);
  assert.equal(second.rx, -32768); assert.equal(second.ry, -32768);
  console.log('PASS: all four virtual controllers are visible through Windows XInput with independent buttons, sticks and triggers');
  clearInterval(heartbeat);
  const indices = pads.map(p => p.index);
  await wait(pads => indices.every(index => { const p = pads.find(p => p.index === index); return p && p.buttons === 0 && p.lt === 0 && p.rt === 0 && p.lx === 0 && p.ly === 0 && p.rx === 0 && p.ry === 0; }));
  console.log('PASS: native helper watchdog releases all controls after input stops');
} finally { clearInterval(heartbeat); driver.close(); }
