import { isPlayerSlot } from './players.js';
const FORMAT = 'webrtc-pad-pairing';
export function filePairingBrowserHint(userAgent='',hostedAvailable=false){
  if(!/Firefox\//.test(userAgent))return '';
  return hostedAvailable?'For Firefox, use a session link to connect automatically. For invite/reply files, use Chrome, Edge or Brave; Firefox can time out while the reply is being sent back.':'For invite/reply files, use Chrome, Edge or Brave. Firefox can time out while the reply is being sent back.';
}
// Connection reports deliberately omit SDP, addresses, server URLs and credentials.
export function connectionFailure(pc) {
  const routes = description => {
    const sdp=description?.sdp || '';
    return {direct:(sdp.match(/ typ (?:host|srflx|prflx)(?: |\r|\n)/g)||[]).length,relay:(sdp.match(/ typ relay(?: |\r|\n)/g)||[]).length};
  };
  const local=routes(pc.localDescription),remote=routes(pc.remoteDescription);
  const configured=pc.getConfiguration().iceServers?.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(u=>/^turns?:/.test(u)));
  let message;
  if(!pc.remoteDescription)message='The reply has not been received. Open the reply file your guest sends back.';
  else if(['connected','completed'].includes(pc.iceConnectionState))message='A network route was found, but the secure connection failed. Keep both apps open and exchange fresh invite/reply files.';
  else if(!configured)message='No connection could be established. No TURN relay is configured; add one on the host for networks that block direct connections, then exchange fresh invite/reply files.';
  else if(!local.relay || !remote.relay)message=`No connection could be established. ${!local.relay && !remote.relay?'Neither computer':!local.relay?'This computer':'The other computer'} found a TURN relay route. Check relay access and credentials, then exchange fresh invite/reply files.`;
  else message='No connection could be established despite relay routes on both computers. Check network/firewall restrictions and TURN service limits, then exchange fresh invite/reply files while both apps stay open.';
  return {message,report:`${message}\nThis computer: ${local.direct} direct routes, ${local.relay} relay routes.\nOther computer: ${remote.direct} direct routes, ${remote.relay} relay routes.\nTURN configured: ${configured?'yes':'no'}. ICE state: ${pc.iceConnectionState || 'unknown'}. Connection state: ${pc.connectionState || 'unknown'}.`};
}
export async function gatherIce(pc, timeoutMs = 30000, {minGatherMs=750,quietMs=350,pollMs=100,onProgress}={}) {
  const usable = () => /a=candidate:/.test(pc.localDescription?.sdp || '');
  const hasRelay = () => / typ relay(?: |\r|\n)/.test(pc.localDescription?.sdp || '');
  const hasPublic = () => / typ (?:srflx|relay)(?: |\r|\n)/.test(pc.localDescription?.sdp || '');
  const config=pc.getConfiguration(),relayOnly=config.iceTransportPolicy==='relay';
  const acceptable=()=>usable() && (!relayOnly || hasRelay());
  if (pc.iceGatheringState === 'complete' && acceptable()) return;
  await new Promise((resolve, reject) => {
    // Some browsers wait a long time for an unreachable secondary TURN endpoint.
    // A quiet set containing a working relay is enough for non-trickle pairing.
    const started = Date.now(); let lastCandidate = started,lastProgress;
    const wantsRelay = config.iceServers?.some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => /^turns?:/.test(u)));
    const cleanup = () => { clearTimeout(timer); clearInterval(quiet); pc.removeEventListener('icecandidate', candidate); pc.removeEventListener('icegatheringstatechange', changed); pc.removeEventListener('connectionstatechange', closed); };
    const candidate = () => { lastCandidate = Date.now(); };
    // On a data-only ICE restart Chromium can briefly report the previous
    // complete state before gathering starts for the new local description.
    const changed = () => { if (pc.iceGatheringState === 'complete' && acceptable()) { cleanup(); resolve(); } };
    const closed = () => { if (pc.connectionState === 'closed') { cleanup(); reject(new Error('Connection closed while creating pairing file')); } };
    const quiet = setInterval(() => {
      const elapsed=Date.now()-started,stage=wantsRelay && !hasRelay()?'relay':'routes';
      if(stage!==lastProgress){lastProgress=stage;onProgress?.(stage);}
      if (pc.iceGatheringState === 'complete' && acceptable()) { cleanup(); resolve(); }
      else if (Date.now() - started >= 1000 && pc.iceGatheringState === 'complete' && !usable()) { cleanup(); reject(new Error('No usable network route found. Check the relay settings.')); }
      else if (elapsed >= minGatherMs && Date.now() - lastCandidate >= quietMs && (wantsRelay?hasRelay():hasPublic()) && acceptable()) { cleanup(); resolve(); }
    }, pollMs);
    const timer = setTimeout(() => {
      cleanup();
      if (acceptable()) resolve();
      else reject(new Error('No usable network route found. Check the relay settings and create a fresh invitation.'));
    }, timeoutMs);
    pc.addEventListener('icecandidate', candidate); pc.addEventListener('icegatheringstatechange', changed); pc.addEventListener('connectionstatechange', closed); changed();
  });
}
export function pairingPacket(kind, pairingId, sdp, ice, slot, expiresAt = Date.now() + 10 * 60 * 1000, fallback) {
  const packet = { format: FORMAT, version: 1, kind, pairingId, expiresAt, sdp: { type: sdp.type, sdp: sdp.sdp } };
  if (kind === 'offer') { packet.ice = ice; packet.slot = slot; if (fallback) packet.fallback = fallback; }
  return packet;
}
export function sanitizeIceConfig(ice) {
  const servers = ice?.iceServers;
  if (!Array.isArray(servers) || servers.length > 32) throw new Error('Invalid relay settings');
  for (const s of servers) {
    const urls = Array.isArray(s?.urls) ? s.urls : [s?.urls];
    if (!urls.length || urls.length > 16 || urls.some(u => typeof u !== 'string' || u.length > 512 || !/^(stun|stuns|turn|turns):[^\s]+$/.test(u))) throw new Error('Invalid relay address');
    for (const key of ['username', 'credential']) if (s[key] !== undefined && (typeof s[key] !== 'string' || s[key].length > 1024)) throw new Error('Invalid relay credential');
  }
  return { iceServers: servers.map(s => ({ urls: s.urls, ...(s.username !== undefined ? { username: s.username } : {}), ...(s.credential !== undefined ? { credential: s.credential } : {}) })), iceTransportPolicy: ice.iceTransportPolicy === 'relay' ? 'relay' : 'all' };
}
export function parsePairing(text, kind, now = Date.now()) {
  if (typeof text !== 'string' || text.length > 131072) throw new Error('Pairing file is too large');
  let p; try { p = JSON.parse(text.replace(/^\uFEFF/, '').trim()); } catch { throw new Error('Open the invite or reply text file from this app, or paste its complete contents.'); }
  if(p?.format===FORMAT && p.version===1 && p.kind!==kind && ['offer','answer'].includes(p.kind))throw new Error(kind==='offer'?'This is a reply file. Ask the host for their invite file.':'This is your invite file. Send it to your guest, then open the reply they send back.');
  if (!p || p.format !== FORMAT || p.version !== 1 || p.kind !== kind || typeof p.pairingId !== 'string' || !/^[a-f0-9-]{32,64}$/i.test(p.pairingId)) throw new Error(`This is not a valid ${kind === 'offer' ? 'invitation' : 'reply'} file`);
  if (!Number.isSafeInteger(p.expiresAt) || p.expiresAt < now) throw new Error('This invitation has expired. Ask the host for a fresh one.');
  if (p.sdp?.type !== kind || typeof p.sdp.sdp !== 'string' || !p.sdp.sdp.startsWith('v=0') || p.sdp.sdp.length > 98304) throw new Error('Invalid connection description');
  if (kind === 'offer') {
    p.ice = sanitizeIceConfig(p.ice);
    p.slot = isPlayerSlot(p.slot) ? p.slot : null;
    if (p.fallback) {
      const f = p.fallback, url = new URL(f.url);
      if (url.protocol !== 'wss:' || url.pathname !== '/fallback' || url.username || url.password || url.search || url.hash || !/^[a-f0-9]{64}$/.test(f.token) || !/^[a-f0-9]{12}$/.test(f.roomId) || !/^[a-f0-9]{16}$/.test(f.peerId)) throw new Error('Invalid fallback connection settings');
      p.fallback = { url: url.href, token: f.token, roomId: f.roomId, peerId: f.peerId };
    }
  }
  return p;
}
export function downloadPairing(packet) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2)], { type: 'text/plain' }));
  const link = document.createElement('a'); link.href = url; link.download = `webrtc-pad-${packet.kind==='offer'?'invite':'reply'}-${packet.pairingId.slice(0, 8)}.txt`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
