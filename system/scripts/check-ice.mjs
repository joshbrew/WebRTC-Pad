// A single unauthenticated binding request per public endpoint; never prints IPs.
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { DEFAULT_STUN_URLS } from '../src/ice.js';

async function check(url) {
  return new Promise(resolve => {
    const [, host, port] = url.split(':'), socket = dgram.createSocket('udp4');
    const id = crypto.randomBytes(12), packet = Buffer.alloc(20);
    packet.writeUInt16BE(1); packet.writeUInt32BE(0x2112a442, 4); id.copy(packet, 8);
    const started = performance.now(); let done = false;
    const finish = result => {
      if (done) return;
      done = true; clearTimeout(timer); socket.close(); resolve({ url, ...result });
    };
    const timer = setTimeout(() => finish({ bindingResponse: false, reason: 'timeout' }), 4000);
    socket.on('error', () => finish({ bindingResponse: false, reason: 'DNS/network error' }));
    socket.on('message', message => {
      if (message.length < 20 || message.readUInt16BE(0) !== 0x101 || message.readUInt32BE(4) !== 0x2112a442 || !message.subarray(8, 20).equals(id)) return;
      const end = 20 + message.readUInt16BE(2);
      if (end > message.length) return;
      for (let offset = 20; offset + 4 <= end;) {
        const type = message.readUInt16BE(offset), length = message.readUInt16BE(offset + 2);
        if (offset + 4 + length > end) return;
        if ((type === 0x0020 || type === 0x0001) && length >= 8) {
          finish({ bindingResponse: true, rttMs: Math.round(performance.now() - started) }); return;
        }
        offset += 4 + ((length + 3) & ~3);
      }
    });
    socket.send(packet, Number(port), host);
  });
}
const results = [];
// Bound DNS/socket work while checking the larger catalog.
for (let i = 0; i < DEFAULT_STUN_URLS.length; i += 5) results.push(...await Promise.all(DEFAULT_STUN_URLS.slice(i, i + 5).map(check)));
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
if (results.some(result => !result.bindingResponse)) process.exitCode = 1;
