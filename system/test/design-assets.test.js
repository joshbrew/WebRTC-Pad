import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.js';
import {discoverThemePacks} from '../src/theme-packs.js';

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
  const themes=await fetch(origin+'/themes.json').then(response=>response.json());
  for(const id of ['classic','signal','cobalt','light']){
    const pack=themes.find(theme=>theme.id===id);
    assert.ok(pack);
    assert.equal(pack.stylesheet,`/themes/${id}/theme.css`);
    assert.match((await fetch(origin+pack.stylesheet)).headers.get('content-type'),/text\/css/);
    assert.equal(pack.preview,`/themes/${id}/preview.webp`);
    assert.equal((await fetch(origin+pack.preview)).headers.get('content-type'),'image/webp');
  }
  for(const route of ['/themes/signal/theme.json','/themes/missing/theme.css','/themes/README.md','/themes/signal/..%2F..%2F..%2F.env'])assert.equal((await fetch(origin+route)).status,404,route);
});

test('a new theme folder registers through its manifest and exposes only its theme assets',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pad-themes-'));
  const theme=path.join(root,'arcade');
  const manifest=path.join(theme,'theme.json');
  t.after(async()=>{for(const filename of [manifest,path.join(theme,'custom.css'),path.join(theme,'notes.js'),path.join(theme,'preview.svg')])await fs.unlink(filename).catch(()=>{});await fs.rmdir(theme);await fs.rmdir(root);});
  await fs.mkdir(theme);
  const write=(stylesheet,preview)=>fs.writeFile(manifest,JSON.stringify({version:1,id:'arcade',name:'Arcade',colorScheme:'dark',stylesheet,preview}));
  await fs.writeFile(path.join(theme,'custom.css'),'');
  await fs.writeFile(path.join(theme,'notes.js'),'');
  await write('custom.css');
  const {themes,files}=discoverThemePacks(root);
  assert.equal(themes[0].stylesheet,'/themes/arcade/custom.css');
  assert.deepEqual([...files.keys()],['/themes/arcade/custom.css']);
  await fs.writeFile(path.join(theme,'preview.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  await write('custom.css','preview.svg');
  assert.equal(discoverThemePacks(root).themes[0].preview,'/themes/arcade/preview.svg');
  for(const invalid of ['../preview.svg','custom.css','missing.webp']){
    await write('custom.css',invalid);
    assert.equal(discoverThemePacks(root).themes[0].preview,undefined);
  }
  await write('../custom.css');
  assert.equal(discoverThemePacks(root).themes.length,0);
});
