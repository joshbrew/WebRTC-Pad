import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {sourceThumbnail} from '../src/source-thumbnail.js';
import {createApp} from '../src/server.js';
const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
test('source thumbnails use bounded, argument-based helpers for Windows and X11',async()=>{
  const calls=[],run=async(...args)=>{calls.push(args);return {stdout:png};};
  await sourceThumbnail({kind:'window',id:'123',pid:456},{NATIVE_THUMBNAIL_HELPER:process.execPath},'win32',run);
  assert.deepEqual(calls[0][1],['123','456']);assert.equal(calls[0][2].timeout,2200);assert.equal(calls[0][2].maxBuffer,512*1024);
  await sourceThumbnail({kind:'window',id:'44',width:640,height:360},{DISPLAY:':0',FFMPEG_BIN:process.execPath},'linux',run);
  assert.ok(calls[1][1].includes('-window_id'));assert.ok(calls[1][1].includes('44'));assert.ok(calls[1][1].includes('image2pipe'));
  await assert.rejects(sourceThumbnail({kind:'window'},{DISPLAY:':0',XDG_SESSION_TYPE:'wayland'},'linux',run),/X11/);
  await assert.rejects(sourceThumbnail({kind:'invalid'},{},'win32',run),/Invalid/);
  await assert.rejects(sourceThumbnail({kind:'desktop'},{NATIVE_THUMBNAIL_HELPER:process.execPath},'win32',async()=>({stdout:Buffer.from('not an image')})),/No thumbnail/);
});
test('thumbnail route is local, same-origin, no-store and only accepts freshly listed sources',async t=>{
  const app=createApp({platform:'other',env:{},getCaptureTargets:async()=>[{kind:'window',id:'123',pid:456,label:'Generated test'}]});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(`${origin}/capture-thumbnail?id=123`)).status,404);
  const listed=await fetch(`${origin}/capture-targets`);assert.equal(listed.headers.get('cache-control'),'no-store');await listed.json();
  assert.equal((await fetch(`${origin}/capture-thumbnail?id=123`,{headers:{Origin:'https://foreign.example'}})).status,403);
  assert.equal((await fetch(`${origin}/capture-thumbnail?id=123`,{headers:{Referer:'http://localhost:9999'}})).status,403);
  const unavailable=await fetch(`${origin}/capture-thumbnail?id=123`);assert.equal(unavailable.status,204);assert.equal(unavailable.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(`${origin}/capture-thumbnail?id=999`)).status,404);
});
