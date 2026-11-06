"use strict";
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const {EventEmitter}=require('node:events');
function startHelper(command, args, encode = (slot, state) => JSON.stringify({ slot, state }) + '\n', encodeCommand = message => JSON.stringify(message)+'\n',{env=process.env,startupMs=8000,commandMs=8000}={}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env:{...process.env,...env},stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let ready = false, closed = false, failure = null, stderr = '';
    const pending=new Map(),feedback=new Set(),events=new EventEmitter();let sequence=0;
    const timer = setTimeout(() => fail(new Error('Controller helper startup timed out')), startupMs);
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-4096); });
    const fail = error => {if(failure || closed)return;failure = error; clearTimeout(timer); for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}pending.clear();if (!ready) reject(error);else events.emit('failure',error);if(child.exitCode===null)child.kill();};
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.on('exit', (code) => fail(new Error(stderr.trim() || `Controller helper exited (${code})`)));
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if(line.startsWith('{')) {
        let reply;try{reply=JSON.parse(line);}catch{return;}
        if(reply.type==='rumble' && /^p[1-9]\d*$/.test(reply.slot) && [reply.large,reply.small].every(v=>typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1)){for(const listener of feedback)listener(reply);return;}
        const request=pending.get(reply.id);if(!request)return;
        pending.delete(reply.id);clearTimeout(request.timer);
        if(reply.error)request.reject(new Error(reply.error));else request.resolve(reply.value);return;
      }
      if (line !== 'READY' || ready) return;
      clearTimeout(timer); ready = true;
      resolve({
        on:events.on.bind(events),
        onFeedback(listener){feedback.add(listener);return ()=>feedback.delete(listener);},
        setState(slot, state) {
          if (failure) throw failure;
          if (closed) throw new Error('Controller helper is closed');
          if (child.stdin.writableLength > 32768) throw new Error('Controller helper is not keeping up');
          child.stdin.write(encode(slot, state));
        },
        command(type,slot) {
          if(failure || closed)return Promise.reject(failure || new Error('Controller helper is closed'));
          const id=++sequence;return new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>fail(new Error('Controller device change timed out')),commandMs);
            pending.set(id,{resolve,reject,timer});child.stdin.write(encodeCommand({type,slot,id}));
          });
        },
        close() { if (!closed) { closed = true; for(const request of pending.values()){clearTimeout(request.timer);request.reject(new Error('Controller helper closed'));}pending.clear();child.stdin.end(); const kill = setTimeout(() => child.kill(), 1000); kill.unref(); child.once('exit', () => clearTimeout(kill)); } }
      });
    });
  });
}
module.exports = { startHelper };
