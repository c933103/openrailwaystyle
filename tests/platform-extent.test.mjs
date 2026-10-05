import test from 'node:test';
import assert from 'node:assert/strict';
import {extentOfPoints} from '../styles/platform-length.mjs';

// Reference: the longer side of every minimum-area rectangle on a hull edge.
const RAD = Math.PI / 180;
function referenceLengths(points) {
  const origin = points[0], scale = 6371000 * RAD, cos = Math.cos(origin[1] * RAD);
  const p = points.map(q => [(((q[0] - origin[0] + 540) % 360) - 180) * scale * cos, (q[1] - origin[1]) * scale]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => {const out = []; for (const q of list) {while (out.length > 1 && cross(out.at(-2), out.at(-1), q) <= 0) out.pop(); out.push(q);} return out.slice(0, -1);};
  const hull = [...half(p), ...half(p.slice().reverse())], rects = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length], t = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(t), s = Math.sin(t);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of hull) {const u = x * c + y * s, v = -x * s + y * c; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);}
    rects.push([(x1 - x0) * (y1 - y0), Math.max(x1 - x0, y1 - y0)]);
  }
  const min = Math.min(...rects.map(r => r[0]));
  return rects.filter(r => r[0] <= min * (1 + 1e-6)).map(r => r[1]);
}
// Deterministic pseudo-random outlines, gridded ones included (area ties).
function random(seed) {return () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;}

test('platform extent: rotating calipers match the minimum-area rectangle on every hull edge', () => {
  const next = random(7);
  for (let t = 0; t < 2000; t++) {
    const n = 3 + Math.floor(next() * 60), grid = t % 2, angle = next() * Math.PI, cx = next() * 358 - 179, cy = next() * 140 - 70, length = next() * 0.01, width = next() * 0.003;
    const points = Array.from({length: n}, () => {
      let u = (next() - 0.5) * length, v = (next() - 0.5) * width;
      if (grid) {u = Math.round(u * 1e5) / 1e5; v = Math.round(v * 1e5) / 1e5;}
      return [cx + u * Math.cos(angle) - v * Math.sin(angle), cy + u * Math.sin(angle) + v * Math.cos(angle)];
    });
    const got = extentOfPoints(points), ok = referenceLengths(points);
    assert.ok(ok.some(l => Math.abs(l - got) <= 1e-6 * Math.max(l, 1)), `outline ${t}: ${got} not among ${ok}`);
  }
});

test('platform extent: an 8,192-vertex convex outline stays within a frame budget', () => {
  const ring = Array.from({length: 8192}, (_, i) => [139.7 + 0.01 * Math.cos(2 * Math.PI * i / 8192), 35.6 + 0.003 * Math.sin(2 * Math.PI * i / 8192)]);
  const started = performance.now(), length = extentOfPoints(ring), elapsed = performance.now() - started;
  assert.ok(Math.abs(length - 1808.25) < 0.5, `ellipse major axis ${length}`);
  assert.ok(elapsed < 100, `linear work, not quadratic (${elapsed.toFixed(1)} ms)`);
});
