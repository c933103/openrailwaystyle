// Repairs the terrain tiles' bad pixels. Mapzen Terrarium tiles hold
// scattered pixels far below the ground around them, mostly at zooms 13 to
// 15: −100 m to −22 000 m beside land a few metres high (for example east
// of Sha Tin and around Nangan and Beigan in Matsu), drawn as deep pits in
// the relief and as rings of contours. Each tile is checked against the
// tile two zooms up (four times coarser), which seldom has the same fault:
// - a height below −11 500 m (deeper than any ocean) is missing data;
// - a pixel more than drop(z) metres below all of the coarser tile's four
//   pixels around it is bad: no real gully that deep is narrower than a
//   pixel of the coarser tile (60 m from zoom 14, more at coarser zooms,
//   where a coarser pixel spans wider valleys);
// - a pixel more than drop(z) below both pixels beside it on a line
//   through it is bad (a pit or groove narrower than a pixel);
// - a pixel more than WALL metres below the ground on both sides of it, a
//   few hundred metres away across or along, is bad: no real gorge is that
//   deep and that narrow. This finds faults the coarser tile shares, such as
//   the band along 120° E through the Taiwan Strait (about 140 m wide, down
//   to −14 840 m, at every zoom from 9).
// A bad pixel takes the coarser tile's height there or, where that is
// missing or shares the fault, the average of its sound neighbours.
//
// At every zoom contours are drawn from (REPAIR_FROM), missing data is
// filled, and a single pixel that would draw a storm of contour rings is
// repaired: a pit (below all eight pixels round it) or a groove one pixel
// wide (below the six pixels beside it) that lies RINGS or more contour lines
// below ground that is nearly level round it (the pixels round it differ by
// at most half the pit's depth). Real holes are wider, or much shallower at
// one pixel's width: a blue hole or a mine pit one pixel across at a zoom
// draws a few rings, an atoll's lagoon spans many pixels. Pixels standing
// above all round them are left alone: a steep islet in deep water draws as
// many rings and is real.
// The tests against the coarser tile, and the narrower ones above, run from
// REFERENCE_FROM.
export const REPAIR_FROM = 4, REFERENCE_FROM = 9, LEVELS_UP = 2, MISSING = -11500, WALL = 1000, RINGS = 12;
export const drop = z => 60 * 2 ** Math.max(0, 14 - z);
// How far to each side the WALL test looks, in pixels: about 190 m at the
// equator, wider than the 120° E band.
const reach = z => Math.max(2, Math.round(10 * 2 ** (z - 13)));

// How many contour lines lie between heights low and high in a terrain
// tile of zoom z, in whichever units draw more of them (map-model.mjs):
// land contours from zoom 7; seabed contours from tiles one zoom coarser
// (only above -200 m for tiles up to zoom 7), none beyond tile zoom 10.
// Metric intervals in metres, imperial ones in feet.
const FOOT = 0.3048;
const INTERVALS = [
  {land: z => z >= 15 ? 10 : z >= 13 ? 20 : z >= 11 ? 50 : z >= 9 ? 100 : z >= 7 ? 200 : 0, sea: z => z >= 10 ? 10 : z >= 8 ? 20 : 50},
  {land: z => FOOT * (z >= 15 ? 25 : z >= 13 ? 50 : z >= 11 ? 100 : z >= 9 ? 250 : z >= 7 ? 500 : 0), sea: z => FOOT * (z >= 10 ? 25 : z >= 8 ? 50 : 150)},
];
const between = (interval, from, to) => interval && to > from ? Math.floor(to / interval) - Math.floor(from / interval) : 0;
// A counter for one zoom: (low, high) => lines between them.
const ringCounter = z => {
  const seabed = z >= 4 && z <= 10, units = INTERVALS.map(({land, sea}) => [land(z), seabed ? sea(z) : 0]);
  return (low, high) => {
    const top = Math.min(high, 0) - 1e-9, bottom = z < 8 ? Math.max(low, -200) : low, ground = Math.max(low, 0);
    let most = 0;
    for (const [land, sea] of units) most = Math.max(most, between(land, ground, high) + between(sea, bottom, top));
    return most;
  };
};
export const contourRings = (z, low, high) => ringCounter(z)(low, high);

export const terrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;
// Height to Terrarium colour, to the format's 1/256 m.
export function encodeTerrarium(height) {
  const v = Math.max(0, Math.min(65535.996, height + 32768)), whole = Math.floor(v);
  return [whole >> 8, whole & 255, Math.floor((v - whole) * 256)];
}

// The coarser tile holding tile z/x/y, and where the tile lies in it: tile
// pixel (px, py) of a 256-pixel tile is at reference pixel ((ox + px) / k,
// (oy + py) / k).
export function referenceTile(z, x, y) {
  const up = Math.min(LEVELS_UP, z), k = 2 ** up;
  return {z: z - up, x: Math.floor(x / k), y: Math.floor(y / k), k, ox: (x % k) * 256, oy: (y % k) * 256};
}

const heightsOf = (data, size) => {
  const h = new Float64Array(size * size);
  for (let i = 0; i < h.length; i++) { const v = terrarium(data[4 * i], data[4 * i + 1], data[4 * i + 2]); h[i] = v < MISSING ? NaN : v; }
  return h;
};

// Repairs RGBA pixels (`size` across) of tile z/x/y in place, against the
// RGBA pixels of its reference tile (`refSize` across; may be null, which
// leaves only missing data to fill). Returns the number of pixels replaced.
export function repairPixels(data, size, z, x, y, ref, refSize = 256) {
  if (z < REPAIR_FROM) return 0;
  const h = heightsOf(data, size), r = ref ? heightsOf(ref, refSize) : null;
  const {k, ox, oy} = referenceTile(z, x, y), scale = 256 / size;
  const clamp = v => Math.max(0, Math.min(refSize - 1, v));
  const bad = new Uint8Array(size * size), out = Float64Array.from(h), limit = drop(z), w = Math.max(1, Math.round(reach(z) / scale));
  const sound = (qx, qy) => qx >= 0 && qy >= 0 && qx < size && qy < size && !bad[qy * size + qx] ? h[qy * size + qx] : NaN;
  // How far below the sound ground w pixels to both sides (across or
  // along) a height lies; one side will do where the other is off the tile
  // or bad, if `oneSide`.
  const depth = (px, py, value, oneSide = false) => Math.max(...[[w, 0], [0, w]].map(([dx, dy]) => {
    const sides = [sound(px - dx, py - dy), sound(px + dx, py + dy)].filter(v => !Number.isNaN(v));
    return sides.length === 2 || (oneSide && sides.length) ? Math.min(...sides) - value : -Infinity;
  }));
  // Below both next pixels on a line through it (across, along or
  // diagonal) by more than the limit: a pit or groove narrower than a pixel.
  const spike = (px, py, value) => [[1, 0], [0, 1], [1, 1], [1, -1]].some(([dx, dy]) => value < Math.min(sound(px - dx, py - dy), sound(px + dx, py + dy)) - limit);
  const queue = [];
  const mark = (i, value) => { bad[i] = 1; out[i] = value; queue.push(i); };
  const referenced = z >= REFERENCE_FROM;
  // A single pixel far below level ground round it, in contour lines.
  const on = (qx, qy) => qx >= 0 && qy >= 0 && qx < size && qy < size;
  // The ring of eight pixels round a pixel, clockwise from the north-west;
  // ring[k] and ring[k + 4] face each other.
  const RING = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]], QUICK = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const rings = ringCounter(z);
  // The ground straight across a pixel in direction (dx, dy): the two
  // pixels either side, or null where either is off the tile, missing or
  // bad. Along a tile's edge nothing is judged: from one tile, a fault
  // there looks just like a coast or shelf edge running along the edge.
  const across = (px, py, dx, dy) => {
    const ground = [sound(px - dx, py - dy), sound(px + dx, py + dy)];
    return ground.some(v => Number.isNaN(v)) ? null : ground;
  };
  // later: a pixel continuing a fault already set aside (one along it is
  // bad) need only lie below the ground straight across it.
  const storm = (px, py, value, later = false) => {
    const sunk = (low, high) => value < low && high - low <= (low - value) / 2 && rings(value, low) >= RINGS;
    // Quick rejection: a pit or groove lies RINGS lines below the ground
    // straight across it in some direction.
    if (!QUICK.some(([dx, dy]) => {
      const ground = Math.min(sound(px - dx, py - dy), sound(px + dx, py + dy));
      return value < ground && rings(value, ground) >= RINGS;
    })) return false;
    const ring = RING.map(([dx, dy]) => sound(px + dx, py + dy));
    if (!ring.some(v => Number.isNaN(v)) && sunk(Math.min(...ring), Math.max(...ring))) return true;
    // A groove: below the pixels beside it (those of them on the tile and
    // sound, with the ground straight across it), which are level, while
    // the two along it (ring[k] and ring[k + 4]) may share the fault. Not
    // the corner of a deep basin, whose pixel has deep neighbours beside it.
    return [0, 1, 2, 3].some(k => {
      const ground = across(px, py, ...RING[k + 2]);
      if (!ground) return false;
      const continues = later && [k, k + 4].some(j => on(px + RING[j][0], py + RING[j][1]) && bad[(py + RING[j][1]) * size + px + RING[j][0]]);
      const side = continues ? ground : [...ring.filter((v, j) => j % 4 !== k && !Number.isNaN(v)), ...ground];
      return sunk(Math.min(...side), Math.max(...side));
    });
  };
  // Missing data and faults the coarser tile shares: filled from the
  // neighbours.
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const i = py * size + px;
    if (Number.isNaN(h[i]) || (referenced && (depth(px, py, h[i]) > WALL || spike(px, py, h[i])))) mark(i, NaN);
  }
  // Contour storms, all judged before any is marked.
  const storms = [];
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const i = py * size + px;
    if (!bad[i] && storm(px, py, h[i])) storms.push(i);
  }
  for (const i of storms) mark(i, NaN);
  // Then round them, until none is left: where two such faults cross, the
  // pixels where they meet stand out once the rest is set aside.
  for (let marked = storms; marked.length;) {
    const next = new Set();
    for (const i of marked) {
      const px = i % size, py = (i - px) / size;
      for (const [dx, dy] of RING) if (on(px + dx, py + dy) && !bad[(py + dy) * size + px + dx]) next.add((py + dy) * size + px + dx);
    }
    marked = [...next].filter(i => storm(i % size, Math.floor(i / size), h[i], true));
    for (const i of marked) mark(i, NaN);
  }
  // Pits below the coarser tile: its height there, unless that shares the
  // fault.
  if (r && referenced) for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const i = py * size + px, value = h[i];
    if (bad[i]) continue;
    // The coarser tile's pixel centres around this pixel's centre.
    const rx = clamp((ox + (px + 0.5) * scale) / k * refSize / 256 - 0.5), ry = clamp((oy + (py + 0.5) * scale) / k * refSize / 256 - 0.5);
    const x0 = Math.floor(rx), y0 = Math.floor(ry), x1 = Math.min(refSize - 1, x0 + 1), y1 = Math.min(refSize - 1, y0 + 1), fx = rx - x0, fy = ry - y0;
    const corners = [[r[y0 * refSize + x0], (1 - fx) * (1 - fy)], [r[y0 * refSize + x1], fx * (1 - fy)], [r[y1 * refSize + x0], (1 - fx) * fy], [r[y1 * refSize + x1], fx * fy]].filter(([v]) => !Number.isNaN(v));
    if (!corners.length || value >= Math.min(...corners.map(([v]) => v)) - limit) continue;
    const weight = corners.reduce((sum, [, f]) => sum + f, 0), replacement = weight > 0 ? corners.reduce((sum, [v, f]) => sum + v * f, 0) / weight : corners[0][0];
    mark(i, depth(px, py, replacement, true) > limit ? NaN : replacement);
  }
  // A fault's edges, shallower than the tests above: low pixels next to a
  // bad one join it.
  while (queue.length) {
    const i = queue.pop(), px = i % size, py = (i - px) / size;
    for (const [qx, qy] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
      if (qx < 0 || qy < 0 || qx >= size || qy >= size) continue;
      const j = qy * size + qx;
      if (!bad[j] && depth(qx, qy, h[j], true) > limit) mark(j, NaN);
    }
  }
  // Where the coarser tile has nothing either: the sound neighbours' mean,
  // spreading inwards.
  for (let pass = 0, left = true; left && pass < size; pass++) {
    left = false;
    const filled = [];
    for (let i = 0; i < out.length; i++) {
      if (!Number.isNaN(out[i])) continue;
      const px = i % size, py = (i - px) / size;
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const qx = px + dx, qy = py + dy;
        if ((dx || dy) && qx >= 0 && qy >= 0 && qx < size && qy < size && !Number.isNaN(out[qy * size + qx])) { sum += out[qy * size + qx]; count++; }
      }
      if (count) filled.push([i, sum / count]); else left = true;
    }
    for (const [i, v] of filled) out[i] = v;
    if (!filled.length) break;
  }
  let changed = 0;
  for (let i = 0; i < out.length; i++) if (bad[i] && !Number.isNaN(out[i])) {
    [data[4 * i], data[4 * i + 1], data[4 * i + 2]] = encodeTerrarium(out[i]);
    changed++;
  }
  return changed;
}
