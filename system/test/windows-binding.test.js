import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import binding from '../src/inject/windows-binding.js';

test('Windows binding checks distinguish missing packages from unusable native binaries without creating controllers',()=>{
  const missing=()=>assert.fail('Missing packages must not be loaded');missing.resolve=()=>{throw Error('not found');};
  assert.equal(binding.inspectBinding(missing).state,'missing');
  const broken=()=>{throw Error('NODE_MODULE_VERSION mismatch');};broken.resolve=()=>'/installed/vigemclient';
  assert.equal(binding.inspectBinding(broken).state,'broken');
  class Driver{constructor(){assert.fail('Readiness must never connect or create a virtual controller');}}
  const ready=()=>Driver;ready.resolve=()=>'/installed/vigemclient';
  assert.deepEqual(binding.inspectBinding(ready),{state:'ready',Binding:Driver});
});
test('Windows controller binding remains an optional pinned dependency across npm dependency repairs',async()=>{
  const manifest=JSON.parse(await fs.readFile(new URL('../../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(await fs.readFile(new URL('../../package-lock.json',import.meta.url),'utf8'));
  assert.equal(manifest.optionalDependencies.vigemclient,'1.5.3');
  assert.equal(lock.packages['node_modules/vigemclient'].optional,true);
  assert.deepEqual(lock.packages['node_modules/vigemclient'].os,['win32']);
});
