import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { parsePairing } from '../public/pairing.js';

const token = () => crypto.randomBytes(32).toString('hex');
const send = (ws, message) => {
  if(ws?.readyState!==WebSocket.OPEN)return;
  if(ws.bufferedAmount>262144){ws.close(1013,'Invite connection is too slow');return;}
  ws.send(JSON.stringify(message));
};
export function sessionSettings(env = {}) {
  let url = null;
  if (env.SESSION_SERVER_URL) {
    const value = new URL(env.SESSION_SERVER_URL);
    if (!(value.protocol === 'https:' || value.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname)) || value.username || value.password || value.search || value.hash || value.pathname !== '/') throw Error('SESSION_SERVER_URL must be an HTTPS origin (HTTP is allowed on localhost for development)');
    url = value.origin;
  }
  const enabled = env.SESSION_SERVER_ENABLED === '1', hosted = env.SESSION_SERVER_ONLY === '1';
  if (hosted && !enabled) throw Error('SESSION_SERVER_ONLY requires SESSION_SERVER_ENABLED=1');
  return { enabled, hosted, url };
}

// Temporary presence and capability-scoped signaling only. No input/media relay.
export function createSessionServer({ maxClients = 512, disconnectGraceMs = 60000, now = Date.now } = {}) {
  if(!Number.isInteger(maxClients)||maxClients<1||maxClients>65536)throw Error('SESSION_SERVER_MAX_CLIENTS must be 1–65536');
  const wss = new WebSocketServer({ noServer: true, maxPayload: 131072 });
  const users = new Map(), names = new Map(), resumes = new Map(), rooms = new Map(), links = new Map();
  let closing=false;
  function endRoom(room, reason='host-ended') {
    if (!room || !rooms.delete(room.id)) return;
    for (const id of room.members.keys()) send(users.get(id)?.ws, { type: 'session-ended', roomId: room.id, reason });
    for (const link of room.links) links.delete(link);
    const host = users.get(room.host); if (host?.room === room.id) host.room = null;
  }
  function removeUser(user) {
    clearTimeout(user.cleanup);
    endRoom(rooms.get(user.room),'host-offline');
    for (const room of rooms.values()) if (room.members.delete(user.id)) send(users.get(room.host)?.ws, { type: 'guest-left', roomId: room.id, guestId: user.id, reason:'guest-offline' });
    users.delete(user.id); names.delete(user.name.toLowerCase()); resumes.delete(user.resume);
  }
  function makeLink(room, recipient = null) {
    const key = token(); links.set(key, { roomId: room.id, recipient }); room.links.add(key); return key;
  }
  wss.on('connection', ws => {
    if (wss.clients.size > maxClients * 2) { ws.close(1013, 'Invite server is full'); return; }
    let user, count = 0, windowStart = now();
    ws.alive = true; ws.on('pong', () => { ws.alive = true; });
    const authTimer = setTimeout(() => ws.close(1008, 'Sign in first'), 8000);
    ws.on('message', raw => {
      let msg;
      try {
        if (now() - windowStart > 10000) { windowStart = now(); count = 0; }
        if (++count > 60) { ws.close(1008,'Too many invite requests');return; }
        msg = JSON.parse(raw.toString());
        if (!msg || typeof msg !== 'object') throw Error('Invalid session message');
        const reply = value => send(ws, { ...value, requestId: typeof msg.requestId === 'string' ? msg.requestId.slice(0, 80) : undefined });
        if (msg.type === 'hello') {
          if (user) throw Error('Already signed in');
          if (msg.resume) {
            user = resumes.get(msg.resume);
            if (!user) throw Error('Temporary sign-in expired. Connect again.');
            clearTimeout(user.cleanup); user.ws?.close(1000, 'Resumed in another window'); user.ws = ws;
          } else {
            if (users.size >= maxClients) throw Error('This invite server is full. Try again later.');
            const name = typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim() : `Guest-${crypto.randomBytes(4).toString('hex')}`;
            if (!/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,23}$/.test(name)) throw Error('Use 1–24 letters, numbers, spaces, dashes or underscores for your temporary name.');
            if (names.has(name.toLowerCase())) throw Error('That temporary name is in use. Choose another.');
            user = { id: token(), name, resume: token(), ws, room: null };
            users.set(user.id, user); names.set(name.toLowerCase(), user); resumes.set(user.resume, user);
          }
          clearTimeout(authTimer);
          reply({ type: 'welcome', userId: user.id, name: user.name, resume: user.resume, roomId: user.room }); return;
        }
        if (!user || user.ws !== ws) throw Error('Connect to the invite server first');
        if (msg.type === 'create') {
          let room = rooms.get(user.room);
          if (!room) {
            room = { id: token(), host: user.id, members: new Map(), links: new Set() };
            room.token = makeLink(room); rooms.set(room.id, room); user.room = room.id;
          }
          reply({ type: 'session-created', roomId: room.id, token: room.token }); return;
        }
        if (msg.type === 'join') {
          const link = links.get(msg.token), room = rooms.get(link?.roomId);
          if (!room || !users.get(room.host)?.ws || link.recipient && link.recipient !== user.id) throw Error('This invite is unavailable or belongs to another temporary sign-in. Ask the host for a fresh link.');
          if (room.host === user.id) throw Error('Open the invite from another app or browser window to join yourself');
          if (!room.members.has(user.id)) {
            const accepted = !!link.recipient;
            room.members.set(user.id, { accepted });
            send(users.get(room.host).ws, { type: accepted ? 'guest-accepted' : 'join-request', roomId: room.id, guestId: user.id, name: user.name });
          }else send(users.get(room.host).ws,{type:room.members.get(user.id).accepted?'guest-accepted':'join-request',roomId:room.id,guestId:user.id,name:user.name});
          reply({ type: 'join-waiting', roomId: room.id }); return;
        }
        const room = rooms.get(msg.roomId);
        if (!room) throw Error('This session has ended');
        const owner = room.host === user.id;
        if (msg.type === 'invite') {
          if (!owner) throw Error('Only the host can invite a guest');
          const recipient = typeof msg.to === 'string' && names.get(msg.to.trim().toLowerCase());
          if (!recipient?.ws || recipient.id === user.id) throw Error('That temporary name is not online here. Ask your friend to connect to this invite server first.');
          if (room.links.size >= 512) throw Error('Too many active invitations');
          const key = makeLink(room, recipient.id);
          send(recipient.ws, { type: 'invited', roomId: room.id, token: key, name: user.name });
          reply({ type: 'invite-sent', name: recipient.name }); return;
        }
        if (msg.type === 'accept' || msg.type === 'reject') {
          if (!owner || !room.members.has(msg.guestId)) throw Error('This guest request is unavailable');
          if (msg.type === 'reject') {
            room.members.delete(msg.guestId); send(users.get(msg.guestId)?.ws, { type: 'join-rejected', roomId: room.id });
            for(const key of room.links)if(links.get(key)?.recipient===msg.guestId){links.delete(key);room.links.delete(key);}
          } else {
            const member = room.members.get(msg.guestId);
            if (!member.accepted) { member.accepted = true; send(ws, { type: 'guest-accepted', roomId: room.id, guestId: msg.guestId, name: users.get(msg.guestId)?.name }); }
          }
          return;
        }
        if (msg.type === 'signal') {
          const guestId = owner ? msg.guestId : user.id, member = room.members.get(guestId);
          if (!member?.accepted) throw Error('The host must accept this guest first');
          const kind = owner ? 'offer' : 'answer';
          const payload = parsePairing(JSON.stringify(msg.payload), kind);
          const destination = owner ? users.get(guestId) : users.get(room.host);
          if (!destination?.ws) throw Error('The other computer is reconnecting. Try again shortly.');
          if(owner){member.pairingId=payload.pairingId;member.answered=false;}
          else {if(member.pairingId!==payload.pairingId || member.answered)throw Error('This reply does not match your current connection offer');member.answered=true;}
          send(destination.ws, { type: 'signal', roomId: room.id, guestId, name: user.name, payload }); return;
        }
        if (msg.type === 'leave') {
          if (owner) endRoom(room);
          else if (room.members.delete(user.id)) send(users.get(room.host)?.ws, { type: 'guest-left', roomId: room.id, guestId: user.id });
          return;
        }
        throw Error('Unknown session action');
      } catch (error) { send(ws, { type: 'session-error', requestId: typeof msg?.requestId === 'string' ? msg.requestId.slice(0, 80) : undefined, error: error instanceof SyntaxError ? 'Invalid session message' : error.message }); }
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      if(closing)return;
      if (user?.ws === ws) { user.ws = null; user.cleanup = setTimeout(() => removeUser(user), disconnectGraceMs); }
    });
    ws.on('error', () => ws.terminate());
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
  }, 10000);
  return { wss, rooms, users, close() {
    closing=true;
    clearInterval(heartbeat);
    for (const user of users.values()) clearTimeout(user.cleanup);
    for (const ws of wss.clients) ws.terminate();
    wss.close(); rooms.clear(); users.clear(); names.clear(); links.clear(); resumes.clear();
  } };
}
