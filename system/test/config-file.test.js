import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettings, parseSettings } from '../scripts/config-utils.mjs';
test('connection setup preserves unrelated file settings and comments while replacing duplicate values safely', () => {
  const before = '# Keep this note\nPORT=8888\nTURN_CRED=old\nTURN_CRED=duplicate\nNATIVE_ENCODER=h264_amf\n';
  const next = mergeSettings(before, { TURN_CRED: 'new # with spaces', PUBLIC_URL: 'https://play.example.com', SIGNALING_FALLBACK: '1' });
  assert.match(next, /# Keep this note/); assert.equal(parseSettings(next).PORT, '8888');
  assert.equal(parseSettings(next).NATIVE_ENCODER, 'h264_amf'); assert.equal(parseSettings(next).TURN_CRED, 'new # with spaces');
  assert.equal(next.match(/TURN_CRED=/g).length, 1); assert.throws(() => mergeSettings(before, { TURN_CRED: 'line\ninjection' }));
});
