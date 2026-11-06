import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamSettings, captureConstraints, applyCaptureSettings } from '../public/media.js';
import { applySenderQuality } from '../public/rtc.js';
test('stream presets enforce capture limits, source-size mode clears resolution caps', () => {
  const settings = streamSettings('720', 30);
  assert.deepEqual(captureConstraints(settings), { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 30, max: 30 } });
  assert.deepEqual(captureConstraints(streamSettings('native', 60)), { frameRate: { ideal: 60, max: 60 } });
  assert.equal(streamSettings('bad', Infinity).frameRate, 60);
  assert.equal(streamSettings('bad', Infinity).resolution, '1080');
});
test('sharp-picture mode requests resolution priority while balanced mode leaves both dimensions adaptive', async () => {
  let params;
  const peer = { quality: streamSettings('1080', 30, 'resolution'), senders: { video: { track: { getSettings: () => ({ width: 1920, height: 1080 }) }, getParameters: () => ({ encodings: [{}] }), setParameters: async p => { params = p; } } } };
  await applySenderQuality(peer); assert.equal(params.degradationPreference, 'maintain-resolution');
  peer.quality = streamSettings('1080', 30, 'balanced'); await applySenderQuality(peer); assert.equal(params.degradationPreference, 'balanced');
});
test('capture settings use actual browser-reported resolution and rate', async () => {
  let applied;
  const track = { async applyConstraints(c) { applied = c; }, getSettings() { return { width: 1280, height: 720, frameRate: 30 }; } };
  const actual = await applyCaptureSettings(track, streamSettings('720', 30));
  assert.equal(applied.height.max, 720); assert.equal(track.contentHint, 'motion'); assert.equal(actual.frameRate, 30);
});
test('fixed-size browser sources stay alive if capture caps are unsupported, without swallowing permission errors',async()=>{
  const attempts=[],track={async applyConstraints(value){attempts.push(value);throw Object.assign(Error('Fixed source'),{name:'OverconstrainedError'});},getSettings:()=>({width:960,height:540,frameRate:60})};
  assert.equal((await applyCaptureSettings(track,streamSettings('720',30))).width,960);assert.equal(attempts.length,2);assert.equal(attempts[1].width.max,undefined);assert.equal(track.contentHint,'motion');
  track.applyConstraints=async()=>{throw Object.assign(Error('Permission denied'),{name:'NotAllowedError'});};await assert.rejects(applyCaptureSettings(track,streamSettings()),{name:'NotAllowedError'});
});
test('live quality changes reach every negotiated video encoding', async () => {
  let updated;
  const quality = streamSettings('1440', 120);
  const peer = { quality, senders: { video: { track: { getSettings() { return { width: 3840, height: 2160 }; } }, getParameters() { return { encodings: [{}, {}] }; }, async setParameters(p) { updated = p; } } } };
  await applySenderQuality(peer);
  assert.equal(updated.encodings.length, 2);
  for (const encoding of updated.encodings) { assert.equal(encoding.maxFramerate, 120); assert.equal(encoding.maxBitrate, quality.maxBitrate); assert.equal(encoding.scaleResolutionDownBy, 1.5); }
  assert.equal(updated.degradationPreference, 'maintain-framerate');
});
