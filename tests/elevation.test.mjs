import test from 'node:test';
import assert from 'node:assert/strict';
import {terrarium, tilePixel, sampleHeight, createElevation, alongLine, profileStats} from '../styles/elevation.mjs';
import {Measure, climb, formatClimb, lengthKm} from '../styles/draw.mjs';

// A tile whose pixels all encode one height, or a ramp rising 1 m a pixel eastwards.
const encode = h => { const v = h + 32768; return [Math.floor(v / 256), Math.floor(v) % 256, Math.round((v % 1) * 256)]; };
const tile = heightAt => { const size = 256, data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set([...encode(heightAt(x, y)), 255], (y * size + x) * 4);
  return {data, size}; };

test('terrarium heights decode, including the seabed; tile positions wrap', () => {
  assert.equal(terrarium(128, 0, 0), 0);
  assert.equal(terrarium(...encode(3776)), 3776);
  assert.equal(terrarium(...encode(-10.5)), -10.5);
  assert.deepEqual(tilePixel(0, 0, 1), {x: 1, y: 1, px: 0, py: 0});
  assert.deepEqual(tilePixel(-180, 0, 1).x, tilePixel(180, 0, 1).x, 'the antimeridian is one column');
});

test('heights are interpolated between pixel centres', () => {
  const ramp = tile(x => x);
  assert.equal(sampleHeight(ramp.data, ramp.size, 10.5, 5), 10);
  assert.equal(sampleHeight(ramp.data, ramp.size, 11, 5), 10.5);
  assert.equal(sampleHeight(ramp.data, ramp.size, -3, 5), 0, 'kept within the tile');
});

test('elevation: one tile load serves many points; a failed tile gives null', async () => {
  const urls = [];
  const elevation = createElevation('https://dem/{z}/{x}/{y}.png', {zoom: 2, load: async url => { urls.push(url); if (url.includes('/2/3/')) throw new Error('down'); return tile(() => 120); }});
  assert.deepEqual(await elevation.heights([[10, 10], [11, 11], [100, 10]]), [120, 120, null]);
  assert.deepEqual(urls, ['https://dem/2/2/1.png', 'https://dem/2/3/1.png']);
  await elevation.heights([[12, 12]]);
  assert.equal(urls.length, 2, 'cached');
});

test('profile samples spread evenly along a line; summary of the heights', () => {
  const line = [[0, 0], [0.01, 0], [0.01, 0.01]];
  const samples = alongLine(line, 4, lengthKm);
  assert.equal(samples.length, 5);
  assert.deepEqual(samples[0].point, [0, 0]);
  assert.deepEqual(samples[2].point.map(v => Number(v.toFixed(6))), [0.01, 0]);
  assert.deepEqual(samples[4].point, [0.01, 0.01]);
  assert.ok(Math.abs(samples[4].at - lengthKm(line)) < 1e-9);
  const stats = profileStats([{at: 0, height: 10}, {at: 0.1, height: 30}, {at: 0.2, height: 20}, {at: 0.3, height: null}]);
  assert.deepEqual(stats, {min: 10, max: 30, ascent: 20, descent: 10, steepest: 0.2, over: 0.1});
  // The steepest gradient is taken over at least 100 m: a 10 m spike is diluted.
  const spiky = Array.from({length: 21}, (_, i) => ({at: i * 0.01, height: i === 10 ? 5 : 0}));
  assert.ok(Math.abs(profileStats(spiky).steepest - 0.05) < 1e-9);
  assert.equal(profileStats([{at: 0, height: null}]), null);
});

test('measure: rise and gradient between the ends of a finished distance', async () => {
  assert.deepEqual(climb(100, 112, 1), {rise: 12, gradient: 0.012});
  assert.equal(climb(null, 5, 1), null);
  assert.equal(formatClimb({rise: 12, gradient: 0.012}), '+12 m · +1.2% (12.0‰)');
  assert.equal(formatClimb({rise: -30.48, gradient: -0.025}, 'imperial'), '−100 ft · −2.5% (25.0‰)');
  const sources = {}, statuses = [];
  const map = {getSource: id => sources[id], addSource: id => { sources[id] = {setData(data) { this.data = data; }}; }, getLayer: () => undefined, addLayer() {}, getCanvas: () => ({style:{}}), on() {}, doubleClickZoom: {enable() {}, disable() {}}};
  const asked = [];
  const m = new Measure(map, {status: s => statuses.push(s), heights: async points => { asked.push(points); return [100, 112]; }});
  m.install(); m.setMode('distance');
  m.click({lng: 0, lat: 0}); m.click({lng: 0.00899, lat: 0}); m.end();
  await new Promise(resolve => setTimeout(resolve));
  assert.deepEqual(asked, [[[0, 0], [0.00899, 0]]], 'only the two ends, once');
  assert.match(statuses.at(-1), /End to end: \+12 m · \+1\.2\d*% \(12\.\d‰\)\. Click a point to select it; drag a point to move it\.$/);
  assert.match(sources['atlas-measure'].data.features.find(f => f.properties.kind === 'total').properties.label, /\n\+12 m/);
  m.refresh();
  assert.equal(asked.length, 1, 'not asked again for the same ends');
});
