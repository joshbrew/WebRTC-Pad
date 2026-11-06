import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { parseSettings, saveSettings } from './config-utils.mjs';
import { readIce } from '../src/ice.js';
import { readConfig } from '../src/config.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
if (process.argv.includes('--help')) {
  console.log('Connection setup writes .env and keeps a private backup in .local/config-backups.\nChoices: public STUN/manual pairing, Metered, custom TURN, or self-hosted coturn; optional HTTPS recovery URL.\nYou can edit .env directly instead. No ports, services or router rules are changed.');
} else {
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
  async function ask(label, fallback = '', secret = false) {
    process.stdout.write(`${label}${fallback ? secret ? ' [Enter keeps saved value]' : ` [${fallback}]` : ''}: `);
    muted = secret;
    try { const value = (await rl.question('')).trim(); return value || fallback; }
    finally { muted = false; if (secret) process.stdout.write('\n'); }
  }
  try {
    let current = {};
    try { current = parseSettings(await fs.readFile(path.join(root, '.env'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    console.log('WebRTC Pad connection setup\nYour configuration remains a local .env file; this menu is optional.\n1. Manual files + public STUN (no relay account)\n2. Metered TURN account\n3. Custom STUN/TURN credentials\n4. Self-hosted coturn (Docker + forwarded ports)');
    const preset = process.argv[process.argv.indexOf('--mode') + 1];
    const choice = preset === 'relay' ? '4' : preset === 'recovery' ? '1' : await ask('Choose 1–4', '1');
    if (!['1','2','3','4'].includes(choice)) throw new Error('Choose a number from 1 to 4');
    const updates = preset === 'recovery' ? {} : { ICE_JSON: '', STUN_URL: '', TURN_URL: '', TURN_USER: '', TURN_CRED: '', TURN_AUTH_SECRET: '', METERED_DOMAIN: '', METERED_API_KEY: '', METERED_USERNAME: '', METERED_CREDENTIAL: '', ICE_TRANSPORT_POLICY: 'all' };
    if (choice === '2') {
      updates.METERED_DOMAIN = await ask('Your application.metered.live hostname', current.METERED_DOMAIN || '');
      if (!/^[a-z0-9-]+\.metered\.live$/i.test(updates.METERED_DOMAIN)) throw new Error('Use the Metered application hostname, without https://');
      updates.METERED_API_KEY = await ask('Metered API key (hidden)', current.METERED_API_KEY || '', true);
      if (!updates.METERED_API_KEY) throw new Error('An API key is required');
    }
    if (choice === '3') {
      updates.STUN_URL = await ask('STUN URL', current.STUN_URL || 'stun:stun.l.google.com:19302');
      updates.TURN_URL = await ask('TURN URLs, separated by commas', current.TURN_URL || '');
      updates.TURN_USER = await ask('TURN username', current.TURN_USER || '');
      updates.TURN_CRED = await ask('TURN password (hidden)', current.TURN_CRED || '', true);
      if (!updates.TURN_URL || !updates.TURN_USER || !updates.TURN_CRED) throw new Error('TURN URLs, username and password are required');
    }
    if (choice === '4') {
      const relayEnv = path.join(root, '.local/coturn/app.env');
      let existing; try { existing = await fs.readFile(relayEnv, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!existing) {
        const hostname = await ask('Relay DNS hostname, without https://');
        const publicIp = await ask('Relay public IPv4 address');
        await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ['system/scripts/setup-turn.mjs', '--hostname', hostname, '--public-ip', publicIp], { cwd: root, stdio: 'inherit', windowsHide: true });
          child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Relay configuration could not be generated')));
        });
        existing = await fs.readFile(relayEnv, 'utf8');
      } else console.log('Using your existing private coturn configuration.');
      Object.assign(updates, parseSettings(existing));
    }
    const recovery = preset === 'recovery' ? 'y' : await ask('Add a dedicated HTTPS recovery URL? y/n', current.SIGNALING_FALLBACK === '1' ? 'y' : 'n');
    updates.SIGNALING_FALLBACK = /^y(es)?$/i.test(recovery) ? '1' : '0';
    updates.PUBLIC_URL = updates.SIGNALING_FALLBACK === '1' ? await ask('HTTPS origin that proxies THIS host’s /fallback', current.PUBLIC_URL || '') : '';
    const next = { ...current, ...updates };
    readIce(next); readConfig(next);
    if (updates.SIGNALING_FALLBACK === '1') {
      const template = await fs.readFile(path.join(root, 'system/config/Caddyfile'), 'utf8');
      await fs.mkdir(path.join(root, '.local/caddy'), { recursive: true });
      const authority = new URL(updates.PUBLIC_URL).host;
      // URL validation above forbids paths/credentials; Caddy gets a hostname only.
      if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(authority)) throw new Error('Use a DNS hostname for the recovery service');
      await fs.writeFile(path.join(root, '.local/caddy/Caddyfile'), template.replace('play.example.com {', `${authority} {`).replace('127.0.0.1:8787', `127.0.0.1:${Number(next.PORT || 8787)}`));
    }
    await saveSettings(root, updates);
    console.log('\nSaved .env. A private backup is in .local/config-backups. No credentials were printed. Restart the app to use these settings.');
    if (choice === '1' && preset !== 'recovery') console.log('Direct STUN mode may fail behind restrictive NAT/firewalls. Choose Metered/custom/self-hosted TURN when a relay is needed.');
    if (choice === '4') console.log('Next: start the relay and forward UDP/TCP 3478 plus UDP 49160–49359. See system/docs/self-hosted-turn.md.');
    if (updates.SIGNALING_FALLBACK === '1') console.log('Next: start Caddy, forward TCP 80/443, and create new invites. The URL must reach this app’s /fallback endpoint; it is not an unrelated server account. See system/docs/port-forwarding.md.');
  } catch (error) { console.error(`Connection setup: ${error.message}`); process.exitCode = 1; }
  finally { rl.close(); output.end(); }
}
