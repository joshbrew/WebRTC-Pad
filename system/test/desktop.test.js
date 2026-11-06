import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoPoint, desktopSnapshot } from '../public/desktop.js';
test('desktop mouse coordinates follow the fitted video after resize and reject letterboxing', () => {
  const video = { videoWidth: 1920, videoHeight: 1080, getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }) };
  assert.equal(videoPoint(video, 500, 60), null); // 75px top black bar.
  assert.deepEqual(videoPoint(video, 500, 350), { x: .5, y: .5 });
  assert.deepEqual(videoPoint(video, 100, 125), { x: 0, y: 0 });
  assert.deepEqual(videoPoint(video, 2000, 1000, true), { x: 1, y: 1 });
  video.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1920, height: 1080 });
  assert.deepEqual(videoPoint(video, 480, 810), { x: .25, y: .75 });
});
test('desktop snapshots bound buttons, physical key codes and normalized coordinates', () => {
  assert.deepEqual(desktopSnapshot({ seq: 4, keys: ['KeyA','KeyA'], buttons: [0], x: .2, y: .3, moveSeq: 3 }), { seq: 4, keys: ['KeyA'], buttons: [0], x: .2, y: .3, moveSeq: 3 });
  for (const value of [{ seq: -1, keys: [], buttons: [] }, { seq: 1, keys: ['exec'], buttons: [] }, { seq: 1, keys: [], buttons: [9] }, { seq: 1, keys: [], buttons: [], x: NaN, y: 0 }, { seq: 1, keys: [], buttons: [], x: 2, y: 0 }]) assert.equal(desktopSnapshot(value), null);
});
