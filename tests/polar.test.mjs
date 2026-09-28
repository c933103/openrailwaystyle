import test from 'node:test';
import assert from 'node:assert/strict';
import {CAP_RADIUS, KM_PER_DEGREE, MERCATOR_LIMIT, bandFor, decodeLine, encodeLine, fromPolar, toPolar} from '../styles/polar.mjs';
import {clipToDisc, clipToRect, isolineSegments, joinSegments, levels, simplify} from '../scripts/polar-contours.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('polar coordinates round-trip and keep distance from the pole true', () => {
  for (const cap of ['north', 'south']) for (const lng of [-179, -90, -12.5, 0, 45, 135, 179]) {
    const lat = cap === 'north' ? 87.25 : -86.5, [x, y] = toPolar(cap, [lng, lat]);
    near(Math.hypot(x, y), (90 - Math.abs(lat)) * KM_PER_DEGREE);
    const [lng2, lat2] = fromPolar(cap, [x, y]);
    near(lng2, lng); near(lat2, lat);
  }
  // North: longitude 0° points down; south: up.
  assert.ok(toPolar('north', [0, 89])[1] < 0);
  assert.ok(toPolar('south', [0, -89])[1] > 0);
  near(CAP_RADIUS, (90 - MERCATOR_LIMIT) * KM_PER_DEGREE);
  assert.ok(CAP_RADIUS > 549 && CAP_RADIUS < 552);
});

test('lines survive encoding within the storage step', () => {
  const line = [[-12.345, 400.001], [-12.3, 399.5], [0, 0], [549.99, -3.21]];
  const back = decodeLine(encodeLine(line));
  assert.equal(back.length, line.length);
  line.forEach(([x, y], k) => { near(back[k][0], x, 0.0051); near(back[k][1], y, 0.0051); });
});

test('zoom bands follow the contour steps elsewhere on the map', () => {
  assert.equal(bandFor(3), 0); assert.equal(bandFor(8.99), 0);
  assert.equal(bandFor(9), 1); assert.equal(bandFor(10.9), 1); assert.equal(bandFor(11), 2);
  assert.deepEqual(levels(-120, 430, 100), [-100, 100, 200, 300, 400]);
});

test('marching squares traces a closed contour around a hill', () => {
  const cols = 21, values = new Float32Array(cols * cols);
  for (let j = 0; j < cols; j++) for (let i = 0; i < cols; i++) values[j * cols + i] = 100 - Math.hypot(i - 10, j - 10) * 10;
  const lines = joinSegments(isolineSegments({values, cols, rows: cols, x0: -10, y0: -10, step: 1}, 50));
  assert.equal(lines.length, 1);
  const ring = lines[0];
  assert.deepEqual(ring[0], ring.at(-1));
  for (const [x, y] of ring) near(Math.hypot(x, y), 5, 0.1);
});

test('grid gaps (NaN) are skipped rather than contoured', () => {
  const cols = 4, values = new Float32Array(cols * cols).fill(NaN);
  assert.deepEqual(isolineSegments({values, cols, rows: cols, x0: 0, y0: 0, step: 1}, 0), []);
});

test('clipping to the cap and to tiles keeps only the inside parts', () => {
  const line = [[-20, 0], [0, 0], [20, 0]];
  const [inside] = clipToDisc([line], 10);
  near(inside[0][0], -10, 1e-9); near(inside.at(-1)[0], 10, 1e-9);
  const pieces = clipToRect([line], [-5, -5, 5, 5]);
  assert.equal(pieces.length, 1);
  for (const [x, y] of pieces[0]) assert.ok(x >= -5 - 1e-9 && x <= 5 + 1e-9 && Math.abs(y) <= 5);
  assert.deepEqual(clipToRect([line], [30, 30, 40, 40]), []);
});

test('simplification keeps ends and drops points within tolerance', () => {
  const points = [[0, 0], [1, 0.01], [2, -0.01], [3, 0], [3, 3]];
  const out = simplify(points, 0.1);
  assert.deepEqual(out[0], [0, 0]); assert.deepEqual(out.at(-1), [3, 3]);
  assert.ok(out.length === 3 && out.some(p => p[0] === 3 && p[1] === 0));
});
