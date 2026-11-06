import crypto from 'node:crypto';
import {WebSocketServer} from 'ws';
import {appInputPacket} from '../public/app-input-wire.js';
// Read-only, loopback-only integrations. A call's token never grants hosting,
// desktop injection, or access to another call. No input history is retained.
export class AppInputBridge{
  constructor(rooms){this.rooms=rooms;this.locals=new Map();this.states=new Map();this.timer=setInterval(()=>{for(const [id,s] of this.locals)if(Date.now()-s.last>300000 && ![...this.wss.clients].some(ws=>ws.room===s)){this.locals.delete(id);this.states.delete(s);}},30000);this.timer.unref?.();this.watchdog=setInterval(()=>{for(const ws of this.wss.clients)if(ws.publisher && Date.now()-(ws.lastActivity || 0)>3000){this.clear(ws.room);ws.close(1011,'Publisher stopped responding');}},700);this.watchdog.unref?.();this.wss=new WebSocketServer({noServer:true,maxPayload:1024});}
  create(label){if(this.locals.size>=32)throw Error('Too many local input sessions');const session={id:crypto.randomUUID(),label:typeof label==='string'?label.slice(0,64):'App input',readToken:crypto.randomBytes(24).toString('hex'),writeToken:crypto.randomBytes(24).toString('hex'),last:Date.now()};this.locals.set(session.id,session);return session;}
  upgrade(req,socket,head){let room,publish=false;try{const url=new URL(req.url,'http://localhost');publish=url.pathname==='/api/inputs/publish';room=url.searchParams.has('session')?this.locals.get(url.searchParams.get('session')):this.rooms.get(url.searchParams.get('room'));const expected=publish?room?.writeToken:room?.readToken || room?.appInputToken;if(!room || !expected || url.searchParams.get('token')!==expected)throw Error();}catch{socket.destroy();return;}
    this.wss.handleUpgrade(req,socket,head,ws=>{ws.room=room;ws.publisher=publish;ws.lastActivity=Date.now();room.last=Date.now();if(publish){if(room.publisher && room.publisher.readyState===1){ws.close(1008,'Publisher already connected');return;}room.publisher=ws;}
      ws.send(JSON.stringify({type:'ready',version:1}));if(!publish)ws.send(JSON.stringify({type:'snapshot',version:1,devices:[...(this.states.get(room)?.values() || [])]}));
      let started=Date.now(),count=0;ws.on('message',raw=>{if(!publish){ws.close(1008,'Read-only input stream');return;}if(Date.now()-started>1000){started=Date.now();count=0;}if(++count>2000){ws.close(1008,'Input rate exceeded');return;}let value;try{value=JSON.parse(raw);}catch{return;}ws.lastActivity=Date.now();if(value?.type==='heartbeat')return;this.publish(room,value.peerId,value);});ws.on('close',()=>{if(publish && room.publisher===ws){room.publisher=null;this.clear(room);room.last=Date.now();}});
    });
  }
  publish(room,peerId,value){const packet=appInputPacket(value);if(!packet || typeof peerId!=='string' || !/^[a-zA-Z0-9:_-]{1,96}$/.test(peerId))return;
    let states=this.states.get(room);if(!states){states=new Map();this.states.set(room,states);}const key=peerId+'|'+packet.device;
    if(packet.kind==='reset'){for(const [id,state] of states)if(state.peerId===peerId && (packet.device==='all' || state.device===packet.device))states.delete(id);}
    else{if(!states.has(key) && states.size>=1024)return;states.set(key,packet.kind==='midi'?{type:'input',peerId,version:1,kind:'device',inputKind:'midi',device:packet.device,label:packet.label,seq:packet.seq}:{type:'input',peerId,...packet});}
    this.broadcast(room,{type:'input',peerId,...packet});
  }
  broadcast(room,value){const data=JSON.stringify(value);for(const ws of this.wss.clients)if(ws.room===room && !ws.publisher && ws.readyState===1){if(ws.bufferedAmount>32768)ws.close(1013,'Input consumer too slow');else ws.send(data);}}
  clear(room){this.states.delete(room);this.broadcast(room,{type:'reset-all',version:1});}
  end(room){this.clear(room);for(const ws of this.wss.clients)if(ws.room===room)ws.close(1000,'Session ended');}
  close(){clearInterval(this.timer);clearInterval(this.watchdog);for(const ws of this.wss.clients)ws.terminate();this.wss.close();this.locals.clear();this.states.clear();}
}
