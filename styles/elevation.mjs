// Heights for the measure tool and elevation profiles, read from the terrain
// tiles the relief shading already uses (Mapzen Terrarium PNGs: height =
// R × 256 + G + B / 256 − 32768 metres, seabed included). Zoom-14 tiles
// (about 9.5 m a pixel at the equator) are finer than most of the source data.
// Their bad pixels are repaired as for the map (dem-repair.mjs), the finer
// zoom included.
import {REFERENCE_FROM, REPAIR_FROM, referenceTile, repairPixels, witnessTiles, repairFromWitness} from './dem-repair.mjs?v=20261030-view-colours-1';
import {TERRAIN_TIMEOUT_MS, REPAIR_TIMEOUT_MS, terrainAbort, terrainTask, sharedTerrainTiles, terrainBlob, decodeTerrain} from './terrain-requests.mjs?v=20261030-view-colours-1';
export const ELEVATION_ZOOM = 14;
const TILE = 256, CACHE = 64;

export const terrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

// The tile holding a place and the place's pixel position in it.
export function tilePixel(lng, lat, z = ELEVATION_ZOOM) {
  const n = 2 ** z, clamped = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  const fx = ((lng + 180) / 360 % 1 + 1) % 1 * n, fy = (1 - Math.asinh(Math.tan(clamped)) / Math.PI) / 2 * n;
  const x = Math.min(n - 1, Math.floor(fx)), y = Math.min(n - 1, Math.floor(fy));
  return {x, y, px: (fx - x) * TILE, py: (fy - y) * TILE};
}

// The height at a pixel position, interpolated between the four nearest
// pixel centres (data: RGBA rows of `size` pixels; kept within the tile).
export function sampleHeight(data, size, px, py) {
  const clamp = v => Math.max(0, Math.min(size - 1, v));
  const x = clamp(px - 0.5), y = clamp(py - 0.5), x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
  const h = (i, j) => { const o = (j * size + i) * 4; return terrarium(data[o], data[o + 1], data[o + 2]); };
  const fx = x - x0, fy = y - y0;
  return (h(x0, y0) * (1 - fx) + h(x1, y0) * fx) * (1 - fy) + (h(x0, y1) * (1 - fx) + h(x1, y1) * fx) * fy;
}

// Decode a PNG tile in the browser into RGBA pixels.
async function loadPixels(url, signal) {
  const {blob} = await terrainBlob(url, signal);
  const {pixels} = await decodeTerrain(blob, signal);
  return {data: pixels.data, size: pixels.width};
}

// heights(points, {signal}): metres or null for missing main tiles. Raw reads
// have a 20 s deadline including body/decode; optional repair gets 5 s total.
// On repair failure keep usable fine heights. There are no automatic retries:
// failed main tiles are uncached and a subsequent call can try again.
export function createElevation(url, {zoom = ELEVATION_ZOOM, load = loadPixels,
  timeoutMs = TERRAIN_TIMEOUT_MS, repairTimeoutMs = REPAIR_TIMEOUT_MS} = {}) {
  const raw = sharedTerrainTiles((key, signal) => {
    const [z, x, y] = key.split('/');
    return load(url.replace('{z}', z).replace('{x}', x).replace('{y}', y), signal);
  }, {keep: CACHE, timeoutMs});
  const fetchTile = (z, x, y, signal) => raw(`${z}/${x}/${y}`, signal).catch(error => {
    if (signal.aborted) throw terrainAbort();
    return null;
  });
  const tile = sharedTerrainTiles(async (key, signal) => {
    const [x, y] = key.split('/').map(Number), pixels = await fetchTile(zoom, x, y, signal);
    if (!pixels || zoom < REPAIR_FROM) return pixels;
    try {
      return await terrainTask(async repairSignal => {
        const coarser = referenceTile(zoom, x, y);
        const ref = zoom >= REFERENCE_FROM ? await fetchTile(coarser.z, coarser.x, coarser.y, repairSignal) : null;
        const data = Uint8ClampedArray.from(pixels.data);
        repairPixels(data, pixels.size, zoom, x, y, ref?.data, ref?.size);
        const witness = witnessTiles(data, pixels.size, zoom, x, y);
        if (witness.tiles.length) {
          const found = new Map(await Promise.all(witness.tiles.map(async ([tx, ty]) => [`${tx}/${ty}`, await fetchTile(witness.z, tx, ty, repairSignal)])));
          repairFromWitness(data, pixels.size, zoom, x, y, (tx, ty) => { const p = found.get(`${tx}/${ty}`); return p?.size === pixels.size ? p.data : null; });
        }
        return {data, size: pixels.size};
      }, {signal, timeoutMs: repairTimeoutMs});
    } catch {
      if (signal.aborted) throw terrainAbort();
      return pixels;
    }
  }, {keep: CACHE, timeoutMs: 0}); // Its two phases above own the deadlines.
  return {
    heights: (points, {signal} = {}) => {
      // One subscription per tile per call, even for many samples in that tile.
      const tiles = new Map();
      return Promise.all(points.map(async ([lng, lat]) => {
        const {x, y, px, py} = tilePixel(lng, lat, zoom), key = `${x}/${y}`;
        if (!tiles.has(key)) tiles.set(key, tile(key, signal));
        const pixels = await tiles.get(key);
        return pixels ? sampleHeight(pixels.data, pixels.size, px, py) : null;
      }));
    },
  };
}

// Points spread evenly along a line, with their distance from its start
// (km): [{at, point}], `count` intervals (the ends included).
export function alongLine(coordinates, count, lengthKm) {
  const pieces = coordinates.slice(1).map((p, i) => lengthKm([coordinates[i], p]));
  const total = pieces.reduce((a, b) => a + b, 0), out = [];
  for (let k = 0, i = 0, start = 0; k <= count; k++) {
    const at = total * k / count;
    while (i < pieces.length - 1 && at > start + pieces[i]) start += pieces[i++];
    const f = pieces[i] ? Math.min(1, (at - start) / pieces[i]) : 0, [a, b] = [coordinates[i], coordinates[i + 1] ?? coordinates[i]];
    // Longitude the short way round (across 180° where the line crosses it).
    let dLng = b[0] - a[0];
    if (dLng > 180) dLng -= 360; else if (dLng < -180) dLng += 360;
    let lng = a[0] + dLng * f;
    if (lng > 180) lng -= 360; else if (lng < -180) lng += 360;
    out.push({at, point: [lng, a[1] + (b[1] - a[1]) * f]});
  }
  return out;
}

// Contiguous observed stretches. Missing samples must remain gaps in both the
// chart and the summary; two valid endpoints do not establish the terrain
// between them when an intermediate tile could not be read.
export function profileSegments(profile) {
  const segments = [];
  let current;
  for (const sample of profile) {
    if (!Number.isFinite(sample.height)) { current = null; continue; }
    if (!current) { current = []; segments.push(current); }
    current.push(sample);
  }
  return segments;
}

// Summary of the observed stretches: lowest, highest, total ascent and
// descent, and the steepest gradient over a contiguous stretch of at least
// `over` km (shorter spans mostly show the terrain data's noise). A missing
// eligible stretch yields null, not an invented flat gradient.
export function profileStats(profile, over = 0.1) {
  const segments = profileSegments(profile), heights = segments.flat().map(p => p.height);
  if (!heights.length) return null;
  let ascent = null, descent = null, steepest = null;
  const total = profile.at(-1).at - profile[0].at, span = Math.min(over, total);
  for (const segment of segments) {
    for (let i = 1; i < segment.length; i++) {
      const rise = segment[i].height - segment[i - 1].height;
      ascent = (ascent ?? 0) + Math.max(0, rise);
      descent = (descent ?? 0) + Math.max(0, -rise);
    }
    for (let i = 0, j = 0; i < segment.length; i++) {
      while (j < segment.length && segment[j].at - segment[i].at < span - 1e-9) j++;
      if (j === segment.length) break;
      const [a, b] = [segment[i], segment[j]];
      if (b.at > a.at) steepest = Math.max(steepest ?? 0, Math.abs(b.height - a.height) / ((b.at - a.at) * 1000));
    }
  }
  return {min: Math.min(...heights), max: Math.max(...heights), ascent, descent, steepest, over: span};
}
