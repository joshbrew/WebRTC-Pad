import {cameraLimit,boundedCamera} from './camera-quality.js';
import {readPreference,writePreference} from './call-comfort.js';
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/><path class="media-off-stroke" d="M3 3 21 21"/></svg>`;
const validId=id=>typeof id==='string' && /^[a-zA-Z0-9-]{1,64}$/.test(id);
const text=(value,max=80)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max):'';
// Deliberate display-only whitelist. Never spread a peer or diagnostics object.
export function participantRoster(values){
  if(!Array.isArray(values))return [];
  const seen=new Set();return values.slice(0,256).filter(p=>p && validId(p.id) && !seen.has(p.id) && seen.add(p.id)).map(p=>({
    id:p.id,name:text(p.name,48) || (p.id==='host'?'Host':'Guest'),connected:p.connected===true,
    detected:Number.isSafeInteger(p.detected)?Math.max(0,Math.min(256,p.detected)):0,sharing:p.sharing!==false,
    mic:p.mic===true,camera:p.camera===true,screen:p.screen===true,micAllowed:p.micAllowed!==false,cameraAllowed:p.cameraAllowed!==false,
    limit:cameraLimit(p.limit),controllers:(Array.isArray(p.controllers)?p.controllers:[]).slice(0,256).filter(c=>/^p[1-9]\d{0,3}$/i.test(c?.slot)).map(c=>({slot:c.slot.toUpperCase(),name:text(c.name) || 'Controller',connected:c.connected!==false}))
  }));
}
export class Participants{
  constructor({state,voice,camera,screens}){
    Object.assign(this,{state,voice,camera,screens});this.roster=[];this.self=null;this.queued=false;
    this.root=document.querySelector('#clientPeopleCard');
    this.root.innerHTML='<p class="small muted participant-help">Mute sound or hide cameras just for you.</p><div class="participant-list"></div><p class="small muted participant-empty">Participants appear after you connect.</p>';
    this.settings=document.createElement('details');this.settings.className='advanced call-camera-limits';this.settings.id='hostCameraLimits';
    this.settings.innerHTML='<summary>Camera limits</summary><div class="camera-limit-fields"><label class="field-label">Maximum picture size<select data-call-limit="height"><option value="240">240p</option><option value="360">360p</option><option value="480">480p</option><option value="720">720p</option><option value="1080" selected>1080p</option></select></label><label class="field-label">Maximum frame rate<select data-call-limit="fps"><option value="10">10 fps</option><option value="15">15 fps</option><option value="24">24 fps</option><option value="30" selected>30 fps</option></select></label></div><label class="check-row"><input data-call-limit="automatic" type="checkbox" checked /> Adjust cameras automatically for gameplay</label><p class="small muted">Turn this off to keep selected camera sizes and frame rates. Browser congestion control still applies.</p><p class="small muted">Applies to everyone’s camera. Screen shares use their own quality settings.</p>';
    document.querySelector('#hostMediaPermissions').append(this.settings);
    const savedLimits=readPreference('hostCameraLimits');if(savedLimits)this.camera('host').setLimits(cameraLimit(savedLimits));
    for(const select of this.settings.querySelectorAll('select,input'))select.onchange=()=>{this.camera('host').setLimits({height:Number(this.settings.querySelector('[data-call-limit=height]').value),fps:Number(this.settings.querySelector('[data-call-limit=fps]').value),automatic:this.settings.querySelector('[data-call-limit=automatic]').checked});writePreference('hostCameraLimits',this.camera('host').sessionLimit);this.schedule();};
    document.addEventListener('call-media-change',()=>this.schedule());document.addEventListener('app-mode',()=>this.schedule());this.schedule();
    window.addEventListener('resize',()=>{for(const menu of document.querySelectorAll('#peerList .peer-menu[open]'))this.positionMenu(menu);});
  }
  schedule(){if(this.queued)return;this.queued=true;requestAnimationFrame(()=>{this.queued=false;this.sync();});}
  hostRoster(){
    const {peers}=this.state(),voice=this.voice('host'),camera=this.camera('host');
    const media=id=>({mic:voice.roster.find(m=>m.id===id)?.mic,camera:camera.roster.find(m=>m.id===id)?.camera,screen:this.screens?.('host').roster.find(m=>m.id===id)?.camera,micAllowed:voice.memberAllowed(id),cameraAllowed:camera.memberAllowed(id),limit:boundedCamera(camera.sessionLimit,camera.memberLimits.get(id))});
    return participantRoster([{id:'host',name:'Host',connected:true,controllers:[],...media('host')},...[...peers].filter(([,p])=>p.control?.readyState==='open').map(([id,p])=>({id,name:p.sessionName || `Guest ${p.diagnosticNumber || 1}`,connected:p.pc.connectionState==='connected',detected:p.controllerPresence?.detected,sharing:p.controllerPresence?.enabled!==false,controllers:(p.slots || []).map((slot,index)=>{const device=p.controllerPresence?.controllers.find(d=>d.index===index);return {slot,name:device?.name,connected:device?.connected!==false};}),...media(id)}))]);
  }
  receive(msg){if(msg?.type!=='participants' || !validId(msg.self))return;this.self=msg.self;this.roster=participantRoster(msg.members);this.schedule();}
  sync(){
    const {hosting,peers}=this.state();
    if(hosting){const members=this.hostRoster();for(const [id,p] of peers){const packet=JSON.stringify({type:'participants',self:id,members});if(p.control?.readyState==='open' && p.control.bufferedAmount<32768 && p.peoplePacket!==packet){p.control.send(packet);p.peoplePacket=packet;}const row=[...document.querySelectorAll('#peerList .peerRow')].find(row=>row.dataset.peerId===id);if(row)this.decorate(row,id,members.find(m=>m.id===id)?.name || 'Guest');}}
    if(!this.voice('client').ready){this.roster=[];this.self=null;}
    this.renderGuest();
    const limit=this.camera('host').sessionLimit;this.settings.querySelector('[data-call-limit=automatic]').checked=limit.automatic!==false;for(const field of ['height','fps'])this.settings.querySelector(`[data-call-limit=${field}]`).value=String(limit[field]);
  }
  controls(id,name,host=false){
    const group=document.createElement('div');group.className='participant-media-actions';
    for(const kind of ['mic','camera']){const button=document.createElement('button');button.type='button';button.className='button participant-media-button';button.dataset.personMedia=kind;button.dataset.peerAction=`${host?'moderate':'personal'}-${kind}`;button.innerHTML=icon(kind);button.onclick=()=>{const room=kind==='mic'?this.voice(host?'host':'client'):this.camera(host?'host':'client');if(host)room.setMemberAllowed(id,!room.memberAllowed(id));else if(kind==='mic')room.setLocalMuted(id,!room.localMuted.has(id));else room.setLocalHidden(id,!room.localHidden.has(id));this.schedule();};group.append(button);}
    this.updateControls(group,id,name,host);return group;
  }
  updateControls(group,id,name,host){
    for(const button of group.querySelectorAll('[data-person-media]')){const mic=button.dataset.personMedia==='mic',room=mic?this.voice(host?'host':'client'):this.camera(host?'host':'client'),off=host?!room.memberAllowed(id):mic?room.localMuted.has(id):room.localHidden.has(id);
      const label=host?`${off?'Allow':'Turn off'} ${name}’s ${mic?'microphone':'camera'} for everyone`:`${off?mic?'Unmute':'Show':mic?'Mute':'Hide'} ${name}${mic?'':'’s camera'} for me`;
      if(button.getAttribute('aria-label')!==label)button.setAttribute('aria-label',label);button.title=label;button.setAttribute('aria-pressed',String(off));button.classList.toggle('is-off',off);
      button.disabled=host && (mic?room.guestMicAllowed===false:room.guestVideoAllowed===false);if(button.disabled)button.title=`Guest ${mic?'microphones':'cameras'} are disabled for this session. Enable them in Guests & access.`;
    }
  }
  decorate(row,id,name){
    let controls=row.querySelector('.participant-media-actions');if(!controls){controls=this.controls(id,name,true);const info=row.querySelector('.peer-info'),heading=document.createElement('span');heading.className='peer-name-line';heading.append(info.firstChild,controls);info.prepend(heading);}this.updateControls(controls,id,name,true);
    const menu=row.querySelector('.peer-menu-actions');if(!menu)return;
    for(const button of menu.querySelectorAll('[data-peer-action^="local-"]')){const mic=button.dataset.peerAction==='local-mic',room=mic?this.voice('host'):this.camera('host'),off=mic?room.localMuted.has(id):room.localHidden.has(id);button.textContent=`${off?mic?'Unmute':'Show':mic?'Mute':'Hide'} ${mic?'microphone':'camera'} for me`;button.setAttribute('aria-pressed',String(off));}
    if(menu.querySelector('.participant-options'))return;
    const options=document.createElement('div');options.className='participant-options';options.innerHTML='<span class="participant-options-title">Camera limit for this guest</span><div class="camera-limit-fields"><label class="field-label">Picture<select data-member-limit="height"><option value="">Session limit</option><option value="240">240p</option><option value="360">360p</option><option value="480">480p</option><option value="720">720p</option><option value="1080">1080p</option></select></label><label class="field-label">Frame rate<select data-member-limit="fps"><option value="">Session limit</option><option value="10">10 fps</option><option value="15">15 fps</option><option value="24">24 fps</option><option value="30">30 fps</option></select></label></div><span class="participant-options-title">Only for you</span><div class="participant-personal-actions"></div>';
    const cam=this.camera('host'),limit=cam.memberLimits.get(id);for(const field of ['height','fps']){const select=options.querySelector(`[data-member-limit=${field}]`);select.value=limit?String(limit[field]):'';select.onchange=()=>{const height=options.querySelector('[data-member-limit=height]').value,fps=options.querySelector('[data-member-limit=fps]').value;if(height || fps)cam.memberLimits.set(id,cameraLimit({height:height?Number(height):1080,fps:fps?Number(fps):30}));else cam.memberLimits.delete(id);cam.setLimits(cam.sessionLimit);};}
    const personal=options.querySelector('.participant-personal-actions');
    for(const kind of ['mic','camera']){const button=document.createElement('button');button.type='button';button.dataset.peerAction=`local-${kind}`;const update=()=>{const room=kind==='mic'?this.voice('host'):this.camera('host'),off=kind==='mic'?room.localMuted.has(id):room.localHidden.has(id);button.textContent=`${off?kind==='mic'?'Unmute':'Show':kind==='mic'?'Mute':'Hide'} ${kind==='mic'?'microphone':'camera'} for me`;button.setAttribute('aria-pressed',String(off));};update();button.onclick=()=>{const room=kind==='mic'?this.voice('host'):this.camera('host');if(kind==='mic')room.setLocalMuted(id,!room.localMuted.has(id));else room.setLocalHidden(id,!room.localHidden.has(id));update();this.schedule();};personal.append(button);}
    menu.prepend(options);
    if(this.screens){const room=this.screens('host'),group=document.createElement('details');group.className='advanced member-screen-limits';group.innerHTML='<summary>Screen sharing</summary><button type="button" data-screen-permission></button><div class="camera-limit-fields"><label class="field-label">Maximum size<select data-member-screen="height"><option value="2160">Session limit</option><option value="360">360p</option><option value="480">480p</option><option value="720">720p</option><option value="1080">1080p</option><option value="1440">1440p</option></select></label><label class="field-label">Frame rate<select data-member-screen="fps"><option value="120">Session limit</option><option value="15">15 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></select></label><label class="field-label">Upload budget<select data-member-screen="bitrate"><option value="40000000">Session limit</option><option value="2000000">2 Mb/s</option><option value="4000000">4 Mb/s</option><option value="8000000">8 Mb/s</option><option value="12000000">12 Mb/s</option><option value="20000000">20 Mb/s</option></select></label></div>';
      const permission=group.querySelector('button');permission.dataset.peerAction='screen-permission';const update=()=>{permission.textContent=room.cameraBlocks.has(id)?'Allow screen sharing':'Block screen sharing';};update();permission.onclick=()=>{room.setMemberAllowed(id,room.cameraBlocks.has(id));update();this.schedule();};
      const current=room.memberLimits.get(id);for(const select of group.querySelectorAll('select')){if(current)select.value=String(current[select.dataset.memberScreen]);select.onchange=()=>{const value=Object.fromEntries([...group.querySelectorAll('select')].map(el=>[el.dataset.memberScreen,Number(el.value)]));room.memberLimits.set(id,value);room.setLimits(room.sessionLimit);};}menu.prepend(group);
    }
    const disclosure=row.querySelector('.peer-menu');disclosure.addEventListener('toggle',()=>{if(disclosure.open)this.positionMenu(disclosure);});if(disclosure.open)this.positionMenu(disclosure);
  }
  positionMenu(disclosure){
    const menu=disclosure.querySelector('.peer-menu-actions'),anchor=disclosure.querySelector('summary').getBoundingClientRect(),toolbar=document.querySelector('#hostToolbar').getBoundingClientRect();
    menu.style.maxHeight='none';const height=menu.getBoundingClientRect().height,bottom=Math.min(innerHeight-12,toolbar.height?toolbar.top-10:innerHeight-12),above=Math.max(0,anchor.top-76),below=Math.max(0,bottom-anchor.bottom-6),up=height>below && above>below;
    menu.style.top=up?'auto':'calc(100% + 6px)';menu.style.bottom=up?'calc(100% + 6px)':'auto';menu.style.maxHeight=`${Math.max(90,up?above:below)}px`;
  }
  renderGuest(){
    const list=this.root.querySelector('.participant-list'),rows=new Map([...list.children].map(row=>[row.dataset.participantId,row]));
    this.root.querySelector('.participant-empty').hidden=this.roster.length>0;
    for(const member of this.roster){let row=rows.get(member.id);rows.delete(member.id);const self=member.id===this.self,name=member.name+(self?' · You':'');
      if(!row){row=document.createElement('section');row.className='participant-row';row.dataset.participantId=member.id;row.innerHTML='<div class="participant-heading"><span class="avatar"></span><strong></strong></div><p class="participant-state small muted"></p><div class="participant-controller-list"></div>';if(!self)row.querySelector('.participant-heading').append(this.controls(member.id,member.name));list.append(row);}
      const title=row.querySelector('strong');if(title.textContent!==name)title.textContent=name;const avatar=row.querySelector('.avatar');avatar.textContent=self?'Y':member.id==='host'?'H':member.name.slice(0,1).toUpperCase();
      const voice=this.voice('client'),camera=this.camera('client'),caption=[member.micAllowed?voice.localMuted.has(member.id)?'Muted for you':member.mic?'Mic on':'Mic off':'Mic off by host',member.cameraAllowed?camera.localHidden.has(member.id)?'Camera hidden':member.camera?'Camera on':'Camera off':'Camera off by host',member.screen?'Sharing screen':''].filter(Boolean).join(' · '),status=row.querySelector('.participant-state');if(status.textContent!==caption)status.textContent=caption;
      const controllers=row.querySelector('.participant-controller-list'),names=member.controllers.map(c=>`${c.slot} · ${c.name}${!c.connected?' · disconnected':!member.sharing?' · paused':''}`);if(!names.length)names.push(member.id==='host'?'Hosting':member.detected?`${member.detected} controller${member.detected===1?'':'s'} connected · not playing yet`:'No controllers joined');
      if(controllers.dataset.value!==JSON.stringify(names)){controllers.dataset.value=JSON.stringify(names);controllers.replaceChildren(...names.map(name=>{const chip=document.createElement('span');chip.textContent=name;return chip;}));}
      const group=row.querySelector('.participant-media-actions');if(group)this.updateControls(group,member.id,member.name);
    }for(const row of rows.values())row.remove();
  }
  snapshot(){return {allowGuestMic:this.voice('host').guestMicAllowed!==false,allowGuestVideo:this.camera('host').guestVideoAllowed!==false,sessionLimit:this.camera('host').sessionLimit,micBlocks:[...this.voice('host').micBlocks],cameraBlocks:[...this.camera('host').cameraBlocks],memberLimits:[...this.camera('host').memberLimits]};}
  rebase(value,mapping){
    if(!value || !this.state().hosting)return;const voice=this.voice('host'),camera=this.camera('host');
    voice.micBlocks=new Set((Array.isArray(value.micBlocks)?value.micBlocks:[]).map(id=>mapping[id]).filter(id=>id && id!=='host'));camera.cameraBlocks=new Set((Array.isArray(value.cameraBlocks)?value.cameraBlocks:[]).map(id=>mapping[id]).filter(id=>id && id!=='host'));
    document.querySelector('#hostAllowGuestMic').checked=value.allowGuestMic!==false;document.querySelector('#hostAllowGuestVideo').checked=value.allowGuestVideo!==false;voice.setGuestMicAllowed(value.allowGuestMic!==false);camera.setGuestVideoAllowed(value.allowGuestVideo!==false);
    const limits=new Map((Array.isArray(value.memberLimits)?value.memberLimits:[]).slice(0,256).filter(entry=>Array.isArray(entry) && mapping[entry[0]]).map(([id,value])=>[mapping[id],cameraLimit(value)]));camera.setLimits(cameraLimit(value.sessionLimit),limits);voice.broadcast();this.schedule();
  }
}
