// Bound the complete asynchronous operation, not just response headers. Some
// loaders/decoders ignore abort, so cancellation must also settle our promise.
export const TERRAIN_TIMEOUT_MS = 20_000;
export const REPAIR_TIMEOUT_MS = 5_000;
export const terrainAbort = () => new DOMException('Terrain request cancelled', 'AbortError');
export function terrainTask(load, {signal, timeoutMs = TERRAIN_TIMEOUT_MS} = {}) {
  if (signal?.aborted) return Promise.reject(terrainAbort());
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false, timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (error) { reject(error); controller.abort(); } else resolve(value);
    };
    const cancel = () => finish(terrainAbort());
    signal?.addEventListener('abort', cancel, {once: true});
    if (timeoutMs > 0) timer = setTimeout(() => finish(new Error('Terrain request timed out')), timeoutMs);
    Promise.resolve().then(() => {
      if (controller.signal.aborted) throw terrainAbort();
      return load(controller.signal);
    }).then(value => finish(null, value), error => finish(error));
  });
}

// Pending work is independent of the completed LRU. Each caller owns its wait;
// only the final departing caller aborts the shared transport. Stale settlement
// may neither populate the cache nor delete a newer attempt for the same key.
export function sharedTerrainTiles(load, {keep = 64, timeoutMs = TERRAIN_TIMEOUT_MS} = {}) {
  const pending = new Map(), completed = new Map();
  return (key, signal) => {
    if (signal?.aborted) return Promise.reject(terrainAbort());
    if (completed.has(key)) {
      const value = completed.get(key); completed.delete(key); completed.set(key, value);
      return Promise.resolve(value);
    }
    let entry = pending.get(key);
    if (!entry) {
      entry = {controller: new AbortController(), users: 0, finished: false};
      pending.set(key, entry);
      entry.promise = terrainTask(child => load(key, child), {signal: entry.controller.signal, timeoutMs}).then(value => {
        if (value && !entry.controller.signal.aborted && pending.get(key) === entry) {
          completed.set(key, value);
          while (completed.size > keep) completed.delete(completed.keys().next().value);
        }
        return value;
      }).finally(() => {
        entry.finished = true;
        if (pending.get(key) === entry) pending.delete(key);
      });
    }
    entry.users++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true; signal?.removeEventListener('abort', cancel);
        if (--entry.users === 0 && !entry.finished) {
          if (pending.get(key) === entry) pending.delete(key);
          entry.controller.abort();
        }
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => finish(terrainAbort());
      signal?.addEventListener('abort', cancel, {once: true});
      entry.promise.then(value => finish(null, value), error => finish(error));
    });
  };
}

export async function terrainBlob(url, signal, fetcher = fetch) {
  const response = await fetcher(url, {signal});
  if (signal.aborted || !response.ok) {
    // A transport that completes after cancellation can still hand us a body.
    // Release it without waiting for a potentially stalled cancel operation.
    Promise.resolve(response.body?.cancel()).catch(() => {});
    if (signal.aborted) throw terrainAbort();
    throw new Error(`Terrain tile returned ${response.status}`);
  }
  const blob = await response.blob();
  if (signal.aborted) throw terrainAbort();
  return {blob, response};
}

export async function decodeTerrain(blob, signal) {
  const image = await createImageBitmap(blob, {colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
  try {
    if (signal.aborted) throw terrainAbort();
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d', {willReadFrequently: true});
    context.drawImage(image, 0, 0);
    return {canvas, context, pixels: context.getImageData(0, 0, image.width, image.height)};
  } finally { image.close?.(); }
}
