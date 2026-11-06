import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {DiagnosticHistory} from '../public/diagnostic-history.js';
import {createApp} from '../src/server.js';

test('diagnostics bound history, retain gaps and export independent numeric samples',()=>{
  const history=new DiagnosticHistory(3);
  const source={fps:60,bufferMs:0,inputMs:8};history.push(source,1000);source.fps=15;
  history.push({fps:59,mbps:Infinity,decodeMs:-1},2500);history.push({fps:60,lossPercent:.5},4000);
  assert.deepEqual(history.data(['fps','inputMs']),[[0,1.5,3],[60,59,60],[8,null,null]]);
  assert.match(history.csv(),/1.500,,,,,59,,/);assert.equal(history.rows[0].bufferMs,0);
  history.push({fps:30},5500);assert.equal(history.rows.length,3);assert.equal(history.rows[0].seconds,1.5);
  history.push({},5500);assert.ok(history.rows.at(-1).seconds>history.rows.at(-2).seconds);
  history.clear();history.push({fps:60},9000);assert.equal(history.rows[0].seconds,0);
});

test('only the chart browser module graph and CSS can be served from its dependency',async t=>{
  const app=createApp({env:{}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const origin=`http://127.0.0.1:${app.server.address().port}`,pending=['/charts/scripts/uPlot.js'],visited=new Set();
  while(pending.length){const route=pending.pop();if(visited.has(route))continue;visited.add(route);
    const response=await fetch(origin+route);assert.equal(response.status,200,route);assert.match(response.headers.get('content-type'),/javascript/);
    const source=await response.text();for(const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+)['"]|\bimport\(['"](\.[^'"]+)['"]\)/g))pending.push(new URL(match[1] || match[2],origin+route).pathname);
  }
  assert.ok(visited.size>15);const css=await fetch(origin+'/charts/scripts/uPlot.css').then(r=>r.text());assert.match(css,/\.uplot/);assert.doesNotMatch(css,/:root|html,\s*body/);
  for(const route of ['/charts/package.json','/charts/README.md','/charts/scripts/webgpu/smokeTest.js','/charts/scripts/ts/uPlot.ts','/node_modules/ws/package.json'])assert.equal((await fetch(origin+route)).status,404,route);
});
