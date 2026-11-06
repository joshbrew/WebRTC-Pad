import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionReports,safeRtcStats,browserEnvironment} from '../public/connection-report.js';

function sampleStats(){return new Map([
  ['transport',{type:'transport',selectedCandidatePairId:'pair',tlsVersion:'private-text',dtlsState:'failed',iceState:'disconnected',iceRole:'controlling'}],
  ['pair',{type:'candidate-pair',state:'succeeded',nominated:true,localCandidateId:'local',remoteCandidateId:'remote',currentRoundTripTime:.02,bytesSent:1234,requestsSent:12,responsesReceived:0}],
  ['local',{type:'local-candidate',candidateType:'relay',protocol:'udp',relayProtocol:'tls',address:'192.0.2.1',url:'turns:private-server:443',usernameFragment:'secret-ufrag'}],
  ['remote',{type:'remote-candidate',candidateType:'host',protocol:'udp',address:'198.51.100.1'}],
  ['codec',{type:'codec',mimeType:'video/H264',sdpFmtpLine:'private-options'}],
  ['video',{type:'inbound-rtp',kind:'video',codecId:'codec',framesDecoded:120,frameWidth:1920,frameHeight:1080,packetsLost:3,trackIdentifier:'secret-track',jitter:.002}],
  ['channel',{type:'data-channel',label:'secret-channel',dataChannelIdentifier:42,messagesSent:12}],
]);}
function peer(){
  const pc=new EventTarget();Object.assign(pc,{connectionState:'new',iceConnectionState:'new',iceGatheringState:'gathering',signalingState:'have-local-offer',localDescription:{sdp:'v=0\r\na=ice-pwd:secret-password\r\na=candidate:1 1 udp 1 192.0.2.1 5000 typ relay\r\n'},remoteDescription:null});
  pc.getConfiguration=()=>({iceTransportPolicy:'relay',iceServers:[{urls:['stun:private-server','turn:private-server','turn:private-server?transport=tcp','turns:private-server'],username:'secret-user',credential:'secret-credential'}]});
  pc.getStats=async()=>sampleStats();return pc;
}
test('connection diagnostics allowlist useful RTC data and exclude private information',async()=>{
  const logs=new ConnectionReports('host'),pc=peer();logs.track(pc);logs.track(pc);
  logs.sharedDescription(pc,{type:'offer',sdp:pc.localDescription.sdp});
  pc.remoteDescription={sdp:'v=0\r\na=candidate:2 1 udp 1 198.51.100.1 5000 typ host\r\n'};
  pc.connectionState='failed';pc.iceConnectionState='failed';pc.dispatchEvent(new Event('connectionstatechange'));
  const error=new Event('icecandidateerror');Object.assign(error,{errorCode:701,url:'turns:private-server',errorText:'STUN host lookup received error: secret-error'});pc.dispatchEvent(error);
  const report=await logs.report(),record=report.connections[0];assert.equal(report.connections.length,1);assert.equal(report.role,'host');
  assert.equal(record.network.localRoutes.relay,1);assert.equal(record.network.remoteRoutes.host,1);assert.equal(record.network.policy,'relay');
  assert.equal(record.sharedDescription.type,'offer');assert.equal(record.sharedDescription.routes.relay,1);
  assert.deepEqual(record.network.servers,{stun:1,turnUdp:1,turnTcp:1,turnTls:1});
  assert.equal(record.events.at(-1).errorCode,701);assert.equal(record.stats.selectedRoute.local.relayProtocol,'tls');assert.equal(record.stats.streams[0].codec,'video/h264');
  assert.equal(record.events.at(-1).service,'turn');assert.equal(record.events.at(-1).transport,'tls');assert.equal(record.events.at(-1).reason,'lookup');
  assert.equal(record.stats.candidatePairs[0].requestsSent,12);assert.equal(record.stats.candidatePairs[0].responsesReceived,0);assert.equal(record.stats.candidatePairs[0].state,'succeeded');
  assert.equal(record.stats.transports[0].dtlsState,'failed');assert.equal(record.stats.transports[0].iceRole,'controlling');
  assert.equal(record.stats.streams[0].framesDecoded,120);assert.equal(record.stats.streams[1].messagesSent,12);
  const json=JSON.stringify(report);for(const value of ['192.0.2.1','198.51.100.1','private-server','secret-','private-options','private-text'])assert.ok(!json.includes(value),value);
});
test('closed peers retain recent stats and bounded timelines; old connections are capped',async()=>{
  const logs=new ConnectionReports('guest',{limit:2}),pc=peer();logs.track(pc,'browser-video');await logs.report();
  pc.getStats=async()=>new Map();pc.connectionState='closed';pc.dispatchEvent(new Event('connectionstatechange'));
  for(let i=0;i<100;i++)pc.dispatchEvent(new Event('icegatheringstatechange'));
  let report=await logs.report();assert.equal(report.connections[0].events.length,80);assert.equal(report.connections[0].network.connection,'closed');assert.equal(report.connections[0].stats.streams[0].framesDecoded,120);
  logs.track(peer());logs.track(peer());report=await logs.report();assert.deepEqual(report.connections.map(record=>record.id),[2,3]);
});
test('failed stats collection can retry and unexpected strings/NaN cannot escape the allowlist',async()=>{
  const logs=new ConnectionReports('guest'),pc=peer();pc.getStats=()=>{throw Error('secret-error');};logs.track(pc);assert.equal((await logs.report()).connections[0].stats,null);
  pc.getStats=async()=>sampleStats();assert.ok((await logs.report()).connections[0].stats);
  const stats=sampleStats();stats.get('video').framesDecoded=NaN;stats.get('codec').mimeType='video/private-secret';stats.get('local').protocol='secret-protocol';
  const safe=safeRtcStats(stats);assert.equal(safe.selectedRoute.local.protocol,null);assert.equal(safe.streams[0].framesDecoded,undefined);assert.equal(safe.streams[0].codec,undefined);
});
test('environment reports coarse browser/OS information without the raw identifying string',()=>{
  assert.deepEqual(browserEnvironment('Mozilla/5.0 (Windows NT 10.0; private-device) Chrome/142.0.1.2 Safari/537.36 Edg/142.0.4.5'),{browser:'Edge',browserMajor:142,os:'Windows'});
  assert.deepEqual(browserEnvironment('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) Version/18.1 Safari/605.1.15'),{browser:'Safari',browserMajor:18,os:'macOS'});
  assert.deepEqual(browserEnvironment('private-device unknown'),{browser:'unknown',browserMajor:null,os:'unknown'});
});
