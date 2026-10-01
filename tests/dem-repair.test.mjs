import test from 'node:test';
import assert from 'node:assert/strict';
import {repairPixels, terrarium, encodeTerrarium, referenceTile, drop, contourRings} from '../styles/dem-repair.mjs';

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
  assert.equal(repairPixels(tile(() => -14840), 256, 8, 0, 0, null), 0);
});

test('terrain repair: contour lines are counted in whichever units draw more', () => {
  assert.equal(contourRings(9, -400, -20), 25); // 50 ft seabed lines (18 at 20 m)
  assert.equal(contourRings(9, -250, -20), 15); // 11 at 20 m: an imperial storm
  assert.equal(contourRings(7, -400, -20), 6); // 150 ft above -200 m, and 500 ft land lines below the sea
  assert.equal(contourRings(11, -400, -20), 0); // no seabed lines
  assert.equal(contourRings(13, 0, 250), 16); // 50 ft land lines (12 at 20 m)
  assert.equal(contourRings(9, -100, 150), 7); // both: 250 ft, and 50 ft below the sea
  assert.equal(contourRings(7, -2500, -20), 20); // land lines below sea level too at zoom 7 (16 at 500 ft), and the shelf's 4
});

test('terrain repair: single-pixel contour storms go at coarse zooms; real holes stay', () => {
  const seabed = (x, y) => -20 - x * 0.02;
  const data = tile((x, y) => {
    if (x === 30 && y === 30) return -420; // a pit 400 m below level seabed: 20 rings
    if (x === 60) return -410; // a one-pixel strip, as the 120° E band at zoom 9
    if (x === 90) return -250; // a strip drawing 11 lines at 20 m, 15 at 50 ft
    if (y === 255 && x >= 128) return -150 - x; // a coast along the tile's edge: sea below, land above
    if (y === 254 && x >= 128) return 12;
    if (y === 160 && x >= 40 && x < 120) return -410; // a strip crossing the one at x = 60
    if (x === 100 && y === 100) return -120; // a blue hole: 5 rings
    if (x === 140 && y === 140) return 300; // an islet
    if (Math.hypot(x - 200, y - 200) < 12) return -60; // an atoll's lagoon
    if (Math.hypot(x - 200, y - 200) < 16) return 2; // its reef
    if (x >= 20 && x < 24 && y >= 200 && y < 204) return -800; // a deep hole 4 px across
    if (x >= 230 && y <= 20) return -400; // a deep basin off a reef; its corner pixel is real
    if (y === 250 && x < 128) return -14840; // missing
    return seabed(x, y);
  });
  const copy = data.slice();
  repairPixels(data, 256, 9, 0, 0, null);
  for (const [x, y] of [[30, 30], [60, 5], [60, 128], [60, 255], [90, 128], [60, 160], [61, 160], [60, 161], [100, 160]]) assert.ok(Math.abs(at(data, x, y) - seabed(x, y)) < 5, `${x},${y}: ${at(data, x, y)}`);
  for (const [x, y] of [[100, 100], [140, 140], [200, 200], [190, 200], [21, 201], [22, 203], [230, 20], [240, 10], [130, 255], [200, 255]]) assert.equal(at(data, x, y), terrarium(...copy.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 3)), `${x},${y} kept`);
  // Steep but sound ground is left alone.
  const slope = tile((x, y) => -20 - x * 30), slopeCopy = slope.slice();
  assert.equal(repairPixels(slope, 256, 8, 0, 0, null), 0);
  assert.deepEqual(slope, slopeCopy);
});

test('terrain repair: missing data is filled from zoom 4', () => {
  const data = tile((x, y) => (x === 50 && y === 50) || (y === 80 && x < 40) ? -14840 : 120);
  assert.ok(repairPixels(data, 256, 5, 0, 0, null) >= 41);
  assert.equal(at(data, 50, 50), 120); assert.equal(at(data, 10, 80), 120);
  assert.equal(repairPixels(tile((x, y) => x === 5 ? -14840 : 120), 256, 3, 0, 0, null), 0);
});
