// Standalone SDK: usable by native webviews and web apps with a copied read URL.
export class InputClient extends EventTarget{
  constructor(url){super();this.url=url;this.devices=new Map();}
  connect(){this.close();const ws=this.socket=new WebSocket(this.url);ws.onmessage=event=>{if(this.socket!==ws)return;let value;try{value=JSON.parse(event.data);}catch{return;}
    if(value.type==='snapshot'){this.devices.clear();for(const input of value.devices || [])this.devices.set(input.peerId+'|'+input.device,input);this.dispatchEvent(new CustomEvent('snapshot',{detail:[...this.devices.values()]}));}
    if(value.type==='input'){if(value.kind==='reset'){for(const [key,input] of this.devices)if(input.peerId===value.peerId && (value.device==='all' || input.device===value.device))this.devices.delete(key);}else this.devices.set(value.peerId+'|'+value.device,value);this.dispatchEvent(new CustomEvent('input',{detail:value}));}
    if(value.type==='reset-all')this.reset();};ws.onclose=()=>{if(this.socket===ws){this.socket=null;this.reset();this.dispatchEvent(new Event('disconnect'));}};return this;}
  reset(){this.devices.clear();this.dispatchEvent(new Event('reset'));}
  close(){if(this.socket){const ws=this.socket;this.socket=null;ws.close();}this.reset();}
}

export class LocalInputPublisher{
  constructor(label,onError=()=>{}){this.label=label;this.onError=onError;this.queue=[];this.epoch=0;this.heartbeat=setInterval(()=>{if(this.socket?.readyState===1 && this.socket.bufferedAmount<32768)this.socket.send(JSON.stringify({type:'heartbeat'}));},700);window.addEventListener('pagehide',()=>{clearInterval(this.heartbeat);this.close();});}
  async start(){if(this.socket?.readyState===1)return this.session;if(this.opening)return this.opening;if(Date.now()<(this.retryAt || 0))return null;const epoch=this.epoch;
    return this.opening=(async()=>{let session=this.session;try{if(!session){const response=await fetch('/api/inputs/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:this.label})});if(!response.ok)throw Error('Local input API is unavailable');session=await response.json();}if(epoch!==this.epoch){this.remove(session);return null;}this.session=session;const url=this.url('publish',session.writeToken),ws=this.socket=new WebSocket(url);
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Local input API timed out')),5000);ws.onopen=()=>{clearTimeout(timer);resolve();};ws.onerror=()=>{clearTimeout(timer);reject(Error('Local input API connection failed'));};ws.onclose=()=>{clearTimeout(timer);if(this.socket===ws){this.socket=null;this.queue=[];}reject(Error('Local input API closed'));};});
      if(epoch!==this.epoch){ws.close();return null;}for(const value of this.queue.splice(0))this.publish(value);return session;
    }catch(error){this.retryAt=Date.now()+5000;this.queue=[];this.socket?.close();this.socket=null;if(session){this.remove(session);if(this.session===session)this.session=null;}this.onError(error.message);return null;}finally{this.opening=null;}})();
  }
  url(action,token){const url=new URL('/api/inputs/'+action,location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('session',this.session.id);url.searchParams.set('token',token);return url.href;}
  async readURL(){const session=await this.start();return session?this.url('subscribe',session.readToken):null;}
  publish(value){if(this.socket?.readyState===1){if(this.socket.bufferedAmount>32768){this.socket.close();return;}this.socket.send(JSON.stringify(value));return;}if(value.kind==='reset' && !this.session)return;if(this.queue.length>=256){this.queue=[];this.onError('Local input API is busy; reconnect the integration.');return;}this.queue.push(value);this.start();}
  remove(session){fetch('/api/inputs/sessions/'+session.id,{method:'DELETE',headers:{Authorization:'Bearer '+session.writeToken},keepalive:true}).catch(()=>{});}
  close(){this.epoch++;this.queue=[];this.socket?.close();this.socket=null;if(this.session)this.remove(this.session);this.session=null;}
}
