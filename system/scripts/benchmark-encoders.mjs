// Controlled encoder comparison. Generated pixels only; no desktop capture,
// audio, real inputs, optional drivers, or external services are involved.
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {nativeCapability} from '../src/native-media.js';
import {videoEncoderArguments} from '../src/encoder-scan.js';

const ffmpeg=nativeCapability().ffmpeg;if(!ffmpeg)throw new Error('Install native capture tools first.');
const label=process.env.BENCH_LABEL || '';if(label && !/^[a-z0-9-]{1,40}$/.test(label))throw new Error('Use a short alphanumeric benchmark label.');
const folder=path.resolve('.local/benchmarks/encoders',label);await fs.mkdir(folder,{recursive:true});
const width=1920,height=1080,fps=60,frames=Number(process.env.BENCH_FRAMES || 120),bitrate=8000000,repeats=Number(process.env.BENCH_REPEATS || 3);
if(!Number.isInteger(frames)||frames<60||frames>600||!Number.isInteger(repeats)||repeats<1||repeats>5)throw new Error('Use 60–600 frames and 1–5 repeats.');
const reference=path.join(folder,'generated-reference.yuv');
const scene=`testsrc2=size=${width}x${height}:rate=${fps},noise=alls=8:allf=u:all_seed=42,scroll=horizontal=0.007:vertical=0.003,drawgrid=width=32:height=32:thickness=1:color=white@0.12`;
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length*.5)]:null;};
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]:null;};
function run(args,{trace=false,timeout=45000}={}){
  return new Promise((resolve,reject)=>{
    const started=performance.now(),child=spawn(ffmpeg,['-hide_banner','-nostdin','-y',...args],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    let stderr='',pending='',submitted=0,emitted=0,firstOutputDepth=null,maxDepth=0;const inputs=new Map(),ages=[],calls=[];
    const timer=setTimeout(()=>{child.kill();reject(new Error('Encoder benchmark timed out'));},timeout);
    const line=value=>{
      if(!trace)return;
      let match=value.match(/encoder <- type:video frame_pts:(\d+)/);
      if(match){inputs.set(match[1],performance.now());submitted++;maxDepth=Math.max(maxDepth,submitted-emitted);}
      match=value.match(/encoder -> type:video pkt_pts:(\d+)/);
      if(match){if(firstOutputDepth===null)firstOutputDepth=submitted;emitted++;const at=inputs.get(match[1]);if(at!==undefined && Number(match[1])>=15)ages.push(performance.now()-at);}
      match=value.match(/bench:\s+\d+ user\s+\d+ sys\s+(\d+) real encode_video/);
      if(match && submitted>15)calls.push(Number(match[1])/1000);
    };
    child.stderr.on('data',data=>{const text=String(data);stderr=(stderr+text).slice(-2*1024*1024);pending+=text;for(let end;(end=pending.indexOf('\n'))>=0;){line(pending.slice(0,end));pending=pending.slice(end+1);}});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('exit',code=>{clearTimeout(timer);if(code!==0){const message=stderr.split(/\r?\n/).find(line=>/Cannot load|Error creating|Error initializing|unsupported|not supported|Error opening|Error during|No device|Failed to/i.test(line));reject(new Error((message || stderr.slice(-1000)).slice(0,500)));return;}resolve({stderr,elapsedMs:performance.now()-started,trace:{submitted,emitted,firstOutputDepth,maxDepth,submissionToPacketMedianMs:median(ages),submissionToPacketP95Ms:percentile(ages,.95),encodeCallMedianMs:median(calls),encodeCallP95Ms:percentile(calls,.95)}});});
  });
}
function options(encoder,changes={}){
  const args=videoEncoderArguments(encoder,fps,bitrate);
  for(const [option,value]of Object.entries(changes)){const i=args.indexOf(option);if(i>=0)args[i+1]=String(value);else args.push(option,String(value));}
  return args;
}
const methods=[
  {id:'nvenc-p1',encoder:'h264_nvenc'},
  {id:'nvenc-p2',encoder:'h264_nvenc',changes:{'-preset':'p2'}},
  {id:'nvenc-p4',encoder:'h264_nvenc',changes:{'-preset':'p4'}},
  {id:'hevc-nvenc-p1',encoder:'hevc_nvenc'},
  {id:'hevc-nvenc-p1-6mbps',encoder:'hevc_nvenc',changes:{'-b:v':6000000,'-maxrate':6000000,'-bufsize':100000}},
  {id:'hevc-nvenc-p2',encoder:'hevc_nvenc',changes:{'-preset':'p2'}},
  {id:'hevc-qsv-depth1',encoder:'hevc_qsv'},
  {id:'nvenc-p1-qres',encoder:'h264_nvenc',changes:{'-multipass':'qres'}},
  {id:'nvenc-main-cabac',encoder:'h264_nvenc',changes:{'-profile:v':'main','-coder':'cabac'},offlineOnly:true},
  {id:'qsv-previous-depth4',encoder:'h264_qsv',changes:{'-async_depth':4}},
  {id:'qsv-depth1-small-vbv',encoder:'h264_qsv',changes:{'-async_depth':1,'-low_delay_brc':1,'-bufsize':Math.ceil(bitrate/fps)}},
  {id:'qsv-depth1',encoder:'h264_qsv',changes:{'-async_depth':1}},
  {id:'qsv-depth1-brc',encoder:'h264_qsv',changes:{'-async_depth':1,'-low_delay_brc':1}},
  {id:'qsv-medium-depth1',encoder:'h264_qsv',changes:{'-preset':'medium','-async_depth':1}},
  {id:'amf-current',encoder:'h264_amf'},
  {id:'cpu-veryfast',encoder:'libx264'},
  {id:'cpu-ultrafast',encoder:'libx264',changes:{'-preset':'ultrafast'}},
].filter(method=>!process.env.BENCH_METHODS || process.env.BENCH_METHODS.split(',').includes(method.id));
if(!methods.length)throw new Error('No matching benchmark methods');
const rawInput=['-f','rawvideo','-pixel_format','yuv420p','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i',reference];
const report={generatedAt:new Date().toISOString(),platform:os.platform(),cpu:os.cpus()[0]?.model,settings:{width,height,fps,frames,bitrate,repeats,scene},notes:['Generated scrolling textured test scene, not a real game.','Raw-memory uploads are included; native WGC GPU texture capture avoids those uploads.','Submission-to-packet estimates use debug-log arrival times, with possible sub-millisecond pipe batching error.','Encode-call timing includes FFmpeg send/receive calls; asynchronous encoders may return before a packet is available.','Startup-inclusive throughput is not steady-state maximum throughput: the first hardware initialization can dominate a short run. Do not rank encoder speed by that column. SSIM/PSNR compare decoded frames against identical generated source frames.','Main/CABAC is an offline-only comparison: the app currently negotiates baseline H.264.'],methods:[]};
try{
  console.log('Generating one reference scene for all methods…');
  await run(['-loglevel','error','-f','lavfi','-i',scene,'-frames:v',String(frames),'-pix_fmt','yuv420p','-f','rawvideo',reference]);
  for(const method of methods){
    const format=method.encoder.startsWith('hevc_')?'hevc':'h264',args=options(method.encoder,method.changes),file=path.join(folder,method.id+'.'+format),result={...method,args};
    try{
      const throughput=await run(['-loglevel','info','-benchmark',...rawInput,'-frames:v',String(frames),...args,'-f',format,file]);
      result.startupInclusiveFPS=frames/(throughput.elapsedMs/1000);result.bytes=(await fs.stat(file)).size;result.actualMbps=result.bytes*8/(frames/fps)/1e6;
      result.runs=[];
      for(let repeat=0;repeat<repeats;repeat++){
        const {trace}=await run(['-loglevel','verbose','-debug_ts','-benchmark_all','-readrate','1',...rawInput,'-frames:v',String(frames),...args,'-f','null','-'],{trace:true});
        assert.equal(trace.submitted,frames,'Every generated frame must reach the encoder');assert.equal(trace.emitted,frames,'Every frame must produce a packet');
        assert.ok(Number.isFinite(trace.submissionToPacketMedianMs),'Encoder timing samples must be readable');result.runs.push(trace);
      }
      const quality=await run(['-loglevel','info',...rawInput,'-r',String(fps),'-i',file,'-filter_complex',`[0:v]settb=AVTB,setpts=N/${fps}/TB,split[r1][r2];[1:v]settb=AVTB,setpts=N/${fps}/TB,split[d1][d2];[d1][r1]ssim[s];[d2][r2]psnr[p]`,'-map','[s]','-map','[p]','-f','null','-']);
      result.ssim=Number(quality.stderr.match(/SSIM.*All:([\d.]+)/)?.[1]);result.psnr=Number(quality.stderr.match(/PSNR.*average:([\d.]+)/)?.[1]);
      assert.ok(Number.isFinite(result.ssim) && Number.isFinite(result.psnr),'Quality comparison must produce valid scores');
      result.packetMedianMs=median(result.runs.map(run=>run.submissionToPacketMedianMs));result.packetP95Ms=median(result.runs.map(run=>run.submissionToPacketP95Ms));result.queueDepth=median(result.runs.map(run=>run.firstOutputDepth));
      result.available=true;
      console.log(JSON.stringify({method:method.id,packetMs:result.packetMedianMs,p95:result.packetP95Ms,queuedFrames:result.queueDepth,ssim:result.ssim,psnr:result.psnr,fps:result.startupInclusiveFPS}));
    }catch(error){result.available=false;result.error=error.message;console.log(JSON.stringify({method:method.id,unavailable:result.error}));}
    report.methods.push(result);await fs.writeFile(path.join(folder,'results.json'),JSON.stringify(report,null,2)+'\n');
  }
  const n=value=>Number.isFinite(value)?value.toFixed(2):'—';
  const rows=report.methods.map(method=>method.available?`| ${method.id} | ${n(method.packetMedianMs)} | ${n(method.packetP95Ms)} | ${method.queueDepth} | ${n(method.startupInclusiveFPS)} | ${n(method.ssim*100)}% | ${n(method.psnr)} | ${n(method.actualMbps)} |`:`| ${method.id} | Unavailable: ${method.error.replaceAll('|','/')} | — | — | — | — | — | — |`);
  await fs.writeFile(path.join(folder,'results.md'),`# Encoder benchmark\n\n${width}×${height} at ${fps} fps, ${bitrate/1e6} Mbps target, ${frames} generated frames, ${repeats} paced repeats per method.\n\n| Method | Submit→packet median ms | p95 ms | Frames submitted before first packet | Startup-inclusive fps | SSIM | PSNR dB | Actual Mbps |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n\n${report.notes.map(note=>'- '+note).join('\n')}\n`);
  console.log(`Saved reports to ${folder}`);
}finally{await fs.unlink(reference).catch(()=>{});}
