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

test('terrain repair: contour lines are counted in whichever units and family draw more', () => {
  assert.equal(contourRings(9, -400, -20), 25); // 50 ft seabed lines (18 at 20 m)
  assert.equal(contourRings(9, -250, -20), 15); // 11 at 20 m: an imperial storm
  assert.equal(contourRings(7, -400, -20), 4); // 150 ft above -200 m (2 land lines at 500 ft)
  assert.equal(contourRings(11, -400, -20), 0); // no seabed lines
  assert.equal(contourRings(13, 0, 250), 16); // 50 ft land lines (12 at 20 m)
  assert.equal(contourRings(9, -100, 150), 6); // 50 ft below the sea; the land lines (1) draw at another zoom
  assert.equal(contourRings(7, -2500, -20), 16); // land lines below sea level too at zoom 7 (500 ft)
  assert.equal(contourRings(8, -170, -10), 11); // 50 ft seabed lines, not added to the land line among them
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

test('terrain repair: faults a few pixels across go; islets, cliffs, coasts and plains stay', () => {
  // The tile two zooms up, which tile 0/0 fills a quarter of.
  const coarse = height => tile((x, y) => height(4 * x, 4 * y));
  // East of Sha Tin at zoom 12: spikes beside pits on river flats, and a
  // pit below the sea two pixels wide (zoom 11's), all in level land; the
  // coarser tile has nothing standing up there.
  const flats = (x, y) => 5 + x * 0.01;
  const fault = {'72,157': 1820, '73,157': -508, '72,158': 2436, '73,158': -655, '72,159': 1260, '73,159': -335, '40,40': -353, '40,41': -261};
  const shaTin = tile((x, y) => fault[`${x},${y}`] ?? flats(x, y));
  repairPixels(shaTin, 256, 12, 0, 0, coarse(flats));
  for (const key of Object.keys(fault)) { const [x, y] = key.split(',').map(Number); assert.ok(Math.abs(at(shaTin, x, y) - flats(x, y)) < 60, `${key}: ${at(shaTin, x, y)}`); }
  // An islet in the sea, and a sea stack beside a fault pit: the coarser
  // tile holds them (lower, as a coarser pixel averages them with the sea).
  const sea = (x, y) => -30;
  const islet = (x, y) => Math.max(0, 500 - 120 * Math.hypot(x - 150, y - 150));
  const stacks = tile((x, y) => x === 200 && y === 100 ? 700 : x === 201 && y === 100 ? -1200 : Math.hypot(x - 150, y - 150) < 4.2 ? islet(x, y) : sea(x, y));
  const coarser = tile((x, y) => (Math.abs(x - 37) <= 1 && Math.abs(y - 37) <= 1) || (Math.abs(x - 50) <= 1 && Math.abs(y - 25) <= 1) ? 420 : -30);
  const before = stacks.slice();
  repairPixels(stacks, 256, 12, 0, 0, coarser);
  for (const [x, y] of [[150, 150], [151, 150], [150, 152], [200, 100]]) assert.equal(at(stacks, x, y), terrarium(...before.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 3)), `${x},${y} kept`);
  assert.ok(at(stacks, 201, 100) > -100, `pit beside the stack: ${at(stacks, 201, 100)}`); // from the coarser tile
  // A coast with a fault on the shore, and a stream bed below the sea in
  // land: the sea and the stream stay.
  const coast = (x, y) => x < 100 ? 150 : -20;
  const shore = tile((x, y) => x === 98 && y === 50 ? 471 : x === 99 && y === 50 ? -79 : x === 60 && y === 120 ? -1.5 : coast(x, y));
  repairPixels(shore, 256, 12, 0, 0, coarse(coast));
  for (const [x, y] of [[100, 50], [101, 49], [100, 52], [102, 50]]) assert.equal(at(shore, x, y), -20, `sea at ${x},${y}`);
  assert.equal(at(shore, 95, 50), 150); assert.equal(at(shore, 60, 120), -1.5);
  assert.ok(Math.abs(at(shore, 98, 50) - 150) < 60, `spike on the shore: ${at(shore, 98, 50)}`);
  // A patch of a fault at one wrong height round a missing pixel (zoom 14,
  // no coarser tile to tell): it goes whole.
  const patch = tile((x, y) => x === 60 && y === 60 ? -14840 : Math.abs(x - 60) <= 2 && Math.abs(y - 60) <= 2 ? 100 : 200);
  repairPixels(patch, 256, 14, 0, 0, null);
  for (const [x, y] of [[58, 58], [60, 59], [62, 62], [60, 60]]) assert.ok(at(patch, x, y) > 150, `patch at ${x},${y}: ${at(patch, x, y)}`);
  // A real narrow summit in both tiles, with a fault a few pixels wide in
  // this one: the coarser tile still repairs it.
  const summit = (x, y) => Math.max(300, 1500 - 150 * Math.hypot(x - 100, y - 100));
  const peak = tile((x, y) => Math.abs(x - 100) <= 2 && Math.abs(y - 100) <= 2 ? 300 : summit(x, y));
  repairPixels(peak, 256, 14, 0, 0, tile((x, y) => Math.hypot(x - 24.5, y - 24.5) <= 1.2 ? 1450 : 300));
  for (const [x, y] of [[100, 100], [101, 99]]) assert.ok(at(peak, x, y) > 1000, `summit at ${x},${y}: ${at(peak, x, y)}`);
  // The same with a fault wider than 16 pixels over the summit's top:
  // no sound summit pixel lies within eight, but the ground still rises.
  const wide = (x, y) => Math.max(300, 1500 - 40 * Math.hypot(x - 100, y - 100));
  const flat = tile((x, y) => Math.abs(x - 100) <= 10 && Math.abs(y - 100) <= 10 ? 300 : wide(x, y));
  repairPixels(flat, 256, 14, 0, 0, tile((x, y) => wide(4 * x + 1.5, 4 * y + 1.5)));
  assert.ok(at(flat, 100, 100) > 1000, `wide fault on the summit: ${at(flat, 100, 100)}`);
  // An ordinary dip beside a spike cluster is not part of the fault.
  const dip = tile((x, y) => x === 120 && y === 120 ? 600 : x === 120 && y === 121 ? 1000 : x === 119 && y === 121 ? 90 : 100);
  repairPixels(dip, 256, 12, 0, 0, coarse(() => 100));
  assert.ok(at(dip, 120, 121) < 200, `spike: ${at(dip, 120, 121)}`);
  assert.equal(at(dip, 119, 121), 90, 'the dip stays');
  // A low bay under cliffs whose top holds a fault (Kalaupapa, zoom 14):
  // the fault goes, the low ground keeps its height.
  const cliff = (x, y) => y >= 100 && x >= 30 && x < 60 ? 5 : 390;
  const plain = tile((x, y) => y === 99 && x >= 30 && x < 40 ? -9351 : cliff(x, y));
  repairPixels(plain, 256, 14, 0, 0, coarse(cliff));
  for (const x of [30, 35, 39]) assert.ok(at(plain, x, 99) > 0, `fault at ${x}: ${at(plain, x, 99)}`);
  let raised = 0;
  for (let y = 100; y < 256; y++) for (let x = 30; x < 60; x++) if (at(plain, x, y) > 50) raised++;
  assert.ok(raised <= 2, `${raised} pixels of the bay raised`);
  // A real hollow inside a rim, with a spike pair on the rim, both in the
  // coarser tile: the spikes go, the hollow keeps its depth.
  const rimmed = (x, y) => { const d = Math.max(Math.abs(x - 150), Math.abs(y - 150)); return d <= 2 ? 100 : d === 3 ? 150 : 200; };
  const hollow = tile((x, y) => x === 153 && y === 150 ? 600 : x === 154 && y === 150 ? 1000 : rimmed(x, y));
  repairPixels(hollow, 256, 14, 0, 0, coarse(rimmed));
  assert.ok(at(hollow, 154, 150) < 300, `spike: ${at(hollow, 154, 150)}`);
  for (const [x, y] of [[150, 150], [152, 150], [148, 152]]) assert.equal(at(hollow, x, y), 100, `hollow at ${x},${y}`);
  // A real bowl below the sea in low land (a quarry), which the coarser tile
  // holds too: it keeps its depth.
  const quarry = (x, y) => x === 200 && y === 200 ? -50 : Math.abs(x - 200) <= 2 && Math.abs(y - 200) <= 2 ? -40 : 10;
  const bowl = tile(quarry);
  repairPixels(bowl, 256, 14, 0, 0, coarse(quarry));
  for (const [x, y] of [[200, 200], [202, 200], [198, 202]]) assert.equal(at(bowl, x, y), quarry(x, y), `quarry at ${x},${y}`);
  // Sound river flats at zoom 13 under a coarser tile holding the zoom 11
  // fault east of Sha Tin: the flats keep their height.
  const river = tile((x, y) => 11), towerTile = tile((x, y) => x >= 25 && x < 27 && y >= 25 && y < 27 ? [1442, 1058][(x + y) % 2] : 11);
  repairPixels(river, 256, 13, 0, 0, towerTile);
  for (const [x, y] of [[100, 100], [102, 104], [106, 106]]) assert.equal(at(river, x, y), 11, `river at ${x},${y}: ${at(river, x, y)}`);
});
