import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { isPlayerSlot, playerSlots } from '../public/players.js';
import { pairingPacket, parsePairing } from '../public/pairing.js';
test('player counts respect the active backend and participant caps are optional', () => {
  assert.equal(readConfig({}, 'win32').playerCount, 4);assert.equal(readConfig({},'win32').controllerType,'auto');assert.equal(readConfig({PLAYER_COUNT:'8'},'win32').maxPlayers,null);
  assert.throws(() => readConfig({ PLAYER_COUNT: '5',WINDOWS_CONTROLLER_TYPE:'x360' }, 'win32'), /four controller/);
  const hid=readConfig({PLAYER_COUNT:'12',WINDOWS_CONTROLLER_TYPE:'ds4'},'win32');
  assert.equal(hid.controllerType,'ds4');assert.equal(hid.maxPlayers,null);assert.equal(hid.slots.at(-1),'p12');
  assert.throws(()=>readConfig({WINDOWS_CONTROLLER_TYPE:'unknown'},'win32'),/auto, x360 or ds4/);
  assert.throws(()=>readConfig({PLAYER_COUNT:'65',WINDOWS_CONTROLLER_TYPE:'ds4'},'win32'));
  const config = readConfig({ PLAYER_COUNT: '12', MAX_PEERS: '0' }, 'linux');
  assert.equal(config.slots.at(-1), 'p12'); assert.equal(config.maxPeers, 0);
  assert.throws(() => readConfig({ PLAYER_COUNT: '65' }, 'linux'));
  assert.throws(() => readConfig({ MAX_PEERS: '-1' }, 'linux'));
  assert.deepEqual(playerSlots(3), ['p1', 'p2', 'p3']);
  assert.equal(isPlayerSlot('p12'), true); assert.equal(isPlayerSlot('p01'), false);assert.equal(isPlayerSlot('p9007199254740992'),false); assert.equal(isPlayerSlot('p65'), true);
});
test('fallback configuration requires an HTTPS public origin', () => {
  assert.throws(() => readConfig({ SIGNALING_FALLBACK: '1' }), /PUBLIC_URL/);
  assert.throws(() => readConfig({ PUBLIC_URL: 'http://play.example.com' }));
  assert.throws(() => readConfig({ PUBLIC_URL: 'https://user:password@play.example.com' }));
  assert.equal(readConfig({ SIGNALING_FALLBACK: '1', PUBLIC_URL: 'https://play.example.com' }).fallbackEnabled, true);
});
test('invitations retain higher player slots and validate scoped WSS recovery capabilities', () => {
  const fallback = { url: 'wss://play.example.com/fallback', roomId: 'a'.repeat(12), peerId: 'b'.repeat(16), token: 'c'.repeat(64) };
  const offer = pairingPacket('offer', '12345678-1234-1234-1234-123456789012', { type: 'offer', sdp: 'v=0\r\n' }, { iceServers: [] }, 'p12', Date.now() + 10000, fallback);
  const parsed = parsePairing(JSON.stringify(offer), 'offer'); assert.equal(parsed.slot, 'p12'); assert.equal(parsed.fallback.url, fallback.url);
  offer.fallback.url = 'ws://play.example.com/fallback'; assert.throws(() => parsePairing(JSON.stringify(offer), 'offer'), /fallback/);
});
