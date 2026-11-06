import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
// The public endpoint only signals for an existing, invited peer. It cannot
// create rooms, assign controllers, fetch provider keys, or inject input.
export function createFallback({ rooms, config, send }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 131072 });
  const closePeer = p => { p.fallbackWs?.close(); p.fallbackWs = null; p.fallbackToken = null; };
  function invitation(r, peerId) {
    if (!config.fallbackEnabled) return undefined;
    const p = r.peers.get(peerId);
    p.fallbackToken = crypto.randomBytes(32).toString('hex');
    const url = new URL('/fallback', config.publicUrl); url.protocol = 'wss:';
    return { url: url.href, roomId: r.roomId, peerId, token: p.fallbackToken };
  }
  wss.on('connection', ws => {
    ws.alive = true; ws.on('pong', () => { ws.alive = true; });
    let room, peer, peerId;
    const timer = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (!msg || typeof msg !== 'object') return;
        if (!peer) {
          const r = rooms.get(msg.roomId), p = r?.peers.get(msg.peerId);
          if (msg.type !== 'auth' || !p?.manual || !p.fallbackToken || msg.token !== p.fallbackToken || r.hostWs?.readyState !== WebSocket.OPEN) { ws.close(1008, 'Invalid invitation'); return; }
          clearTimeout(timer); room = r; peer = p; peerId = msg.peerId;
          const previous = peer.fallbackWs; peer.fallbackWs = ws; previous?.close();
          send(ws, { type: 'ready', slot: peer.slot });
          send(room.hostWs, { type: 'fallback-connected', peerId }); return;
        }
        if (peer.fallbackWs !== ws || room.peers.get(peerId) !== peer) { ws.close(); return; }
        if (msg.type === 'restart') send(room.hostWs, { type: 'fallback-restart', peerId });
        if (msg.type === 'answer' && typeof msg.id === 'string' && msg.id.length <= 64 && msg.sdp?.type === 'answer' && typeof msg.sdp.sdp === 'string' && msg.sdp.sdp.length <= 98304) send(room.hostWs, { type: 'fallback-answer', peerId, id: msg.id, sdp: msg.sdp });
      } catch { ws.close(1008, 'Invalid signaling message'); }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (peer?.fallbackWs === ws) { peer.fallbackWs = null; send(room.hostWs, { type: 'fallback-disconnected', peerId }); }
    });
    ws.on('error', () => ws.terminate());
  });
  function forwardHost(r, msg) {
    if (msg.type !== 'fallback-offer') return false;
    const p = r.peers.get(msg.peerId);
    if (!p?.manual || p.fallbackWs?.readyState !== WebSocket.OPEN) { send(r.hostWs, { type: 'fallback-error', peerId: msg.peerId, error: 'The fallback signaling connection is unavailable' }); return true; }
    send(p.fallbackWs, { type: 'offer', id: msg.id, sdp: msg.sdp, ice: msg.ice, slot: p.slot }); return true;
  }
  return { wss, invitation, forwardHost, closePeer };
}
