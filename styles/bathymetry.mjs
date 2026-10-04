// Colour sea elevations from the existing, repaired terrain cache. ETOPO1
// bathymetry disappears from the provider's finer tiles, so depth requests
// stop at zoom 10. Coastlines still use the basemap's detailed water polygons.
export const DEPTH_ZOOM = 10, WATER_ZOOM = 14;
export const DEPTH_COLOURS = [
  [0, '#d8efe3'], [20, '#a9ded8'], [200, '#91cad6'],
  [1000, '#80b7cf'], [3000, '#739fbe'], [6000, '#638cad'], [11500, '#56799f'],
];

// The basemap and its sea mask request the same archive tile concurrently.
// Share that request without retaining another raw-vector cache. Each reader
// gets its own bytes; cancelling one reader must not cancel the other.
export function shareArchiveRequests(load) {
  const pending = new Map();
  return (params, controller) => {
    if (params.type !== 'arrayBuffer') return load(params, controller);
    controller.signal.throwIfAborted();
    let entry = pending.get(params.url);
    if (!entry) {
      entry = {controller: new AbortController(), readers:0, done:false};
      pending.set(params.url, entry);
      entry.promise = Promise.resolve().then(() => load(params, entry.controller));
      const done = () => {entry.done = true; if (pending.get(params.url) === entry) pending.delete(params.url);};
      entry.promise.then(done, done);
    }
    entry.readers++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error, result) => {
        if (finished) return;
        finished = true; controller.signal.removeEventListener('abort', abort); entry.readers--;
        if (!entry.readers && !entry.done) {
          if (pending.get(params.url) === entry) pending.delete(params.url);
          entry.controller.abort();
        }
        if (error) reject(error); else resolve({...result, data:result.data.slice(0)});
      };
      const abort = () => finish(controller.signal.reason || new DOMException('Cancelled','AbortError'));
      controller.signal.addEventListener('abort', abort, {once:true});
      entry.promise.then(result=>finish(null,result), error=>finish(error));
    });
  };
}
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const stops = DEPTH_COLOURS.map(([depth, hex]) => [depth, rgb(hex)]);

// Negative elevation is metres below sea level. Missing / impossible depths
// and positive land heights are transparent; the water mask clips the rest.
export function depthColour(elevation) {
  if (!Number.isFinite(elevation) || elevation > 0 || elevation < -11500) return [0, 0, 0, 0];
  const depth = -elevation;
  for (let i = 1; i < stops.length; i++) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i];
    if (depth <= b) {
      const f = (depth - a) / (b - a);
      return ca.map((v, k) => Math.round(v + (cb[k] - v) * f)).concat(255);
    }
  }
  return stops.at(-1)[1].concat(255);
}
// A flat, 46 KB palette avoids per-pixel colour work and object allocation.
let colours;
const palette = () => {
  if (!colours) {
    colours = new Uint8ClampedArray(11501 * 4);
    for (let depth = 0; depth <= 11500; depth++) colours.set(depthColour(-depth), depth * 4);
  }
  return colours;
};

export function depthTile(z, x, y) {
  const scale = 2 ** Math.max(0, z - DEPTH_ZOOM);
  return {z: Math.min(z, DEPTH_ZOOM), x: Math.floor(x / scale), y: Math.floor(y / scale),
    scale, ox: x % scale, oy: y % scale};
}
// Contour heights are emitted in the chosen display units. Convert them back
// to metres for styling, so switching units does not change contour weight.
export function seabedContourOpacity(units = 'metric') {
  const elevation = units === 'imperial' ? ['/', ['get','ele'], 3.28084] : ['get','ele'];
  const weight = ['*', ['case',['>', ['get','level'],0],1,0.45],
    ['interpolate',['linear'],['abs',elevation],0,1,200,0.9,1000,0.45,3000,0.2,6000,0.1]];
  return ['interpolate',['linear'],['zoom'],5,['*',0.4,weight],12,['*',0.65,weight]];
}
// Bilinear elevations, sampled at pixel centres, before applying the palette.
// This makes a smooth depth surface rather than sharp, invented isoband edges.
export function colourPixels(dem, tile, size = 256) {
  const out = new Uint8ClampedArray(size * size * 4), {width, height, data} = dem, lookup = palette();
  const clamp = (v, max) => Math.max(0, Math.min(max - 1, v));
  for (let py = 0; py < size; py++) {
    const sy = clamp((tile.oy + (py + 0.5) / size) / tile.scale * height - 0.5, height);
    const y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), fy = sy - y0;
    for (let px = 0; px < size; px++) {
      const sx = clamp((tile.ox + (px + 0.5) / size) / tile.scale * width - 0.5, width);
      const x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), fx = sx - x0;
      const a = data[y0 * width + x0], b = data[y0 * width + x1], c = data[y1 * width + x0], d = data[y1 * width + x1];
      const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
      // No-data must not become a false trench or a false shallow patch.
      if ((wa && (!Number.isFinite(a) || a < -11500)) || (wb && (!Number.isFinite(b) || b < -11500))
        || (wc && (!Number.isFinite(c) || c < -11500)) || (wd && (!Number.isFinite(d) || d < -11500))) continue;
      const elevation = (wa ? a * wa : 0) + (wb ? b * wb : 0) + (wc ? c * wc : 0) + (wd ? d * wd : 0);
      // A coastline pixel may mix sea and land in the coarse DEM. The
      // detailed ocean mask, not that mixed height, decides what is water.
      const colour = Math.max(0, Math.min(11500, Math.round(-elevation))) * 4, at = (py * size + px) * 4;
      out[at] = lookup[colour]; out[at + 1] = lookup[colour + 1]; out[at + 2] = lookup[colour + 2]; out[at + 3] = 255;
    }
  }
  return out;
}

// Vector-tile rings include holes (islands). Draw each feature with even-odd
// winding, then union the features: overlapping polygons must not cancel.
export function oceanPolygons(tile) {
  const water = tile.layers?.water;
  if (!water) return [];
  return Array.from({length: water.length}, (_, i) => water.feature(i))
    .filter(f => f.type === 3 && f.properties.class === 'ocean')
    .map(f => ({extent: f.extent || water.extent, rings: f.loadGeometry()}));
}
const canvas = size => typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size)
  : Object.assign(document.createElement('canvas'), {width: size, height: size});
const png = image => image.convertToBlob ? image.convertToBlob({type: 'image/png'})
  : new Promise((resolve, reject) => image.toBlob(blob => blob ? resolve(blob) : reject(new Error('Depth tile could not be encoded')), 'image/png'));
export const encodePng = async image => (await png(image)).arrayBuffer();

export function maskOcean(context, polygons, size) {
  const mask = canvas(size), ink = mask.getContext('2d');
  ink.fillStyle = '#fff';
  for (const {extent, rings} of polygons) {
    ink.beginPath();
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const {x, y} = ring[i], at = [x / extent * size, y / extent * size];
        if (i) ink.lineTo(...at); else ink.moveTo(...at);
      }
      ink.closePath();
    }
    ink.fill('evenodd');
  }
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(mask, 0, 0);
  context.globalCompositeOperation = 'source-over';
}

// A depth worker (depth-worker.mjs): send(message, signal) resolves with
// its answer; forget(key) drops the polygons kept for a tile. A cancelled
// tile's answer is discarded, and its polygons forgotten. A worker that
// fails (its script did not load, or it stopped) is not used again: its
// waiting calls reject with `workerFailed`, and `failed` is set.
function depthWorker(create) {
  const worker = create(), waiting = new Map(), state = {failed: false};
  let next = 0;
  const forget = key => { if (!state.failed) worker.postMessage({key, drop: true}); };
  worker.onmessage = ({data}) => {
    const call = waiting.get(data.id);
    if (!call) return;
    waiting.delete(data.id);
    if (data.error) call.reject(new Error(data.error)); else call.resolve(data);
  };
  worker.onerror = event => {
    state.failed = true;
    worker.terminate?.();
    for (const call of waiting.values()) call.reject(Object.assign(new Error(event?.message || 'Depth worker failed'), {workerFailed: true}));
    waiting.clear();
  };
  const send = (message, signal) => new Promise((resolve, reject) => {
    if (state.failed) { reject(Object.assign(new Error('Depth worker failed'), {workerFailed: true})); return; }
    if (signal.aborted) { forget(message.key); reject(signal.reason); return; }
    const id = ++next;
    const abort = () => { waiting.delete(id); forget(message.key); reject(signal.reason || new DOMException('Cancelled', 'AbortError')); };
    const settle = done => value => { signal.removeEventListener('abort', abort); done(value); };
    waiting.set(id, {resolve: settle(resolve), reject: settle(reject)});
    signal.addEventListener('abort', abort, {once: true});
    worker.postMessage({...message, id});
  });
  return {send, forget, get failed() { return state.failed; }};
}

// waterTile reads the SAME PMTiles archive through the existing protocol.
// With a worker (createWorker: () => Worker running depth-worker.js) the
// tiles are decoded, coloured and encoded there, so panning and zooming
// over the sea stay smooth; without one (no Worker or OffscreenCanvas),
// readTile, the page's vector decoder, does it here.
// Keep only 32 encoded tiles; MapLibre retains the visible textures itself.
export function installBathymetry(maplibre, dem, {waterTile, readTile, createWorker, keep = 32}) {
  const cache = new Map();
  let worker = null, requestId = 0;
  // A worker that cannot even be created (blocked by the browser) leaves
  // the drawing on the page.
  if (createWorker && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') try { worker = depthWorker(createWorker); } catch { worker = null; }
  let blank;
  const empty = () => {
    if (!blank) {
      const image = canvas(1);
      image.getContext('2d'); // OffscreenCanvas needs a context before encoding.
      blank = png(image).then(blob => blob.arrayBuffer());
    }
    return blank;
  };
  maplibre.addProtocol('atlas-depth', async ({url}, controller) => {
    const match = /^atlas-depth:\/\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
    if (!match) throw new Error('Invalid depth tile');
    const [z, x, y] = match.slice(1).map(Number);
    if (z > WATER_ZOOM || x >= 2 ** z || y >= 2 ** z) throw new Error('Depth tile outside source bounds');
    controller.signal.throwIfAborted();
    if (cache.has(url)) {
      const data = cache.get(url); cache.delete(url); cache.set(url, data);
      return {data: data.slice(0)};
    }
    const requestKey = `${url}#${++requestId}`; // World wraps may request the same URL concurrently.
    const water = await waterTile(z, x, y, controller);
    controller.signal.throwIfAborted();
    // In the worker while it works; on the page without one, or after it failed.
    const inWorker = async () => {
      const {ocean} = await worker.send({key: requestKey, water: water.data ?? new ArrayBuffer(0)}, controller.signal);
      if (!ocean) return empty(); // No extra DEM request inland.
      const tile = depthTile(z, x, y);
      let heights;
      try { heights = await dem.getDemTile(tile.z, tile.x, tile.y, controller); controller.signal.throwIfAborted(); }
      catch (error) { worker.forget(requestKey); throw error; }
      // A copy: the terrain cache keeps its own.
      return (await worker.send({key: requestKey, tile, heights: {width: heights.width, height: heights.height, data: Float32Array.from(heights.data)}}, controller.signal)).data;
    };
    const onPage = async () => {
      const polygons = water.data?.byteLength ? oceanPolygons(readTile(water.data)) : [];
      if (!polygons.length) return empty(); // No extra DEM request inland.
      const tile = depthTile(z, x, y), heights = await dem.getDemTile(tile.z, tile.x, tile.y, controller);
      controller.signal.throwIfAborted();
      const image = canvas(256), context = image.getContext('2d');
      context.putImageData(new ImageData(colourPixels(heights, tile), 256, 256), 0, 0);
      maskOcean(context, polygons, 256);
      return encodePng(image);
    };
    let data;
    if (worker && !worker.failed) {
      try { data = await inWorker(); }
      catch (error) { if (!error?.workerFailed) throw error; data = await onPage(); }
    } else data = await onPage();
    controller.signal.throwIfAborted();
    cache.set(url, data);
    while (cache.size > keep) cache.delete(cache.keys().next().value);
    return {data: data.slice(0)};
  });
}
