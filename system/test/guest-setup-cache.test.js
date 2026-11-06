import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {windowsBootId,windowsBootStartedAt,guestSetupCache,saveGuestSetupCache} from '../scripts/guest-setup-cache.mjs';

test('Windows boot identity is read without PowerShell and unavailable boot identity disables caching',()=>{
  let args;
  assert.equal(windowsBootId({env:{WINDIR:'C:\\Windows',COMPUTERNAME:'TEST'},invoke:(...values)=>{args=values;return {status:0,stdout:'    BootId    REG_DWORD    0x9a\r\n'};}}),'TEST:154');
  assert.match(args[0],/reg.exe$/);assert.equal(args[1].at(-1),'BootId');assert.equal(args[2].windowsHide,true);
  assert.equal(windowsBootId({invoke:()=>({status:1})}),null);
  assert.equal(windowsBootId({invoke:()=>{throw Error('unavailable');}}),null);
});

test('legacy restart check reads the actual Windows boot time and handles unavailable OS data',()=>{
  assert.equal(windowsBootStartedAt({invoke:()=>({status:0,stdout:'2026-10-19T09:02:34.5000000Z\r\n'})}),Date.parse('2026-10-19T09:02:34.500Z'));
  assert.equal(windowsBootStartedAt({invoke:()=>({status:0,stdout:'invalid'})}),null);
  assert.equal(windowsBootStartedAt({invoke:()=>({status:1})}),null);
});

test('successful setup is cached per boot, settings and source; explicit repair always checks',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pad-setup-cache-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'system/scripts'),{recursive:true});
  for(const file of ['setup-guest-input.mjs','install-guest-drivers.ps1','hidhide-updater.ps1','input-driver-status.ps1'])await fs.writeFile(path.join(root,'system/scripts',file),file);
  const settings={mode:'All',sourceHash:'reader-1',bootId:'PC:154'};
  let cache=await guestSetupCache(root,settings);assert.equal(cache.valid,false);
  await saveGuestSetupCache(cache);assert.equal((await guestSetupCache(root,settings)).valid,true);
  for(const change of [{bootId:'PC:155'},{bootId:'OTHER:154'},{bootId:null},{mode:'Controllers'},{sourceHash:'reader-2'},{force:true}])assert.equal((await guestSetupCache(root,{...settings,...change})).valid,false);
  await fs.writeFile(path.join(root,'.local/hidhide-disabled'),'disabled');assert.equal((await guestSetupCache(root,settings)).valid,false);
  await fs.unlink(path.join(root,'.local/hidhide-disabled'));assert.equal((await guestSetupCache(root,settings)).valid,true);
  await fs.writeFile(path.join(root,'.local/interception-disabled'),'disabled');assert.equal((await guestSetupCache(root,settings)).valid,false);
  await fs.unlink(path.join(root,'.local/interception-disabled'));assert.equal((await guestSetupCache(root,settings)).valid,true);
  await fs.writeFile(path.join(root,'.local/input-driver-choice.json'),JSON.stringify({choice:'skip'}));assert.equal((await guestSetupCache(root,settings)).valid,false);
  await fs.unlink(path.join(root,'.local/input-driver-choice.json'));assert.equal((await guestSetupCache(root,settings)).valid,true);
  await fs.appendFile(path.join(root,'system/scripts/install-guest-drivers.ps1'),'changed');assert.equal((await guestSetupCache(root,settings)).valid,false);
  await fs.writeFile(cache.file,'invalid JSON');assert.equal((await guestSetupCache(root,settings)).valid,false);
  await fs.unlink(cache.file);await saveGuestSetupCache(await guestSetupCache(root,{...settings,bootId:null}));await assert.rejects(fs.access(cache.file));
});
