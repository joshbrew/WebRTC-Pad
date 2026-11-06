import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../src/server.js';

test('the served page can load its entire local browser module and worker graph',async t=>{
  const app=createApp({env:{}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const origin=`http://127.0.0.1:${app.server.address().port}`,html=await fetch(origin).then(r=>r.text());
  const pending=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match=>new URL(match[1],origin+'/'));
  assert.ok(pending.length,'The page must declare a browser entry point');
  const visited=new Set();
  while(pending.length){
    const url=pending.pop();if(visited.has(url.href))continue;visited.add(url.href);
    assert.equal(url.origin,origin,'Local browser code must not silently depend on a third-party module host');
    const response=await fetch(url);assert.equal(response.status,200,`${url.pathname} must be served`);
    assert.match(response.headers.get('content-type') || '',/javascript/,`${url.pathname} must have a JavaScript media type`);
    const source=await response.text();
    const references=[...source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+)['"]/g),...source.matchAll(/new URL\(['"](\.[^'"]+\.js)['"]/g)];
    for(const match of references)pending.push(new URL(match[1],url));
  }
  assert.ok(visited.size>1,'Follow imported modules as well as the entry point');
});
