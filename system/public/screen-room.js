import {CameraRoom,cameraCodecs} from './camera.js';
import {screenSettings,screenLimit,boundedScreen,screenBudget} from './screen-quality.js';
import {rememberControls} from './call-comfort.js';
import {applyCaptureSettings} from './media.js';
import {preferLowLatency} from './rtc.js';
import {voiceDescription} from './voice-quality.js';
const wire=send=>message=>send({...message,type:'screen'});
const validId=id=>typeof id==='string' && /^[a-zA-Z0-9-]{1,64}$/.test(id);
// Reuse the camera mesh's authenticated signaling, glare avoidance and cleanup.
// Screen capture, sender budgets and optional system audio are independent.
export class ScreenRoom extends CameraRoom{
  constructor(root,options){
    super(root,{...options,remember:false});this.screenInitialized=true;this.sessionLimit=screenLimit();this.ownLimit=screenLimit();this.soundMuted=new Set();
    root.className='screen-share-card';root.innerHTML='<div class="section-heading"><h3>Share a screen</h3></div><button data-screen="toggle" class="button secondary"><svg class="icon" aria-hidden="true"><use href="#i-share"/></svg><span>Choose window or screen…</span></button><p data-screen="status" class="small muted" role="status"></p><label class="check-row"><input data-screen="audio" type="checkbox" checked /> Include sound, when offered</label><p class="small muted screen-audio-help">Choose sound in the browser’s sharing dialog. Window audio may be unavailable.</p><details class="advanced"><summary>Screen quality</summary><div class="screen-quality-fields"><label class="field-label">Maximum picture size<select data-screen="resolution"><option value="360">360p</option><option value="480">480p</option><option value="720">720p</option><option value="1080" selected>1080p</option><option value="1440">1440p</option><option value="2160">4K</option></select></label><label class="field-label">Frame rate<select data-screen="fps"><option value="15">15 fps</option><option value="30">30 fps</option><option value="60" selected>60 fps</option><option value="120">120 fps</option></select></label><label class="field-label">Upload budget<select data-screen="bitrate"><option value="2000000">2 Mb/s</option><option value="4000000">4 Mb/s</option><option value="8000000" selected>8 Mb/s</option><option value="12000000">12 Mb/s</option><option value="20000000">20 Mb/s</option><option value="40000000">40 Mb/s</option></select></label><label class="field-label">Prioritize<select data-screen="priority"><option value="motion">Smooth motion</option><option value="detail">Sharp text</option></select></label></div><label class="check-row"><input data-screen="automatic" type="checkbox" checked /> Adjust automatically for gameplay</label><p class="small muted">The upload budget is shared across viewers. Turn automatic adjustment off to keep these limits fixed; browser congestion control still applies.</p><p data-screen="detail" class="small muted" role="status"></p></details><label class="check-row"><input data-screen="watch" type="checkbox" checked /> Receive shared screens</label><button data-screen="play" class="button small-button" hidden>Play screen audio</button><div data-screen="audio-elements" hidden></div>';
    this.$=name=>root.querySelector(`[data-screen="${name}"]`);rememberControls(root,'screen',['resolution','fps','bitrate','priority','automatic','audio','watch']);
    this.$('toggle').onclick=()=>this.toggle();for(const name of ['resolution','fps','bitrate','priority','automatic'])this.$(name).onchange=()=>this.settingsChanged();
    this.$('audio').onchange=()=>{for(const track of this.stream?.getAudioTracks() || [])track.enabled=this.$('audio').checked;this.syncAudio();this.announce();};
    this.$('watch').onchange=()=>{this.announce();this.reconcile();this.applyAudio();};this.$('play').onclick=()=>{this.$('play').hidden=true;for(const p of this.peers.values())this.playSound(p);};
    this.gallery.classList.add('screen-gallery');this.gallery.setAttribute('aria-label','Shared screens');this.render();
  }
  async devices(){}
  status(text){super.status(text.replace(/Camera/g,'Screen').replace(/camera/g,'screen'));}
  settings(){return boundedScreen(screenSettings(this.screenInitialized?{height:this.$('resolution').value,fps:this.$('fps').value,bitrate:this.$('bitrate').value,priority:this.$('priority').value,automatic:this.$('automatic').checked}:{}),this.sessionLimit,this.host?null:this.ownLimit);}
  policy(id){return {allowGuestVideo:this.memberAllowed(id),sessionLimit:this.sessionLimit,cameraLimit:boundedScreen(screenLimit(),this.sessionLimit,this.memberLimits.get(id))};}
  setLimits(session,limits=this.memberLimits){if(!this.host)return;this.sessionLimit=screenLimit(session);this.memberLimits=new Map([...limits].map(([id,value])=>[id,screenLimit(value)]));this.settingsChanged();this.broadcast();}
  setGuestVideoAllowed(value){if(!this.host && !value && (this.stream || this.busy))this.stopCamera();super.setGuestVideoAllowed(value);}
  connect(send){super.connect(wire(send));}
  addControl(id,send){super.addControl(id,wire(send));}
  announce(){
    if(!this.ready || !this.screenInitialized)return;
    const member={id:this.self,session:this.session,camera:this.canShare() && !!this.stream,watch:this.$('watch').checked,hidden:[...this.localHidden],soundMuted:[...this.soundMuted],audio:!!this.stream?.getAudioTracks().some(t=>t.enabled && t.readyState==='live')};
    if(this.host){this.members.set('host',{...member,id:'host'});this.broadcast();}else this.sendControl?.({type:'camera',action:'join',...member});this.render();
  }
  receive(from,msg){
    if(!this.ready || msg?.type!=='screen')return;
    if(this.host && msg.action==='join'){
      if(!this.controls.has(from) || typeof msg.session!=='string' || msg.session.length>64)return;
      this.members.set(from,{id:from,session:msg.session,camera:this.memberAllowed(from) && msg.camera===true,watch:msg.watch!==false,hidden:Array.isArray(msg.hidden)?msg.hidden.filter(validId).slice(0,256):[],audio:msg.audio===true,soundMuted:Array.isArray(msg.soundMuted)?msg.soundMuted.filter(validId).slice(0,256):[]});this.broadcast();return;
    }
    if(!this.host && ['hello','members'].includes(msg.action)){
      if(!validId(msg.self) || !Array.isArray(msg.members))return;const before=JSON.stringify(this.settings());this.sessionLimit=screenLimit(msg.sessionLimit);this.ownLimit=screenLimit(msg.cameraLimit);this.setGuestVideoAllowed(msg.allowGuestVideo!==false);const first=!this.self;this.self=msg.self;
      this.roster=msg.members.slice(0,256).filter(m=>validId(m?.id) && typeof m.session==='string' && m.session.length<=64).map(m=>({id:m.id,session:m.session,camera:m.camera===true,watch:m.watch!==false,cameraAllowed:m.cameraAllowed!==false,audio:m.audio===true,soundMuted:Array.isArray(m.soundMuted)?m.soundMuted.filter(validId).slice(0,256):[],hidden:Array.isArray(m.hidden)?m.hidden.filter(validId).slice(0,256):[]}));this.reconcile();this.applyAudio();this.render();if(before!==JSON.stringify(this.settings()))this.settingsChanged();if(first)this.announce();return;
    }
    super.receive(from,{...msg,type:'camera'});
  }
  async capture(){
    if(!this.canShare())throw Error('The host has not allowed screen sharing.');const epoch=this.epoch,request=++this.request,s=this.settings();
    const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:s.fps,max:s.fps}},audio:this.$('audio').checked});
    if(!this.ready || !this.canShare() || epoch!==this.epoch || request!==this.request){stream.getTracks().forEach(t=>t.stop());return false;}
    const track=stream.getVideoTracks()[0];if(!track){stream.getTracks().forEach(t=>t.stop());throw Error('No screen was selected.');}
    const old=this.stream;this.stream=stream;track.contentHint=s.priority;track.onended=()=>{if(this.stream===stream)this.stopCamera();};
    try{await Promise.all([...this.peers.values()].map(p=>p.sender?.replaceTrack(this.outgoingTrack(this.member(p.id)))));await this.syncAudio();}
    catch(error){this.stream=old;await Promise.allSettled([...this.peers.values()].map(p=>p.sender?.replaceTrack(this.outgoingTrack(this.member(p.id)))));await this.syncAudio();stream.getTracks().forEach(t=>t.stop());throw error;}
    old?.getTracks().forEach(t=>t.stop());this.failure=false;this.announce();await this.settingsChanged();return true;
  }
  stopCamera(){super.stopCamera();if(this.screenInitialized)this.syncAudio();}
  async toggle(){if(!this.ready || !this.canShare() && !this.stream || this.handoffLocked)return;if(this.stream || this.busy){this.stopCamera();return;}await super.toggle();}
  async settingsChanged(){if(!this.screenInitialized)return;await this.tuneAll();const track=this.stream?.getVideoTracks()[0];if(!track)return;const s=this.settings();try{await applyCaptureSettings(track,{height:s.height,width:Math.round(s.height*16/9),frameRate:s.fps,priority:s.priority==='detail'?'resolution':'motion'});}catch(error){this.status(error.message);}await this.tuneAll();this.render();}
  outgoingAudio(member){return this.outgoingTrack(member) && !member?.soundMuted?.includes(this.self)?this.stream?.getAudioTracks().find(t=>t.enabled) || null:null;}
  async syncAudio(){await Promise.allSettled([...this.peers.values()].map(p=>p.audioSender?.replaceTrack(this.outgoingAudio(this.member(p.id)))));}
  reconcile(){super.reconcile();this.syncAudio();this.applyAudio();}
  addSenders(p,member){const s=this.settings(),budget=screenBudget({}, {},s,Math.max(1,this.peers.size)),t=p.pc.addTransceiver(this.outgoingTrack(member) || 'video',{direction:'sendrecv',streams:this.stream?[this.stream]:[],sendEncodings:[{maxBitrate:budget.bitrate,maxFramerate:s.fps,priority:'medium',networkPriority:'medium'}]});cameraCodecs(t);p.sender=t.sender;p.audioSender=p.pc.addTransceiver(this.outgoingAudio(member) || 'audio',{direction:'sendrecv',streams:this.stream?[this.stream]:[]}).sender;}
  validDescription(sdp){return ['offer','answer'].includes(sdp?.type) && typeof sdp.sdp==='string' && sdp.sdp.length<=65536 && !/^m=(?!(?:video|audio)\s)/m.test(sdp.sdp);}
  localDescription(sdp){return voiceDescription(sdp,192000,true);}
  async answerSenders(p){await super.answerSenders(p);const audio=p.pc.getTransceivers().find(t=>t.receiver.track.kind==='audio');if(audio){audio.direction='sendrecv';p.audioSender=audio.sender;await p.audioSender.replaceTrack(this.outgoingAudio(this.member(p.id)));}}
  async offer(p){const ice=await this.network();if(this.peers.get(p.id)!==p)return;p.pc.setConfiguration(ice);await p.pc.setLocalDescription(voiceDescription(await p.pc.createOffer(),192000,true));if(this.peers.get(p.id)===p)this.send(p,{action:'description',sdp:p.pc.localDescription});}
  receiveTrack(p,e){
    preferLowLatency(e.receiver);p.stream ||= new MediaStream();for(const track of p.stream.getTracks())if(track.kind===e.track.kind)p.stream.removeTrack(track);p.stream.addTrack(e.track);
    if(e.track.kind==='audio'){p.audio ||= document.createElement('audio');p.audio.autoplay=true;p.audio.srcObject=new MediaStream([e.track]);this.$('audio-elements').append(p.audio);this.applyAudio();this.playSound(p);}
    e.track.onunmute=()=>{this.applyAudio();this.render();};e.track.onended=()=>this.render();this.render();
  }
  applyAudio(){if(!this.screenInitialized)return;for(const p of this.peers.values())if(p.audio)p.audio.muted=!this.$('watch').checked || this.localHidden.has(p.id) || this.soundMuted.has(p.id) || !this.member(p.id)?.camera || !this.member(p.id)?.audio;}
  playSound(p){if(!p?.audio)return;p.audio.play().then(()=>{if(this.peers.get(p.id)===p && p.audioBlocked){p.audioBlocked=false;this.render();}}).catch(()=>{if(this.peers.get(p.id)!==p || !this.ready)return;p.audioBlocked=true;this.$('play').hidden=false;this.render();});}
  toggleSound(id){const p=this.peers.get(id);if(p?.audioBlocked){this.soundMuted.delete(id);this.playSound(p);}else{this.soundMuted.has(id)?this.soundMuted.delete(id):this.soundMuted.add(id);if(!this.soundMuted.has(id))this.playSound(p);}this.applyAudio();this.announce();this.render();}
  async tune(p,metrics=null){
    if(!p.sender || this.peers.get(p.id)!==p)return;const s=this.settings(),combined={...(metrics || {})},pressure=this.pressure(p.id) || {},remote=performance.now()-(p.remotePressure?.at || 0)<5000?p.remotePressure || {}:{};for(const key of ['loss','rttMs','bufferMs','freezeMs','decodeMs'])combined[key]=Math.max(combined[key] || 0,pressure[key] || 0,remote[key] || 0);
    p.budget=screenBudget(p.budget,combined,s,[...this.peers.values()].filter(p=>this.outgoingTrack(this.member(p.id))).length,metrics!==null || !p.budget);
    p.tuning=(p.tuning || Promise.resolve()).catch(()=>{}).then(async()=>{if(this.peers.get(p.id)!==p)return;const params=p.sender.getParameters();if(!params.encodings?.length)return;const height=this.stream?.getVideoTracks()[0]?.getSettings().height || s.height,key=JSON.stringify([p.budget.bitrate,p.budget.fps,Math.max(1,height/p.budget.height),s.priority]);if(p.appliedKey===key && p.appliedTrack===p.sender.track)return;for(const encoding of params.encodings){encoding.maxBitrate=p.budget.bitrate;encoding.maxFramerate=p.budget.fps;encoding.scaleResolutionDownBy=Math.max(1,height/p.budget.height);encoding.priority='medium';encoding.networkPriority='medium';}params.degradationPreference=s.priority==='detail'?'maintain-resolution':'maintain-framerate';try{await p.sender.setParameters(params);}catch{delete params.degradationPreference;for(const encoding of params.encodings){delete encoding.priority;delete encoding.networkPriority;}await p.sender.setParameters(params);}p.appliedKey=key;p.appliedTrack=p.sender.track;
      if(p.audioSender){const audio=p.audioSender.getParameters();if(audio.encodings?.length){for(const e of audio.encodings){e.maxBitrate=192000;e.priority='low';e.networkPriority='low';}try{await p.audioSender.setParameters(audio);}catch{/* Audio congestion remains browser controlled. */}}}
    });await p.tuning;
  }
  sources(){if(!this.screenInitialized)return [];const sources=[];if(this.stream)sources.push({id:'screen-self',owner:this.self,kind:'screen',label:'Your screen',stream:this.stream,viewOnly:true});if(this.$('watch').checked)for(const m of this.roster)if(m.id!==this.self && m.camera && !this.localHidden.has(m.id)){const p=this.peers.get(m.id);if(p?.stream?.getVideoTracks().length)sources.push({id:`screen-${m.id}`,owner:m.id,kind:'screen',label:(this.names?.get(m.id) || (m.id==='host'?'Host':`Guest ${this.roster.filter(n=>n.id!=='host').findIndex(n=>n.id===m.id)+1}`))+' · screen',stream:p.stream,viewOnly:true,audio:m.audio,muted:this.soundMuted.has(m.id) || p.audioBlocked===true,toggleSound:()=>this.toggleSound(m.id)});}return sources;}
  render(){
    if(!this.screenInitialized)return;this.root.hidden=!this.ready;this.applyAudio();const on=!!this.stream,s=this.settings();this.$('toggle').disabled=!this.ready || !this.canShare() && !on || this.handoffLocked===true;this.$('toggle').setAttribute('aria-pressed',String(on));this.$('toggle').querySelector('span').textContent=this.busy?'Cancel sharing':on?'Stop sharing':'Choose window or screen…';this.$('toggle').hidden=this.host && !on;this.root.querySelector('h3').textContent=this.host?on?'Your shared screen':'Guest screens':'Share a screen';this.$('audio').closest('label').hidden=this.host && !on;this.root.querySelector('.screen-audio-help').hidden=this.host && !on;this.root.querySelector('details').hidden=this.host && !on;
    if(this.busy && !this.failure)this.status('Choose a window or screen in the sharing dialog…');
    if(!this.failure && !this.busy)this.status(!this.ready?'Join a session to share a window or screen.':!this.canShare()?'The host has turned off your screen sharing.':on?`${this.stream.getVideoTracks()[0]?.label || 'Screen'} · ${s.height}p · up to ${s.fps} fps${this.stream.getAudioTracks().some(t=>t.enabled)?' · sound on':' · no sound'}`:this.host?'Guests can share their screens when you allow it.':'Choose a window or screen. Your controller keeps working while you share.');
    const budgets=[...this.peers.values()].filter(p=>p.budget && p.sender?.track).map(p=>p.budget);this.$('detail').textContent=budgets.length?`${(budgets.reduce((sum,b)=>sum+b.bitrate,0)/1000000).toFixed(1)} Mb/s total send limit${budgets.some(b=>b.level)?' · reduced for gameplay':''}`:'';
    this.gallery.hidden=true;this.changed(this.sources());this.onChange?.();document.dispatchEvent(new Event('call-media-change'));
  }
  error(error){this.failure=true;this.status(error?.name==='NotAllowedError'?'Screen sharing was cancelled or blocked.':error?.message || 'Could not share this screen.');}
  closePeer(id){const p=this.peers.get(id);if(p?.audio){p.audio.pause();p.audio.srcObject=null;p.audio.remove();}super.closePeer(id);}
  setReady(ready){super.setReady(ready);if(!ready && this.soundMuted)this.soundMuted.clear();}
  rebase(value){for(const id of [...this.peers.keys()])if(!value.mapping[id])this.closePeer(id);this.soundMuted=new Set([...this.soundMuted].map(id=>value.mapping[id]).filter(Boolean));const audio=new Map((value.roster || []).map(m=>[value.mapping[m.id],{audio:m.audio===true,soundMuted:(Array.isArray(m.soundMuted)?m.soundMuted:[]).filter(validId).map(id=>value.mapping[id]).filter(Boolean)}]));super.rebase({...value,send:value.send?wire(value.send):undefined,controls:new Map([...(value.controls || [])].map(([id,send])=>[id,wire(send)]))});for(const member of this.roster)Object.assign(member,audio.get(member.id));if(this.host)this.members=new Map(this.roster.map(m=>[m.id,m]));this.syncAudio();this.render();}
}
