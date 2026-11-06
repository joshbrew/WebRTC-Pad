import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {guestLaunchPlan,projectRoot} from './guest-runtime.js';
import {guestPlatform} from '../public/guest-platform.js';
import {readInputDriverPreferences} from './input-driver-choice.js';
export function guestInputCapability(platform=process.platform,root=projectRoot){
  let available=false;try{guestLaunchPlan(platform,root);available=true;}catch{}
  const info=guestPlatform(platform);
  const choice=platform==='win32'?readInputDriverPreferences(root):null;
  return {available,platform,installDeclined:choice?.hidHide===false,installApproved:choice?.hidHide===true,error:available?null:info.setup?`Run ${info.setup} on this computer to install or update native guest input.`:'Native guest input is unavailable on this platform. Browser sharing remains available.'};
}

// Controller reservation can use a local page lease before joining a call.
// Keyboard/mouse capture still requires the remote control-channel lease.
export class GuestInputService {
  constructor({capability=guestInputCapability(),launch=()=>{const plan=guestLaunchPlan(capability.platform);return spawn(plan.command,plan.args,plan.options);},now=()=>performance.now(),leaseMs=1800}={}){
    this.capability=capability;this.launch=launch;this.now=now;this.leaseMs=leaseMs;
    this.clients=new Set();this.hosting=false;
    this.timer=setInterval(()=>this.tick(),100);this.timer.unref?.();
  }
  attach(ws){
    this.clients.add(ws);
    const send=value=>{if(ws.readyState===1 && ws.bufferedAmount<65536)ws.send(JSON.stringify(value));};
    send({type:'capability',...this.capability});
    send({type:'hosting',active:this.hosting});
    ws.on('message',raw=>{try{
      const msg=JSON.parse(raw);if(!['list','identify','start','stop','heartbeat','rumble'].includes(msg?.type))return;
      if(this.hosting && msg.type!=='stop'){send({type:'hosting',active:true});return;}
      if(!this.capability.available){send({type:'error',error:this.capability.error});return;}
      if(this.owner && this.owner!==ws){send({type:'error',error:'Another local window is using native input. Release its devices first.'});return;}
      if(msg.type==='stop'){this.stop('Devices released.');return;}
      if(msg.type==='rumble'){if(this.owner===ws && this.child && this.capability.platform==='win32' && this.selection?.includes(msg.device) && msg.device.startsWith('pad:') && [msg.large,msg.small].every(v=>typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1) && this.now()-(this.rumbleAt || 0)>=40){this.rumbleAt=this.now();this.write({type:'rumble',device:msg.device,large:msg.large,small:msg.small});}return;}
      if(msg.type==='heartbeat'){if(this.owner===ws && this.child && (this.localReservation?msg.local===true:msg.connected===true)){this.lease=this.now();this.write({type:'heartbeat'});}return;}
      if(!this.child)this.open(ws,send);
      if(msg.type==='start'){
        const localReservation=msg.local===true;
        if(!localReservation && msg.connected!==true)throw new Error('Connect to the host before taking exclusive control of a device.');
        if(!Array.isArray(msg.devices) || !msg.devices.length || msg.devices.length>256 || new Set(msg.devices).size!==msg.devices.length || msg.devices.some(id=>typeof id!=='string' || !this.devices?.some(d=>d.id===id && d.available)))throw new Error('Refresh the list and select available devices.');
        if(localReservation && msg.devices.some(id=>!this.devices.some(d=>d.id===id && d.kind==='gamepad' && id.startsWith('pad:'))))throw new Error('Local reservation supports controllers only. Connect to the host before sharing a keyboard or mouse.');
        this.localReservation=localReservation;
        this.selection=[...msg.devices];this.lease=this.now();this.write({type:'start',devices:msg.devices});
      }else if(msg.type==='identify'){this.lease=this.now();this.identifying=true;this.write({type:'identify'});}
      else if(this.ready)this.write({type:'list'});
    }catch(error){send({type:'error',error:error.message});}});
    ws.on('close',()=>{this.clients.delete(ws);if(this.owner===ws)this.stop('Local page closed. Devices released.');});ws.on('error',()=>ws.terminate());
  }
  async setHosting(active){
    this.hosting=active===true;
    const released=this.hosting?this.stop('Hosting on this computer. Local inputs released.'):Promise.resolve();
    for(const ws of this.clients)if(ws.readyState===1)ws.send(JSON.stringify({type:'hosting',active:this.hosting}));
    if(await released===false)throw new Error('Local input blocking is still shutting down. Wait a moment before starting your session.');
  }
  open(ws,send){
    this.owner=ws;this.send=send;this.devices=[];this.ready=false;this.active=false;this.identifying=false;
    let child;try{child=this.child=this.launch();}catch(error){this.clear();throw error;}let stderr='';
    child.stdin.on('error',()=>{if(this.child===child)this.stop('Input reader connection failed. Devices released.');});
    child.stderr?.on('data',value=>{stderr=(stderr+value).slice(-2000);});
    createInterface({input:child.stdout}).on('line',line=>{
      if(this.child!==child)return;if(line.length>131072){this.stop('Native reader sent too much data. Devices released.');return;}
      let value;try{value=JSON.parse(line);}catch{return;}
      if(value.type==='devices')this.devices=Array.isArray(value.devices)?value.devices:[];
      if(value.type==='ready')this.ready=true;
      if(value.type==='active'){this.active=true;this.identifying=false;}
      if(value.type==='released' || value.type==='error'){this.active=false;this.identifying=false;this.selection=[];}
      if(ws.bufferedAmount>65536){this.stop('Local input connection is congested. Devices released.');return;}
      this.send?.(value.type==='active'?{...value,local:this.localReservation===true}:value);
    });
    child.on('error',error=>{if(this.child===child){this.send?.({type:'error',error:`Native input could not start: ${error.message}`});this.stop('Native reader stopped. Devices released.');}});
    child.on('exit',()=>{if(this.child===child){this.send?.({type:'released',reason:'Native reader stopped. Devices released.',...(stderr?{detail:stderr}:{})});this.clear();}});
  }
  write(value){if(this.child && !this.child.stdin.destroyed && !this.child.stdin.writableEnded)this.child.stdin.write(JSON.stringify(value)+'\n',error=>{if(error)this.stop('Input reader connection failed. Devices released.');});}
  tick(){if((this.active || this.identifying || this.selection?.length) && this.now()-this.lease>this.leaseMs)this.stop(this.localReservation?'Local page stopped responding. Controllers released.':'Host connection stopped responding. Devices released.');}
  clear(){this.child=null;this.owner=null;this.send=null;this.active=false;this.identifying=false;this.selection=[];this.ready=false;this.localReservation=false;}
  stop(reason='Devices released.'){
    const child=this.child,send=this.send;this.clear();
    let released=this.releasing || Promise.resolve(true);
    if(child){
      const previous=released;
      const pending=new Promise(resolve=>{
        let finished=false;
        const finish=ok=>{if(finished)return;finished=true;clearTimeout(killTimer);clearTimeout(deadline);resolve(ok);};
        const killTimer=setTimeout(()=>{try{if(child.exitCode===null)child.kill();}catch{finish(false);}},500);
        const deadline=setTimeout(()=>finish(child.exitCode!==null),5000);
        killTimer.unref?.();deadline.unref?.();
        child.once('exit',()=>finish(true));
        if(child.exitCode!==null)finish(true);else {try{child.stdin.end();}catch{try{child.kill();}catch{finish(false);}}}
      });
      released=this.releasing=Promise.all([previous,pending]).then(results=>results.every(Boolean));
      released.then(()=>{if(this.releasing===released)this.releasing=null;});
    }
    send?.({type:'released',reason});
    return released;
  }
  close(){clearInterval(this.timer);this.stop('App closed. Devices released.');}
}
