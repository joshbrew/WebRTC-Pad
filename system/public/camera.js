import {syncMediaControls} from './media-controls.js';
import {rememberControls,restoreDevice} from './call-comfort.js';
import {cameraSettings,cameraBudget,cameraLimit,boundedCamera} from './camera-quality.js';
import {preferLowLatency} from './rtc.js';
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const cameraCodecs=transceiver=>{try{const codecs=RTCRtpSender.getCapabilities('video').codecs,rank=c=>c.mimeType.toLowerCase()==='video/h264'?0:c.mimeType.toLowerCase()==='video/vp8'?1:2;transceiver.setCodecPreferences([...codecs].sort((a,b)=>rank(a)-rank(b)));}catch{/* Keep the browser's compatible codec list. */}};
const cleanPressure=value=>Object.fromEntries(['loss','rttMs','bufferMs','freezeMs','decodeMs'].map(k=>[k,typeof value?.[k]==='number' && Number.isFinite(value[k])?Math.max(0,Math.min(k==='loss'?1:5000,value[k])):0]));
const hiddenCameras=value=>Array.isArray(value)?value.filter(id=>typeof id==='string' && /^[a-zA-Z0-9-]{1,64}$/.test(id)).slice(0,256):[];
const validMembers=members=>Array.isArray(members)?members.filter(m=>m && typeof m.id==='string' && /^[a-zA-Z0-9-]{1,64}$/.test(m.id) && typeof m.session==='string' && m.session.length<=64).map(m=>({id:m.id,session:m.session,camera:m.camera===true,watch:m.watch!==false,hidden:hiddenCameras(m.hidden),cameraAllowed:m.cameraAllowed!==false})).slice(0,256):[];

// Camera-only mesh: one capture per device, no audio or game frames here.
// The game host relays only small signaling messages over the control channel.
export class CameraRoom{
  constructor(root,{host=false,stage,ice=async()=>({iceServers:[]}),trackPeer=pc=>pc,pressure=()=>({}),receivePressure=()=>({}),changed=()=>{},remember=true}={}){
    Object.assign(this,{root,host,stage,getIce:ice,trackPeer,pressure,receivePressure,changed});this.controls=new Map();this.members=new Map();this.peers=new Map();this.roster=[];this.self=host?'host':null;this.epoch=0;this.request=0;this.guestVideoAllowed=host;this.preparing=false;this.localHidden=new Set();this.cameraBlocks=new Set();this.memberLimits=new Map();this.sessionLimit=cameraLimit();this.ownLimit=cameraLimit();
    root.innerHTML=`<div class="section-heading"><h3>${icon('camera')} Camera</h3></div><div class="row"><button data-camera="toggle" class="button secondary">${icon('camera')} <span>Turn camera on</span></button></div><p data-camera="status" class="small muted" role="status">Connect to a session to share your camera.</p><div class="camera-settings-grid"><label class="field-label">Camera<select data-camera="device"><option value="default">Default camera</option></select></label><label class="field-label">Picture size<select data-camera="resolution"><option value="240">240p</option><option value="360">360p</option><option value="480" selected>480p</option><option value="720">720p</option><option value="1080">1080p</option></select></label><label class="field-label">Frame rate<select data-camera="fps"><option value="10">10 fps</option><option value="15">15 fps</option><option value="24" selected>24 fps</option><option value="30">30 fps</option></select></label></div><label class="check-row"><input data-camera="watch" type="checkbox" checked /> Show other cameras</label><label class="check-row"><input data-camera="automatic" type="checkbox" checked /> Adjust camera quality automatically</label><p class="small muted">Turn off automatic adjustment to keep your selected size and frame rate, within the host’s limits. Browser congestion control still applies.</p><p data-camera="detail" class="small muted" role="status"></p>`;
    this.$=name=>root.querySelector(`[data-camera="${name}"]`);
    if(remember)rememberControls(root,'camera',['device','resolution','fps','watch','automatic']);
    this.gallery=document.createElement('div');this.gallery.className='camera-gallery';this.gallery.hidden=true;this.gallery.setAttribute('aria-label','Call cameras');stage.after(this.gallery);this.home=document.createComment('Camera gallery');this.gallery.before(this.home);this.tiles=new Map();
    this.$('toggle').onclick=()=>this.toggle();this.$('device').onchange=()=>{if(this.stream)this.capture().catch(error=>this.error(error));};
    for(const name of ['resolution','fps','automatic'])this.$(name).onchange=()=>this.settingsChanged();
    this.$('watch').onchange=()=>this.announce();
    navigator.mediaDevices?.addEventListener('devicechange',()=>this.devices());
    document.addEventListener('fullscreenchange',()=>{if(document.fullscreenElement===this.stage && this.gallery.parentElement!==this.stage)this.stage.append(this.gallery);else if(!document.fullscreenElement && this.home.nextSibling!==this.gallery)this.home.after(this.gallery);});
    for(const name of ['pointerdown','pointerup','pointermove','wheel','keydown'])this.gallery.addEventListener(name,e=>e.stopPropagation());
    document.addEventListener('call-media-change',()=>{for(const source of this.sources()){const tile=this.tiles.get(source.id);if(tile)syncMediaControls(tile.tile,this.mediaControls?.(source.owner));}});window.addEventListener('pagehide',()=>{this.setPreparing(false);this.setReady(false);});this.devices();this.render();
  }
  canShare(){return this.ready && (this.host || this.guestVideoAllowed!==false);}
  outgoingTrack(member){return this.canShare() && member?.watch!==false && !member?.hidden?.includes(this.self)?this.stream?.getVideoTracks()[0] || null:null;}
  memberAllowed(id){return id==='host' || this.guestVideoAllowed!==false && !this.cameraBlocks?.has(id);}
  setMemberAllowed(id,allowed){if(!this.host || id==='host')return;allowed?this.cameraBlocks.delete(id):this.cameraBlocks.add(id);if(!allowed && this.members.has(id))this.members.get(id).camera=false;this.broadcast();}
  setLocalHidden(id,hidden){hidden?this.localHidden.add(id):this.localHidden.delete(id);this.announce();this.reconcile();this.render();}
  setLimits(session,memberLimits=this.memberLimits){if(!this.host)return;this.sessionLimit=cameraLimit(session);this.memberLimits=new Map([...memberLimits].map(([id,value])=>[id,cameraLimit(value)]));this.settingsChanged();this.broadcast();}
  setPreparing(value){if(this.preparing===value)return;this.preparing=value;if(!value && !this.ready)this.stopCamera();this.render();}
  setGuestVideoAllowed(value){
    const changed=this.guestVideoAllowed!==value;this.guestVideoAllowed=value;
    if(!changed)return;
    for(const p of this.peers.values())p.sender?.replaceTrack(this.outgoingTrack(this.member(p.id))).catch(()=>{});
    if(this.host){for(const m of this.members.values())if(m.id!=='host' && !value)m.camera=false;this.broadcast();}
    else this.announce();
    this.render();
  }
  settings(){return boundedCamera({...cameraSettings(Number(this.$('resolution').value),Number(this.$('fps').value)),...(this.$('automatic')?.checked===false?{automatic:false}:{})},this.sessionLimit,this.host?null:this.ownLimit);}
  constraints(){const s=this.settings(),device=this.$('device').value;return {deviceId:device==='default'?undefined:{exact:device},width:{ideal:s.height<=480?Math.round(s.height*4/3):Math.round(s.height*16/9)},height:{ideal:s.height},frameRate:{ideal:s.fps,max:s.fps}};}
  status(text){this.$('status').textContent=text;}
  error(error){this.failure=true;this.status(error?.name==='NotAllowedError'?'Camera access is blocked. Allow it in your browser to share.':error?.name==='NotFoundError'?'No camera found. Connect one, then try again.':error?.message || 'Could not start the camera.');}
  async devices(){try{const select=this.$('device'),selected=select.value,devices=await navigator.mediaDevices.enumerateDevices();select.replaceChildren(new Option('Default camera','default'));let count=0;for(const d of devices)if(d.kind==='videoinput' && d.deviceId)select.add(new Option(d.label || `Camera ${++count}`,d.deviceId));if([...select.options].some(o=>o.value===selected))select.value=selected;restoreDevice(select,'camera:device');}catch{/* Device names may require camera permission. */}}
  async capture(){
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera sharing needs HTTPS or localhost.');
    const epoch=this.epoch,request=++this.request,stream=await navigator.mediaDevices.getUserMedia({video:this.constraints(),audio:false});
    if(!this.ready && !this.preparing || epoch!==this.epoch || request!==this.request){stream.getTracks().forEach(t=>t.stop());return false;}
    const old=this.stream,track=stream.getVideoTracks()[0];track.contentHint='motion';
    // Do not discard a working camera if a replacement cannot be negotiated.
    const watches=id=>this.member(id)?.watch!==false && !this.member(id)?.hidden?.includes(this.self);
    try{await Promise.all([...this.peers.values()].map(p=>p.sender?.replaceTrack(this.canShare() && watches(p.id)?track:null)));}
    catch(error){await Promise.allSettled([...this.peers.values()].map(p=>p.sender?.replaceTrack(this.canShare() && watches(p.id)?old?.getVideoTracks()[0] || null:null)));stream.getTracks().forEach(t=>t.stop());throw error;}
    if(epoch!==this.epoch || request!==this.request){stream.getTracks().forEach(t=>t.stop());return false;}
    this.failure=false;this.stream=stream;track.onended=()=>{if(this.stream===stream){this.stopCamera();this.status('Camera disconnected. Choose another camera to share.');}};
    old?.getTracks().forEach(t=>t.stop());this.announce();this.tuneAll();this.devices();return true;
  }
  async toggle(){if(!this.ready && !this.preparing || this.handoffLocked)return;if(this.stream || this.busy){this.stopCamera();return;}const toggleRequest=this.toggleRequest=(this.toggleRequest || 0)+1;this.failure=false;this.busy=true;this.status('Allow camera access to share…');this.render();try{await this.capture();}catch(error){if(this.toggleRequest===toggleRequest)this.error(error);}finally{if(this.toggleRequest===toggleRequest){this.busy=false;this.render();}}}
  stopCamera(){this.toggleRequest=(this.toggleRequest || 0)+1;this.failure=false;this.request++;this.busy=false;const stream=this.stream;this.stream=null;stream?.getTracks().forEach(t=>t.stop());for(const p of this.peers.values())p.sender?.replaceTrack(null).catch(()=>{});this.announce();this.render();}
  async settingsChanged(){const track=this.stream?.getVideoTracks()[0];if(!track)return;const request=this.settingsRequest=(this.settingsRequest || 0)+1;await this.tuneAll();try{await track.applyConstraints(this.constraints());if(request===this.settingsRequest && this.stream?.getVideoTracks()[0]===track){await this.tuneAll();this.render();}}catch(error){if(request===this.settingsRequest && this.stream?.getVideoTracks()[0]===track)this.error(error);}}
  setReady(ready){
    if(this.ready===ready && (ready || !this.stream && !this.busy)){this.render();return;}this.ready=ready;this.failure=false;
    if(!ready){this.epoch++;this.request++;this.toggleRequest=(this.toggleRequest || 0)+1;this.busy=false;clearInterval(this.timer);this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;for(const id of [...this.peers.keys()])this.closePeer(id);this.controls.clear();this.members.clear();this.localHidden.clear();this.cameraBlocks.clear();this.memberLimits.clear();this.ownLimit=cameraLimit();if(!this.host)this.sessionLimit=cameraLimit();this.roster=[];this.session=null;this.ice=null;this.status('Connect to a session to share your camera.');this.render();return;}
    this.session=crypto.randomUUID();this.timer=setInterval(()=>this.stats(),2000);this.announce();this.render();
  }
  connect(send){this.sendControl=send;this.setReady(true);this.announce();}
  member(id){return this.roster.find(m=>m.id===id);}
  announce(){if(!this.ready)return;const member={id:this.self,session:this.session,camera:this.canShare() && !!this.stream,watch:this.$('watch').checked,hidden:[...this.localHidden]};if(this.host){this.members.set('host',{...member,id:'host'});this.broadcast();}else this.sendControl?.({type:'camera',action:'join',...member});this.render();}
  policy(id){return {allowGuestVideo:this.memberAllowed(id),sessionLimit:this.sessionLimit,cameraLimit:boundedCamera(this.sessionLimit,this.memberLimits.get(id))};}
  addControl(id,send){this.controls.set(id,send);send({type:'camera',action:'hello',self:id,members:this.roster,...this.policy(id)});}
  removeControl(id){this.controls.delete(id);if(this.members.delete(id))this.broadcast();this.closePeer(id);}
  broadcast(){this.roster=[...this.members.values()].map(m=>({...m,camera:m.camera && this.memberAllowed(m.id),cameraAllowed:this.memberAllowed(m.id)}));for(const [id,send] of this.controls)send({type:'camera',action:'members',self:id,members:this.roster,...this.policy(id)});this.reconcile();this.render();}
  receive(from,msg){
    if(!this.ready || msg?.type!=='camera')return;
    if(this.host){if(!this.controls.has(from))return;if(msg.action==='join' && typeof msg.session==='string' && msg.session.length<=64){this.members.set(from,{id:from,session:msg.session,camera:this.memberAllowed(from) && msg.camera===true,watch:msg.watch!==false,hidden:hiddenCameras(msg.hidden)});this.broadcast();return;}this.route(from,msg);return;}
    if(['hello','members'].includes(msg.action)){if(typeof msg.self!=='string' || !Array.isArray(msg.members))return;const before=JSON.stringify(this.settings());this.sessionLimit=cameraLimit(msg.sessionLimit);this.ownLimit=cameraLimit(msg.cameraLimit);this.setGuestVideoAllowed(msg.allowGuestVideo!==false);const first=!this.self;this.self=msg.self;this.roster=validMembers(msg.members);this.reconcile();this.render();if(before!==JSON.stringify(this.settings()))this.settingsChanged();if(first)this.announce();return;}this.signal(msg);
  }
  route(from,msg){if(!['description','candidate','retry','pressure'].includes(msg.action))return;const a=this.members.get(from),b=this.members.get(msg.to);if(!a || !b || from===msg.to || msg.session!==a.session || msg.toSession!==b.session)return;const relay={...msg,type:'camera',from,session:a.session};if(msg.to==='host')this.signal(relay);else this.controls.get(msg.to)?.(relay);}
  send(p,message){const msg={...message,type:'camera',session:this.session,to:p.id,toSession:p.session};if(this.host)this.route('host',msg);else this.sendControl?.(msg);}
  reconcile(){
    if(!this.ready || !this.self)return;
    const wanted=m=>m.id!==this.self && (!!this.outgoingTrack(m) || this.$('watch').checked && !this.localHidden.has(m.id) && m.camera);
    for(const [id,p] of this.peers)if(!this.roster.some(m=>m.id===id && m.session===p.session && wanted(m) && !['failed','closed'].includes(p.pc.connectionState)))this.closePeer(id);
    for(const m of this.roster)if(wanted(m)){const p=this.peers.get(m.id);if(!p)this.createPeer(m);else{p.sender?.replaceTrack(this.outgoingTrack(m)).catch(()=>{});}}
    this.tuneAll();
  }
  createPeer(member){
    const pc=this.trackPeer(new RTCPeerConnection(this.ice || {}),this.host),p={id:member.id,session:member.session,pc,queue:Promise.resolve(),candidates:[]};this.peers.set(p.id,p);
    if(this.self<p.id)this.addSenders(p,member);
    pc.onicecandidate=e=>{if(e.candidate && this.peers.get(p.id)===p)this.send(p,{action:'candidate',candidate:e.candidate.toJSON()});};
    pc.ontrack=e=>{if(this.peers.get(p.id)!==p)return;this.receiveTrack(p,e);};
    pc.onconnectionstatechange=()=>{if(this.peers.get(p.id)!==p)return;if(pc.connectionState==='connected')this.tune(p).catch(()=>{});if(pc.connectionState==='failed'){this.failure=true;this.status('A camera connection failed. Switch your camera off and on to retry. Game controls stay connected.');}this.render();};
    if(this.self<p.id)p.queue=this.offer(p).catch(error=>{if(this.peers.get(p.id)===p)this.error(error);});return p;
  }
  addSenders(p,member){const t=p.pc.addTransceiver(this.outgoingTrack(member) || 'video',{direction:'sendrecv',streams:this.stream?[this.stream]:[],sendEncodings:[{maxBitrate:cameraBudget({}, {},this.settings(),Math.max(1,this.peers.size)).bitrate,maxFramerate:this.settings().fps,priority:'very-low',networkPriority:'low'}]});cameraCodecs(t);p.sender=t.sender;}
  receiveTrack(p,e){preferLowLatency(e.receiver);p.stream=new MediaStream([e.track]);e.track.onunmute=()=>this.render();e.track.onended=()=>this.render();this.render();}
  validDescription(sdp){return ['offer','answer'].includes(sdp?.type) && typeof sdp.sdp==='string' && sdp.sdp.length<=65536 && !/^m=(?!video\s)/m.test(sdp.sdp);}
  localDescription(sdp){return sdp;}
  async answerSenders(p){const t=p.pc.getTransceivers().find(t=>t.receiver.track.kind==='video');t.direction='sendrecv';cameraCodecs(t);p.sender=t.sender;await p.sender.replaceTrack(this.outgoingTrack(this.member(p.id)));}
  async network(){this.ice ||= await this.getIce();return this.ice;}
  async offer(p){const ice=await this.network();if(this.peers.get(p.id)!==p)return;p.pc.setConfiguration(ice);await p.pc.setLocalDescription(await p.pc.createOffer());if(this.peers.get(p.id)===p)this.send(p,{action:'description',sdp:p.pc.localDescription});}
  signal(msg){
    const p=this.peers.get(msg.from);if(!p || msg.toSession!==this.session || msg.session!==p.session)return;
    p.queue=p.queue.catch(()=>{}).then(async()=>{
      if(this.peers.get(p.id)!==p)return;
      if(msg.action==='pressure'){p.remotePressure={at:performance.now(),...cleanPressure(msg.metrics)};return;}
      if(msg.action==='candidate'){if(typeof msg.candidate?.candidate!=='string' || msg.candidate.candidate.length>4096)return;if(p.pc.remoteDescription)await p.pc.addIceCandidate(msg.candidate);else if(p.candidates.length<128)p.candidates.push(msg.candidate);}
      else if(msg.action==='description'){
        if(!this.validDescription(msg.sdp))return;
        p.pc.setConfiguration(await this.network());if(this.peers.get(p.id)!==p)return;
        await p.pc.setRemoteDescription(msg.sdp);for(const c of p.candidates.splice(0))await p.pc.addIceCandidate(c);
        if(msg.sdp.type==='offer'){await this.answerSenders(p);await p.pc.setLocalDescription(this.localDescription(await p.pc.createAnswer()));this.send(p,{action:'description',sdp:p.pc.localDescription});}await this.tune(p);
      }
    }).catch(error=>{if(this.peers.get(p.id)===p)this.error(error);});
  }
  async tune(p,metrics=null){
    if(!p.sender || this.peers.get(p.id)!==p)return;
    const sample=metrics!==null;metrics ||= {};const pressure=this.pressure(p.id) || {},combined={...metrics};const remote=performance.now()-(p.remotePressure?.at || 0)<5000?p.remotePressure || {}:{};for(const k of ['loss','rttMs','bufferMs','freezeMs','decodeMs'])combined[k]=Math.max(metrics[k] || 0,pressure[k] || 0,remote[k] || 0);
    const senders=[...this.peers.values()].filter(p=>this.outgoingTrack(this.member(p.id))).length;
    p.budget=cameraBudget(p.budget,combined,this.settings(),senders,sample || !p.budget);
    // Serial parameter updates avoid stale transaction IDs during live changes.
    p.tuning=(p.tuning || Promise.resolve()).catch(()=>{}).then(async()=>{
      if(this.peers.get(p.id)!==p)return;const height=this.stream?.getVideoTracks()[0]?.getSettings().height || this.settings().height,key=JSON.stringify([p.budget.bitrate,p.budget.fps,Math.max(1,height/p.budget.height)]);if(p.appliedKey===key && p.appliedTrack===p.sender.track)return;const params=p.sender.getParameters();if(!params.encodings?.length)return;
      for(const e of params.encodings){e.maxBitrate=p.budget.bitrate;e.maxFramerate=p.budget.fps;e.scaleResolutionDownBy=Math.max(1,height/p.budget.height);e.priority='very-low';e.networkPriority='low';}
      params.degradationPreference='maintain-framerate';try{await p.sender.setParameters(params);p.appliedKey=key;p.appliedTrack=p.sender.track;}catch{try{delete params.degradationPreference;for(const e of params.encodings){delete e.priority;delete e.networkPriority;}await p.sender.setParameters(params);p.appliedKey=key;p.appliedTrack=p.sender.track;}catch{/* Unsupported parameters never interrupt camera or game media. */}}
    });await p.tuning;
  }
  tuneAll(){return Promise.all([...this.peers.values()].map(p=>this.tune(p).catch(()=>{})));}
  async stats(){if(!this.ready || this.collecting)return;for(const p of this.peers.values())if(this.$('watch').checked && this.member(p.id)?.camera)this.send(p,{action:'pressure',metrics:cleanPressure(this.receivePressure())});if(!this.canShare() || !this.stream)return;this.collecting=true;try{for(const p of this.peers.values())if(p.pc.connectionState==='connected'){try{const stats=await p.pc.getStats(),remote=[...stats.values()].find(s=>s.type==='remote-inbound-rtp' && s.kind==='video');await this.tune(p,{loss:remote?.fractionLost || 0,rttMs:(remote?.roundTripTime || 0)*1000});}catch{}}this.render();}finally{this.collecting=false;}}
  sources(){const sources=[];if(this.stream)sources.push({id:'camera-self',owner:this.self,kind:'camera',label:this.canShare()?'You':'You · private preview',stream:this.stream,viewOnly:true});if(this.$('watch').checked)for(const m of this.roster)if(m.id!==this.self && m.camera && !this.localHidden.has(m.id)){const p=this.peers.get(m.id);if(p?.stream)sources.push({id:`camera-${m.id}`,owner:m.id,kind:'camera',label:m.id==='host'?'Host camera':`Guest ${this.roster.filter(m=>m.id!=='host').findIndex(n=>n.id===m.id)+1} camera`,stream:p.stream,viewOnly:true});}return sources;}
  render(){
    this.root.hidden=!this.ready && !this.preparing;const on=!!this.stream,toggle=this.$('toggle');toggle.disabled=!this.ready && !this.preparing || this.handoffLocked===true;toggle.querySelector('span').textContent=this.busy?'Cancel camera':on?'Turn camera off':'Turn camera on';toggle.setAttribute('aria-pressed',String(on));
    if(!this.busy && !this.failure)this.status(!this.ready?on?'Private preview · shares after joining, if allowed by the host.':'Choose a camera and turn it on to preview before joining.':!this.host && !this.guestVideoAllowed?on?'Private preview only · the host has turned off guest cameras.':'The host has turned off guest cameras.':on?'Camera on · shared with the call.':'Your camera is off. You can still see other cameras.');
    const sources=this.sources(),wanted=new Set(sources.map(s=>s.id));for(const [id,t] of this.tiles)if(!wanted.has(id)){t.video.srcObject=null;t.tile.remove();this.tiles.delete(id);}
    for(const source of sources){let t=this.tiles.get(source.id);if(!t){const tile=document.createElement('section');tile.className='camera-tile';tile.dataset.cameraId=source.id;const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.setAttribute('aria-label',source.label);const name=document.createElement('span');name.className='camera-name';name.textContent=source.label;const expand=document.createElement('button');expand.type='button';expand.className='camera-expand';expand.title=`Fullscreen ${source.label.toLowerCase()}`;expand.setAttribute('aria-label',expand.title);expand.innerHTML=icon('expand');expand.onclick=()=>video.requestFullscreen?.().catch(()=>{});tile.append(video,name,expand);this.gallery.append(tile);t={tile,video};this.tiles.set(source.id,t);}syncMediaControls(t.tile,this.mediaControls?.(source.owner));t.tile.querySelector('.camera-name').textContent=source.label;t.video.setAttribute('aria-label',source.label);if(t.video.srcObject!==source.stream){t.video.srcObject=source.stream;t.video.play().catch(()=>{});}}
    this.gallery.hidden=!sources.length;const budgets=[...this.peers.values()].filter(p=>p.budget && this.stream && this.member(p.id)?.watch).map(p=>p.budget);this.$('detail').textContent=budgets.length?`${this.settings().height}p · up to ${this.settings().fps} fps · ${Math.round(budgets.reduce((s,b)=>s+b.bitrate,0)/1000)} kb/s total camera limit${this.settings().automatic===false?' · fixed quality':budgets.some(b=>b.level)?' · reduced for gameplay':''}`:'';
    this.changed(sources);this.onChange?.();document.dispatchEvent(new Event('call-media-change'));
  }
  closePeer(id){const p=this.peers.get(id);if(!p)return;this.peers.delete(id);p.pc.close();this.render();}
  rebase({host,mapping,roster,send,controls=new Map()}){
    this.localHidden=new Set([...this.localHidden].map(id=>mapping[id]).filter(Boolean));this.cameraBlocks=new Set([...this.cameraBlocks].map(id=>mapping[id]).filter(Boolean));this.memberLimits=new Map([...this.memberLimits].filter(([id])=>mapping[id]).map(([id,value])=>[mapping[id],value]));
    this.self=mapping[this.self] || (host?'host':null);this.host=host;this.ice=null;this.sendControl=send;this.controls=controls;const peers=new Map();for(const [id,p] of this.peers){const next=mapping[id];if(next){p.id=next;peers.set(next,p);}else p.pc.close();}this.peers=peers;this.roster=validMembers(roster).filter(m=>mapping[m.id]).map(m=>({...m,id:mapping[m.id]}));this.members=host?new Map(this.roster.map(m=>[m.id,m])):new Map();this.ready=true;this.render();
  }
}
