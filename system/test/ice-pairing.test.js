import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createIceProvider, readIce, validateIceServers, DEFAULT_STUN_URLS } from '../src/ice.js';
import { pairingPacket, parsePairing, gatherIce, connectionFailure, filePairingBrowserHint } from '../public/pairing.js';
test('data-only ICE restart waits for a new gather instead of rejecting the previous complete state', async () => {
  const pc = new EventTarget(); pc.iceGatheringState = 'complete'; pc.localDescription = { sdp: 'v=0' }; pc.getConfiguration = () => ({ iceServers: [] });
  const gathering = gatherIce(pc, 2000);
  setTimeout(() => { pc.iceGatheringState = 'gathering'; pc.dispatchEvent(new Event('icegatheringstatechange')); }, 10);
  setTimeout(() => { pc.localDescription.sdp = 'v=0\r\na=candidate:1'; pc.iceGatheringState = 'complete'; pc.dispatchEvent(new Event('icegatheringstatechange')); }, 30);
  await gathering;
});
const config = { iceServers: [{ urls: 'stun:example.com:80' }, { urls: 'turn:example.com:443', username: 'user', credential: 'password' }] };
test('Firefox manual-file advice explains the timeout and mentions links only when configured',()=>{
  assert.equal(filePairingBrowserHint('Chrome/155.0.0.0'),'');
  assert.match(filePairingBrowserHint('Firefox/151.0'),/Firefox can time out/);
  assert.doesNotMatch(filePairingBrowserHint('Firefox/151.0'),/session link/);
  assert.match(filePairingBrowserHint('Firefox/151.0',true),/session link/);
});

function gatheringPeer(ice=config){const pc=new EventTarget();pc.iceGatheringState='gathering';pc.connectionState='new';pc.localDescription={sdp:'v=0\r\na=candidate:1 1 udp 1 192.0.2.1 5000 typ host\r\n'};pc.getConfiguration=()=>ice;return pc;}

test('connection failure reports distinguish missing replies and missing relay routes without leaking connection secrets',()=>{
  const pc=gatheringPeer();pc.connectionState='failed';pc.iceConnectionState='failed';
  assert.match(connectionFailure(pc).message,/reply has not been received/);
  pc.remoteDescription={sdp:'v=0\r\na=ice-pwd:private-password\r\na=candidate:2 1 udp 1 198.51.100.1 5000 typ host\r\n'};
  assert.match(connectionFailure(pc).message,/Neither computer/);
  pc.localDescription.sdp+='a=candidate:3 1 udp 1 203.0.113.1 5000 typ relay\r\n';
  assert.match(connectionFailure(pc).message,/other computer/);
  pc.remoteDescription.sdp+='a=candidate:4 1 udp 1 203.0.113.2 5000 typ relay\r\n';
  const both=connectionFailure(pc);assert.match(both.message,/despite relay routes on both/);assert.match(both.report,/1 direct routes, 1 relay routes/);
  for(const secret of ['192.0.2.1','198.51.100.1','203.0.113','private-password','example.com','username','credential'])assert.ok(!both.report.includes(secret));
  pc.getConfiguration=()=>({iceServers:[{urls:'stun:example.com'}]});assert.match(connectionFailure(pc).message,/No TURN relay is configured/);
  pc.iceConnectionState='connected';assert.match(connectionFailure(pc).message,/secure connection failed/);
});
test('usable relay routes finish quickly while silent secondary servers continue gathering',async()=>{
  const pc=gatheringPeer();pc.localDescription.sdp+='a=candidate:2 1 udp 1 192.0.2.2 5000 typ relay\r\n';
  const start=performance.now();await gatherIce(pc,1000,{minGatherMs:10,quietMs:10,pollMs:5});
  assert.ok(performance.now()-start<500);assert.equal(pc.iceGatheringState,'gathering');assert.match(pc.localDescription.sdp,/ typ relay/);
});
test('fast gathering waits for configured relay and does not publish host-only routes early',async()=>{
  const pc=gatheringPeer();pc.localDescription.sdp+='a=candidate:2 1 udp 1 192.0.2.2 5000 typ srflx\r\n';let done=false;
  const pending=gatherIce(pc,1000,{minGatherMs:10,quietMs:10,pollMs:5}).then(()=>{done=true;});
  await new Promise(r=>setTimeout(r,40));assert.equal(done,false);
  pc.localDescription.sdp+='a=candidate:3 1 udp 1 192.0.2.3 5000 typ relay\r\n';pc.dispatchEvent(new Event('icecandidate'));await pending;
  const local=gatheringPeer({iceServers:[{urls:'stun:example.com:80'}]});let localDone=false;
  const localPending=gatherIce(local,1000,{minGatherMs:10,quietMs:10,pollMs:5}).then(()=>{localDone=true;});
  await new Promise(r=>setTimeout(r,40));assert.equal(localDone,false);local.iceGatheringState='complete';local.dispatchEvent(new Event('icegatheringstatechange'));await localPending;
});
test('relay-only gathering rejects direct-only results and closing cancels the wait',async()=>{
  const relay=gatheringPeer({...config,iceTransportPolicy:'relay'});relay.iceGatheringState='complete';await assert.rejects(gatherIce(relay,30),/No usable network route/);
  const pc=gatheringPeer(),pending=gatherIce(pc,1000);pc.connectionState='closed';pc.dispatchEvent(new Event('connectionstatechange'));await assert.rejects(pending,/Connection closed/);
});

test('empty configuration uses independent public STUN providers without a credential lookup', async () => {
  const provider = createIceProvider({}, { fetchImpl: () => { throw new Error('No account API should be called'); } });
  const result = await provider();
  assert.deepEqual(result, { iceServers: DEFAULT_STUN_URLS.map(urls => ({ urls })), iceTransportPolicy: 'all' });
  assert.ok(DEFAULT_STUN_URLS.length >= 20 && DEFAULT_STUN_URLS.length <= 32);
  assert.equal(new Set(DEFAULT_STUN_URLS).size, DEFAULT_STUN_URLS.length);
  assert.ok(DEFAULT_STUN_URLS.includes('stun:stun.cloudflare.com:3478'));
  assert.ok(DEFAULT_STUN_URLS.includes('stun:global.stun.twilio.com:3478'));
  assert.ok(new Set(DEFAULT_STUN_URLS.map(url => url.split(':')[1].split('.').slice(-2).join('.'))).size >= 8);
  result.iceServers[0].urls = 'stun:changed.example:3478';
  assert.equal(readIce({}).iceServers[0].urls, DEFAULT_STUN_URLS[0]);
});

test('explicit ICE and STUN settings override the public defaults', async () => {
  assert.deepEqual(readIce({ STUN_URL: 'stun:first.example:3478, stun:second.example:19302' }).iceServers,
    [{ urls: ['stun:first.example:3478', 'stun:second.example:19302'] }]);
  const provider = createIceProvider({ ICE_JSON: JSON.stringify(config), METERED_API_KEY: 'unused' }, {
    fetchImpl: () => { throw new Error('Explicit ICE must not call a provider API'); }
  });
  assert.deepEqual((await provider()).iceServers, config.iceServers);
  const custom = readIce({ TURN_URL: 'turn:private.example:3478', TURN_USER: 'u', TURN_CRED: 'p' });
  assert.deepEqual(custom.iceServers.slice(0, DEFAULT_STUN_URLS.length), readIce({}).iceServers);
  assert.equal(custom.iceServers.at(-1).urls[0], 'turn:private.example:3478');
});
test('Metered credentials are fetched server-side, validated, cached, and refreshed', async () => {
  let calls = 0, time = 0;
  const provider = createIceProvider({ METERED_DOMAIN: 'test.metered.live', METERED_API_KEY: 'server-key' }, {
    now: () => time, fetchImpl: async url => { calls++; assert.equal(url.searchParams.get('apiKey'), 'server-key'); return { ok: true, json: async () => config.iceServers }; }
  });
  const [first, second] = await Promise.all([provider(), provider()]);
  assert.equal(calls, 1); assert.deepEqual(first, second); assert.ok(!JSON.stringify(first).includes('server-key'));
  await provider(); assert.equal(calls, 1); time = 300001; await provider(); assert.equal(calls, 2);
});
test('Metered failures use explicit fallback credentials with a visible warning', async () => {
  const env = { METERED_DOMAIN: 'test.metered.live', METERED_API_KEY: 'key', METERED_USERNAME: 'user', METERED_CREDENTIAL: 'password', ICE_TRANSPORT_POLICY: 'relay' };
  const result = await createIceProvider(env, { fetchImpl: async () => { throw new Error('offline'); } })();
  assert.match(result.warning, /fallback/); assert.equal(result.iceTransportPolicy, 'relay');
  assert.equal(result.iceServers.length, 5);
  assert.ok(result.iceServers.some(s => s.urls === 'turns:global.relay.metered.ca:443?transport=tcp'));
});
test('Metered failures without fallback do not silently claim TURN is available', async () => {
  const provider = createIceProvider({ METERED_DOMAIN: 'test.metered.live', METERED_API_KEY: 'key' }, { fetchImpl: async () => ({ ok: false }) });
  await assert.rejects(provider(), /TURN credentials unavailable/);
  assert.throws(() => createIceProvider({ METERED_DOMAIN: 'untrusted.example', METERED_API_KEY: 'key' }));
  assert.throws(() => validateIceServers([{ urls: 'https://example.com' }]));
  assert.equal(readIce({}).iceTransportPolicy, 'all');
});
test('pairing files contain RTC descriptions and relay settings, and reject expired or mismatched data', () => {
  const id = '12345678-1234-1234-1234-123456789012';
  const offer = pairingPacket('offer', id, { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:local' }, config, 'p1', 2000);
  assert.equal(parsePairing(JSON.stringify(offer), 'offer', 1000).slot, 'p1');
  assert.throws(() => parsePairing(JSON.stringify(offer), 'answer', 1000), /your invite file/);
  assert.throws(() => parsePairing(JSON.stringify(offer), 'offer', 2001), /expired/);
  offer.ice.iceServers = [{ urls: 'file:///private' }];
  assert.throws(() => parsePairing(JSON.stringify(offer), 'offer', 1000), /relay address/);
  assert.throws(() => parsePairing('x'.repeat(131073), 'offer'), /too large/);
});

test('text files saved with a UTF-8 BOM parse and wrong-direction files explain the next step', () => {
  const id='12345678-1234-1234-1234-123456789012';
  const offer=pairingPacket('offer',id,{type:'offer',sdp:'v=0\r\na=ice-ufrag:local'},{iceServers:[]},null,2000);
  assert.equal(parsePairing('\uFEFF'+JSON.stringify(offer)+'\n','offer',1000).pairingId,id);
  const answer=pairingPacket('answer',id,{type:'answer',sdp:'v=0'},null,null,2000);
  assert.throws(()=>parsePairing(JSON.stringify(answer),'offer',1000),/Ask the host for their invite file/);
});
test('self-hosted coturn credentials expire, match its REST HMAC, and never disclose the master secret', async () => {
  const secret = 'a'.repeat(64); let time = 1000000;
  const env = { STUN_URL: 'stun:turn.example.com:3478', TURN_URL: 'turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp', TURN_AUTH_SECRET: secret, TURN_TTL_SECONDS: '3600', METERED_DOMAIN: 'ignored', METERED_API_KEY: 'not-used', ICE_TRANSPORT_POLICY: 'relay' };
  const provider = createIceProvider(env, { now: () => time, fetchImpl: () => { throw new Error('Self-hosting must not call a hosted provider'); } });
  const first = await provider(), turn = first.iceServers[1];
  assert.equal(Number(turn.username.split(':')[0]), 4600);
  assert.equal(turn.credential, crypto.createHmac('sha1', secret).update(turn.username).digest('base64'));
  assert.deepEqual(turn.urls, env.TURN_URL.split(',')); assert.equal(first.iceTransportPolicy, 'relay');
  assert.ok(!JSON.stringify(first).includes(secret));
  time += 600000; assert.equal((await provider()).iceServers[1].username, turn.username, 'ICE refreshes reuse live TURN allocations');
  time += 2400000; assert.equal(Number((await provider()).iceServers[1].username.split(':')[0]), 7600);
  assert.notEqual((await provider()).iceServers[1].username, turn.username);
});
test('explicit relay settings take priority and incomplete self-hosted authentication is rejected', async () => {
  const result = await createIceProvider({ TURN_URL: 'turn:example.com:3478', TURN_USER: 'me', TURN_CRED: 'pw', METERED_API_KEY: 'ignored' })();
  assert.equal(result.iceServers[1].username, 'me');
  for (const env of [{ TURN_AUTH_SECRET: 'a'.repeat(64) }, { TURN_URL: 'turn:x', TURN_AUTH_SECRET: 'short' }, { TURN_URL: 'turn:x', TURN_AUTH_SECRET: 'a'.repeat(64), TURN_TTL_SECONDS: '5' }, { TURN_URL: 'turn:x' }]) assert.throws(() => createIceProvider(env));
});
