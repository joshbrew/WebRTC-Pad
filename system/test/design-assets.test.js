import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../src/server.js';

test('design tokens, components, icons and local fonts are served without exposing the archive or source',async t=>{
  const app=createApp({env:{}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const css=await fetch(origin+'/design/styles.css').then(r=>r.text());assert.match(css,/tokens\/fonts.css/);
  for(const path of ['tokens/fonts.css','tokens/colors.css','tokens/typography.css','tokens/spacing.css','tokens/effects.css','tokens/base.css','components/components.css']){
    const response=await fetch(origin+'/design/'+path);assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),/text\/css/);
  }
  for(const name of ['Inter-Variable-latin.woff2','Inter-Variable-latin-ext.woff2']){const response=await fetch(origin+'/design/fonts/'+name);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'font/woff2');assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,4).toString(),'wOF2');}
  assert.match((await fetch(origin+'/design/assets/brand-mark.svg')).headers.get('content-type'),/image\/svg\+xml/);
  for(const route of ['/WebRTC%20Pad%20Design%20System.zip','/design/SKILL.md','/design/fonts/OFL.md','/design/../../.env','/_ds_bundle.js','/uploads/WebRTC-Pad/system/src/server.js'])assert.equal((await fetch(origin+route)).status,404,route);
});
