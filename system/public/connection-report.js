// Keep a bounded local journal. Never export raw RTC configuration, SDP, URLs,
// candidate addresses, identifiers, labels, error text, or credentials.
const states=new Set(['new','connecting','connected','disconnected','failed','closed','checking','completed','gathering','complete','stable','have-local-offer','have-remote-offer','have-local-pranswer','have-remote-pranswer']);
const kinds=new Set(['controls','browser-video','native-video','native-audio','preview','voice','camera']);
const safeState=value=>states.has(value)?value:'unknown';
const number=value=>typeof value==='number' && Number.isFinite(value) && value>=0?value:null;
const choice=(value,values)=>values.includes(value)?value:null;
const numericFields=['bytesSent','bytesReceived','packetsSent','packetsReceived','packetsLost','framesEncoded','framesDecoded','framesDropped','framesPerSecond','frameWidth','frameHeight','jitter','jitterBufferDelay','jitterBufferEmittedCount','totalDecodeTime','totalEncodeTime','roundTripTime','currentRoundTripTime','availableOutgoingBitrate','messagesSent','messagesReceived','requestsSent','requestsReceived','responsesSent','responsesReceived','consentRequestsSent','selectedCandidatePairChanges','keyFramesDecoded','nackCount','pliCount','firCount','freezeCount','totalFreezesDuration','audioLevel','totalAudioEnergy','totalSamplesDuration','silentConcealedSamples','concealedSamples','retransmittedPacketsSent','retransmittedBytesSent'];
export function browserEnvironment(ua=''){
  const browser=[['Edge',/Edg\/(\d+)/],['Firefox',/Firefox\/(\d+)/],['Chrome',/(?:Chrome|CriOS)\/(\d+)/],['Safari',/Version\/(\d+).*Safari/]].map(([family,pattern])=>({family,match:ua.match(pattern)})).find(value=>value.match);
  const os=/Android/.test(ua)?'Android':/iPhone|iPad/.test(ua)?'iOS':/Windows/.test(ua)?'Windows':/Macintosh|Mac OS X/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'unknown';
  return {browser:browser?.family || 'unknown',browserMajor:browser?Number(browser.match[1]):null,os};
}
function routes(description){
  const result={host:0,srflx:0,prflx:0,relay:0};
  for(const match of (description?.sdp || '').matchAll(/ typ (host|srflx|prflx|relay)(?: |\r|\n)/g))result[match[1]]++;
  return result;
}
function network(pc){
  let config={};try{config=pc.getConfiguration();}catch{}
  const servers={stun:0,turnUdp:0,turnTcp:0,turnTls:0};
  for(const server of config.iceServers || [])for(const url of Array.isArray(server.urls)?server.urls:[server.urls]){
    if(/^stuns?:/.test(url))servers.stun++;
    else if(/^turns:/.test(url))servers.turnTls++;
    else if(/^turn:/.test(url))servers[/[?&]transport=tcp(?:&|$)/.test(url)?'turnTcp':'turnUdp']++;
  }
  return {connection:safeState(pc.connectionState),ice:safeState(pc.iceConnectionState),gathering:safeState(pc.iceGatheringState),signaling:safeState(pc.signalingState),dtls:choice(pc.sctp?.transport?.state,['new','connecting','connected','closed','failed']),sctp:choice(pc.sctp?.state,['connecting','connected','closed']),policy:config.iceTransportPolicy==='relay'?'relay':'all',servers,localRoutes:routes(pc.localDescription),remoteRoutes:routes(pc.remoteDescription),localDescription:!!pc.localDescription,remoteDescription:!!pc.remoteDescription};
}
export function safeRtcStats(stats){
  const rows=[...stats.values()],result={selectedRoute:null,candidatePairs:[],transports:[],streams:[]};
  const transport=rows.find(row=>row.type==='transport' && row.selectedCandidatePairId);
  const pair=(transport && stats.get(transport.selectedCandidatePairId)) || rows.find(row=>row.type==='candidate-pair' && row.state==='succeeded' && row.nominated);
  const candidate=id=>{
    const row=stats.get(id);if(!row)return null;
    return {type:choice(row.candidateType,['host','srflx','prflx','relay']),protocol:choice(row.protocol,['udp','tcp']),relayProtocol:choice(row.relayProtocol,['udp','tcp','tls'])};
  };
  if(pair){result.selectedRoute={local:candidate(pair.localCandidateId),remote:candidate(pair.remoteCandidateId)};for(const key of numericFields)if(number(pair[key])!==null)result.selectedRoute[key]=pair[key];}
  for(const row of rows){
    if(row.type==='candidate-pair' && result.candidatePairs.length<64){
      const entry={state:choice(row.state,['frozen','waiting','in-progress','failed','succeeded']),nominated:row.nominated===true,local:candidate(row.localCandidateId),remote:candidate(row.remoteCandidateId)};
      for(const key of numericFields)if(number(row[key])!==null)entry[key]=row[key];result.candidatePairs.push(entry);
    }
    if(row.type==='transport' && result.transports.length<8){
      const entry={dtlsState:choice(row.dtlsState,['new','connecting','connected','closed','failed']),iceState:safeState(row.iceState),iceRole:choice(row.iceRole,['controlling','controlled','unknown'])};
      for(const key of numericFields)if(number(row[key])!==null)entry[key]=row[key];result.transports.push(entry);
    }
  }
  for(const row of rows){
    if(!['inbound-rtp','outbound-rtp','remote-inbound-rtp','data-channel'].includes(row.type))continue;
    const stream={type:row.type,kind:choice(row.kind,['audio','video'])};
    for(const key of numericFields)if(number(row[key])!==null)stream[key]=row[key];
    const mime=stats.get(row.codecId)?.mimeType?.toLowerCase();
    if(['video/h264','video/h265','video/vp8','video/vp9','video/av1','audio/opus','audio/pcmu','audio/pcma'].includes(mime))stream.codec=mime;
    result.streams.push(stream);if(result.streams.length>=32)break;
  }
  return result;
}
export class ConnectionReports{
  constructor(role,{limit=64}={}){this.role=role==='host'?'host':'guest';this.limit=Number.isInteger(limit)?Math.max(1,Math.min(128,limit)):64;this.records=[];this.next=0;this.known=new WeakMap();}
  track(pc,kind='controls'){
    if(this.known.has(pc))return pc;
    const record={id:++this.next,kind:kinds.has(kind)?kind:'controls',startedAt:new Date().toISOString(),started:performance.now(),events:[],stats:null,pc};
    const capture=(type,error)=>{
      record.network=network(pc);record.events.push({milliseconds:Math.round(performance.now()-record.started),event:type,...record.network,...error});
      if(record.events.length>80)record.events.shift();
      if(type==='connectionstatechange' && ['connected','failed','closed'].includes(pc.connectionState))this.sample(record);
    };
    const listeners=['connectionstatechange','iceconnectionstatechange','icegatheringstatechange','signalingstatechange'].map(type=>{const fn=()=>capture(type);pc.addEventListener(type,fn);return [type,fn];});
    const error=event=>{
      if(!Number.isInteger(event.errorCode) || event.errorCode<300 || event.errorCode>799)return;
      const url=typeof event.url==='string'?event.url:'',text=typeof event.errorText==='string'?event.errorText:'';
      const service=/^turns?:/.test(url)?'turn':/^stuns?:/.test(url)?'stun':'unknown';
      const transport=service==='unknown'?'unknown':/^(turns|stuns):/.test(url)?'tls':/[?&]transport=tcp(?:&|$)/.test(url)?'tcp':'udp';
      const reason=/host lookup|resolv|\bdns\b/i.test(text)?'lookup':/timed out|timeout/i.test(text)?'timeout':/unreachable/i.test(text)?'unreachable':/unauthorized|credential/i.test(text)?'authentication':'unknown';
      capture('icecandidateerror',{errorCode:event.errorCode,service,transport,reason});
    };pc.addEventListener('icecandidateerror',error);
    record.dispose=()=>{for(const [type,fn] of listeners)pc.removeEventListener(type,fn);pc.removeEventListener('icecandidateerror',error);};
    this.known.set(pc,record);this.records.push(record);capture('created');
    while(this.records.length>this.limit)this.records.shift().dispose();
    return pc;
  }
  async sample(record){
    if(record.sampling)return record.sampling;
    record.sampling=(async()=>{let timer;try{const stats=await Promise.race([record.pc.getStats(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Stats timeout')),1500);})]);if(stats.size || !record.stats){record.stats=safeRtcStats(stats);record.statsSampledAt=new Date().toISOString();}}catch{/* Keep the previous successful sample after disconnect. */}finally{clearTimeout(timer);}})().finally(()=>{record.sampling=null;});
    return record.sampling;
  }
  sharedDescription(pc,description){
    const record=this.known.get(pc);if(record)record.sharedDescription={milliseconds:Math.round(performance.now()-record.started),type:choice(description?.type,['offer','answer']),routes:routes(description)};
  }
  async report(){
    await Promise.all(this.records.map(record=>this.sample(record)));
    return {format:'webrtc-pad-connection-diagnostics',version:1,generatedAt:new Date().toISOString(),role:this.role,environment:{...browserEnvironment(globalThis.navigator?.userAgent),secureContext:globalThis.isSecureContext===true,online:typeof globalThis.navigator?.onLine==='boolean'?navigator.onLine:null},retention:{connections:this.limit,eventsPerConnection:80,lifetime:'This page, including ended sessions. Refreshing clears the journal.'},privacy:'Addresses, server URLs, SDP, credentials, usernames, device names and input contents are excluded.',connections:this.records.map(record=>({id:record.id,kind:record.kind,startedAt:record.startedAt,network:network(record.pc),sharedDescription:record.sharedDescription || null,events:record.events,statsSampledAt:record.statsSampledAt || null,stats:record.stats}))};
  }
  async download(issue){
    const report=await this.report();if(['connection','picture','controls'].includes(issue))report.issue=issue;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`webrtc-pad-connection-${this.role}-${report.generatedAt.replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
}
