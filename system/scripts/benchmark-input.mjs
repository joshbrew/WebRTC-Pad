// Payload size and local codec cost only; not an Internet latency estimate.
import fs from 'node:fs/promises';
import {neutralState} from '../public/input.js';
import {encodeInputPacket,decodeInputPacket} from '../public/input-wire.js';
const packets=Array.from({length:256},(_,seq)=>{
  const state=neutralState();state.buttons.a=!!(seq%2);state.axes.lx=Math.sin(seq);state.axes.ly=Math.cos(seq);state.axes.rt=seq/255;
  return {seq,controller:seq%3,generation:5,source:'gamepad',state};
});
const iterations=100000,results=[];let checksum=0;
for(const method of [{id:'json',encode:JSON.stringify,decode:JSON.parse,bytes:v=>new TextEncoder().encode(v).byteLength},{id:'binary-v1',encode:encodeInputPacket,decode:decodeInputPacket,bytes:v=>v.byteLength}]){
  for(let i=0;i<3000;i++)method.decode(method.encode(packets[i%256]));
  const encoded=packets.map(method.encode),sizes=encoded.map(method.bytes),runs=[];
  for(let repeat=0;repeat<3;repeat++){
    let start=performance.now();for(let i=0;i<iterations;i++){const output=method.encode(packets[i%256]);checksum+=typeof output==='string'?output.length:output.byteLength;}const encodeMs=performance.now()-start;
    start=performance.now();for(let i=0;i<iterations;i++)checksum+=method.decode(encoded[i%256]).seq;const decodeMs=performance.now()-start;runs.push({encodeMs,decodeMs});
  }
  results.push({method:method.id,meanBytes:sizes.reduce((a,b)=>a+b,0)/sizes.length,minBytes:Math.min(...sizes),maxBytes:Math.max(...sizes),runs});
}
const report={generatedAt:new Date().toISOString(),iterations,repeats:3,notes:['Canonical controller snapshots, identical state and lossless float64 axes.','CPU encode measurements include constant-time output-length accounting; UTF-8 size conversion is outside the timed loop.','Payload bytes exclude SCTP/DTLS/UDP/IP overhead; savings do not imply a measured Internet latency reduction.'],results,checksum};
await fs.mkdir('.local/benchmarks/input',{recursive:true});await fs.writeFile('.local/benchmarks/input/results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
