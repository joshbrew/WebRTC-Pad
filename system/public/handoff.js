import {gatherIce,sanitizeIceConfig} from './pairing.js';
import {inputChannelOptions} from './rtc.js';

export function validHandoffMap(members,target,mapping){
  if(!validHandoffMembers(members,target) || !mapping || typeof mapping!=='object' || Array.isArray(mapping) || mapping[target]!=='host' || Object.keys(mapping).length!==members.length)return false;
  const ids=members.map(member=>mapping[member.id]);
  return ids.every(id=>typeof id==='string' && /^[a-zA-Z0-9-]{1,64}$/.test(id)) && new Set(ids).size===ids.length;
}
export function validHandoffMembers(members,target){return Array.isArray(members) && members.length>=2 && members.every(m=>m && typeof m.id==='string' && /^[a-zA-Z0-9-]{1,64}$/.test(m.id)) && target!=='host' && members.some(m=>m.id==='host') && members.some(m=>m.id===target) && new Set(members.map(m=>m.id)).size===members.length;}
export function waitFor(check,message,timeout=30000){
  return new Promise((resolve,reject)=>{const end=Date.now()+timeout;const tick=()=>{try{if(check())return resolve();if(Date.now()>=end)return reject(Error(message));setTimeout(tick,40);}catch(error){reject(error);}};tick();});
}

// Stage controller-only connections while the old game and voice keep running.
// The application adopts these exact PCs only after every route is ready.
export class StagedControls{
  constructor(ice,offerer=false){
    this.pc=new RTCPeerConnection(sanitizeIceConfig(ice));this.channels=new Map();this.messages=new Map();
    const add=channel=>{if(!['input','control','desktop','desktop-events','chat','files'].includes(channel.label) || this.channels.has(channel.label)){channel.close();return;}this.channels.set(channel.label,channel);this.messages.set(channel.label,[]);channel.binaryType='arraybuffer';channel.onmessage=event=>{const queue=this.messages.get(channel.label);if(queue.length<64)queue.push(event);};};
    this.pc.ondatachannel=event=>add(event.channel);
    if(offerer)for(const [label,options] of [['input',inputChannelOptions],['control',{}],['desktop',inputChannelOptions],['desktop-events',{priority:'high'}],['chat',{ordered:true,priority:'very-low'}],['files',{ordered:true,priority:'very-low'}]])add(this.pc.createDataChannel(label,options));
  }
  async offer(){await this.pc.setLocalDescription(await this.pc.createOffer());await gatherIce(this.pc);return this.pc.localDescription.toJSON();}
  async remote(description){
    if(!['offer','answer'].includes(description?.type) || typeof description.sdp!=='string' || description.sdp.length>98304 || /^m=(?:audio|video)\s/m.test(description.sdp))throw Error('Invalid controller handoff description');
    await this.pc.setRemoteDescription(description);
  }
  async answer(description){await this.remote(description);await this.pc.setLocalDescription(await this.pc.createAnswer());await gatherIce(this.pc);return this.pc.localDescription.toJSON();}
  ready(){return waitFor(()=>{if(['failed','closed'].includes(this.pc.connectionState))throw Error('The new connection failed');return this.pc.connectionState==='connected' && ['input','control','desktop','desktop-events','chat'].every(label=>this.channels.get(label)?.readyState==='open');},'The new host could not connect to everyone');}
  flush(){for(const [label,events] of this.messages){const channel=this.channels.get(label);for(const event of events.splice(0))channel.onmessage?.(event);}}
  close(){if(!this.adopted)this.pc.close();}
}

export class HostHandoff{
  constructor(api){this.api=api;this.state=null;}
  get busy(){return !!this.state;}
  owns(channel){const s=this.state;return !!s && (s.upstream===channel || [...s.links.values()].includes(channel));}
  packet(s,action,extra={}){return {type:'host-handoff',id:s.id,action,...extra};}
  send(channel,message){if(channel?.readyState!=='open')throw Error('A participant disconnected');if(channel.bufferedAmount>262144)throw Error('The connection is busy. Try the handoff again.');channel.send(JSON.stringify(message));}
  to(s,id,action,extra={}){if(id==='host')return this.receive('host',this.packet(s,action,extra),null);this.send(s.links.get(id),this.packet(s,action,extra));}
  upstream(s,action,extra={}){this.send(s.upstream,this.packet(s,action,extra));}
  startState(value){const s={...value,stages:new Map(),committed:new Set(),phase:'preparing'};this.state=s;s.timer=setTimeout(()=>this.cancel('Host switch timed out. The current session is kept.'),90000);s.watch=setInterval(()=>{if(s.phase!=='committing' && (s.coordinator?[...s.links.values()]:[s.upstream]).some(ch=>ch?.readyState!=='open'))this.cancel('A participant disconnected. Host switch cancelled.');},500);this.api.status('Preparing host switch…',true);this.api.lock(true);return s;}
  request(target){
    if(this.busy || !this.api.isHost())return;
    const members=this.api.members(),links=this.api.links();if(!links.has(target))return;
    const s=this.startState({id:crypto.randomUUID(),target,members,links,coordinator:true,old:this.api.snapshot()});s.phase='asking';
    try{this.to(s,target,'request',{target,members});this.api.status('Waiting for your guest to accept…',true);}catch(error){this.cancel(error.message);}
  }
  receive(from,message,channel){
    if(message?.type!=='host-handoff' || typeof message.id!=='string' || message.id.length>64)return;
    if(message.action==='request'){
      if(this.busy || this.api.isHost() || channel!==this.api.upstream())return;
      if(!validHandoffMembers(message.members,message.target))return;
      if(!this.api.canHost() || !this.api.confirm()){this.send(channel,{type:'host-handoff',id:message.id,action:'declined'});return;}
      const s=this.startState({id:message.id,target:message.target,members:message.members,links:new Map(),upstream:channel,old:this.api.snapshot(),promoted:true});
      this.upstream(s,'accepted');return;
    }
    const s=this.state;
    // Prepare reaches the other guests after the selected guest accepts.
    if(!s && message.action==='prepare' && !this.api.isHost() && channel===this.api.upstream()){
      if(!validHandoffMembers(message.members,message.target))return;
      this.startState({id:message.id,target:message.target,members:message.members,links:new Map(),upstream:channel,old:this.api.snapshot()});return;
    }
    if(!s || message.id!==s.id || (s.coordinator?from!=='host' && s.links.get(from)!==channel:s.upstream!==channel))return;
    this.handle(s,from,message).catch(error=>{if(s.phase==='committing')this.interrupted(s,error.message);else this.cancel(error.message);});
  }
  async handle(s,from,message){
    if(s!==this.state)return;
    if(message.action==='declined' && s.coordinator && from===s.target){this.cancel('Your guest declined. You are still hosting.');return;}
    if(message.action==='accepted' && s.coordinator && from===s.target && s.phase==='asking'){
      s.phase='preparing';for(const id of s.links.keys())this.to(s,id,'prepare',{target:s.target,members:s.members});return;
    }
    if(message.action==='prepare' && s.promoted && !s.preparing){
      s.preparing=true;await this.api.prepare(s);if(this.state!==s)return;
      s.mapping={[s.target]:'host'};
      await Promise.all(s.members.filter(member=>member.id!==s.target).map(async member=>{
        const info=await this.api.register(member,s);if(this.state!==s)return;
        const transport=new StagedControls(info.ice,true);s.stages.set(member.id,{transport,info});s.mapping[member.id]=info.peerId;
        const description=await transport.offer();if(this.state!==s){transport.close();return;}
        this.upstream(s,'relay',{to:member.id,payload:{action:'offer',info:{...info,sdp:description}}});
      }));return;
    }
    if(message.action==='relay' && s.coordinator && s.phase==='preparing'){
      const payload=message.payload;
      if(from===s.target && payload?.action==='offer' && message.to!==s.target && s.members.some(m=>m.id===message.to))this.to(s,message.to,'signal',{from:s.target,payload});
      else if(from!==s.target && message.to===s.target && payload?.action==='answer')this.to(s,s.target,'signal',{from,payload});return;
    }
    if(message.action==='signal' && s.phase==='preparing'){
      if(message.payload?.action==='offer' && !s.promoted && message.from===s.target && !s.client){
        const info=message.payload.info,transport=new StagedControls(info.ice);s.client={info,transport};
        const sdp=await transport.answer(info.sdp);if(this.state!==s){transport.close();return;}
        const payload={action:'answer',sdp};if(s.coordinator)await this.handle(s,'host',this.packet(s,'relay',{to:s.target,payload}));else this.upstream(s,'relay',{to:s.target,payload});
      }else if(message.payload?.action==='answer' && s.promoted){
        const stage=s.stages.get(message.from);if(!stage || stage.answered)return;stage.answered=true;await stage.transport.remote(message.payload.sdp);await stage.transport.ready();stage.ready=true;
        if(this.state===s && s.stages.size===s.members.length-1 && [...s.stages.values()].every(p=>p.ready) && !s.prepared){s.prepared=true;this.upstream(s,'prepared',{mapping:s.mapping});}
      }return;
    }
    if(message.action==='prepared' && s.coordinator && from===s.target && s.phase==='preparing'){
      if(!validHandoffMap(s.members,s.target,message.mapping))throw Error('Invalid host switch membership');
      s.mapping=message.mapping;s.phase='committing';clearTimeout(s.timer);s.timer=setTimeout(()=>this.interrupted(s,'A participant did not finish switching.'),30000);
      const extra={mapping:s.mapping,voice:this.api.voiceRoster(),cameras:this.api.cameraRoster?.() || [],chat:this.api.chatSnapshot?.(),moderation:this.api.moderationSnapshot?.(),screens:this.api.screenRoster?.() || [],screenPolicy:this.api.screenPolicy?.()};
      for(const id of s.links.keys())this.to(s,id,'commit',extra);await this.apply(s,extra);return;
    }
    if(message.action==='commit' && !s.coordinator && s.phase==='preparing'){await this.apply(s,message);return;}
    if(message.action==='committed' && s.coordinator){s.committed.add(from);if(s.committed.size===s.members.length)this.finish(s);return;}
    if(message.action==='finalize' && !s.coordinator){if(s.applied)this.finalize(s);else s.finalizePending=true;return;}
    if(message.action==='interrupted' && s.phase==='committing'){this.interrupted(s,'A participant could not finish switching.',!s.coordinator);return;}
    if(message.action==='cancel' && s.phase!=='committing'){this.cancel(message.reason || 'Host switch cancelled.',!s.coordinator);}
  }
  async apply(s,message){
    if(s.applying || s.applied)return;
    if(!validHandoffMap(s.members,s.target,message.mapping) || !Array.isArray(message.voice))throw Error('Invalid host switch membership');
    if(s.promoted?s.stages.size!==s.members.length-1 || [...s.stages.values()].some(stage=>!stage.ready):!s.client)throw Error('The new controller connections are not ready');
    s.phase='committing';s.applying=true;s.mapping=message.mapping;this.api.status('Switching host…',false);
    clearTimeout(s.timer);s.timer=setTimeout(()=>this.interrupted(s,'The host switch did not finish.'),30000);
    await this.api.commit(s,message.voice,Array.isArray(message.cameras)?message.cameras:[],message.chat,message.moderation,Array.isArray(message.screens)?message.screens:[],message.screenPolicy);s.applied=true;
    if(s.coordinator){s.committed.add('host');if(s.committed.size===s.members.length)this.finish(s);}else this.upstream(s,'committed');
    if(s.finalizePending)this.finalize(s);
  }
  finish(s){if(this.state!==s)return;if(!s.applied || s.committed.size!==s.members.length){this.api.status('The host switch is waiting for a participant. Reconnect if they left the call.',false);return;}for(const id of s.links.keys())try{this.to(s,id,'finalize');}catch{}this.finalize(s);}
  finalize(s){if(this.state!==s)return;clearTimeout(s.timer);clearInterval(s.watch);this.api.finalize(s);this.state=null;this.api.lock(false);this.api.status(s.promoted?'You are hosting. Choose a window or screen to share.':'Host switched. Your voice and cameras stay connected.',false);}
  interrupted(s,reason,quiet=false){
    if(this.state!==s)return;
    if(!quiet){if(s.coordinator){for(const id of s.links.keys())try{this.to(s,id,'interrupted');}catch{}}else try{this.upstream(s,'interrupted');}catch{}}
    clearTimeout(s.timer);clearInterval(s.watch);this.state=null;
    for(const stage of s.stages.values())stage.transport.close();s.client?.transport.close();
    this.api.interrupted(s);this.api.lock(false);this.api.status(`Host switch interrupted: ${reason} End the session and reconnect if needed.`,false);
  }
  cancel(reason='Host switch cancelled.',quiet=false){
    const s=this.state;if(!s || s.phase==='committing')return;
    if(!quiet){if(s.coordinator){for(const id of s.links.keys())try{this.to(s,id,'cancel',{reason});}catch{}}else try{this.upstream(s,'cancel',{reason});}catch{}}
    clearTimeout(s.timer);clearInterval(s.watch);this.state=null;for(const stage of s.stages.values())stage.transport.close();s.client?.transport.close();Promise.resolve(this.api.rollback(s)).catch(()=>{});this.api.lock(false);this.api.status(reason,false);
  }
}
