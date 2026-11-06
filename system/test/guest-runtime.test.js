import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {guestLaunchPlan,guestSourceHash,posixSources} from '../src/guest-runtime.js';
import {guestInputCapability} from '../src/guest-input.js';
import {guestPlatform,guestSetupNotes} from '../public/guest-platform.js';
test('older native reader setup messages use the current shortcut and describe optional local input blocking',()=>{
  const notes=guestSetupNotes(['HidHide is not available. Install it with Windows/09-Guest-Exclusive-Setup.cmd, then restart Windows if requested.','Keyboard/mouse isolation needs the Interception driver and a Windows restart.','Close HidHide Configuration Client or another exclusive controller session and retry.',null],'win32');
  assert.equal(notes.length,3);assert.match(notes[0],/windows\/shortcuts\/09-Guest-Exclusive-Setup.cmd/);assert.match(notes[0],/Browser controller sharing works without this driver/);assert.match(notes[1],/Interception/);assert.match(notes[1],/optional for browser input sharing/);assert.match(notes[2],/^Close HidHide/);
  assert.deepEqual(guestSetupNotes(['Grant read permission for the selected event device.'],'linux'),['Grant read permission for the selected event device.']);assert.deepEqual(guestSetupNotes(null,'darwin'),[]);
});
for(const platform of ['linux','darwin'])test(`${platform} native guest setup validates its runtime, OS and source version`,t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pad-guest-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'system/native'),{recursive:true});for(const name of posixSources)fs.writeFileSync(path.join(root,'system/native',name),name);
  const folder=path.join(root,'.local/tools/guest-input');fs.mkdirSync(folder,{recursive:true});
  assert.equal(guestInputCapability(platform,root).available,false);assert.ok(guestInputCapability(platform,root).error.includes(guestPlatform(platform).setup));
  const manifest={platform,sourceHash:guestSourceHash(platform,root),python:process.execPath};
  const save=()=>fs.writeFileSync(path.join(folder,'posix-build.json'),JSON.stringify(manifest));save();
  assert.equal(guestInputCapability(platform,root).available,true);
  const plan=guestLaunchPlan(platform,root);assert.equal(plan.command,process.execPath);assert.equal(plan.options.detached,true);assert.ok(plan.args.at(-1).endsWith('guest-input-posix.py'));
  manifest.platform='win32';save();assert.equal(guestInputCapability(platform,root).available,false);
  manifest.platform=platform;manifest.python='python3';save();assert.equal(guestInputCapability(platform,root).available,false);
  manifest.python=process.execPath;save();fs.appendFileSync(path.join(root,'system/native/guest_input_common.py'),'changed');assert.equal(guestInputCapability(platform,root).available,false);
  assert.doesNotMatch(guestPlatform(platform).intro+guestPlatform(platform).help,/Windows|HidHide|Interception/);
});
