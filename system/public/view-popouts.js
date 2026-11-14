import {gatherIce,sanitizeIceConfig} from './pairing.js';
import {applySenderQuality,preferLowLatency,prioritizeAudio} from './rtc.js';
import {adaptationMetrics,adaptQuality,nativeEncodingKey} from './quality.js';
import {receivedVideoStats} from './stats.js';
import {prepareVideoHandover} from './video-handover.js';
import {voiceDescription} from './voice-quality.js';
import {screenSoundButton,syncScreenSound,viewLayoutButton,viewLayoutLabels} from './guest-tiles.js';
import {readPreference,writePreference} from './call-comfort.js';
import {bindScreenQuickControls,screenQuickButton} from './screen-quick-controls.js';

const post=(p,msg)=>{if(p.control?.readyState==='open')p.control.send(JSON.stringify(msg));};

// Independent views share the room's input channels and use the same capture
// tracks as the main player.
export class HostViewPopouts {
  constructor(options){Object.assign(this,options);this.entries=new Map();}
  async handle(p,peerId,msg){
    if(!['view-open','view-close','view-answer','view-presented','view-metrics'].includes(msg?.type))return false;
    if(typeof msg.sourceId!=='string' || msg.sourceId.length>80)return true;
    const key=`${peerId}:${msg.sourceId}`,current=this.entries.get(key);
    if(msg.type==='view-close'){if(!msg.requestId || current?.requestId===msg.requestId)this.close(key);return true;}
    if(msg.type==='view-metrics'){
      const now=Date.now();
      if(!current?.settledAt || current.token!==msg.token || current.awaitingFrame || now-current.settledAt<4000 || now-(current.lastMetrics || 0)<1000)return true;
      const ceiling=this.quality(p,msg.sourceId);
      if(ceiling.autoThrottle===false)return true;
      current.lastMetrics=now;
      const before=current.adaptation;
      current.adaptation=adaptQuality(before,adaptationMetrics(msg.metrics),ceiling.height || this.sourceHeight(current.sourceId) || 2160,now,ceiling.minHeight,ceiling);
      if(before?.height!==current.adaptation.height || before?.frameRate!==current.adaptation.frameRate)this.updateQuality(key,current).catch(()=>{});
      return true;
    }
    if(msg.type==='view-presented'){
      if(current?.kind==='native' && current.token===msg.token && current.awaitingFrame){
        await this.nativeCommand('native-ready',peerId,{sourceId:msg.sourceId,viewer:true});
        clearTimeout(current.timer);
        current.awaitingFrame=false;
        current.live=true;
        current.settledAt=Date.now();
        current.liveToken=current.token;
        current.liveEncodingKey=current.encodingKey;
        this.updateQuality(key,current).catch(()=>{});
      }
      return true;
    }
    if(msg.type==='view-answer'){
      if(!current || current.token!==msg.token)return true;
      try{
        if(current.kind==='native'){
          await this.nativeCommand('native-answer',peerId,{sourceId:msg.sourceId,viewer:true,sdp:msg.sdp});
          if(!current.liveQuality){clearTimeout(current.timer);current.live=true;}
        }
        else {await current.pc.setRemoteDescription(msg.sdp);clearTimeout(current.timer);current.settledAt=Date.now();await this.updateQuality(key,current);}
      }catch{
        if(!current.live && this.entries.get(key)===current){this.close(key);post(p,{type:'view-error',sourceId:msg.sourceId,requestId:current.requestId,error:'This view could not connect. Close it and try again.'});}
      }
      return true;
    }
    if(current){if(!msg.requestId || current.requestId===msg.requestId)return true;this.close(key);}
    const source=this.source(msg.sourceId);
    if(!source){post(p,{type:'view-error',sourceId:msg.sourceId,requestId:msg.requestId,error:'This view is no longer shared.'});return true;}
    const entry={p,peerId,sourceId:msg.sourceId,source,kind:source.kind,liveQuality:msg.liveQuality===true,videoPriority:'medium',requestId:typeof msg.requestId==='string'?msg.requestId.slice(0,80):undefined,token:crypto.randomUUID()};this.entries.set(key,entry);
    try{
      if(source.kind==='native')await this.updateQuality(key,entry);
      else{
        const track=source.stream?.getVideoTracks()[0];if(track?.readyState!=='live')throw new Error('This source has stopped.');
        const ice=await this.ice();if(this.entries.get(key)!==entry)return true;
        const pc=new RTCPeerConnection(ice);entry.pc=pc;
        entry.senders={video:pc.addTransceiver(track,{direction:'sendonly',streams:[source.stream]}).sender,audio:pc.addTransceiver('audio',{direction:'sendonly'}).sender};
        await this.syncAudio(entry);
        await this.updateQuality(key,entry);
        await pc.setLocalDescription(voiceDescription(await pc.createOffer(),192000,true));await gatherIce(pc);
        if(this.entries.get(key)===entry)this.sendOffer(entry,pc.localDescription,ice);
      }
    }catch(error){if(this.entries.get(key)===entry){this.close(key);post(p,{type:'view-error',sourceId:msg.sourceId,requestId:msg.requestId,error:'Could not start this view. Check the host’s screen sharing settings.'});}}
    return true;
  }
  sendOffer(entry,sdp,ice){
    post(entry.p,{type:'view-offer',sourceId:entry.sourceId,requestId:entry.requestId,token:entry.token,native:entry.kind==='native',sdp,ice});
    const key=`${entry.peerId}:${entry.sourceId}`;
    entry.timer=setTimeout(()=>{
      if(this.entries.get(key)!==entry)return;
      entry.awaitingFrame=false;
      if(entry.live){entry.encodingKey=entry.liveEncodingKey;entry.token=entry.liveToken;return;}
      this.close(key);
      post(entry.p,{type:'view-error',sourceId:entry.sourceId,requestId:entry.requestId,error:'The view timed out. Close it and try again.'});
    },46000);
  }
  async updateQuality(key,entry){
    if(this.entries.get(key)!==entry)return;
    const base=this.quality(entry.p,entry.sourceId);
    if(base.autoThrottle===false)entry.adaptation=undefined;
    const quality={...this.quality(entry.p,entry.sourceId,entry.adaptation),codec:'h264'};
    if(entry.kind!=='native'){
      if(entry.senders){
        entry.quality=quality;
        entry.qualityQueue=(entry.qualityQueue || Promise.resolve()).catch(()=>{}).then(()=>applySenderQuality(entry));
        await entry.qualityQueue;
      }
      return;
    }
    const encodingKey=nativeEncodingKey(entry.sourceId,quality);
    if(entry.awaitingFrame || entry.encodingKey===encodingKey || entry.live && !entry.liveQuality)return;
    entry.awaitingFrame=true;
    try{
      const result=await this.nativeCommand('native-offer',entry.peerId,{sourceId:entry.sourceId,viewer:true,quality});
      if(this.entries.get(key)!==entry)return;
      entry.encodingKey=encodingKey;
      entry.token=crypto.randomUUID();
      this.sendOffer(entry,result.sdp,result.ice);
    }catch(error){entry.awaitingFrame=false;throw error;}
  }
  async refreshQuality(p,sourceId,resetAdaptation=sourceId!==undefined){
    await Promise.all([...this.entries].filter(([,entry])=>(!p || entry.p===p) && (sourceId===undefined || sourceId===entry.sourceId)).map(([key,entry])=>{
      if(resetAdaptation)entry.adaptation=undefined;
      return this.updateQuality(key,entry);
    }));
  }
  syncAudio(entry,sourceId=entry.sourceId){
    const sender=entry.senders?.audio;if(!sender)return;
    entry.audioUpdate=(entry.audioUpdate || Promise.resolve()).catch(()=>{}).then(async()=>{
      const track=this.audioTrack(sourceId) || null;
      if(sender.track===track)return;
      await sender.replaceTrack(track);
      if(track)await prioritizeAudio(sender);
    });
    return entry.audioUpdate;
  }
  async refreshAudio(sourceId){
    await Promise.all([...this.entries.values()].filter(entry=>entry.sourceId===sourceId).map(entry=>this.syncAudio(entry)));
  }
  rollback(peerId,sourceId){
    for(const entry of this.entries.values()){
      if(entry.kind!=='native' || entry.sourceId!==sourceId || `${entry.peerId}:view:${sourceId || 'main'}`!==peerId)continue;
      clearTimeout(entry.timer);entry.awaitingFrame=false;entry.encodingKey=entry.liveEncodingKey;entry.token=entry.liveToken;
      return true;
    }
    return false;
  }
  close(key){const entry=this.entries.get(key);if(!entry)return;this.entries.delete(key);clearTimeout(entry.timer);entry.pc?.close();if(entry.kind==='native')this.nativeCommand('native-close',entry.peerId,{sourceId:entry.sourceId,viewer:true}).catch(()=>{});}
  closePeer(p){for(const [key,entry] of this.entries)if(entry.p===p)this.close(key);}
  prune(){for(const [key,entry] of this.entries)if(!this.source(entry.sourceId)){post(entry.p,{type:'view-error',sourceId:entry.sourceId,requestId:entry.requestId,error:'The host stopped sharing this view.'});this.close(key);}}
  refreshMain(){for(const [key,entry] of [...this.entries])if(!entry.sourceId && this.source('') && this.source('').identity!==entry.source.identity){const {p,peerId}=entry;this.close(key);this.handle(p,peerId,{type:'view-open',sourceId:'',requestId:entry.requestId,liveQuality:entry.liveQuality});}this.prune();}
}

export class GuestViewPopouts {
  constructor({send,status,soundChanged,toggleSound,selectedSoundBlocked,quickSettings}){
    Object.assign(this,{send,status,soundChanged,toggleSound,selectedSoundBlocked,quickSettings});this.entries=new Map();this.sources=new Map();this.mutes=new Map();this.soundButtons=new Map();this.selected='';
    window.addEventListener('message',event=>{
      if(event.origin!==location.origin || event.data?.type!=='view-window-ready')return;
      const found=[...this.entries].find(([,entry])=>entry.window===event.source);if(!found)return;
      const [sourceId,entry]=found;if(entry.ready)return;entry.ready=true;
      const d=entry.window.document;d.title=this.sources.get(sourceId)?.label || 'Shared view';d.querySelector('#viewTitle').textContent=d.title;
      entry.popupSink={video:d.querySelector('video'),note:d.querySelector('[role=status]')};
      entry.popupSink.video.setAttribute('aria-label',d.title);
      this.addSink(sourceId,entry,entry.popupSink);
      if(this.quickSettings){
        const button=screenQuickButton(d);
        d.querySelector('#viewFullscreen').before(button);
        bindScreenQuickControls(entry.popupSink.video,()=>this.quickSettings(this.sources.get(sourceId)),{button});
      }
      entry.removeSound=this.bindSoundButton(sourceId,d.querySelector('#viewFullscreen'));
      const win=entry.window;win.addEventListener('pagehide',()=>{if(entry.window===win)this.closeWindow(sourceId);});
    });
  }
  update(sources,selected){
    this.sources=new Map(sources.filter(source=>typeof source?.id==='string' && source.id.length<=80 && typeof source.label==='string').slice(0,33).map(source=>[source.id,source]));
    this.selected=selected || '';
    for(const [id,entry] of this.entries)if(this.sources.has(id)){
      this.syncAudio(id,entry);
      this.subscribe(id,entry);
      const doc=entry.ready && !entry.window?.closed && entry.window?.document;
      if(doc)doc.dispatchEvent(new doc.defaultView.Event('screen-quick-refresh'));
    }else this.close(id);
    for(const id of this.mutes.keys())if(id && !this.sources.has(id))this.mutes.delete(id);
  }
  entry(id){let e=this.entries.get(id);if(!e){e={requestId:crypto.randomUUID(),sinks:new Set(),noteText:'Connecting…'};this.entries.set(id,e);}return e;}
  muted(id){return this.mutes.get(id)===true;}
  setMuted(id,muted,retry=false){
    this.mutes.set(id,muted);
    const entry=this.entries.get(id);if(entry)this.syncAudio(id,entry,retry);
  }
  blocked(id){return this.entries.get(id)?.audioBlocked===true;}
  bindSoundButton(id,anchor){
    const button=screenSoundButton(()=>this.toggleSound(id),'view-window-sound');
    anchor.before(button);this.soundButtons.set(button,id);this.refreshSoundControls();
    return ()=>{this.soundButtons.delete(button);button.remove();};
  }
  refreshSoundControls(){
    for(const [button,id] of this.soundButtons){
      const source=this.sources.get(id),selected=id===this.selected;
      syncScreenSound(button,source && {...source,audio:source.audio===true && (selected || source.independentAudio!==false),muted:this.muted(id),soundBlocked:selected?this.selectedSoundBlocked():this.blocked(id)});
    }
  }
  syncAudio(id,entry,retry=false){
    const track=entry.audioTrack,source=this.sources.get(id);
    const active=id!==this.selected && source?.audio===true && source.independentAudio!==false && track?.readyState==='live';
    if(active && !entry.audio){
      const audio=document.createElement('audio');audio.hidden=true;audio.dataset.viewAudio=id;document.body.append(audio);entry.audio=audio;
    }
    const audio=entry.audio;if(!audio)return;
    const changed=entry.playingTrack!==(active?track:null),muted=this.muted(id),volumeChanged=audio.muted!==muted;
    audio.muted=muted;
    if(changed){entry.playingTrack=active?track:null;audio.srcObject=active?new MediaStream([track]):null;}
    const setBlocked=blocked=>{
      if(entry.audioBlocked===blocked)return;
      entry.audioBlocked=blocked;this.soundChanged?.(id);
    };
    if(!active || muted){audio.pause();setBlocked(false);return;}
    if(changed || volumeChanged || retry || audio.paused && !entry.audioBlocked){
      audio.play().then(()=>{if(entry.playingTrack===track)setBlocked(false);},error=>{if(entry.playingTrack===track && !audio.muted && error.name==='NotAllowedError')setBlocked(true);});
    }
  }
  updateSink(e,sink){
    sink.note.textContent=e.noteText || '';
    sink.note.hidden=!e.noteText;
    if(!e.noteText)delete sink.video.dataset.reconnecting;
    if(sink.video.srcObject!==(e.stream || null))sink.video.srcObject=e.stream || null;
    if(e.stream)sink.video.play().catch(()=>{});
  }
  subscribe(id,entry){
    if(entry.subscribed || !entry.sinks.size || !this.sources.has(id))return;
    entry.subscribed=true;
    this.send({type:'view-open',sourceId:id,requestId:entry.requestId,liveQuality:true});
  }
  addSink(id,e,sink){e.sinks.add(sink);sink.video.muted=true;sink.video.playsInline=true;this.updateSink(e,sink);this.subscribe(id,e);}
  attach(id,video,note,{keepOnReconnect=false}={}){
    const e=this.entry(id),sink={video,note,keepOnReconnect};this.addSink(id,e,sink);
    return ()=>{
      if(!e.sinks.delete(sink))return;
      video.srcObject=null;
      if(!e.sinks.size && !e.window && this.entries.get(id)===e)this.close(id);
    };
  }
  paint(e,text){e.noteText=text;for(const sink of e.sinks)this.updateSink(e,sink);}
  open(sourceId){
    const old=this.entries.get(sourceId);if(old?.window && !old.window.closed){old.window.focus();return;}
    const win=window.open(new URL('./view-window.html',import.meta.url).href,'', 'popup,width=960,height=600');
    if(!win){this.status('Allow pop-up windows for this app, then try again.');return;}
    // A real same-origin document loads its stylesheet under the existing CSP
    // and signals readiness before media negotiation begins.
    const entry=this.entry(sourceId);entry.window=win;entry.ready=false;
    // Window.closed is a fallback for browsers which omit pagehide on close.
    this.timer ||= setInterval(()=>{for(const [id,e] of this.entries)if(e.window?.closed)this.closeWindow(id);},750);
  }
  async handle(msg){
    if(!['view-offer','view-error'].includes(msg?.type))return false;
    const entry=this.entries.get(msg.sourceId);if(!entry || msg.requestId && msg.requestId!==entry.requestId)return true;
    if(msg.type==='view-error'){entry.cancelWarmup?.();entry.pending?.close();entry.pc?.close();entry.retired?.close();entry.pending=null;entry.pc=null;entry.retired=null;entry.recovering=false;entry.stream=null;entry.audioTrack=null;this.syncAudio(msg.sourceId,entry);this.paint(entry,String(msg.error || 'This view stopped.').slice(0,180));return true;}
    entry.cancelWarmup?.();entry.pending?.close();
    const pc=new RTCPeerConnection(sanitizeIceConfig(msg.ice));entry.pending=pc;
    const active=()=>this.entries.get(msg.sourceId)===entry && entry.pending===pc;
    const fail=()=>{
      if(!active())return;
      entry.cancelWarmup?.();entry.pending=null;pc.close();
      if(entry.recovering || !entry.stream)this.paint(entry,'Could not connect this view. Close it and try again.');
    };
    let nextAudio;
    pc.ontrack=event=>{
      if(!active() && entry.pc!==pc)return;
      preferLowLatency(event.receiver);
      if(event.track.kind==='audio'){
        nextAudio=event.track;
        const update=()=>{if(this.entries.get(msg.sourceId)===entry && entry.pc===pc){entry.audioTrack=nextAudio;this.syncAudio(msg.sourceId,entry);}};
        for(const name of ['unmute','ended'])nextAudio.addEventListener(name,update);
        update();return;
      }
      const show=()=>{
        const previous=entry.pc;
        entry.pending=null;entry.pc=pc;entry.stream=new MediaStream([event.track]);entry.token=msg.token;entry.sample=null;
        entry.audioTrack=nextAudio;this.syncAudio(msg.sourceId,entry);
        entry.recovering=false;
        this.paint(entry,null);
        previous?.close();
        entry.retired?.close();entry.retired=null;
        if(msg.native)this.send({type:'view-presented',sourceId:msg.sourceId,token:msg.token});
      };
      if(msg.native || entry.recovering)entry.cancelWarmup=prepareVideoHandover(event.track,{active,ready:show,failed:fail});
      else show();
    };
    pc.onconnectionstatechange=()=>{
      if(pc.connectionState!=='failed')return;
      if(active())fail();
      else if(entry.pc===pc){entry.audioTrack=null;this.syncAudio(msg.sourceId,entry);this.paint(entry,'Connection lost. Close this view and open it again.');}
    };
    try{await pc.setRemoteDescription(msg.sdp);await pc.setLocalDescription(voiceDescription(await pc.createAnswer(),192000,true));await gatherIce(pc);if(active() || entry.pc===pc)this.send({type:'view-answer',sourceId:msg.sourceId,token:msg.token,sdp:pc.localDescription});}
    catch{fail();}return true;
  }
  async reportQuality(){
    if(this.reporting)return;
    this.reporting=true;
    try{await Promise.all([...this.entries].map(async ([sourceId,entry])=>{
      const video=entry.sinks.values().next().value?.video,pc=entry.pc,token=entry.token;
      if(!video || !pc || !token || pc.connectionState!=='connected' || entry.pending)return;
      try{
        const stats=await pc.getStats();
        if(entry.pc!==pc || entry.token!==token || entry.pending)return;
        const data=receivedVideoStats(stats,entry.sample,video);
        if(!data)return;
        entry.sample=data.sample;
        const {loss,rttMs,bufferMs,freezeMs,decodeMs}=data;
        if(this.entries.get(sourceId)===entry)this.send({type:'view-metrics',sourceId,token,metrics:{loss,rttMs,bufferMs,freezeMs,decodeMs}});
      }catch{/* Closed during a stats request. */}
    }));}finally{this.reporting=false;}
  }
  closeWindow(id){const e=this.entries.get(id);if(!e?.window)return;const win=e.window;e.window=null;e.ready=false;e.removeSound?.();if(e.popupSink){e.sinks.delete(e.popupSink);e.popupSink.video.srcObject=null;e.popupSink=null;}if(!win.closed)win.close();if(!e.sinks.size)this.close(id);if(![...this.entries.values()].some(e=>e.window)){clearInterval(this.timer);this.timer=null;}}
  close(id){const e=this.entries.get(id);if(!e)return;this.entries.delete(id);e.removeSound?.();e.cancelWarmup?.();e.pending?.close();e.pc?.close();e.retired?.close();if(e.audio){e.audio.pause();e.audio.srcObject=null;e.audio.remove();}for(const sink of e.sinks)sink.video.srcObject=null;e.sinks.clear();if(e.subscribed)this.send({type:'view-close',sourceId:id,requestId:e.requestId});if(e.window && !e.window.closed)e.window.close();if(![...this.entries.values()].some(e=>e.window)){clearInterval(this.timer);this.timer=null;}}
  reconnectWindow(id,entry){
    entry.cancelWarmup?.();entry.cancelWarmup=null;
    entry.pending?.close();entry.pending=null;
    if(entry.pc){
      entry.retired?.close();entry.retired=entry.pc;entry.pc=null;
    }
    // Retain the displayed stream until the replacement decodes a frame.
    entry.subscribed=false;
    entry.recovering=true;
    entry.requestId=crypto.randomUUID();
    entry.audioTrack=null;entry.sample=null;
    this.syncAudio(id,entry);
    this.paint(entry,'Reconnecting this screen…');
    const doc=entry.ready && entry.window?.document;
    if(doc)doc.dispatchEvent(new doc.defaultView.Event('screen-quick-close'));
  }
  clear({recovering=false}={}){
    this.sources.clear();
    for(const [id,entry] of this.entries){
      if(recovering && (entry.window && !entry.window.closed || [...entry.sinks].some(sink=>sink.keepOnReconnect)))this.reconnectWindow(id,entry);
      else this.close(id);
    }
    if(!recovering)this.mutes.clear();
    this.selected='';
    this.refreshSoundControls();
  }
}

// Keep all views in a regular popup so the whole layout can enter fullscreen.
export class FloatingScreens {
  constructor({attach,notify,changed,sound,focusChanged,side='client',quickSettings}){
    Object.assign(this,{attach,notify,changed,sound,focusChanged,quickSettings});this.entries=new Map();this.revision=0;
    this.available=new Map();
    this.preferenceKey=side==='host'?'hostPopoutLayout':'guestPopoutLayout';
    window.addEventListener('message',event=>{
      if(event.origin!==location.origin || event.data?.type!=='view-window-ready' || event.source!==this.popup)return;
      this.popupReady?.(event.source);
    });
  }
  get active(){return !!this.win && !this.win.closed || !!this.opening;}
  get focused(){return this.focusedWindow===this.win && !!this.win && !this.win.closed;}
  async open(sources,{mode='single',featured,remember=false}={}){
    const requested=Array.isArray(sources)?null:sources;
    if(!Array.isArray(sources))sources=requested?[requested]:[];
    if(!sources.length)return;
    if(this.win?.closed)this.clear(false);
    const revision=this.revision;
    for(const source of sources)if(!this.entries.has(source.id))this.entries.set(source.id,{source});
    if(this.active && requested){
      if(this.zoomed!==null)this.zoomed=requested.id;
      else if(['single','focus'].includes(this.mode))this.featured=requested.id;
    }
    if(!this.active){
      this.callMode=viewLayoutLabels.has(mode)?mode:'single';
      this.rememberLayout=remember;
      const saved=remember && readPreference(this.preferenceKey);
      this.savedMode=viewLayoutLabels.has(saved) && saved!=='streamer'?saved:null;
      this.mode=this.savedMode ?? this.callMode;
      this.featured=this.entries.has(featured)?featured:sources[0].id;
      this.zoomed=null;
      const opening=this.openWindow(revision);
      if(revision!==this.revision)return;
      this.opening=opening.finally(()=>{if(revision===this.revision)this.opening=null;});
    }
    let win;
    try{this.changed?.();win=this.win || await this.opening;}
    catch(error){if(revision===this.revision)this.clear();throw error;}
    if(revision!==this.revision || !win || win.closed)return;
    for(const entry of this.entries.values())this.mount(entry);
    this.render();win.focus();
  }
  setLayout(mode){
    this.mode=mode;
    if(mode==='single' && this.zoomed!==null)this.featured=this.zoomed;
    this.zoomed=null;
    this.render();
  }
  async openWindow(revision){
    const url=new URL('./view-window.html',import.meta.url);url.searchParams.set('layout','1');
    this.popup=window.open(url.href,'','popup,width=800,height=520');
    if(!this.popup){this.clear();this.notify('Allow pop-up windows to pop out the screens.');return;}
    const win=await new Promise(resolve=>{
      this.popupReady=resolve;
      this.popupWatch=setInterval(()=>{if(this.popup?.closed)resolve(null);},300);
      this.popupTimeout=setTimeout(()=>resolve(null),10000);
    });
    if(revision!==this.revision)return;
    clearInterval(this.popupWatch);clearTimeout(this.popupTimeout);this.popupReady=null;
    if(!win){this.clear();return;}
    this.win=win;
    const d=win.document;
    d.title='Shared screens';d.body.className='view-popout floating-screens';
    this.grid=d.createElement('main');this.grid.className='floating-screens-grid';
    this.controls=d.createElement('div');this.controls.className='floating-screens-controls';
    this.layout=d.createElement('div');this.layout.className='floating-layout-options';
    this.layout.setAttribute('role','group');this.layout.setAttribute('aria-label','View layout');
    for(const [id,label] of viewLayoutLabels)if(id!=='streamer' || this.callMode==='streamer'){
      const button=viewLayoutButton(d,id,id==='streamer'?'Streamer view · screens':label);
      button.onclick=()=>{
        if(this.rememberLayout){
          this.savedMode=id==='streamer'?null:id;
          writePreference(this.preferenceKey,this.savedMode);
        }
        this.setLayout(id);
      };
      this.layout.append(button);
    }
    if(this.rememberLayout){
      const reset=d.createElement('button');reset.type='button';reset.className='floating-layout-reset';
      reset.title='Reset pop-out layout';reset.setAttribute('aria-label',reset.title);
      reset.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></svg>';
      reset.onclick=()=>{
        this.savedMode=null;
        writePreference(this.preferenceKey,null);
        this.setLayout(this.callMode);
        this.layout.querySelector('[aria-pressed="true"]').focus({preventScroll:true});
      };
      this.layout.append(reset);
    }
    this.screen=d.createElement('select');this.screen.setAttribute('aria-label','Choose screen');
    this.screen.onchange=()=>{
      if(this.zoomed===null)this.featured=this.screen.value;
      else this.zoomed=this.screen.value;
      this.render();
    };
    this.addScreen=d.createElement('select');this.addScreen.setAttribute('aria-label','Add a screen');
    this.addScreen.onchange=()=>{
      if(this.addScreen.selectedIndex<1)return;
      const source=this.available.get(this.addScreen.value.slice('screen:'.length));
      this.addScreen.selectedIndex=0;
      if(!source)return;
      this.open(source).then(()=>{
        if(this.win!==win || !this.addScreen.hidden || ![d.body,this.addScreen].includes(d.activeElement))return;
        const next=this.screen.hidden?this.layout.querySelector('[aria-pressed="true"]'):this.screen;
        next?.focus({preventScroll:true});
      }).catch(()=>this.notify('Could not add this screen to the pop-out.'));
    };
    const fullscreen=d.querySelector('#viewFullscreen'),notice=d.querySelector('#viewNotice');
    this.fullscreen=fullscreen;
    this.controls.append(this.layout,this.screen,this.addScreen,fullscreen);d.body.replaceChildren(this.grid,this.controls,notice);
    if(d.hasFocus())this.focusedWindow=win;
    win.addEventListener('focus',()=>{if(this.win===win){this.focusedWindow=win;this.focusChanged?.();}});
    win.addEventListener('blur',()=>{if(this.win===win){this.focusedWindow=null;this.focusChanged?.();}});
    win.addEventListener('pagehide',()=>{if(this.win===win)this.clear(false);},{once:true});
    this.windowWatch=setInterval(()=>{if(win.closed && this.win===win)this.clear(false);},750);
    return win;
  }
  mount(entry){
    if(entry.card)return;
    const {source}=entry,d=this.win.document;
    const card=d.createElement('section'),header=d.createElement('header'),label=d.createElement('span'),zoom=d.createElement('button'),close=d.createElement('button'),video=d.createElement('video'),note=d.createElement('p');
    card.className='floating-screen';card.dataset.sourceId=source.id;
    zoom.type='button';zoom.className='floating-screen-zoom';
    zoom.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><path class="zoom-in" d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><path class="zoom-out" d="M3 9h6V3m12 6h-6V3M9 21v-6H3m12 6v-6h6"/></svg>';
    const toggleZoom=()=>{if(this.mode==='single' || this.entries.size<2)return;this.zoomed=this.zoomed===source.id?null:source.id;this.render();};
    zoom.onclick=toggleZoom;video.ondblclick=toggleZoom;
    close.type='button';close.className='floating-screen-close';close.textContent='×';close.onclick=()=>{
      this.close(source.id);
      if(this.addScreen && !this.addScreen.hidden)this.addScreen.focus({preventScroll:true});
    };
    header.append(label,zoom,close);
    video.muted=true;video.autoplay=true;video.playsInline=true;
    note.setAttribute('role','status');note.textContent='Waiting for video…';
    card.append(header,video,note);this.grid.append(card);entry.card=card;
    Object.assign(entry,{video,note,zoom,label,close});
    this.updateTitle(entry,entry.title ?? source.label);
    entry.removeSound=this.sound?.(source,close);
    if(this.quickSettings){
      const button=screenQuickButton(d);close.before(button);
      bindScreenQuickControls(card,()=>this.quickSettings(this.available.get(source.id)),{button});
    }
  }
  updateTitle(entry,label){
    entry.title=label;
    if(!entry.card)return;
    entry.label.textContent=label;
    entry.video.setAttribute('aria-label',label);
    entry.close.setAttribute('aria-label',`Close ${label}`);
    entry.close.title=`Close ${label}`;
  }
  render(){
    if(!this.grid || !this.entries.size)return;
    if(!this.entries.has(this.featured))this.featured=this.entries.keys().next().value;
    const count=this.entries.size;
    if(count<2 || !this.entries.has(this.zoomed))this.zoomed=null;
    this.grid.dataset.layout=this.mode;
    this.grid.dataset.zoomed=String(this.zoomed!==null);
    this.grid.style.setProperty('--popout-columns',this.mode==='columns'?count:Math.ceil(Math.sqrt(count)));
    this.grid.style.setProperty('--popout-rows',this.mode==='stacked'?count:Math.ceil(count/Math.ceil(Math.sqrt(count))));
    for(const [id,entry] of this.entries)if(entry.card){
      const inLayout=this.mode!=='single' || id===this.featured;
      const zoomed=id===this.zoomed;
      entry.card.hidden=this.zoomed===null?!inLayout:!zoomed;
      entry.card.dataset.zoomed=String(zoomed);
      entry.zoom.hidden=count<2 || this.mode==='single';
      const label=zoomed?'Back to layout':`Maximize ${entry.title}`;
      entry.zoom.setAttribute('aria-label',label);entry.zoom.title=label;
      // Keep the grid's receivers attached so restoring it needs no new connection.
      if(inLayout && !entry.detach){entry.note.hidden=false;entry.detach=this.attach(entry.source,entry.video,entry.note);}
      else if(!inLayout && entry.detach){entry.detach();entry.detach=null;}
      entry.card.dataset.featured=String(id===this.featured);
    }
    if(this.mode==='focus'){
      const card=this.entries.get(this.featured)?.card;
      if(card && this.grid.firstElementChild!==card)this.grid.prepend(card);
      this.grid.style.setProperty('--popout-rows',Math.max(1,count-1));
    }else{
      let previous=null;
      for(const {card} of this.entries.values())if(card){const next=previous?previous.nextElementSibling:this.grid.firstElementChild;if(next!==card)this.grid.insertBefore(card,next);previous=card;}
    }
    for(const button of this.layout.querySelectorAll('[data-layout]'))button.setAttribute('aria-pressed',String(button.dataset.layout===this.mode));
    const reset=this.layout.querySelector('.floating-layout-reset');
    if(reset)reset.hidden=this.savedMode===null;
    this.layout.hidden=count<2;this.screen.hidden=count<2 || this.zoomed===null && !['single','focus'].includes(this.mode);
    const labels=[...this.entries.values()].map(({source,title})=>[source.id,title ?? source.label]);
    this.screenOptions(this.screen,labels);
    this.screen.value=this.zoomed ?? this.featured;
    this.updateAddScreen();
  }
  screenOptions(select,items){
    const current=[...select.options];
    if(current.length===items.length && items.every(([id,label],index)=>id===current[index].value && label===current[index].textContent))return false;
    select.replaceChildren(...items.map(([id,label])=>new this.win.Option(label,id)));
    return true;
  }
  updateAddScreen(){
    if(!this.addScreen)return;
    const missing=[...this.available.values()].filter(source=>!this.entries.has(source.id));
    // The main share has an empty ID, so the placeholder uses a separate value.
    if(this.screenOptions(this.addScreen,[['','Add a screen…'],...missing.map(({id,label})=>[`screen:${id}`,label])])){
      this.addScreen.options[0].disabled=true;
      this.addScreen.selectedIndex=0;
    }
    this.addScreen.hidden=!missing.length;
    this.controls.hidden=this.entries.size<2 && this.fullscreen.hidden && this.addScreen.hidden;
  }
  close(id){
    const entry=this.entries.get(id);if(!entry)return;
    this.entries.delete(id);entry.detach?.();entry.removeSound?.();entry.card?.remove();
    if(!this.entries.size)this.clear();else{this.render();this.changed?.();}
  }
  updateSources(sources){
    if(this.recovering)return;
    this.available=new Map(sources.map(source=>[source.id,source]));
    let labelsChanged=false;
    for(const [id,entry] of this.entries){
      const current=this.available.get(id);
      if(!current)this.close(id);
      else if((entry.title ?? entry.source.label)!==current.label){this.updateTitle(entry,current.label);labelsChanged=true;}
    }
    if(labelsChanged)this.render();
    else this.updateAddScreen();
    const doc=this.win?.document;
    if(doc)doc.dispatchEvent(new doc.defaultView.Event('screen-quick-refresh'));
  }
  beginReconnect(sharedSources){
    if(!this.active || this.recovering)return;
    this.recovering=true;
    const doc=this.win?.document;
    if(doc)doc.dispatchEvent(new doc.defaultView.Event('screen-quick-close'));
    for(const [id,entry] of this.entries){
      if(!sharedSources.has(id)){this.close(id);continue;}
      if(entry.note){entry.note.textContent='Reconnecting this screen…';entry.note.hidden=false;}
      if(entry.video)entry.video.dataset.reconnecting='true';
    }
  }
  finishReconnect(){this.recovering=false;}
  clear(closeWindow=true){
    this.recovering=false;
    if(!this.entries.size && !this.win && !this.opening && !this.popup)return;
    this.revision++;
    const win=this.win || this.popup;
    this.win=null;this.popup=null;this.opening=null;this.grid=null;this.controls=null;this.layout=null;this.screen=null;this.addScreen=null;this.fullscreen=null;
    clearInterval(this.popupWatch);clearInterval(this.windowWatch);clearTimeout(this.popupTimeout);this.popupReady?.(null);this.popupReady=null;
    for(const entry of this.entries.values()){entry.detach?.();entry.removeSound?.();}
    this.entries.clear();
    if(closeWindow && win && !win.closed)win.close();
    this.focusedWindow=null;this.focusChanged?.();
    this.changed?.();
  }
}

export function mirrorVideo(video,note,stream){
  video.srcObject=stream || null;
  const ready=()=>{note.hidden=true;delete video.dataset.reconnecting;};
  video.addEventListener('loadeddata',ready,{once:true});
  if(stream)video.play().catch(()=>{});
  return (keepPicture=false)=>{video.removeEventListener('loadeddata',ready);if(!keepPicture)video.srcObject=null;};
}

export function mirrorPlayer(source,video,note){
  let detach,stream;
  const sync=()=>{
    if(source.srcObject===stream)return;
    if(video.dataset.reconnecting==='true' && stream && source.readyState<2)return;
    detach?.(true);stream=source.srcObject;note.hidden=false;
    detach=mirrorVideo(video,note,stream);
  };
  const events=['loadeddata','emptied','resize'];
  for(const event of events)source.addEventListener(event,sync);
  sync();
  return ()=>{detach?.();for(const event of events)source.removeEventListener(event,sync);};
}
