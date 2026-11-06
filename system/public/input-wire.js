// Negotiated controller snapshot v1: lossless JS numbers, no device-brand data.
// JSON remains available when pairing with an older app. Control messages keep
// their existing reliable channel and never use this snapshot format.
export const inputWireVersion=1;
export const inputPacketBytes=76;
// Keep at most roughly one controller group's snapshots queued locally. A
// congested connection should resume with current state, not old movements.
export const inputQueueLimit=(controllers,version)=>Math.min(8192,(version===inputWireVersion?inputPacketBytes:512)*Math.max(1,controllers));
const buttons=['a','b','x','y','lb','rb','back','start','ls','rs','up','down','left','right','guide'];
const axes=['lx','ly','rx','ry','lt','rt'];
const validCounter=value=>Number.isSafeInteger(value) && value>=0;
export function encodeInputPacket(packet){
  const {seq,controller=0,generation=0,source,state}=packet || {};
  if(!validCounter(seq) || !validCounter(generation) || !Number.isInteger(controller) || controller<0 || controller>0xffffffff || !['gamepad','keyboard'].includes(source) || !state?.buttons || !state.axes || axes.some(key=>!Number.isFinite(state.axes[key])))return null;
  const buffer=new ArrayBuffer(inputPacketBytes),view=new DataView(buffer);
  view.setUint8(0,0x50);view.setUint8(1,inputWireVersion);view.setUint8(2,source==='keyboard'?1:0);
  view.setUint32(4,controller,true);view.setFloat64(8,seq,true);view.setFloat64(16,generation,true);
  let mask=0;for(let i=0;i<buttons.length;i++)if(state.buttons[buttons[i]]===true)mask|=1<<i;
  view.setUint32(24,mask,true);
  for(let i=0;i<axes.length;i++)view.setFloat64(28+i*8,state.axes[axes[i]],true);
  return buffer;
}
export function decodeInputPacket(data){
  let view;
  if(data instanceof ArrayBuffer){if(data.byteLength!==inputPacketBytes)return null;view=new DataView(data);}
  else if(ArrayBuffer.isView(data)){if(data.byteLength!==inputPacketBytes)return null;view=new DataView(data.buffer,data.byteOffset,data.byteLength);}
  else return null;
  if(view.byteLength!==inputPacketBytes || view.getUint8(0)!==0x50 || view.getUint8(1)!==inputWireVersion || view.getUint8(2)>1 || view.getUint8(3)!==0)return null;
  const seq=view.getFloat64(8,true),generation=view.getFloat64(16,true),mask=view.getUint32(24,true);
  if(!validCounter(seq) || !validCounter(generation) || mask>>>buttons.length)return null;
  const state={buttons:{},axes:{}};
  for(let i=0;i<buttons.length;i++)state.buttons[buttons[i]]=!!(mask & 1<<i);
  for(let i=0;i<axes.length;i++){
    const value=view.getFloat64(28+i*8,true);if(!Number.isFinite(value))return null;state.axes[axes[i]]=value;
  }
  return {seq,controller:view.getUint32(4,true),generation,source:view.getUint8(2)?'keyboard':'gamepad',state};
}
export function inputPayload(packet,version){return version===inputWireVersion?encodeInputPacket(packet):JSON.stringify(packet);}
