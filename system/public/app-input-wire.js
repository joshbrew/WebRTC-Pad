import {desktopCodes} from './desktop.js';
import {buttonLabels,neutralState} from './input.js';
const id=value=>typeof value==='string' && /^[a-zA-Z0-9:_-]{1,96}$/.test(value);
const finite=(n,min,max)=>typeof n==='number' && Number.isFinite(n) && n>=min && n<=max;
export function midiData(value){
  if(!Array.isArray(value) || value.length<1 || value.length>3 || value.some(n=>!Number.isInteger(n) || n<0 || n>255))return null;
  const status=value[0],size=status>=0x80 && status<0xf0?([0xc0,0xd0].includes(status&0xf0)?2:3):[0xf8,0xfa,0xfb,0xfc,0xfe].includes(status)?1:0;
  return size===value.length && value.slice(1).every(n=>n<128)?[...value]:null;
}
export function appInputPacket(value){
  if(!value || value.version!==1 || !id(value.device) || !Number.isSafeInteger(value.seq) || value.seq<0)return null;
  const base={version:1,kind:value.kind,device:value.device,seq:value.seq};
  if(value.kind==='reset')return base;
  if(value.kind==='controller'){
    const state=neutralState();if(!value.state?.axes || !value.state?.buttons)return null;
    for(const key of Object.keys(state.axes)){const low=['lt','rt'].includes(key)?0:-1;if(!finite(value.state.axes[key],low,1))return null;state.axes[key]=value.state.axes[key];}
    for(const key of Object.keys(buttonLabels)){if(typeof value.state.buttons[key]!=='boolean')return null;state.buttons[key]=value.state.buttons[key];}
    return {...base,state,label:typeof value.label==='string'?value.label.replace(/[\x00-\x1f\x7f]/g,'').slice(0,64):'Controller'};
  }
  if(value.kind==='device' && value.inputKind==='midi')return {...base,inputKind:'midi',label:typeof value.label==='string'?value.label.replace(/[\x00-\x1f\x7f]/g,'').slice(0,64):'MIDI device'};
  if(value.kind==='midi'){const data=midiData(value.data);return data?{...base,data,label:typeof value.label==='string'?value.label.replace(/[\x00-\x1f\x7f]/g,'').slice(0,64):'MIDI device'}:null;}
  if(value.kind==='keyboard')return Array.isArray(value.keys) && value.keys.length<=64 && value.keys.every(code=>desktopCodes.has(code)) && new Set(value.keys).size===value.keys.length?{...base,keys:[...value.keys]}:null;
  if(value.kind==='mouse'){
    if(!finite(value.x,0,1) || !finite(value.y,0,1) || !Array.isArray(value.buttons) || value.buttons.length>5 || value.buttons.some(n=>!Number.isInteger(n) || n<0 || n>4) || new Set(value.buttons).size!==value.buttons.length)return null;
    const result={...base,x:value.x,y:value.y,buttons:[...value.buttons]};
    for(const key of ['dx','dy','wheelX','wheelY']){if(!finite(value[key] ?? 0,-32768,32768))return null;result[key]=value[key] || 0;}
    if(value.sourceId!==undefined && (typeof value.sourceId!=='string' || value.sourceId.length>96))return null;
    result.sourceId=value.sourceId || '';
    for(const key of ['width','height']){if(!Number.isInteger(value[key]) || value[key]<1 || value[key]>32768)return null;result[key]=value[key];}
    return result;
  }
  return null;
}

// Independent identities and explicit releases; no OS input injection here.
export class AppInputInbox{
  constructor(deliver){this.deliver=deliver;this.states=new Map();this.sequences=new Map();this.deliverySequence=0;}
  emit(value){this.deliver({...value,seq:this.deliverySequence++});}
  receive(peer,value,allowed){const packet=appInputPacket(value);if(!packet || packet.kind!=='reset' && !allowed[packet.kind==='controller'?'controllers':packet.kind==='midi' || packet.kind==='device'?'midi':'events'])return false;
    const key=peer+'|'+packet.device;if(!this.sequences.has(key) && this.sequences.size>=1024 || packet.seq<=(this.sequences.get(key) ?? -1))return false;this.sequences.set(key,packet.seq);
    if(packet.kind==='reset'){this.release(peer,packet.device);return true;}
    if(!this.states.has(key) && this.states.size>=1024)return false;
    this.states.set(key,{peer,packet});this.emit({peerId:peer,...packet});return true;
  }
  release(peer,device='all'){for(const [key,state] of this.states)if(state.peer===peer && (device==='all' || state.packet.device===device)){this.states.delete(key);this.emit({peerId:peer,version:1,kind:'reset',device:state.packet.device,seq:state.packet.seq+1});}if(device==='all')for(const key of this.sequences.keys())if(key.startsWith(peer+'|'))this.sequences.delete(key);}
  clear(){for(const peer of new Set([...this.states.values()].map(value=>value.peer)))this.release(peer);this.sequences.clear();}
}
