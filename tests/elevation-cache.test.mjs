import test from 'node:test';
import assert from 'node:assert/strict';
import {createElevation, tilePixel, alongLine} from '../styles/elevation.mjs';
import {lengthKm} from '../styles/draw.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const pixel = height => ({size: 1, data: new Uint8ClampedArray([128, height, 0, 255])});
const point = (x, zoom = 8) => [(x + 0.5) / 2 ** zoom * 360 - 180, 0];
const path = (x, zoom = 8) => `https://terrain.fixture/${zoom}/${x}/${2 ** (zoom - 1)}.png`;
function fixture(zoom = 8) {
  const calls = [];
  const elevation = createElevation('https://terrain.fixture/{z}/{x}/{y}.png', {zoom,
    load: url => new Promise((resolve, reject) => calls.push({url, resolve, reject})),
  });
  return {calls, elevation};
}

test('a profile exceeding the completed-cache limit shares every pending tile', async () => {
  const {calls, elevation} = fixture();
  const points = Array.from({length: 65}, (_, x) => point(x));
  assert.equal(new Set(points.map(p => tilePixel(...p, 8).x)).size, 65);
  const first = elevation.heights([...points, points[0]]);
  const overlap = elevation.heights([points[0], points[32], points[64]]);
  await tick();
  const started = calls.length;
  for (const call of calls) call.resolve(pixel(120));
  assert.deepEqual(await first, Array(66).fill(120));
  assert.deepEqual(await overlap, [120, 120, 120]);
  assert.equal(started, 65, 'active tiles cannot be evicted into duplicate downloads');
  assert.equal(calls.filter(call => call.url === path(0)).length, 1);
});

test('the actual 201-sample profile path reuses unfinished tiles on its return leg', async () => {
  const {calls, elevation} = fixture(14);
  const start = point(8192, 14), end = point(8452, 14);
  const points = alongLine([start, end, start], 200, lengthKm).map(sample => sample.point);
  const expected = new Set(points.map(p => {
    const {x, y} = tilePixel(...p, 14); return `${x}/${y}`;
  })).size;
  assert.ok(expected > 64 && expected < points.length);
  const result = elevation.heights(points);
  await tick();
  const initial = calls.length;
  for (const call of calls) call.resolve(pixel(120));
  await tick();
  for (const call of calls) call.resolve(pixel(120));
  assert.deepEqual(await result, Array(201).fill(120));
  assert.equal(initial, expected, 'the outbound and return samples share each unfinished fine tile');
});

test('failure fans out to all shared readers and a later call can retry once', async () => {
  const {calls, elevation} = fixture();
  const points = Array.from({length: 65}, (_, x) => point(x));
  const first = elevation.heights([...points, points[0]]);
  const overlap = elevation.heights([points[0]]);
  await tick();
  for (const call of calls) call.url === path(0) ? call.reject(new Error('Controlled failure')) : call.resolve(pixel(120));
  assert.deepEqual(await first, [null, ...Array(64).fill(120), null]);
  assert.deepEqual(await overlap, [null]);
  const before = calls.length;
  const retried = elevation.heights([points[0], points[0]]);
  await tick();
  assert.equal(calls.length, before + 1);
  calls.at(-1).resolve(pixel(121));
  assert.deepEqual(await retried, [121, 121]);
  assert.deepEqual(await elevation.heights([points[0]]), [121]);
  assert.equal(before, 65, 'failed in-flight work is also shared across cache pressure');
});

test('completed elevation tiles remain bounded and recently used tiles are retained', async () => {
  const calls = [];
  const elevation = createElevation('https://terrain.fixture/{z}/{x}/{y}.png', {zoom: 8,
    load: async url => {calls.push(url); return pixel(120);},
  });
  for (let x = 0; x < 64; x++) await elevation.heights([point(x)]);
  await elevation.heights([point(0)]);
  await elevation.heights([point(64)]);
  assert.equal(calls.length, 65);
  await elevation.heights([point(0)]);
  assert.equal(calls.length, 65, 'a completed-cache hit promotes recency');
  // The raw cache has its own recency: a repaired hit need not reread raw
  // pixels. One more distinct tile evicts tile 1 from both 64-entry caches.
  await elevation.heights([point(65)]);
  await elevation.heights([point(1)]);
  assert.equal(calls.length, 67, 'completed caches do not grow with the profile');
  assert.equal(calls.at(-1), path(1));
});

test('zoom-14 repair keeps pending fine and shared reference tiles coalesced', async () => {
  const {calls, elevation} = fixture(14);
  const points = Array.from({length: 65}, (_, i) => point(8192 + i * 4, 14));
  const first = elevation.heights([...points, points[0]]);
  await tick();
  const fine = calls.slice();
  for (const call of fine) call.resolve(pixel(120));
  await tick();
  const references = calls.slice(fine.length);
  const overlap = elevation.heights([points[0], points[64]]);
  await tick();
  for (const call of calls.slice(fine.length)) call.resolve(pixel(120));
  // The broken implementation may add another reference after the duplicated
  // fine tile resolves. Release it as well so the negative control terminates.
  await tick();
  for (const call of calls.slice(fine.length)) call.resolve(pixel(120));
  assert.deepEqual(await first, Array(66).fill(120));
  assert.deepEqual(await overlap, [120, 120]);
  assert.equal(fine.length, 65, 'one fine download per distinct profile tile');
  assert.equal(references.length, 65, 'one reference download per distinct parent');
  assert.equal(calls.length, 130, 'overlap during repair does not restart fine/reference work');
});

test('a failed coarser reference preserves fine heights and the existing repaired-result cache', async () => {
  const {calls, elevation} = fixture(14), p = point(8192, 14);
  const first = elevation.heights([p, p]);
  await tick();
  assert.equal(calls.length, 1);
  const data = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([128, 120, 0, 255], i);
  calls[0].resolve({size: 256, data});
  await tick();
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/12\/2048\/2048\.png$/);
  const overlap = elevation.heights([p]);
  calls[1].reject(new Error('Reference unavailable'));
  assert.deepEqual(await first, [120, 120]);
  assert.deepEqual(await overlap, [120]);
  assert.deepEqual(await elevation.heights([p]), [120]);
  assert.equal(calls.length, 2, 'missing reference does not discard a usable repaired fine tile');
  assert.deepEqual(data.slice(0, 4), new Uint8ClampedArray([128, 120, 0, 255]), 'raw pixels remain intact');
});
