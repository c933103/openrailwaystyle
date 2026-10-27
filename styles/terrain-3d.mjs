// A terrain mesh uses the same repaired DEM as hillshade and contours, but
// the provider has no seabed elevations beyond z10. Restore only genuine sea
// cells from the coarse, bathymetry-bearing DEM; never alter inland depressions.
// All elevations remain metres, regardless of the contour-label unit setting.
import {depthTile, oceanPolygons, maskOcean, encodePng} from './bathymetry.mjs?v=20261027-clean-history-3d-3';
import {encodeTerrarium} from './dem-repair.mjs?v=20261027-clean-history-3d-3';
import {sharedTerrainTiles, terrainAbort} from './terrain-requests.mjs?v=20261027-clean-history-3d-3';

// MapLibre renders its terrain DEM one zoom below the camera tile level.
// At globe/continent scales even mountains several kilometres high cover
// fewer than a few display pixels at true 1x elevation. A deliberate press of
// the 3D control therefore brings the *current centre* to a terrain-inspection
// scale, without inventing vertical exaggeration or moving to another place.
export const TERRAIN_3D_INSPECTION_ZOOM = 12.3;
export const TERRAIN_3D_VIEW_PITCH = 60;
export function terrain3DViewTarget({zoom, detail = 0, active = false}) {
  if (!Number.isFinite(zoom) || !Number.isInteger(detail) || detail < 0 || detail > 2) {
    throw new RangeError('Invalid 3D terrain view');
  }
  if (active) return {pitch: 0};
  const target = TERRAIN_3D_INSPECTION_ZOOM + detail;
  return {pitch: TERRAIN_3D_VIEW_PITCH, ...(zoom < target ? {zoom: target} : {})};
}

export const TERRAIN_3D_SOURCE = 'terrain3d';
export const TERRAIN_3D_MAXZOOM = 14;
export const TERRAIN_TILE_SIZE = 256;
const HEIGHT_MIN = -11500, HEIGHT_MAX = 9000;
const TERRAIN_3D_TIMEOUT_MS = 45_000;

export function terrain3DEnabled(relief, pitch) {
  return Boolean(relief) && Number.isFinite(pitch) && pitch > 0.25;
}

export function syncTerrain3D(map, relief) {
  // isStyleLoaded() is false while *any* visible tile is loading, including
  // ordinary rail and imagery tiles. The DEM source only has to be registered.
  if (!map?.getSource?.(TERRAIN_3D_SOURCE)) return;
  const desired = terrain3DEnabled(relief, map.getPitch()) ? TERRAIN_3D_SOURCE : null;
  const current = map.getTerrain()?.source || null;
  if (current === desired) return;
  map.setTerrain(desired ? {source: desired, exaggeration: 1} : null);
}

export function needsSeabedRecovery(fine, z) {
  if (z <= 10) return false;
  assertHeights(fine);
  // High-zoom Mapzen tiles encode the ocean as exactly zero, including
  // coastlines. If none are present, avoid requesting basemap/ocean masks.
  return fine.data.some(height => height === 0);
}

function assertHeights(tile) {
  if (tile?.width !== TERRAIN_TILE_SIZE || tile?.height !== TERRAIN_TILE_SIZE ||
      tile.data?.length !== TERRAIN_TILE_SIZE * TERRAIN_TILE_SIZE) {
    throw new Error('Invalid 3D elevation tile dimensions');
  }
}

export function oceanMask(vectorTile) {
  const polygons = oceanPolygons(vectorTile);
  if (!polygons.length) return null;
  const image = makeCanvas(), context = image.getContext('2d', {willReadFrequently: true});
  if (!context) throw new Error('Cannot render ocean elevation mask');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);
  // The same even-odd mask as bathymetry preserves islands and lakes and
  // unions overlapping sea polygons.
  maskOcean(context, polygons, TERRAIN_TILE_SIZE);
  return context.getImageData(0, 0, TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE).data;
}

function makeCanvas() {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);
  if (typeof document === 'undefined') throw new Error('No canvas for 3D elevation');
  const image = document.createElement('canvas');
  image.width = image.height = TERRAIN_TILE_SIZE;
  return image;
}

export function sampleSeabed(dem, tile, px, py) {
  assertHeights(dem);
  if (!tile || !Number.isInteger(tile.scale) || tile.scale < 1 ||
      !Number.isInteger(tile.ox) || !Number.isInteger(tile.oy) ||
      tile.ox < 0 || tile.oy < 0 || tile.ox >= tile.scale || tile.oy >= tile.scale) {
    throw new Error('Invalid seabed tile position');
  }
  const size = TERRAIN_TILE_SIZE;
  const clamp = v => Math.max(0, Math.min(size - 1, v));
  const sx = clamp((tile.ox + (px + 0.5) / size) / tile.scale * size - 0.5);
  const sy = clamp((tile.oy + (py + 0.5) / size) / tile.scale * size - 0.5);
  const x0 = Math.floor(sx), x1 = Math.min(size - 1, x0 + 1), fx = sx - x0;
  const y0 = Math.floor(sy), y1 = Math.min(size - 1, y0 + 1), fy = sy - y0;
  const data = dem.data;
  const a = data[y0 * size + x0], b = data[y0 * size + x1];
  const c = data[y1 * size + x0], d = data[y1 * size + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

export function composeTerrainHeights(fine, coarse = null, tile = null, mask = null) {
  assertHeights(fine);
  if (mask && (!coarse || !tile || mask.length !== TERRAIN_TILE_SIZE ** 2 * 4)) {
    throw new Error('Ocean mask lacks matching bathymetry');
  }
  const values = new Float32Array(fine.data.length);
  for (let i = 0; i < values.length; i++) {
    const inSea = mask && mask[i * 4 + 3] >= 128;
    const height = inSea ? sampleSeabed(coarse, tile, i % TERRAIN_TILE_SIZE, Math.floor(i / TERRAIN_TILE_SIZE))
      : fine.data[i];
    // A bogus or absent height must not be encoded as a plausible 0 m cell.
    if (!Number.isFinite(height) || height < HEIGHT_MIN || height > HEIGHT_MAX) {
      throw new Error('Invalid 3D elevation height');
    }
    values[i] = height;
  }
  return values;
}

export async function encodeTerrainPng(heights) {
  if (!heights || heights.length !== TERRAIN_TILE_SIZE ** 2) throw new Error('Invalid 3D elevation pixel count');
  const image = makeCanvas(), context = image.getContext('2d');
  if (!context) throw new Error('Cannot encode 3D elevation');
  const pixels = context.createImageData(TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    if (!Number.isFinite(h) || h < HEIGHT_MIN || h > HEIGHT_MAX) throw new Error('Invalid 3D elevation height');
    const rgb = encodeTerrarium(h), at = i * 4;
    pixels.data[at] = rgb[0]; pixels.data[at + 1] = rgb[1];
    pixels.data[at + 2] = rgb[2]; pixels.data[at + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return encodePng(image);
}

function paintWorker(create) {
  const worker = create(), pending = new Map();
  let sequence = 0, failed = false;
  const fail = error => {
    if (failed) return;
    failed = true; worker.terminate?.();
    const failure = Object.assign(new Error(error?.message || '3D terrain worker failed'), {workerFailed: true});
    for (const task of pending.values()) task.reject(failure);
    pending.clear();
  };
  worker.onmessage = ({data}) => {
    const task = pending.get(data?.id);
    if (!task) return;
    if (data.error) { fail(new Error(data.error)); return; }
    task.resolve(data.data);
  };
  worker.onerror = fail;
  worker.onmessageerror = fail;
  return {
    get failed() { return failed; },
    paint(message, signal) {
      if (failed) return Promise.reject(Object.assign(new Error('3D terrain worker failed'), {workerFailed: true}));
      if (signal.aborted) return Promise.reject(terrainAbort());
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const cleanup = () => { pending.delete(id); signal.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); reject(terrainAbort()); };
        pending.set(id, {
          resolve(value) {cleanup(); resolve(value);},
          reject(error) {cleanup(); reject(error);},
        });
        signal.addEventListener('abort', abort, {once: true});
        try { worker.postMessage({...message, id}); }
        catch (error) { cleanup(); reject(error); }
      });
    },
  };
}

// Each reader has independent cancellation. The shared output LRU is bounded,
// and DEM fetches continue to use the existing repaired, bounded DEM manager.
export function installTerrain3D(maplibre, dem, {waterTile, readTile, createWorker, keep = 32}) {
  let worker = null;
  if (createWorker && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try { worker = paintWorker(createWorker); } catch { worker = null; }
  }
  const load = sharedTerrainTiles(async (key, signal) => {
    const [z, x, y] = key.split('/').map(Number);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, {once: true});
    try {
      if (signal.aborted) throw terrainAbort();
      const fine = await dem.getDemTile(z, x, y, controller);
      if (signal.aborted) throw terrainAbort();
      let coarse = null, water = null, tile = null;
      if (needsSeabedRecovery(fine, z)) {
        const result = await waterTile(z, x, y, controller);
        if (signal.aborted) throw terrainAbort();
        // Do not import coarse ocean heights for inland areas such as the
        // Dead Sea, below-sea valleys, lakes or DEM zero-height plains.
        if (result.data?.byteLength && oceanPolygons(readTile(result.data)).length) {
          tile = depthTile(z, x, y);
          coarse = await dem.getDemTile(tile.z, tile.x, tile.y, controller);
          water = result.data;
          if (signal.aborted) throw terrainAbort();
        }
      }
      const message = {
        fine: {width: fine.width, height: fine.height, data: Float32Array.from(fine.data)},
        coarse: coarse ? {width: coarse.width, height: coarse.height, data: Float32Array.from(coarse.data)} : null,
        tile, water,
      };
      if (worker && !worker.failed) {
        try { return await worker.paint(message, signal); }
        catch (error) { if (!error?.workerFailed) throw error; }
      }
      const mask = water ? oceanMask(readTile(water)) : null;
      return encodeTerrainPng(composeTerrainHeights(message.fine, message.coarse, tile, mask));
    } finally {
      signal.removeEventListener('abort', abort);
      controller.abort();
    }
  }, {keep, timeoutMs: TERRAIN_3D_TIMEOUT_MS});

  maplibre.addProtocol('atlas-terrain', async ({url}, controller) => {
    const match = /^atlas-terrain:\/\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
    if (!match) throw new Error('Invalid 3D elevation tile address');
    const [z, x, y] = match.slice(1).map(Number);
    if (z > TERRAIN_3D_MAXZOOM || x >= 2 ** z || y >= 2 ** z) {
      throw new Error('3D elevation tile outside source bounds');
    }
    const data = await load(`${z}/${x}/${y}`, controller.signal);
    controller.signal.throwIfAborted();
    return {data: data.slice(0)};
  });
}
