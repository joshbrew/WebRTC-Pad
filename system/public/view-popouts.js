import {gatherIce,sanitizeIceConfig} from './pairing.js';
import {preferLowLatency} from './rtc.js';

const post=(p,msg)=>{if(p.control?.readyState==='open')p.control.send(JSON.stringify(msg));};

// Separate video subscriptions share the existing control connection. No extra
// controller slots, input channels, or audio capture are created for a window.
export class HostViewPopouts {
  constructor(options){Object.assign(this,options);this.entries=new Map();}
  async handle(p,peerId,msg){
    if(!['view-open','view-close','view-answer'].includes(msg?.type))return false;
    if(typeof msg.sourceId!=='string' || msg.sourceId.length>80)return true;
    const key=`${peerId}:${msg.sourceId}`,current=this.entries.get(key);
    if(msg.type==='view-close'){if(!msg.requestId || current?.requestId===msg.requestId)this.close(key);return true;}
    if(msg.type==='view-answer'){
      if(!current || current.token!==msg.token)return true;
      try{if(current.kind==='native')await this.nativeCommand('native-answer',peerId,{sourceId:msg.sourceId,viewer:true,sdp:msg.sdp});else await current.pc.setRemoteDescription(msg.sdp);clearTimeout(current.timer);}
      catch(error){this.close(key);post(p,{type:'view-error',sourceId:msg.sourceId,requestId:current.requestId,error:'This view could not connect. Close it and try again.'});}return true;
    }
    if(current){if(!msg.requestId || current.requestId===msg.requestId)return true;this.close(key);}
    const source=this.source(msg.sourceId);
    if(!source){post(p,{type:'view-error',sourceId:msg.sourceId,requestId:msg.requestId,error:'This view is no longer shared.'});return true;}
    const entry={p,peerId,sourceId:msg.sourceId,source,kind:source.kind,requestId:typeof msg.requestId==='string'?msg.requestId.slice(0,80):undefined,token:crypto.randomUUID()};this.entries.set(key,entry);
    entry.timer=setTimeout(()=>{if(this.entries.get(key)!==entry)return;this.close(key);post(p,{type:'view-error',sourceId:msg.sourceId,requestId:msg.requestId,error:'The view timed out. Close it and try again.'});},45000);
    try{
      // Extra views use H.264 for consistent independent playback. Quality is
      // bounded by the same host/guest limits as the main stream.
      const quality={...this.quality(p),codec:'h264'};let sdp,ice;
      if(source.kind==='native'){
        const result=await this.nativeCommand('native-offer',peerId,{sourceId:msg.sourceId,viewer:true,quality});sdp=result.sdp;ice=result.ice;
      }else{
        const track=source.stream?.getVideoTracks()[0];if(track?.readyState!=='live')throw new Error('This source has stopped.');
        ice=await this.ice();if(this.entries.get(key)!==entry)return true;
        const pc=new RTCPeerConnection(ice);entry.pc=pc;const sender=pc.addTransceiver(track,{direction:'sendonly',streams:[source.stream]}).sender;
        const parameters=sender.getParameters();if(parameters.encodings?.length){const size=track.getSettings();parameters.encodings[0].maxBitrate=quality.maxBitrate;parameters.encodings[0].maxFramerate=quality.frameRate;parameters.encodings[0].scaleResolutionDownBy=Math.max(1,(size.width || 1)/(quality.width || Infinity),(size.height || 1)/(quality.height || Infinity));await sender.setParameters(parameters);}
        await pc.setLocalDescription(await pc.createOffer());await gatherIce(pc);sdp=pc.localDescription;
      }
      if(this.entries.get(key)===entry)post(p,{type:'view-offer',sourceId:msg.sourceId,requestId:entry.requestId,token:entry.token,sdp,ice});
      else if(source.kind==='native' && !this.entries.has(key))this.nativeCommand('native-close',peerId,{sourceId:msg.sourceId,viewer:true}).catch(()=>{});
    }catch(error){if(this.entries.get(key)===entry){this.close(key);post(p,{type:'view-error',sourceId:msg.sourceId,requestId:msg.requestId,error:'Could not start this view. Check the host’s screen sharing settings.'});}}
    return true;
  }
  close(key){const entry=this.entries.get(key);if(!entry)return;this.entries.delete(key);clearTimeout(entry.timer);entry.pc?.close();if(entry.kind==='native')this.nativeCommand('native-close',entry.peerId,{sourceId:entry.sourceId,viewer:true}).catch(()=>{});}
  closePeer(p){for(const [key,entry] of this.entries)if(entry.p===p)this.close(key);}
  prune(){for(const [key,entry] of this.entries)if(!this.source(entry.sourceId)){post(entry.p,{type:'view-error',sourceId:entry.sourceId,requestId:entry.requestId,error:'The host stopped sharing this view.'});this.close(key);}}
  refreshMain(){for(const [key,entry] of [...this.entries])if(!entry.sourceId && this.source('') && this.source('').identity!==entry.source.identity){const {p,peerId}=entry;this.close(key);this.handle(p,peerId,{type:'view-open',sourceId:'',requestId:entry.requestId});}this.prune();}
}

export class GuestViewPopouts {
  constructor({send,status}){
    Object.assign(this,{send,status});this.entries=new Map();this.sources=new Map();
    window.addEventListener('message',event=>{
      if(event.origin!==location.origin || event.data?.type!=='view-window-ready')return;
      const found=[...this.entries].find(([,entry])=>entry.window===event.source);if(!found)return;
      const [sourceId,entry]=found;if(entry.ready)return;entry.ready=true;
      const d=entry.window.document;d.title=this.sources.get(sourceId) || 'Shared view';d.querySelector('#viewTitle').textContent=d.title;
      entry.popupSink={video:d.querySelector('video'),note:d.querySelector('[role=status]')};this.addSink(sourceId,entry,entry.popupSink);
      const win=entry.window;win.addEventListener('pagehide',()=>{if(entry.window===win)this.closeWindow(sourceId);});
    });
  }
  update(sources){this.sources=new Map(sources.map(s=>[s.id,s.label]));for(const [id] of this.entries)if(!this.sources.has(id))this.close(id);}
  entry(id){let e=this.entries.get(id);if(!e){e={requestId:crypto.randomUUID(),sinks:new Set(),noteText:'Connecting… · video only'};this.entries.set(id,e);}return e;}
  addSink(id,e,sink){e.sinks.add(sink);sink.video.muted=true;sink.video.playsInline=true;sink.video.srcObject=e.stream || null;sink.note.textContent=e.noteText;sink.note.hidden=!!e.stream && sink.note.classList.contains('tile-status');if(e.stream)sink.video.play().catch(()=>{});if(!e.subscribed){e.subscribed=true;this.send({type:'view-open',sourceId:id,requestId:e.requestId});}}
  attach(id,video,note){const e=this.entry(id),sink={video,note};this.addSink(id,e,sink);return ()=>{e.sinks.delete(sink);video.srcObject=null;if(!e.sinks.size && !e.window)this.close(id);};}
  paint(e,text){e.noteText=text;for(const sink of e.sinks){sink.note.textContent=text;sink.note.hidden=!!e.stream && sink.note.classList.contains('tile-status');sink.video.srcObject=e.stream || null;if(e.stream)sink.video.play().catch(()=>{});}}
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
    if(msg.type==='view-error'){entry.pc?.close();entry.stream=null;this.paint(entry,String(msg.error || 'This view stopped.').slice(0,180));return true;}
    entry.pc?.close();const pc=new RTCPeerConnection(sanitizeIceConfig(msg.ice));entry.pc=pc;
    pc.ontrack=e=>{if(this.entries.get(msg.sourceId)!==entry || entry.pc!==pc)return;preferLowLatency(e.receiver);entry.stream=new MediaStream([e.track]);this.paint(entry,'Video only · controller sharing stays in the main app');};
    pc.onconnectionstatechange=()=>{if(pc.connectionState==='failed')this.paint(entry,'Connection lost. Close this view and open it again.');};
    try{await pc.setRemoteDescription(msg.sdp);await pc.setLocalDescription(await pc.createAnswer());await gatherIce(pc);if(this.entries.get(msg.sourceId)===entry && entry.pc===pc)this.send({type:'view-answer',sourceId:msg.sourceId,token:msg.token,sdp:pc.localDescription});}
    catch{if(this.entries.get(msg.sourceId)===entry){pc.close();entry.stream=null;this.paint(entry,'Could not connect this view. Close it and try again.');}}return true;
  }
  closeWindow(id){const e=this.entries.get(id);if(!e?.window)return;const win=e.window;e.window=null;e.ready=false;if(e.popupSink){e.sinks.delete(e.popupSink);e.popupSink.video.srcObject=null;e.popupSink=null;}if(!win.closed)win.close();if(!e.sinks.size)this.close(id);if(![...this.entries.values()].some(e=>e.window)){clearInterval(this.timer);this.timer=null;}}
  close(id){const e=this.entries.get(id);if(!e)return;this.entries.delete(id);e.pc?.close();for(const sink of e.sinks)sink.video.srcObject=null;e.sinks.clear();if(e.subscribed)this.send({type:'view-close',sourceId:id,requestId:e.requestId});if(e.window && !e.window.closed)e.window.close();if(![...this.entries.values()].some(e=>e.window)){clearInterval(this.timer);this.timer=null;}}
  clear(){for(const id of [...this.entries.keys()])this.close(id);this.sources.clear();}
}
