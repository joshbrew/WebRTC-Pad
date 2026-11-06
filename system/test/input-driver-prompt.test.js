import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {chooseInputDrivers as chooseDrivers,showInputRestartNotice} from '../scripts/input-driver-prompt.mjs';
import {readInputDriverChoice,readInputDriverPreferences} from '../src/input-driver-choice.js';
import {guestInputCapability} from '../src/guest-input.js';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'pad-driver-prompt-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
// Existing installer-choice tests must not depend on this PC's actual drivers.
const chooseInputDrivers=(root,options={})=>chooseDrivers(root,{detectInstalled:()=>({checked:true,hidHide:false,interception:false}),...options});

test('fresh app installation reuses retained Windows drivers without questions or install warnings',async t=>{
  const root=await fixture(t),logs=[];let checks=0;
  const options={detectInstalled:()=>{checks++;return {checked:true,hidHide:true,interception:true};},ask:()=>{throw Error('Installed drivers must not prompt');},log:line=>logs.push(line)};
  assert.deepEqual(await chooseInputDrivers(root,options),{hidHide:true,interception:true});assert.equal(checks,1);
  assert.match(logs.join('\n'),/HidHide is already installed/);assert.match(logs.join('\n'),/Interception is already installed/);assert.doesNotMatch(logs.join('\n'),/administrator|restart|Install /);
  assert.deepEqual(readInputDriverPreferences(root),{hidHide:true,interception:true});
  await chooseInputDrivers(root,options);assert.equal(checks,1,'Saved choices preserve fast repeat startup');
});
test('existing drivers and missing drivers are handled independently, including noninteractive and controller-only setup',async t=>{
  for(const existing of ['hidHide','interception']){
    const root=await fixture(t),questions=[],other=existing==='hidHide'?'interception':'hidHide';
    const result=await chooseInputDrivers(root,{detectInstalled:()=>({checked:true,[existing]:true,[other]:false}),ask:async question=>{questions.push(question);return 'n';},log:()=>{}});
    assert.equal(result[existing],true);assert.equal(result[other],false);assert.equal(questions.length,1);assert.match(questions[0],other==='hidHide'?/HidHide/:/Interception/);
  }
  const root=await fixture(t);assert.deepEqual(await chooseInputDrivers(root,{interactive:false,detectInstalled:()=>({checked:true,hidHide:true,interception:false}),log:()=>{}}),{hidHide:true,interception:false});
  const only=await fixture(t);assert.deepEqual(await chooseInputDrivers(only,{controllersOnly:true,detectInstalled:()=>({checked:true,hidHide:true,interception:true}),ask:()=>{throw Error('No missing requested driver');},log:()=>{}}),{hidHide:true,interception:false});
});
test('saved opt-outs remain respected and unavailable driver checks do not claim installation',async t=>{
  const root=await fixture(t);await fs.mkdir(path.join(root,'.local'));await fs.writeFile(path.join(root,'.local/hidhide-disabled'),'disabled');await fs.writeFile(path.join(root,'.local/interception-disabled'),'disabled');
  assert.deepEqual(await chooseInputDrivers(root,{detectInstalled:()=>({checked:true,hidHide:true,interception:true}),ask:()=>{throw Error('Do not override uninstall opt-out');},log:()=>{}}),{hidHide:false,interception:false});
  const unknown=await fixture(t),questions=[];assert.deepEqual(await chooseInputDrivers(unknown,{detectInstalled:()=>{throw Error('Unavailable');},ask:async value=>{questions.push(value);return '';},log:()=>{}}),{hidHide:false,interception:false});assert.equal(questions.length,2);
});

test('optional drivers explain purpose and restart, remember No, and can be enabled later',async t=>{
  const root=await fixture(t),logs=[];let prompts=0;
  const opts={ask:async()=>{prompts++;return 'n';},log:text=>logs.push(text)};
  assert.deepEqual(await chooseInputDrivers(root,opts),{hidHide:false,interception:false});assert.equal(readInputDriverChoice(root),'skip');assert.equal(prompts,2);
  assert.match(logs.join('\n'),/Regular controller sharing, video and voice work without/);assert.match(logs.join('\n'),/computer restart/);assert.match(logs.join('\n'),/09-Guest-Exclusive-Setup.cmd/);
  assert.deepEqual(await chooseInputDrivers(root,opts),{hidHide:false,interception:false});assert.equal(prompts,2);
  const capability=guestInputCapability('win32',root);assert.equal(capability.installDeclined,true);assert.equal(capability.installApproved,false);
  assert.deepEqual(await chooseInputDrivers(root,{...opts,force:true,ask:async()=>{prompts++;return 'YES';}}),{hidHide:true,interception:true});assert.equal(prompts,4);assert.equal(readInputDriverChoice(root),'install');assert.equal(guestInputCapability('win32',root).installApproved,true);
});

test('blank/noninteractive setup skips safely; explicit automation can accept installation',async t=>{
  const root=await fixture(t),opts={log:()=>{}};
  assert.deepEqual(await chooseInputDrivers(root,{...opts,ask:async()=>''}),{hidHide:false,interception:false});
  assert.deepEqual(await chooseInputDrivers(root,{...opts,force:true,interactive:false}),{hidHide:false,interception:false});
  assert.deepEqual(await chooseInputDrivers(root,{...opts,yes:true}),{hidHide:true,interception:true});
  assert.deepEqual(await chooseInputDrivers(root,{...opts,force:true,interactive:false}),{hidHide:false,interception:false});assert.equal(readInputDriverChoice(root),'install');
  const other=await fixture(t);assert.deepEqual(await chooseInputDrivers(other,{...opts,interactive:false}),{hidHide:false,interception:false});assert.equal(readInputDriverChoice(other),'skip');
});

test('Interception reconnect warning precedes its optional install question and does not apply to controller-only setup',async t=>{
  const root=await fixture(t),events=[];
  assert.deepEqual(await chooseInputDrivers(root,{log:value=>events.push(value),ask:async question=>{events.push(question);return question.includes('HidHide')?'y':'n';}}),{hidHide:true,interception:false});
  const warning=events.findIndex(value=>value.includes('known unplug/replug bug')),question=events.findIndex(value=>value.startsWith('Install Interception'));
  assert.ok(warning>=0 && question===warning+1);assert.match(events[warning],/even with this app closed/);assert.match(events[warning],/focused browser input/);
  const other=await fixture(t),logs=[];await chooseInputDrivers(other,{controllersOnly:true,ask:async()=>'y',log:value=>logs.push(value)});assert.doesNotMatch(logs.join('\n'),/known unplug\/replug bug/);
});

test('HidHide and Interception choices are independent, retained and compatible with earlier saved answers',async t=>{
  for(const answers of [['y','n'],['n','y']]){
    const root=await fixture(t),pending=[...answers],questions=[];
    const expected={hidHide:answers[0]==='y',interception:answers[1]==='y'};
    assert.deepEqual(await chooseInputDrivers(root,{log:()=>{},ask:async question=>{questions.push(question);return pending.shift();}}),expected);
    assert.match(questions[0],/HidHide.*controller/);assert.match(questions[1],/Interception.*keyboard\/mouse/);
    assert.deepEqual(readInputDriverPreferences(root),expected);assert.deepEqual(await chooseInputDrivers(root,{ask:()=>{throw Error('Unexpected question');}}),expected);
    assert.equal(guestInputCapability('win32',root).installApproved,expected.hidHide);
  }
  const legacy=await fixture(t);await fs.mkdir(path.join(legacy,'.local'));await fs.writeFile(path.join(legacy,'.local/input-driver-choice.json'),JSON.stringify({choice:'install'}));assert.deepEqual(readInputDriverPreferences(legacy),{hidHide:true,interception:true});
});

test('restart reminder survives repeated launches and clears after a different Windows boot',async t=>{
  const root=await fixture(t),file=path.join(root,'.local/input-drivers-restart.json');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify({bootId:'PC:154'}));
  const logs=[],opts={log:text=>logs.push(text)};
  await showInputRestartNotice(root,'PC:154',opts);await showInputRestartNotice(root,'PC:154',opts);assert.equal(logs.filter(text=>text.includes('RESTART YOUR COMPUTER')).length,2);await fs.access(file);
  logs.length=0;await showInputRestartNotice(root,'PC:155',opts);assert.equal(logs.length,0);await assert.rejects(fs.access(file));
  await fs.writeFile(file,JSON.stringify({bootId:'PC:155',action:'remove'}));await showInputRestartNotice(root,'PC:155',opts);assert.match(logs.join('\n'),/finish removing input-blocking drivers/);
});

test('legacy restart notices clear after an actual reboot and current-boot changes explain why a restart is still needed',async t=>{
  const root=await fixture(t),file=path.join(root,'.local/input-drivers-restart.json');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify({bootId:null}));
  const written=(await fs.stat(file)).mtimeMs,logs=[];
  await showInputRestartNotice(root,'PC:155',{log:value=>logs.push(value),getBootTime:()=>written+1000});assert.equal(logs.length,0);await assert.rejects(fs.access(file));
  await fs.writeFile(file,JSON.stringify({bootId:'PC:155',drivers:['Interception']}));
  await showInputRestartNotice(root,'PC:155',{log:value=>logs.push(value)});assert.match(logs.join('\n'),/Interception installation/);assert.match(logs.join('\n'),/after Windows last started/);assert.match(logs.join('\n'),/command window does not restart Windows/);
  logs.length=0;await fs.utimes(file,1,1);await showInputRestartNotice(root,'PC:155',{log:value=>logs.push(value),getBootTime:()=>Date.now()-1000});assert.equal(logs.length,0);await assert.rejects(fs.access(file));
});
