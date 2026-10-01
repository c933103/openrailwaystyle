import test from 'node:test';
import assert from 'node:assert/strict';
import {repairPixels, terrarium, encodeTerrarium, referenceTile, drop} from '../styles/dem-repair.mjs';

const tile = height => {
  const data = new Uint8ClampedArray(256 * 256 * 4);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const o = (y * 256 + x) * 4; [data[o], data[o + 1], data[o + 2]] = encodeTerrarium(height(x, y)); data[o + 3] = 255; }
  return data;
};
const at = (data, x, y) => { const o = (y * 256 + x) * 4; return terrarium(data[o], data[o + 1], data[o + 2]); };

test('terrain repair: Terrarium colours round-trip', () => {
  for (const h of [-10904.6, -14.3, 0, 12.5, 8848]) assert.ok(Math.abs(terrarium(...encodeTerrarium(h)) - h) < 1 / 256 + 1e-9, String(h));
  assert.deepEqual(referenceTile(15, 27306, 13910), {z: 13, x: 6826, y: 3477, k: 4, ox: 512, oy: 512});
  assert.equal(drop(15), 60); assert.equal(drop(13), 120);
});

test('terrain repair: pits, a groove and a band go; real terrain stays', () => {
  const ground = (x, y) => 10 + x * 0.05;
  // A gorge 400 m deep and 40 px (~190 m at zoom 15) across, as in the
  // narrowest real canyons: smooth walls, no fault.
  const gorge = (x, y) => 400 * Math.min(1, Math.abs(x - 200) / 20);
  const faulty = tile((x, y) => {
    if (x === 40 && y === 40) return -2934; // a pit (east of Sha Tin)
    if (x === 87) return -738; // a one-pixel groove
    if (x >= 120 && x < 128) return [-1594, -5677, -9761, -13844, -14840, -10757, -6673, -2590][x - 120]; // the 120° E band
    if (x >= 180) return gorge(x, y);
    return ground(x, y);
  });
  const reference = tile((x, y) => (x >= 158 && x < 160) ? -9100 : (x >= 173 ? 400 : 10)); // shares the band
  const changed = repairPixels(faulty, 256, 15, 0, 0, reference);
  assert.ok(changed >= 1 + 256 + 8 * 256, `changed ${changed}`);
  for (const [x, y] of [[40, 40], [87, 10], [120, 5], [124, 128], [127, 250]]) assert.ok(Math.abs(at(faulty, x, y) - ground(x, y)) < 20, `${x},${y}: ${at(faulty, x, y)}`);
  for (const x of [185, 195, 200, 205, 215]) assert.ok(Math.abs(at(faulty, x, 100) - gorge(x, 100)) < 1e-2, `gorge kept at ${x}: ${at(faulty, x, 100)}`);
  // Coarse zooms and sound tiles are left alone.
  const sound = tile(ground), copy = sound.slice();
  assert.equal(repairPixels(sound, 256, 15, 0, 0, tile(() => 10)), 0);
  assert.deepEqual(sound, copy);
  assert.equal(repairPixels(tile(() => -14840), 256, 9, 0, 0, null), 0);
});
