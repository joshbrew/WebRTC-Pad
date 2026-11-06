import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parseSettings } from './config-utils.mjs';
const source = fileURLToPath(new URL('../../', import.meta.url)), temp = await fs.mkdtemp(path.join(os.tmpdir(), 'webrtc pad config '));
async function command(args, answers = []) {
  const child = spawn(process.execPath, args, { cwd: temp, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let output = '', pending = '', index = 0;
  child.stdout.on('data', data => {
    output += data; pending += data;
    while (index < answers.length && pending.includes(answers[index][0])) { pending = ''; child.stdin.write(answers[index++][1] + '\n'); }
  });
  child.stderr.on('data', data => { output += data; });
  const timer = setTimeout(() => child.kill(), 15000), [code] = await once(child, 'exit'); clearTimeout(timer);
  return { code, output };
}
try {
  for (const folder of ['system', 'windows', 'linux', 'mac']) await fs.cp(path.join(source, folder), path.join(temp, folder), { recursive: true });
  for (const file of ['package.json', '.env.example']) await fs.copyFile(path.join(source, file), path.join(temp, file));
  const before = '# Keep my file settings\nPORT=9000\nPLAYER_COUNT=2\nMETERED_API_KEY=old-test-key\nNATIVE_ENCODER=h264_amf\n';
  await fs.writeFile(path.join(temp, '.env'), before);
  const custom = await command(['system/scripts/configure.mjs'], [['Choose 1–4','3'], ['STUN URL',''], ['TURN URLs','turn:relay.example.com:3478'], ['TURN username','example-user'], ['TURN password','example-private-password'], ['Add a dedicated','y'], ['HTTPS origin','https://play.example.com']]);
  assert.equal(custom.code, 0, custom.output); assert.ok(!custom.output.includes('example-private-password'));
  let config = parseSettings(await fs.readFile(path.join(temp, '.env'), 'utf8'));
  assert.equal(config.PORT, '9000'); assert.equal(config.NATIVE_ENCODER, 'h264_amf'); assert.equal(config.TURN_CRED, 'example-private-password'); assert.equal(config.METERED_API_KEY, '');
  const caddy = await fs.readFile(path.join(temp, '.local/caddy/Caddyfile'), 'utf8'); assert.match(caddy, /play.example.com \{/); assert.match(caddy, /127\.0\.0\.1:9000/);
  const backups = await fs.readdir(path.join(temp, '.local/config-backups')); assert.equal(await fs.readFile(path.join(temp, '.local/config-backups', backups[0]), 'utf8'), before);
  const relay = await command(['system/scripts/setup-turn.mjs', '--hostname', 'turn.example.com', '--public-ip', '203.0.113.10']); assert.equal(relay.code, 0, relay.output);
  const relayEnv = parseSettings(await fs.readFile(path.join(temp, '.local/coturn/app.env'), 'utf8'));
  assert.equal(relayEnv.TURN_AUTH_SECRET.length, 64); assert.ok(!relay.output.includes(relayEnv.TURN_AUTH_SECRET));
  assert.match(await fs.readFile(path.join(temp, '.local/coturn/turnserver.conf'), 'utf8'), new RegExp(`static-auth-secret=${relayEnv.TURN_AUTH_SECRET}`));
  const duplicate = await command(['system/scripts/setup-turn.mjs', '--hostname', 'turn.example.com', '--public-ip', '203.0.113.10']); assert.equal(duplicate.code, 1);
  const reuse = await command(['system/scripts/configure.mjs'], [['Choose 1–4','4'], ['Add a dedicated','n']]); assert.equal(reuse.code, 0, reuse.output); assert.ok(!reuse.output.includes(relayEnv.TURN_AUTH_SECRET));
  config = parseSettings(await fs.readFile(path.join(temp, '.env'), 'utf8')); assert.equal(config.TURN_AUTH_SECRET, relayEnv.TURN_AUTH_SECRET); assert.equal(config.SIGNALING_FALLBACK, '0');
  const recovery = await command(['system/scripts/configure.mjs','--mode','recovery'], [['HTTPS origin','https://recover.example.com']]); assert.equal(recovery.code,0,recovery.output);
  config = parseSettings(await fs.readFile(path.join(temp,'.env'),'utf8')); assert.equal(config.TURN_AUTH_SECRET,relayEnv.TURN_AUTH_SECRET); assert.equal(config.TURN_URL,relayEnv.TURN_URL); assert.equal(config.PUBLIC_URL,'https://recover.example.com');
  console.log('PASS: optional console setup writes the existing .env, preserves unrelated settings and private backups, hides passwords, generates the correct recovery URL proxy, and creates/reuses self-hosted relay secrets without printing them');
} finally {
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'webrtc pad config '));
  await fs.rm(temp, { recursive: true, force: true });
}
