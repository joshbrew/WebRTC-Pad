import {chatAttachments} from './file-transfer.js';
export const chatLimit=100,chatTextLimit=1000;
const identity=value=>typeof value==='string' && /^[a-zA-Z0-9-]{1,64}$/.test(value);
export const chatText=value=>{if(typeof value!=='string')return '';const text=value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,chatTextLimit).trim();return [...text].map(char=>char.length===1 && char.charCodeAt(0)>=0xd800 && char.charCodeAt(0)<=0xdfff?'\ufffd':char).join('');};
const validEntry=entry=>entry && Number.isSafeInteger(entry.seq) && entry.seq>0 && identity(entry.author) && typeof entry.name==='string' && entry.name.length<=48 && typeof entry.text==='string' && entry.text.length<=chatTextLimit && chatText(entry.text)===entry.text && entry.text.length>0 && Number.isSafeInteger(entry.time) && entry.time>=0 && entry.time<=Date.now()+86400000;
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export class ChatHistory{
  constructor(){this.reset();}
  reset(epoch=null){this.epoch=epoch;this.cursor=0;this.entries=[];}
  merge(entries){for(const entry of Array.isArray(entries)?entries:[])if(validEntry(entry) && !this.entries.some(row=>row.seq===entry.seq)){this.entries.push({seq:entry.seq,author:entry.author,name:entry.name,text:entry.text,time:entry.time,...(identity(entry.request)?{request:entry.request}:{})});this.cursor=Math.max(this.cursor,entry.seq);}this.entries.sort((a,b)=>a.seq-b.seq);this.entries=this.entries.slice(-chatLimit);}
  complete(cursor){return Number.isSafeInteger(cursor) && cursor>=0 && Array.from({length:Math.min(cursor,chatLimit)},(_,i)=>cursor-i).every(seq=>this.entries.some(e=>e.seq===seq));}
  tail(bytes=16000){const entries=[];for(const entry of [...this.entries].reverse()){if(new TextEncoder().encode(JSON.stringify([entry,...entries])).length>bytes)break;entries.unshift(entry);}return entries;}
}

// Ordered, reliable and low priority. A bounded outbox waits for SCTP to drain
// rather than dropping messages or sending the entire history in one frame.
export function chatLink(channel,receive,closed=()=>{}){
  let queue=[],timer=null,stopped=false,api;channel.bufferedAmountLowThreshold=16384;
  const flush=()=>{clearTimeout(timer);timer=null;if(stopped || channel.readyState!=='open')return;while(queue.length && channel.bufferedAmount<32768){try{channel.send(queue[0]);queue.shift();}catch{stop();closed();return;}}if(queue.length)timer=setTimeout(flush,30);else queueMicrotask(()=>{if(!stopped && !queue.length)api?.onDrain?.();});};
  const stop=()=>{stopped=true;clearTimeout(timer);queue=[];channel.removeEventListener('bufferedamountlow',flush);};
  channel.addEventListener('bufferedamountlow',flush);
  channel.onmessage=event=>{if(stopped || typeof event.data!=='string' || event.data.length>20000)return;try{receive(JSON.parse(event.data));}catch{/* Invalid chat packets are ignored. */}};
  channel.onclose=()=>{if(!stopped){stop();closed();}};
  return api={channel,stop,send(message){if(stopped || channel.readyState!=='open' || queue.length>=128)return false;const raw=JSON.stringify(message);if(raw.length>20000)return false;queue.push(raw);flush();return true;}};
}

export class SessionChat{
  constructor(root,{host=false,stage,onFocus=()=>{}}={}){
    Object.assign(this,{root,host,stage,onFocus});this.history=new ChatHistory();this.links=new Map();this.authors=new Map();this.unread=0;this.ready=false;
    root.className='chat-card';root.innerHTML=`<div data-chat="messages" class="chat-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label="Call messages" tabindex="0"></div><p data-chat="empty" class="chat-empty">Say hello to the call.</p><form class="chat-compose"><label class="sr-only" for="${root.id}Input">Message the call</label><textarea id="${root.id}Input" data-chat="input" rows="1" maxlength="${chatTextLimit}" placeholder="Message the call…" aria-describedby="${root.id}Note"></textarea><button data-chat="send" type="submit" class="button primary" aria-label="Send message" title="Send message">${icon('send')}</button></form><p data-chat="status" class="chat-status" role="status"></p><p id="${root.id}Note" class="chat-session-note" title="New joiners receive the recent conversation. Messages are cleared when the call ends.">Only this call · latest 100 messages</p>`;
    this.$=name=>root.querySelector(`[data-chat="${name}"]`);
    this.peek=document.createElement('button');this.peek.type='button';this.peek.className='chat-peek';this.peek.hidden=true;this.peek.setAttribute('aria-label','Open call chat');stage.append(this.peek);this.peek.onclick=()=>this.onOpen?.();
    for(const name of ['pointerdown','pointermove','pointerup','wheel','keydown'])this.peek.addEventListener(name,e=>e.stopPropagation());
    root.querySelector('form').onsubmit=event=>{event.preventDefault();this.post(this.$('input').value);};
    this.$('input').onkeydown=event=>{if(event.key!=='Escape')event.stopPropagation();if(event.key==='Enter' && !event.shiftKey && !event.isComposing){event.preventDefault();this.post(this.$('input').value);}};
    root.addEventListener('focusin',()=>this.onFocus());this.$('input').oninput=()=>this.renderState();
    this.inputObserver=new ResizeObserver(()=>this.sizeInput());this.inputObserver.observe(this.$('input'));
    window.addEventListener('pagehide',()=>{this.inputObserver.disconnect();this.setReady(false);});this.render();this.files=chatAttachments(this);
  }
  state(){this.root.dispatchEvent(new Event('chat-state',{bubbles:true}));}
  setReady(ready){
    if(this.ready===ready)return;this.ready=ready;
    if(!ready){this.detach();clearTimeout(this.postTimer);clearTimeout(this.recoveryTimer);clearTimeout(this.peekTimer);this.peek.hidden=true;this.history.reset();this.authors.clear();this.self=null;this.synced=false;this.recovering=false;this.unread=0;this.pending=null;this.$('input').value='';this.note='';}
    else if(this.host){this.history.reset(crypto.randomUUID());this.self=crypto.randomUUID();this.authors.set('host',{author:this.self,name:'Host'});this.synced=true;}
    this.render();
  }
  detach(){this.files?.reset();for(const link of this.links.values())link.stop();this.links.clear();this.upstream?.stop();this.upstream=null;}
  removePeer(id){this.files?.removePeer(id);this.links.get(id)?.stop();this.links.delete(id);}
  name(id){const member=this.authors.get(id);return member || {author:crypto.randomUUID(),name:'Guest'};}
  addPeer(id,channel,name='Guest'){
    this.links.get(id)?.stop();this.links.delete(id);const member=this.name(id);member.name=chatText(name || 'Guest').replace(/\s+/g,' ').slice(0,48) || 'Guest';this.authors.set(id,member);
    let link;link=chatLink(channel,msg=>{if(this.links.get(id)===link)this.receiveHost(id,msg);},()=>{if(this.links.get(id)===link)this.links.delete(id);});this.links.set(id,link);link.onDrain=()=>{if(link.resync && this.links.get(id)===link){link.resync=false;this.sync(link,member.author);}};
    this.sync(link,member.author);
    if(this.recovering && id===this.recoveryFrom)link.send({action:'recover',epoch:this.history.epoch,cursor:this.recoveryCursor});
  }
  connect(channel){
    this.upstream?.stop();this.setReady(true);this.synced=false;let link;
    link=chatLink(channel,msg=>{if(this.upstream===link)this.receiveGuest(msg);},()=>{if(this.upstream===link)this.setReady(false);});this.upstream=link;this.renderState();
  }
  sync(link,self){const ok=link.send({action:'welcome',epoch:this.history.epoch,self,cursor:this.history.cursor}) && this.chunks(link,'history',this.history.entries) && link.send({action:'ready',epoch:this.history.epoch,cursor:this.history.cursor,waiting:this.recovering===true});if(!ok)link.resync=true;}
  chunks(link,action,entries){for(let i=0;i<entries.length;i+=8)if(!link.send({action,epoch:this.history.epoch,entries:entries.slice(i,i+8)}))return false;return true;}
  broadcast(message){for(const link of this.links.values())if(link.resync || !link.send(message))link.resync=true;}
  post(value){
    const text=chatText(value);if(!text || !this.ready || !this.synced || this.locked || this.pending)return;
    const request=crypto.randomUUID();
    if(this.host){this.accept('host',{request,text});this.$('input').value='';}
    else if(this.upstream?.send({action:'post',request,text})){this.pending={request,text};clearTimeout(this.postTimer);this.postTimer=setTimeout(()=>{if(this.pending?.request===request){this.pending=null;this.note='Message was not confirmed. Your text is still here; try again when connected.';this.renderState();}},10000);}
    else this.note='Chat is reconnecting. Your text is still here.';
    this.renderState();
  }
  accept(id,msg){
    const member=this.authors.get(id),text=chatText(msg.text);if(!member || !identity(msg.request) || !text || !this.ready)return;
    const link=this.links.get(id);
    if(this.locked || this.recovering){link?.send({action:'error',request:msg.request,message:'Chat is switching hosts. Try again in a moment.'});return;}
    member.requests ||= new Set();if(member.requests.has(msg.request))return;
    const now=performance.now();member.posts=(member.posts || []).filter(at=>now-at<5000);if(id!=='host' && member.posts.length>=10){link?.send({action:'error',request:msg.request,message:'Please wait a moment before sending more messages.'});return;}
    member.posts.push(now);member.requests.add(msg.request);if(member.requests.size>100)member.requests.delete(member.requests.values().next().value);
    const entry={seq:this.history.cursor+1,author:member.author,name:member.name,time:Date.now(),text,request:msg.request};this.history.merge([entry]);this.broadcast({action:'message',epoch:this.history.epoch,entry,request:msg.request});this.arrived(entry);this.render();
  }
  receiveHost(id,msg){
    if(!this.host || !this.ready || !msg)return;
    if(msg.action==='post'){this.accept(id,msg);return;}
    if(!this.recovering || id!==this.recoveryFrom || msg.epoch!==this.history.epoch)return;
    if(msg.action==='recovery-history' && Array.isArray(msg.entries) && msg.entries.length<=8){this.history.merge(msg.entries.filter(e=>e?.seq<=this.recoveryCursor));}
    if(msg.action==='recovery-ready' && msg.cursor===this.recoveryCursor && this.history.complete(this.recoveryCursor))this.finishRecovery();
  }
  receiveGuest(msg){
    if(this.host || !this.ready || !msg)return;
    if(msg.action==='welcome'){
      if(!identity(msg.epoch) || !identity(msg.self) || !Number.isSafeInteger(msg.cursor) || msg.cursor<0)return;
      if(this.history.epoch!==msg.epoch){const previous=!!this.history.epoch;this.history.reset(msg.epoch);this.unread=0;this.pending=null;if(previous)this.$('input').value='';}
      this.self=msg.self;this.synced=false;this.render();return;
    }
    if(msg.epoch!==this.history.epoch && msg.action!=='error')return;
    if(msg.action==='history' && Array.isArray(msg.entries) && msg.entries.length<=8){this.history.merge(msg.entries);this.ackPending();this.render();}
    if(msg.action==='ready' && Number.isSafeInteger(msg.cursor) && msg.cursor>=0){this.history.cursor=Math.max(this.history.cursor,msg.cursor);this.synced=!msg.waiting;this.note='';this.renderState();}
    if(msg.action==='message' && validEntry(msg.entry)){
      const fresh=msg.entry.seq>this.history.cursor;this.history.merge([msg.entry]);
      this.ackPending();
      if(fresh)this.arrived(msg.entry);this.render();
    }
    if(msg.action==='error' && msg.request===this.pending?.request){this.pending=null;clearTimeout(this.postTimer);this.note=String(msg.message || 'Message could not be sent. Try again.').slice(0,160);this.renderState();}
    if(msg.action==='recover' && Number.isSafeInteger(msg.cursor) && msg.cursor>=0){this.chunks(this.upstream,'recovery-history',this.history.entries.filter(e=>e.seq<=msg.cursor));this.upstream.send({action:'recovery-ready',epoch:this.history.epoch,cursor:msg.cursor});}
  }
  ackPending(){if(this.pending && this.history.entries.some(e=>e.request===this.pending.request && e.author===this.self)){if(chatText(this.$('input').value)===this.pending.text)this.$('input').value='';this.pending=null;clearTimeout(this.postTimer);this.note='';}}
  arrived(entry){
    if(entry.author===this.self || this.open)return;this.unread=Math.min(chatLimit,this.unread+1);
    this.peek.replaceChildren();const name=document.createElement('strong'),text=document.createElement('span');name.textContent=entry.name;text.textContent=entry.text.slice(0,160);this.peek.append(name,text);this.peek.hidden=false;clearTimeout(this.peekTimer);this.peekTimer=setTimeout(()=>{this.peek.hidden=true;},5000);
  }
  setOpen(open){this.open=open;if(open){this.unread=0;this.peek.hidden=true;this.$('messages').scrollTop=this.$('messages').scrollHeight;}this.state();}
  sizeInput(){
    const input=this.$('input');if(!input.getClientRects().length)return;const key=JSON.stringify([input.value,input.getBoundingClientRect().width]);if(key===this.inputSizeKey)return;this.inputSizeKey=key;input.style.height='auto';input.style.height=`${Math.max(40,Math.min(120,input.scrollHeight+2))}px`;
  }
  renderState(){
    this.sizeInput();
    this.$('messages').setAttribute('aria-live',this.open && this.synced?'polite':'off');this.$('input').disabled=!this.ready;this.$('send').disabled=!this.ready || !this.synced || this.locked || !!this.pending || !chatText(this.$('input').value);
    const status=!this.ready?'Connect to a call to chat.':this.locked?'Switching hosts…':!this.synced?'Catching up on the call…':this.pending?'Sending…':this.note || '';
    if(this.$('status').textContent!==status)this.$('status').textContent=status;this.state();
  }
  render(){
    const log=this.$('messages'),nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<48,scroll=log.scrollTop;
    this.rows ||= new Map();if(this.renderedEpoch!==this.history.epoch){this.rows.clear();log.replaceChildren();this.renderedEpoch=this.history.epoch;}
    const wanted=new Set(this.history.entries.map(e=>e.seq));for(const [seq,row] of this.rows)if(!wanted.has(seq)){row.remove();this.rows.delete(seq);}
    let previous=null;
    for(const entry of this.history.entries){let row=this.rows.get(entry.seq);if(!row){row=document.createElement('article');row.className='chat-message';row.dataset.seq=String(entry.seq);const heading=document.createElement('div'),name=document.createElement('strong'),time=document.createElement('time'),body=document.createElement('p');time.dateTime=new Date(entry.time).toISOString();time.textContent=new Date(entry.time).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});heading.append(name,time);body.textContent=entry.text;row.append(heading,body);this.rows.set(entry.seq,row);}row.dataset.mine=String(entry.author===this.self);const name=row.querySelector('strong'),label=entry.author===this.self?'You':entry.name;if(name.textContent!==label)name.textContent=label;const next=previous?previous.nextSibling:log.firstChild;if(next!==row)log.insertBefore(row,next);previous=row;}
    if(nearBottom)log.scrollTop=log.scrollHeight;else log.scrollTop=scroll;
    this.$('empty').hidden=!!this.history.entries.length;this.renderState();
  }
  snapshot(){return {epoch:this.history.epoch,cursor:this.history.cursor,tail:this.history.tail(),authors:[{id:'host',...this.authors.get('host')},...[...this.links.keys()].map(id=>({id,...this.authors.get(id)}))].map(({id,author,name})=>({id,author,name}))};}
  rebase({host,mapping,snapshot,stage}){
    this.detach();clearTimeout(this.peekTimer);clearTimeout(this.recoveryTimer);this.host=host;if(this.files){this.files.host=host;this.files.setPolicy({files:true,clipboard:false});}this.stage=stage;stage.append(this.peek);this.peek.hidden=true;this.ready=true;
    if(!identity(snapshot?.epoch) || !Number.isSafeInteger(snapshot?.cursor) || snapshot.cursor<0){this.history.reset(crypto.randomUUID());this.self ||= crypto.randomUUID();this.authors.clear();this.synced=host;if(host)this.authors.set('host',{author:this.self,name:'Host'});this.render();return;}
    if(this.history.epoch!==snapshot.epoch)this.history.reset(snapshot.epoch);this.history.merge(snapshot.tail);this.history.cursor=Math.max(this.history.cursor,snapshot.cursor);
    this.authors=new Map((Array.isArray(snapshot.authors)?snapshot.authors:[]).filter(m=>identity(m?.author) && typeof mapping[m.id]==='string').map(m=>[mapping[m.id],{author:m.author,name:String(m.name || 'Guest').slice(0,48)}]));
    if(host){const me=this.authors.get('host') || {author:this.self || crypto.randomUUID()};this.self=me.author;me.name='Host';this.authors.set('host',me);}
    this.recovering=host && !this.history.complete(snapshot.cursor);this.synced=host && !this.recovering;this.recoveryFrom=mapping.host;this.recoveryCursor=snapshot.cursor;
    if(this.recovering)this.recoveryTimer=setTimeout(()=>{this.note='Some earlier messages were unavailable after switching hosts.';this.finishRecovery();},5000);this.render();
  }
  finishRecovery(){clearTimeout(this.recoveryTimer);this.recovering=false;this.synced=true;for(const [id,link] of this.links)this.sync(link,this.authors.get(id).author);this.render();}
}
