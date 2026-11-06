// Sequential Windows capture-to-guest comparisons using only a generated window.
// Requires the same local tools and Playwright module as smoke-preview-latency.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const methods=[
  {id:'qsv-depth4',encoder:'h264_qsv',depth:'4'},
  {id:'qsv-depth1',encoder:'h264_qsv',depth:'1'},
  {id:'nvenc-p1',encoder:'h264_nvenc',preset:'p1'},
  {id:'nvenc-p2',encoder:'h264_nvenc',preset:'p2'},
  {id:'nvenc-p4',encoder:'h264_nvenc',preset:'p4'},
  {id:'cpu-veryfast',encoder:'libx264'},
  {id:'browser-window',browser:true},
].filter(method=>!process.env.BENCH_METHODS || process.env.BENCH_METHODS.split(',').includes(method.id));
if(!methods.length)throw new Error('No matching benchmark methods');
const folder=path.resolve('.local/benchmarks/guest');await fs.mkdir(folder,{recursive:true});
const results=[];
for(const method of methods){
  console.log(`Measuring ${method.id}…`);
  const file=path.join(folder,method.id+'.json');await fs.unlink(file).catch(()=>{});
  const env={...process.env,LATENCY_GUEST:'1',LATENCY_UI:'1',LATENCY_AUDIO:'0',LATENCY_FPS:'60',LATENCY_RESOLUTION:'720',LATENCY_MAX_MS:'',LATENCY_CAPTURE:method.browser?'browser':'native',LATENCY_ENCODER:method.encoder || '',NATIVE_QSV_ASYNC_DEPTH:method.depth || '1',NATIVE_NVENC_PRESET:method.preset || 'p1',LATENCY_REPORT:method.id};
  try{
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['system/scripts/smoke-preview-latency.mjs'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
      for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output=(output+data).slice(-8000);});
      const timer=setTimeout(()=>{child.kill();reject(new Error('Guest benchmark timed out'));},120000);
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(output));});
    });
    const result={id:method.id,...JSON.parse(await fs.readFile(file,'utf8'))};results.push(result);
    console.log(JSON.stringify({method:method.id,medianMs:result.medianMs,p95Ms:result.p95Ms,sourceToReceiveMs:result.sourceToReceiveMs,fps:result.fps}));
  }catch(error){results.push({id:method.id,error:error.message});console.log(`${method.id}: unavailable or failed; see results.json`);}
  await fs.writeFile(path.join(folder,'results.json'),JSON.stringify(results,null,2)+'\n');
}
const n=value=>Number.isFinite(value)?value.toFixed(1):'—';
const rows=results.map(r=>r.error?`| ${r.id} | Failed | — | — | — | — |`:`| ${r.id} | ${n(r.medianMs)} | ${n(r.p95Ms)} | ${n(r.sourceToReceiveMs)} | ${n(r.receiveToDisplayMs)} | ${n(r.fps)} |`);
await fs.writeFile(path.join(folder,'results.md'),`# Local guest comparison\n\nGenerated clock window, 720p cap at 60 fps, independent host/guest pages, loopback WebRTC, no audio.\n\n| Method | Picture age median ms | p95 ms | Source→receive ms | Receive→display ms | Reported fps |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n\nBrowser capture includes window decorations and selects its own encoder; native captures the client area with explicit H.264 encoding. Presentation timing is estimated in headless Edge, not physical display scanout. Repeat runs before interpreting differences of a few milliseconds. Failed methods are recorded rather than silently substituted.\n`);
console.log(`Saved reports to ${folder}`);
if(results.some(result=>result.error))process.exitCode=1;
