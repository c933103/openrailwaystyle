// Worker terrain transport kept separate from its actor, so the exact loader
// can be exercised with controlled fetch/decode implementations.
import {REFERENCE_FROM, REPAIR_FROM, referenceTile, repairPixels, witnessTiles, repairFromWitness} from './dem-repair.mjs';
import {TERRAIN_TIMEOUT_MS, REPAIR_TIMEOUT_MS, terrainAbort, terrainTask, sharedTerrainTiles, terrainBlob, decodeTerrain} from './terrain-requests.mjs';
const TILE = /\/(\d+)\/(\d+)\/(\d+)\.png(?=\?|$)/;
export function createDemTileLoader({fetcher = fetch, decode = decodeTerrain,
  timeoutMs = TERRAIN_TIMEOUT_MS, repairTimeoutMs = REPAIR_TIMEOUT_MS} = {}) {
  const references = sharedTerrainTiles(async (url, signal) => {
    const {blob} = await terrainBlob(url, signal, fetcher);
    return (await decode(blob, signal)).pixels;
  }, {keep: 32, timeoutMs: repairTimeoutMs});
  const reference = (url, signal) => references(url, signal).catch(() => {
    if (signal.aborted) throw terrainAbort();
    return null;
  });
  return async (url, abortController) => {
    const signal = abortController.signal;
    const {blob, response} = await terrainTask(child => terrainBlob(url, child, fetcher), {signal, timeoutMs});
    const tile = {data: blob, expires: response.headers.get('expires') || undefined, cacheControl: response.headers.get('cache-control') || undefined};
    const match = url.match(TILE), [z, x, y] = match ? match.slice(1).map(Number) : [];
    if (!match || z < REPAIR_FROM || typeof OffscreenCanvas === 'undefined') return tile;
    try {
      return await terrainTask(async repairSignal => {
        const coarser = referenceTile(z, x, y);
        const [{canvas, context, pixels}, ref] = await Promise.all([decode(blob, repairSignal), z >= REFERENCE_FROM ? reference(url.replace(TILE, `/${coarser.z}/${coarser.x}/${coarser.y}.png`), repairSignal) : null]);
        let changed = repairPixels(pixels.data, pixels.width, z, x, y, ref?.data, ref?.width);
        const witness = witnessTiles(pixels.data, pixels.width, z, x, y);
        if (witness.tiles.length) {
          const found = new Map(await Promise.all(witness.tiles.map(async ([tx, ty]) => [`${tx}/${ty}`, await reference(url.replace(TILE, `/${witness.z}/${tx}/${ty}.png`), repairSignal)])));
          changed += repairFromWitness(pixels.data, pixels.width, z, x, y, (tx, ty) => { const p = found.get(`${tx}/${ty}`); return p?.width === pixels.width ? p.data : null; });
        }
        if (!changed) return tile;
        context.putImageData(pixels, 0, 0);
        return {...tile, data: await canvas.convertToBlob({type: 'image/png'})};
      }, {signal, timeoutMs: repairTimeoutMs});
    } catch {
      // Optional repair failure must not discard usable fine bytes. A caller
      // cancellation (including DemSource's existing overall timeout) still wins.
      if (signal.aborted) throw terrainAbort();
      return tile;
    }
  };
}
