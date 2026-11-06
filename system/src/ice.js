// TURN provider keys stay on this computer. Only RTCIceServer credentials go to peers.
import crypto from 'node:crypto';
// Account-free STUN endpoints. Sources and verification: docs/public-stun.md.
export const DEFAULT_STUN_URLS = Object.freeze([
  'stun:stun.cloudflare.com:3478',
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun3.l.google.com:19302',
  'stun:stun4.l.google.com:19302',
  'stun:global.stun.twilio.com:3478',
  'stun:ashburn.stun.twilio.com:3478',
  'stun:dublin.stun.twilio.com:3478',
  'stun:frankfurt.stun.twilio.com:3478',
  'stun:singapore.stun.twilio.com:3478',
  'stun:tokyo.stun.twilio.com:3478',
  'stun:sydney.stun.twilio.com:3478',
  'stun:sao-paulo.stun.twilio.com:3478',
  'stun:stun.nextcloud.com:443',
  'stun:stun.hitv.com:3478',
  'stun:stun.internetcalls.com:3478',
  'stun:stun.miwifi.com:3478',
  'stun:stun.schlund.de:3478',
  'stun:stun.sipgate.net:3478',
  'stun:stun.voip.aebc.com:3478',
  'stun:stun.voipbuster.com:3478',
  'stun:stun.voipstunt.com:3478'
]);
export function validateIceServers(servers) {
  if (!Array.isArray(servers) || !servers.length || servers.length > 32) throw new Error('Invalid ICE server list');
  return servers.map(server => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    if (!urls.length || urls.length > 16 || urls.some(u => typeof u !== 'string' || u.length > 512 || !/^(stun|stuns|turn|turns):[^\s]+$/.test(u))) throw new Error('Invalid ICE server URL');
    const result = { urls: server.urls };
    for (const key of ['username', 'credential']) if (server[key] !== undefined) {
      if (typeof server[key] !== 'string' || server[key].length > 1024) throw new Error('Invalid TURN credentials');
      result[key] = server[key];
    }
    return result;
  });
}
export function readIce(env = process.env, now = Date.now()) {
  if (env.ICE_JSON) {
    const config = JSON.parse(env.ICE_JSON);
    return { iceServers: validateIceServers(config.iceServers), iceTransportPolicy: env.ICE_TRANSPORT_POLICY === 'relay' ? 'relay' : 'all' };
  }
  const iceServers = env.STUN_URL
    ? [{ urls: env.STUN_URL.split(',').map(url => url.trim()) }]
    : env.METERED_API_KEY || env.METERED_USERNAME
      ? [{ urls: 'stun:stun.relay.metered.ca:80' }]
      : DEFAULT_STUN_URLS.map(urls => ({ urls }));
  if (env.TURN_AUTH_SECRET && !env.TURN_URL) throw new Error('Set TURN_URL when using a coturn shared secret');
  if (env.TURN_URL) {
    const urls = env.TURN_URL.split(',');
    if (urls.some(url => !/^turns?:/.test(url))) throw new Error('TURN_URL must contain turn: or turns: addresses');
    let username = env.TURN_USER || '', credential = env.TURN_CRED || '';
    if (env.TURN_AUTH_SECRET) {
      if (env.TURN_AUTH_SECRET.length < 32 || env.TURN_AUTH_SECRET.length > 1024) throw new Error('TURN_AUTH_SECRET must contain 32–1024 characters');
      const ttl = Number(env.TURN_TTL_SECONDS || 86400);
      if (!Number.isInteger(ttl) || ttl < 3600 || ttl > 604800) throw new Error('TURN_TTL_SECONDS must be 3600–604800');
      username = `${Math.floor(now / 1000) + ttl}:${crypto.randomBytes(8).toString('hex')}`;
      credential = crypto.createHmac('sha1', env.TURN_AUTH_SECRET).update(username).digest('base64');
    }
    if (!username || !credential) throw new Error('Set TURN_AUTH_SECRET or both TURN_USER and TURN_CRED for your TURN server');
    iceServers.push({ urls, username, credential });
  } else if (env.METERED_USERNAME && env.METERED_CREDENTIAL) {
    const relay = env.METERED_RELAY || 'global.relay.metered.ca';
    for (const url of [`turn:${relay}:80`, `turn:${relay}:80?transport=tcp`, `turn:${relay}:443`, `turns:${relay}:443?transport=tcp`]) iceServers.push({ urls: url, username: env.METERED_USERNAME, credential: env.METERED_CREDENTIAL });
  }
  return { iceServers: validateIceServers(iceServers), iceTransportPolicy: env.ICE_TRANSPORT_POLICY === 'relay' ? 'relay' : 'all' };
}
export function createIceProvider(env = process.env, { fetchImpl = fetch, now = Date.now } = {}) {
  const fallback = readIce(env);
  let cached, expires = 0, pending;
  if (!env.ICE_JSON && !env.TURN_URL && env.METERED_API_KEY && !/^[a-z0-9-]+\.metered\.live$/i.test(env.METERED_DOMAIN || '')) throw new Error('METERED_DOMAIN must be your application.metered.live hostname');
  return async () => {
    if (env.TURN_AUTH_SECRET && !env.ICE_JSON) {
      // Replacing a TURN username on every ICE restart can invalidate the old
      // allocation before the answer crosses its reliable control channel.
      if (!cached || now() >= expires) {
        cached = readIce(env, now());
        const ttl = Number(env.TURN_TTL_SECONDS || 86400);
        expires = now() + Math.max(300, ttl - 600) * 1000;
      }
      return cached;
    }
    if (!env.METERED_API_KEY || env.ICE_JSON || env.TURN_URL) return fallback;
    if (cached && now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      try {
        const endpoint = new URL(`https://${env.METERED_DOMAIN}/api/v1/turn/credentials`);
        endpoint.searchParams.set('apiKey', env.METERED_API_KEY);
        const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('Credential request failed');
        const iceServers = validateIceServers(await response.json());
        if (!iceServers.some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => /^turns?:/.test(u)))) throw new Error('No TURN servers returned');
        cached = { iceServers, iceTransportPolicy: fallback.iceTransportPolicy }; expires = now() + 300000;
      } catch {
        if (!fallback.iceServers.some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => /^turns?:/.test(u)))) throw new Error('TURN credentials unavailable. Check the Metered settings on this computer.');
        cached = { ...fallback, warning: 'Metered credential lookup failed; using configured fallback relay credentials.' }; expires = now() + 10000;
      }
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  };
}
