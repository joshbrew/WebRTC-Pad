import {rememberControls,restoreDevice} from './call-comfort.js';
import {voiceDescription,voiceBudget} from './voice-quality.js';
import {extraVoiceControls} from './voice-controls.js';

const mutedListeners=value=>Array.isArray(value)?value.filter(id=>typeof id==='string' && /^[a-zA-Z0-9-]{1,64}$/.test(id)).slice(0,256):[];

// The host forwards signaling only. Each voice participant sends audio straight
// to the others, with no host audio mixer or extra encode/decode pass.
export class VoiceRoom{
  constructor(root,{host=false,ice=async()=>({iceServers:[]}),trackPeer=pc=>pc}={}){
    Object.assign(this,{root,host,getIce:ice,trackPeer});this.controls=new Map();this.members=new Map();this.peers=new Map();this.epoch=0;this.ready=false;this.guestMicAllowed=host;
    this.self=host?'host':null;this.roster=[];this.localMuted=new Set();this.micBlocks=new Set();
    root.innerHTML=`<div class="section-heading"><h3>Voice chat</h3><span data-voice="count" class="small muted"></span></div>
      <div class="row voice-actions"><button data-voice="join" class="button secondary">Join voice</button><button data-voice="listen" class="button small-button">Listen only</button><button data-voice="mic" class="button control" hidden>Mute mic</button><button data-voice="leave" class="button small-button" hidden>Leave voice</button><button data-voice="play" class="button small-button" hidden>Play voices</button></div>
      <p data-voice="status" class="small" role="status"></p><p data-voice="capture-note" class="small muted" hidden></p>
      <div class="voice-preflight" data-voice="preflight"><button data-voice="preview" class="button secondary" type="button">Turn microphone on</button><label class="voice-input-meter">Microphone level <meter data-voice="level" min="0" max="1" value="0"></meter></label><p class="small muted">Private mic test. Speak to check the level. Your mic joins the call only if the host allows it.</p></div>
      <details class="advanced voice-preferences"><summary>Devices &amp; sound</summary>
        <div class="voice-device-fields"><div class="voice-mic-field"><label class="field-label">Microphone<select data-voice="device"><option value="default">Default microphone</option></select></label><button data-voice="refresh" class="button small-button" title="Refresh audio devices" aria-label="Refresh audio devices"><svg class="icon" aria-hidden="true"><use href="#i-refresh"/></svg></button></div>
        <label data-voice="output-field" class="field-label">Speakers<select data-voice="output"><option value="">Default speakers</option></select></label></div>
        <label class="field-label voice-master-volume">Call volume<input data-voice="volume" type="range" min="0" max="1" step="0.05" value="1" /></label>
        <details class="advanced voice-tuning"><summary>Sound quality</summary>
          <label class="field-label">Quality limit<select data-voice="quality"><option value="128000">High &middot; 128 kb/s</option><option value="192000">Highest &middot; 192 kb/s</option></select></label>
          <label class="check-row"><input data-voice="automatic" type="checkbox" checked /> Adjust quality automatically</label>
          <label class="check-row"><input data-voice="gain" type="checkbox" checked /> Balance microphone volume</label>
          <label class="check-row"><input data-voice="clean" type="checkbox" checked /> Reduce echo &amp; background noise</label>
          <p class="small muted">Use headphones for clearer sound. Turn off noise reduction for a more natural microphone. Automatic quality adjusts between 64 kb/s and your limit.</p><p data-voice="detail" class="small muted"></p>
        </details>
      </details><div data-voice="audio" hidden></div>`;
    this.$=name=>root.querySelector(`[data-voice="${name}"]`);
    rememberControls(root,'voice',['device','quality','automatic','gain','clean','output','volume']);
    this.$('join').onclick=()=>this.join(true);this.$('listen').onclick=()=>this.join(false);
    this.$('preview').onclick=()=>this.previewMicrophone();
    this.$('leave').onclick=()=>this.leave();this.$('mic').onclick=()=>this.toggleMic();
    this.$('refresh').onclick=()=>this.devices();this.$('device').onchange=()=>{if(this.mic)this.microphone().catch(error=>this.error(error));};
    for(const name of ['clean','gain'])this.$(name).onchange=()=>this.mic?.getAudioTracks()[0]?.applyConstraints(this.constraints()).catch(error=>this.error(error));
    for(const name of ['automatic','quality'])this.$(name).onchange=()=>{for(const p of this.peers.values()){p.budget=null;this.tune(p).catch(()=>{});}};
    this.$('volume').oninput=()=>{this.extra?.updateVolumes();this.onChange?.();};
    this.$('play').onclick=()=>this.play();
    this.$('output-field').hidden=typeof HTMLMediaElement.prototype.setSinkId!=='function';
    this.$('output').onchange=()=>{for(const p of this.peers.values())this.playPeer(p);};
    this.deviceChange=()=>this.devices();navigator.mediaDevices?.addEventListener('devicechange',this.deviceChange);
    window.addEventListener('pagehide',()=>this.leave());this.extra=extraVoiceControls(this);this.devices();this.render();
  }
  setPreparing(value){if(this.preparing===value)return;this.preparing=value;if(!value && !this.ready)this.leave();this.root.hidden=!this.ready && !value;this.render();}
  async previewMicrophone(){
    if(this.ready || !this.preparing)return;
    if(this.mic || this.micBusy){this.leave();return;}
    this.joinPreparedMic=true;this.micBusy=true;this.muted=false;this.render();const epoch=this.epoch;
    try{if(await this.microphone()){if(this.ready && this.canSpeak())await this.join(true);else this.status('Private microphone test · not shared.');}}catch(error){if(epoch===this.epoch){this.joinPreparedMic=false;this.error(error);}}
    finally{if(epoch===this.epoch){this.micBusy=false;this.render();}}
  }
  stopMeter(){clearInterval(this.meterTimer);this.meterTimer=null;this.meterStream=null;this.meterContext?.close().catch(()=>{});this.meterContext=null;this.$('level').value=0;}
  meter(){
    const stream=!this.ready && this.preparing?this.mic:null;if(this.meterStream===stream)return;this.stopMeter();if(!stream)return;
    try{const context=new AudioContext(),source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();analyser.fftSize=256;source.connect(analyser);this.meterContext=context;this.meterStream=stream;context.resume().catch(()=>{});const data=new Float32Array(256);this.meterTimer=setInterval(()=>{analyser.getFloatTimeDomainData(data);this.$('level').value=Math.min(1,Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length)*4);},80);}catch{this.stopMeter();}
  }
  canSpeak(){return !this.awaitingPolicy && (this.host || this.guestMicAllowed!==false);}
  memberAllowed(id){return id==='host' || this.guestMicAllowed!==false && !this.micBlocks?.has(id);}
  setMemberAllowed(id,allowed){if(!this.host || id==='host')return;allowed?this.micBlocks.delete(id):this.micBlocks.add(id);if(!allowed && this.members.has(id))this.members.get(id).mic=false;this.broadcast();}
  setLocalMuted(id,muted){muted?this.localMuted.add(id):this.localMuted.delete(id);this.announce();this.render();}
  applyMutes(){for(const p of this.peers.values())if(p.audio)p.audio.muted=this.localMuted.has(p.id) || this.roster.find(m=>m.id===p.id)?.micAllowed===false || this.host && !this.memberAllowed(p.id);}
  setGuestMicAllowed(value){
    const changed=this.guestMicAllowed!==value;this.guestMicAllowed=value;if(!changed && !(this.ready && !value && (this.mic || this.micBusy)))return;
    if(!this.host && !value){this.micToggleRequest=(this.micToggleRequest || 0)+1;this.micBusy=false;this.micRequest=(this.micRequest || 0)+1;this.mic?.getTracks().forEach(t=>t.stop());this.mic=null;this.muted=true;for(const p of this.peers.values())p.sender?.replaceTrack(null).catch(()=>{});this.status('The host has turned off guest microphones. You can still listen.');}
    this.applyMutes();
    if(this.host){if(!value)for(const m of this.members.values())if(m.id!=='host')m.mic=false;this.broadcast();}else this.announce();this.render();
  }
  status(text){this.$('status').textContent=text;}
  error(error){this.status(error?.name==='NotAllowedError'?'Microphone blocked. Allow it in your browser, or use Listen only.':error?.name==='NotFoundError'?'No microphone found. Connect one, or use Listen only.':error?.message || 'Voice could not start. Try joining again.');}
  constraints(){const device=this.$('device').value;return {deviceId:device==='default'?undefined:{exact:device},sampleRate:{ideal:48000},channelCount:{ideal:1},echoCancellation:this.$('clean').checked,noiseSuppression:this.$('clean').checked,autoGainControl:this.$('gain').checked};}
  async devices(){
    try{const devices=await navigator.mediaDevices.enumerateDevices(),select=this.$('device'),value=select.value;
      select.replaceChildren(new Option('Default microphone','default'));let count=0;
      for(const device of devices)if(device.kind==='audioinput' && device.deviceId && device.deviceId!=='default')select.add(new Option(device.label || `Microphone ${++count}`,device.deviceId));
      if([...select.options].some(option=>option.value===value))select.value=value;
      else if(value!=='default')this.status('Selected microphone was removed. Choose another microphone.');
      restoreDevice(select,'voice:device');
      const output=this.$('output'),sink=output.value;output.replaceChildren(new Option('Default speakers',''));let outputs=0;
      for(const device of devices)if(device.kind==='audiooutput' && device.deviceId && device.deviceId!=='default')output.add(new Option(device.label || `Audio output ${++outputs}`,device.deviceId));
      if([...output.options].some(option=>option.value===sink))output.value=sink;
      else if(sink)for(const p of this.peers.values())this.playPeer(p);
      restoreDevice(output,'voice:output');
    }catch{this.status('Microphone names appear after you allow microphone access.');}
  }
  async microphone(){
    if(!(this.preparing && (!this.ready || this.awaitingPolicy)) && !this.canSpeak())throw Error('The host has turned off guest microphones. You can still listen.');
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone access needs HTTPS or localhost. You can still listen.');
    const epoch=this.epoch,request=this.micRequest=(this.micRequest || 0)+1,stream=await navigator.mediaDevices.getUserMedia({audio:this.constraints(),video:false});
    if((!(this.preparing && (!this.ready || this.awaitingPolicy)) && !this.canSpeak()) || epoch!==this.epoch || request!==this.micRequest){stream.getTracks().forEach(track=>track.stop());return false;}
    const old=this.mic,muted=this.muted===true;this.mic=stream;
    const track=stream.getAudioTracks()[0];track.enabled=!muted;this.extra?.apply();track.contentHint='speech';
    track.onended=()=>{if(this.mic===stream){this.mic=null;this.muted=true;for(const p of this.peers.values())p.sender?.replaceTrack(null).catch(()=>{});this.status('Microphone disconnected. You can still listen.');this.announce();this.render();}};
    await Promise.all([...this.peers.values()].map(p=>this.syncSender(p).catch(()=>{})));old?.getTracks().forEach(track=>track.stop());
    await this.devices();this.announce();this.render();return true;
  }
  setReady(ready){this.ready=ready;this.root.hidden=!ready && !this.preparing;if(!ready){this.localMuted.clear();this.micBlocks.clear();this.leave('Voice is off. Connect to a session to join.');}else if(!this.active)this.status('Voice is off. Join when you are ready.');this.render();}
  connect(send){this.awaitingPolicy=!this.host;this.sendControl=send;this.setReady(true);send({type:'voice',action:'hello'});}
  // Readdress signaling after a host switch without touching mic tracks or
  // existing audio connections. Audio keeps flowing directly between peers.
  rebase({host,mapping,roster,send,controls=new Map()}){
    this.extra?.rebase(mapping);
    this.localMuted=new Set([...this.localMuted].map(id=>mapping[id]).filter(Boolean));this.micBlocks=new Set([...this.micBlocks].map(id=>mapping[id]).filter(Boolean));
    this.self=mapping[this.self] || (host?'host':null);this.host=host;
    this.sendControl=send;this.controls=controls;
    const peers=new Map();for(const [id,p] of this.peers){const next=mapping[id];if(next){p.id=next;peers.set(next,p);}else{p.pc.close();p.audio?.remove();}}
    this.peers=peers;
    this.roster=roster.filter(m=>mapping[m.id]).map(m=>({...m,id:mapping[m.id],muted:mutedListeners(m.muted).map(id=>mapping[id]).filter(Boolean)}));
    this.members=host?new Map(this.roster.map(m=>[m.id,m])):new Map();
    if(host){if(this.active)this.members.set('host',{id:'host',session:this.session,mic:!!this.mic && !this.muted,muted:[...this.localMuted]});else this.members.delete('host');}
    this.ready=true;this.root.hidden=false;this.render();
  }
  announce(){
    if(!this.active || !this.ready)return;
    const member={id:this.self,session:this.session,mic:!!this.mic && !this.muted && this.canSpeak(),muted:[...this.localMuted]};
    if(this.host){this.members.set('host',{...member,id:'host'});this.broadcast();}
    else this.sendControl?.({type:'voice',action:'join',...member});
  }
  addControl(id,send){this.controls.set(id,send);send({type:'voice',action:'hello',self:id,members:this.roster,allowGuestMic:this.memberAllowed(id)});}
  removeControl(id){this.controls.delete(id);if(this.members.delete(id))this.broadcast();this.closePeer(id);}
  async join(withMic){
    if(!this.ready || this.active || this.busy || this.handoffLocked)return;
    withMic=withMic && this.canSpeak();this.joinPreparedMic=false;
    if(!withMic){this.mic?.getTracks().forEach(track=>track.stop());this.mic=null;}
    const epoch=++this.epoch;this.busy=true;this.micBusy=false;this.muted=false;this.status(withMic?'Allow microphone access to join voice…':'Joining voice…');this.render();
    try{
      const ice=await this.getIce();if(epoch!==this.epoch)return;this.ice=ice;
      if(withMic && !this.mic && !await this.microphone())return;
      if(epoch!==this.epoch)return;this.active=true;this.extra?.apply();this.session=crypto.randomUUID();
      this.timer=setInterval(()=>this.stats(),3000);
      this.announce();
      this.status(withMic?'Voice on · your mic is on.':'Listening · your microphone is off.');this.play();
    }catch(error){if(epoch===this.epoch){this.mic?.getTracks().forEach(track=>track.stop());this.mic=null;this.error(error);}}
    finally{if(epoch===this.epoch){this.busy=false;this.render();}}
  }
  cancelMic(){
    if(!this.active){this.leave('Microphone setup cancelled.');return;}
    this.micToggleRequest=(this.micToggleRequest || 0)+1;this.micRequest=(this.micRequest || 0)+1;this.micBusy=false;this.muted=true;
    this.mic?.getTracks().forEach(track=>track.stop());this.mic=null;
    for(const p of this.peers.values())this.syncSender(p).catch(()=>{});
    this.status('Mic off. You can still listen.');this.announce();this.render();
  }
  async toggleMic(){
    if(!this.active || this.micBusy || !this.canSpeak() || this.handoffLocked)return;
    if(!this.mic){const request=this.micToggleRequest=(this.micToggleRequest || 0)+1;this.micBusy=true;this.render();try{this.muted=false;await this.microphone();}catch(error){if(request===this.micToggleRequest)this.error(error);}finally{if(request===this.micToggleRequest){this.micBusy=false;this.render();}}return;}
    this.muted=!this.muted;for(const track of this.mic.getAudioTracks())track.enabled=!this.muted;this.extra?.apply();
    this.status(this.muted?'Mic muted · you can still hear others.':'Voice on · your mic is on.');this.announce();this.render();
  }
  leave(message='Voice is off.'){
    const wasActive=this.active;this.micToggleRequest=(this.micToggleRequest || 0)+1;this.epoch++;this.active=false;this.busy=false;this.micBusy=false;this.joinPreparedMic=false;this.awaitingPolicy=false;this.session=null;clearInterval(this.timer);
    this.mic?.getTracks().forEach(track=>track.stop());this.mic=null;this.extra?.stop();
    for(const id of [...this.peers.keys()])this.closePeer(id);
    if(this.host){if(this.members.delete('host'))this.broadcast();}else if(wasActive)this.sendControl?.({type:'voice',action:'leave'});
    this.$('play').hidden=true;this.status(message);this.render();
  }
  render(){
    this.applyMutes();
    this.extra?.render();this.meter();
    this.$('preflight').hidden=this.ready || !this.preparing;this.$('preview').textContent=this.micBusy?'Cancel microphone':this.mic?'Turn microphone off':'Turn microphone on';this.$('preview').setAttribute('aria-pressed',String(!!this.mic));
    this.$('join').hidden=this.active || this.busy;this.$('listen').hidden=this.active || this.busy;
    this.$('join').disabled=!this.ready || !this.canSpeak() || this.handoffLocked===true;this.$('listen').disabled=!this.ready || this.handoffLocked===true;
    this.$('leave').hidden=!this.active && !this.busy;this.$('mic').hidden=!this.active;this.$('mic').disabled=this.micBusy===true || !this.canSpeak();
    this.$('mic').textContent=this.mic && !this.muted?'Mute mic':'Turn mic on';this.$('mic').setAttribute('aria-pressed',String(!!this.mic && !this.muted));
    this.$('count').textContent=this.roster.length?`${this.roster.length} in voice`:'';
    if(!this.ready && !this.active && !this.preparing)this.status('Connect to a session to join voice.');else if(this.ready && !this.canSpeak())this.status('The host has turned off your microphone. You can still listen.');this.onChange?.();document.dispatchEvent(new Event('call-media-change'));
  }
  broadcast(){
    this.roster=[...this.members.values()].map(m=>({...m,mic:m.mic && this.memberAllowed(m.id),micAllowed:this.memberAllowed(m.id)}));
    for(const [id,send] of this.controls)send({type:'voice',action:'members',self:id,members:this.roster,allowGuestMic:this.memberAllowed(id)});
    this.reconcile();this.render();
  }
  receive(from,msg){
    if(msg?.type!=='voice')return;
    if(this.host){
      if(!this.controls.has(from))return;
      if(msg.action==='hello'){this.controls.get(from)({type:'voice',action:'hello',self:from,members:this.roster,allowGuestMic:this.memberAllowed(from)});return;}
      if(msg.action==='join' && typeof msg.session==='string' && msg.session.length<=64){this.members.set(from,{id:from,session:msg.session,mic:this.memberAllowed(from) && msg.mic===true,muted:mutedListeners(msg.muted)});this.broadcast();return;}
      if(msg.action==='leave'){this.members.delete(from);this.broadcast();return;}
      this.route(from,msg);return;
    }
    if(['hello','members'].includes(msg.action)){
      if(typeof msg.self!=='string' || !Array.isArray(msg.members))return;
      this.awaitingPolicy=false;this.setGuestMicAllowed(msg.allowGuestMic!==false);this.self=msg.self;this.roster=msg.members.filter(m=>typeof m?.id==='string' && /^[a-zA-Z0-9-]{1,64}$/.test(m.id) && typeof m.session==='string' && m.session.length<=64).slice(0,256).map(m=>({id:m.id,session:m.session,mic:m.mic===true,micAllowed:m.micAllowed!==false,muted:mutedListeners(m.muted)}));this.reconcile();this.render();if(this.joinPreparedMic && this.mic && !this.muted && this.canSpeak())this.join(true);return;
    }
    this.signal(msg);
  }
  route(from,msg){
    if(!['description','candidate','retry'].includes(msg.action))return;
    const member=this.members.get(from),to=this.members.get(msg.to);
    if(!member || !to || from===msg.to || msg.session!==member.session || msg.toSession!==to.session)return;
    const relay={...msg,type:'voice',from,session:member.session};
    if(msg.to==='host')this.signal(relay);else this.controls.get(msg.to)?.(relay);
  }
  send(p,message){
    const msg={...message,type:'voice',session:this.session,to:p.id,toSession:p.session};
    if(this.host)this.route('host',msg);else this.sendControl?.(msg);
  }
  outgoingTrack(id){if(this.preparing && !this.ready)return null;return !this.muted && this.canSpeak() && !this.roster.find(m=>m.id===id)?.muted?.includes(this.self)?this.mic?.getAudioTracks()[0] || null:null;}
  syncSender(p){p.trackUpdate=(p.trackUpdate || Promise.resolve()).catch(()=>{}).then(()=>{if(this.peers.get(p.id)!==p || !p.sender)return;const track=this.outgoingTrack(p.id);if(p.sender.track!==track)return p.sender.replaceTrack(track);});return p.trackUpdate;}
  reconcile(){
    if(!this.active || !this.self)return;
    for(const [id,p] of this.peers)if(!this.roster.some(m=>m.id===id && m.session===p.session))this.closePeer(id);
    for(const member of this.roster)if(member.id!==this.self){const p=this.peers.get(member.id);if(!p)this.createPeer(member);else this.syncSender(p).catch(()=>{});}
  }
  createPeer(member){
    const pc=this.trackPeer(new RTCPeerConnection(this.ice),this.host),p={id:member.id,session:member.session,pc,queue:Promise.resolve(),candidates:[],budget:null};this.peers.set(p.id,p);
    // An answerer uses the offered audio transceiver. Pre-creating another one
    // can leave its microphone on an unnegotiated m-line (one-way audio).
    if(this.self<p.id)p.sender=pc.addTransceiver(this.outgoingTrack(p.id) || 'audio',{direction:'sendrecv',streams:this.mic?[this.mic]:[]}).sender;
    pc.onicecandidate=e=>{if(e.candidate && this.peers.get(p.id)===p)this.send(p,{action:'candidate',candidate:e.candidate.toJSON()});};
    pc.ontrack=e=>{
      if(this.peers.get(p.id)!==p)return;
      p.audio ||= document.createElement('audio');p.audio.autoplay=true;p.audio.playsInline=true;p.audio.volume=Number(this.$('volume').value);p.audio.srcObject=new MediaStream([e.track]);this.$('audio').append(p.audio);this.applyMutes();this.extra?.render();
      e.track.onunmute=()=>this.playPeer(p);this.playPeer(p);
    };
    pc.onconnectionstatechange=()=>{if(this.peers.get(p.id)!==p)return;if(pc.connectionState==='connected'){this.tune(p).catch(()=>{});this.status(this.mic&&!this.muted?'Voice connected · mic on.':'Voice connected · microphone off.');}if(pc.connectionState==='failed')this.status('A voice connection failed. Leave voice and join again; game controls stay connected.');};
    if(this.self<p.id)p.queue=this.offer(p).catch(error=>{if(this.peers.get(p.id)===p)this.error(error);});
    return p;
  }
  async offer(p){await p.pc.setLocalDescription(voiceDescription(await p.pc.createOffer()));if(this.peers.get(p.id)===p)this.send(p,{action:'description',sdp:p.pc.localDescription});}
  signal(msg){
    const p=this.peers.get(msg.from);if(!this.active || !p || msg.toSession!==this.session || msg.session!==p.session)return;
    p.queue=p.queue.catch(()=>{}).then(async()=>{
      if(this.peers.get(p.id)!==p)return;
      if(msg.action==='candidate'){
        if(!msg.candidate || typeof msg.candidate.candidate!=='string' || msg.candidate.candidate.length>4096)return;
        if(p.pc.remoteDescription)await p.pc.addIceCandidate(msg.candidate);else if(p.candidates.length<128)p.candidates.push(msg.candidate);
      }else if(msg.action==='description'){
        if(!['offer','answer'].includes(msg.sdp?.type) || typeof msg.sdp.sdp!=='string' || msg.sdp.sdp.length>65536 || /^m=(?!audio\s)/m.test(msg.sdp.sdp))return;
        await p.pc.setRemoteDescription(msg.sdp);for(const candidate of p.candidates.splice(0))await p.pc.addIceCandidate(candidate);
        if(msg.sdp.type==='offer'){
          const transceiver=p.pc.getTransceivers().find(t=>t.receiver.track.kind==='audio');transceiver.direction='sendrecv';p.sender=transceiver.sender;
          await this.syncSender(p);
          await p.pc.setLocalDescription(voiceDescription(await p.pc.createAnswer()));this.send(p,{action:'description',sdp:p.pc.localDescription});
        }
        await this.tune(p);
      }
    }).catch(error=>{if(this.peers.get(p.id)===p)this.error(error);});
  }
  async tune(p,metrics){
    const ceiling=Number(this.$('quality').value);p.budget=voiceBudget(p.budget || {},metrics || {loss:0,rttMs:0},ceiling,this.$('automatic').checked);
    const params=p.sender?.getParameters();if(!params?.encodings?.length)return;
    for(const encoding of params.encodings){encoding.maxBitrate=p.budget.bitrate;encoding.priority='low';encoding.networkPriority='low';}
    try{await p.sender.setParameters(params);}catch{/* The negotiated full-band Opus ceiling still applies. */}
  }
  async stats(){
    if(!this.active || this.collecting)return;this.collecting=true;
    try{
      const rates=[];for(const p of this.peers.values())if(p.pc.connectionState==='connected'){
        try{const report=await p.pc.getStats();if(this.peers.get(p.id)!==p)continue;
          const remote=[...report.values()].find(s=>s.type==='remote-inbound-rtp' && (s.kind==='audio' || s.mediaType==='audio'));
          if(remote)await this.tune(p,{loss:Math.max(0,remote.fractionLost || 0),rttMs:(remote.roundTripTime || 0)*1000});
          rates.push(Math.round((p.budget?.bitrate || 128000)/1000));
        }catch{/* A participant may leave during collection. */}
      }
      this.$('detail').textContent=rates.length?`Opus · 48 kHz · ${Math.min(...rates)}–${Math.max(...rates)} kb/s send limit per person.`:'';
    }finally{this.collecting=false;}
  }
  async playPeer(p){
    if(!p.audio || !this.active || this.peers.get(p.id)!==p)return;
    try{if(p.audio.setSinkId && p.audio.sinkId!==this.$('output').value)await p.audio.setSinkId(this.$('output').value);}catch{this.status('Could not change voice output. Choose another device or use the default speakers.');}
    if(!this.active || this.peers.get(p.id)!==p)return;
    try{await p.audio.play();}catch{if(this.active && this.peers.get(p.id)===p){this.$('play').hidden=false;this.status('Click Play voices to allow voice playback.');}}
  }
  play(){this.$('play').hidden=true;for(const p of this.peers.values())this.playPeer(p);}
  closePeer(id){const p=this.peers.get(id);if(!p)return;this.peers.delete(id);p.pc.close();if(p.audio){p.audio.pause();p.audio.srcObject=null;p.audio.remove();}}
}
