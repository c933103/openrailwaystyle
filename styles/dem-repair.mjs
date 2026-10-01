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
export const REPAIR_FROM = 9, LEVELS_UP = 2, MISSING = -11500, WALL = 1000;
export const drop = z => 60 * 2 ** Math.max(0, 14 - z);
// How far to each side the WALL test looks, in pixels: about 190 m at the
// equator, wider than the 120° E band.
const reach = z => Math.max(2, Math.round(10 * 2 ** (z - 13)));

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
  // Missing data and faults the coarser tile shares: filled from the
  // neighbours.
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const i = py * size + px;
    if (Number.isNaN(h[i]) || depth(px, py, h[i]) > WALL || spike(px, py, h[i])) mark(i, NaN);
  }
  // Pits below the coarser tile: its height there, unless that shares the
  // fault.
  if (r) for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
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
