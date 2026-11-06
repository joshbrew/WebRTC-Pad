import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
try {
  if (args.includes('--help')) console.log('Generate private coturn configuration:\n  npm run setup:turn -- --hostname turn.example.com --public-ip YOUR_PUBLIC_IPV4\nOutputs .local/coturn/turnserver.conf and app.env. Merge app.env into .env; see system/docs/self-hosted-turn.md.');
  else {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--hostname', '--public-ip'].includes(args[i]) || !args[i + 1]) throw new Error('Use --hostname and --public-ip. See --help.');
      options[args[i]] = args[i + 1];
    }
    const hostname = options['--hostname'], publicIp = options['--public-ip'];
    if (!hostname || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname) || hostname.includes('..')) throw new Error('Use your DNS hostname without a protocol, path, or port.');
    if (net.isIP(publicIp) !== 4) throw new Error('Supply your public IPv4 address with --public-ip.');
    const folder = path.join(root, '.local/coturn'); await fs.mkdir(folder, { recursive: true });
    for (const name of ['turnserver.conf', 'app.env']) {
      try { await fs.access(path.join(folder, name)); throw new Error('Coturn settings already exist. Back them up and remove them before generating a new secret.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const secret = crypto.randomBytes(32).toString('hex');
    const template = await fs.readFile(path.join(root, 'system/config/coturn.conf.example'), 'utf8');
    const config = template.replaceAll('turn.example.com', hostname).replace('external-ip=203.0.113.10', `external-ip=${publicIp}`).replace('REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS', secret);
    await fs.writeFile(path.join(folder, 'turnserver.conf'), config, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(folder, 'app.env'), `STUN_URL=stun:${hostname}:3478\nTURN_URL=turn:${hostname}:3478?transport=udp,turn:${hostname}:3478?transport=tcp\nTURN_AUTH_SECRET=${secret}\nTURN_TTL_SECONDS=86400\nICE_TRANSPORT_POLICY=all\n`, { flag: 'wx', mode: 0o600 });
    console.log('Created private coturn configuration and app settings in .local/coturn. The secret was not printed.\nMerge app.env into .env, then run docker compose -f system/config/coturn.compose.yml up -d. See system/docs/self-hosted-turn.md for router ports and NAT details.');
  }
} catch (error) { console.error(`TURN setup: ${error.message}`); process.exitCode = 1; }
