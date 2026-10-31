// Heights for the measure tool and elevation profiles, read from the terrain
// tiles the relief shading already uses (Mapzen Terrarium PNGs: height =
// R × 256 + G + B / 256 − 32768 metres, seabed included). Zoom-14 tiles
// (about 9.5 m a pixel at the equator) are finer than most of the source data.
// Their bad pixels are repaired as for the map (dem-repair.mjs), the finer
// zoom included.
import {REFERENCE_FROM, REPAIR_FROM, referenceTile, repairPixels, witnessTiles, repairFromWitness} from './dem-repair.mjs?v=20261101-measure-surface-1';
import {TERRAIN_TIMEOUT_MS, REPAIR_TIMEOUT_MS, terrainAbort, terrainTask, sharedTerrainTiles, terrainBlob, decodeTerrain} from './terrain-requests.mjs?v=20261101-measure-surface-1';
import {DEPTH_ZOOM, WATER_ZOOM, oceanPolygons} from './bathymetry.mjs?v=20261101-measure-surface-1';
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

// Work in tile pixels, rather than world degrees. Per-feature even-odd
// winding keeps islands as holes; testing each feature separately makes
// overlapping ocean polygons a UNION instead of cancelling each other.
// A point within one pixel of a genuine shoreline is indeterminate: do not
// silently choose an overlapping, coarse seabed/land elevation there.
// Clipped edges of the vector tile are not shorelines.
export function oceanAt(polygons, px, py, margin = 1) {
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  let boundary = false, insideAny = false;
  for (const polygon of polygons) {
    const scale = TILE / polygon.extent;
    if (!Number.isFinite(scale) || scale <= 0) return null;
    let inside = false, ambiguous = false;
    for (const ring of polygon.rings) {
      let inRing = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j], b = ring[i];
        const ax = a.x * scale, ay = a.y * scale, bx = b.x * scale, by = b.y * scale;
        if (![ax, ay, bx, by].every(Number.isFinite)) return null;
        const dx = bx - ax, dy = by - ay;
        const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
        const clippedEdge = (ax === 0 && bx === 0) || (ay === 0 && by === 0) ||
          (ax === TILE && bx === TILE) || (ay === TILE && by === TILE);
        if (!clippedEdge && Math.hypot(px - ax - t * dx, py - ay - t * dy) <= margin) ambiguous = true;
        if ((ay > py) !== (by > py) && px < (bx - ax) * (py - ay) / (by - ay) + ax) inRing = !inRing;
      }
      if (inRing) inside = !inside;
    }
    if (ambiguous) boundary = true;
    else if (inside) insideAny = true;
  }
  return boundary ? null : insideAny;
}

// The fine Mapzen DEM loses bathymetry above z10. Classify genuine ocean
// using the same basemap ocean polygons as the 3D/depth renderer, then sample
// the repaired coarse DEM only there. Inland negative elevations (Dead Sea,
// etc.) remain fine land heights, and lakes are not mistaken for ocean.
// Missing/ambiguous coastlines or failed tiles yield null, never a fake 0 m.
// Water and DEM calls are shared per tile, bounded and cancellable.
export function createSurfaceElevation(url, {waterTile, readTile, load, zoom = ELEVATION_ZOOM,
  timeoutMs = TERRAIN_TIMEOUT_MS, repairTimeoutMs = REPAIR_TIMEOUT_MS} = {}) {
  if (typeof waterTile !== 'function' || typeof readTile !== 'function') throw new TypeError('A basemap water reader is required');
  const options = {zoom, timeoutMs, repairTimeoutMs, ...(load ? {load} : {})};
  const fine = createElevation(url, options);
  const seabed = zoom > DEPTH_ZOOM ? createElevation(url, {...options, zoom: DEPTH_ZOOM}) : fine;
  const water = sharedTerrainTiles(async (key, signal) => {
    const [z, x, y] = key.split('/').map(Number);
    const controller = new AbortController(), abort = () => controller.abort();
    signal.addEventListener('abort', abort, {once:true});
    try {
      if (signal.aborted) throw terrainAbort();
      const result = await waterTile(z, x, y, controller);
      if (signal.aborted) throw terrainAbort();
      if (!result?.data?.byteLength) return null; // unknown coverage, not land
      return oceanPolygons(readTile(result.data));
    } finally {
      signal.removeEventListener('abort', abort);
      controller.abort();
    }
  }, {keep: CACHE, timeoutMs});
  return {
    async heights(points, {signal} = {}) {
      if (!Array.isArray(points)) throw new TypeError('Elevation points must be an array');
      const valid = point => Array.isArray(point) && point.length >= 2 &&
        point.every(Number.isFinite) && Math.abs(point[1]) <= 85.05112878;
      const safe = points.filter(valid);
      const raw = await fine.heights(safe, {signal});
      let index = 0;
      return Promise.all(points.map(async point => {
        if (!valid(point)) return null;
        const high = raw[index++];
        if (!Number.isFinite(high) || high < -11500 || high > 9000) return null;
        const {x, y, px, py} = tilePixel(point[0], point[1], Math.min(zoom, WATER_ZOOM));
        try {
          const polygons = await water(`${Math.min(zoom, WATER_ZOOM)}/${x}/${y}`, signal);
          if (!polygons) return null;
          const ocean = oceanAt(polygons, px, py);
          if (ocean === null) return null;
          if (!ocean) return high;
          const [depth] = await seabed.heights([point], {signal});
          // The coarse cell can mix land and water near shore. Never report
          // a positive land height as a seabed elevation.
          return Number.isFinite(depth) && depth >= -11500 && depth <= 0 ? depth : null;
        } catch (error) {
          if (signal?.aborted) throw error;
          return null;
        }
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
