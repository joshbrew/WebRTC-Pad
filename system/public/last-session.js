// Remember setup choices, never live tracks, desktop access or device grabs.
export const lastSessionKey='webrtc-pad:last-session:v1';
export function browserSourceLabel(label,surface){
  const value=typeof label==='string'?label.trim():'';
  return !value || /^[A-Za-z0-9+/=_-]{32,}$/.test(value) || /^(?:screen|window):\d/.test(value)?surface==='window'?'Browser window':surface==='browser'?'Browser tab':surface==='monitor'?'Browser screen':'Browser share':value.slice(0,160);
}
export function sessionPage(url,saved='host'){
  const parsed=new URL(url,'http://localhost'),mode=parsed.searchParams.get('mode');
  if(parsed.searchParams.has('room') || ['join','client'].includes(mode) || new URLSearchParams(parsed.hash.slice(1)).has('invite'))return 'client';
  if(mode==='host')return 'host';
  return saved==='client'?'client':'host';
}
const choices={captureBackend:['native','browser'],streamResolution:['native','720','1080','1440','2160'],streamMinimumResolution:['360','480','720','1080','1440','2160'],streamFramerate:['15','30','60','120'],streamPriority:['motion','resolution','balanced'],streamCodec:['h264','h265'],streamEncoderPreset:['','p1','p2','p4'],hostControllerOutput:['auto','x360','ds4','native']};
const toggles=['nativeCaptureAudio','hostAudioOnly','hostAutoThrottle','hostAllowGuestVideo','hostAllowGuestMic','hostAllowGuestScreens','hostAllowFiles','hostAllowClipboard','hostDynamicControllers'];
export const lastSessionFields=[...Object.keys(choices),...toggles];
const size=value=>[value?.width,value?.height].every(n=>Number.isSafeInteger(n)&&n>1&&n<=32768)?{width:value.width,height:value.height}:null;
export function cleanLastSession(value){
  if(value?.version!==1)return null;const fields={};
  for(const [id,allowed] of Object.entries(choices))if(allowed.includes(value.fields?.[id]))fields[id]=value.fields[id];
  for(const id of toggles)if(typeof value.fields?.[id]==='boolean')fields[id]=value.fields[id];
  if(/^[1-9]\d{0,3}$/.test(value.fields?.hostControllerCount || '') && Number(value.fields.hostControllerCount)<=1024)fields.hostControllerCount=value.fields.hostControllerCount;
  const cleanSource=source=>source && ['none','desktop','window','browser'].includes(source.kind)?{kind:source.kind,label:typeof source.label==='string'?source.label.slice(0,240):''}:null;
  const source=cleanSource(value.source),audio=cleanSource(value.audio);
  let area=null;const bounds=size(value.bounds),rect=value.area;
  if(bounds && rect && ['x','y','width','height'].every(k=>Number.isSafeInteger(rect[k])) && rect.x>=0 && rect.y>=0 && rect.width>=2 && rect.height>=2 && rect.x+rect.width<=bounds.width && rect.y+rect.height<=bounds.height)area={x:rect.x,y:rect.y,width:rect.width,height:rect.height};
  // Never silently turn a saved crop into a full-window share.
  return {version:1,fields,source,audio,bounds,area,needsAreaReview:value.needsAreaReview===true || !!value.area && !area};
}
export function matchLastSource(source,targets){
  if(!source || !['desktop','window'].includes(source.kind))return null;
  const matches=targets.filter(t=>t.kind===source.kind && (source.kind==='desktop'?t.id==='desktop':t.label===source.label));
  return matches.length===1?matches[0]:null;
}
export function loadLastSession(storage){try{return cleanLastSession(JSON.parse((storage || globalThis.localStorage).getItem(lastSessionKey)));}catch{return null;}}
export function storeLastSession(value,storage){const clean=cleanLastSession(value);if(!clean)return;try{(storage || globalThis.localStorage).setItem(lastSessionKey,JSON.stringify(clean));}catch{/* This visit still works without storage. */}}
export function restoreLastFields(saved,doc=document,{ids=lastSessionFields}={}){
  for(const id of ids){const value=saved?.fields?.[id],el=doc.getElementById(id);if(!el)continue;if(el.type==='checkbox' && typeof value==='boolean')el.checked=value;else if(typeof value==='string' && [...el.options].some(o=>o.value===value && !o.disabled))el.value=value;}
}
