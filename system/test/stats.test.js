import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receivedVideoStats, videoStatsLabel } from '../public/stats.js';
test('received video stats distinguish decoded dimensions, FPS and measured bitrate across samples', () => {
  const stats = (timestamp, frames, bytes) => new Map([['v', { id: 'v', type: 'inbound-rtp', kind: 'video', frameWidth: 960, frameHeight: 540, timestamp, framesDecoded: frames, bytesReceived: bytes }]]);
  const first = receivedVideoStats(stats(1000, 10, 1000), null, {});
  assert.equal(first.mbps, null);
  const second = receivedVideoStats(stats(2000, 40, 501000), first.sample, {});
  assert.equal(second.fps, 30); assert.equal(second.mbps, 4);
  assert.equal(videoStatsLabel(second, true), '960 × 540 · 30 fps · 4.0 Mbps');
  const reset = receivedVideoStats(stats(500, 1, 500), second.sample, {}); assert.equal(reset.mbps, null);
});
