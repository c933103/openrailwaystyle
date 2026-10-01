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
const colours = new Uint8ClampedArray(11501 * 4);
for (let depth = 0; depth <= 11500; depth++) colours.set(depthColour(-depth), depth * 4);

export function depthTile(z, x, y) {
  const scale = 2 ** Math.max(0, z - DEPTH_ZOOM);
  return {z: Math.min(z, DEPTH_ZOOM), x: Math.floor(x / scale), y: Math.floor(y / scale),
    scale, ox: x % scale, oy: y % scale};
}
// Bilinear elevations, sampled at pixel centres, before applying the palette.
// This makes a smooth depth surface rather than sharp, invented isoband edges.
export function colourPixels(dem, tile, size = 256) {
  const out = new Uint8ClampedArray(size * size * 4), {width, height, data} = dem;
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
      out[at] = colours[colour]; out[at + 1] = colours[colour + 1]; out[at + 2] = colours[colour + 2]; out[at + 3] = 255;
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

// waterTile reads the SAME PMTiles archive through the existing protocol;
// readTile is the already-loaded vector decoder. No new provider or worker.
// Keep only 32 encoded tiles; MapLibre retains the visible textures itself.
export function installBathymetry(maplibre, dem, {waterTile, readTile, keep = 32}) {
  const cache = new Map();
  let blank;
  const empty = () => blank ||= png(canvas(1)).then(blob => blob.arrayBuffer());
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
    const water = await waterTile(z, x, y, controller);
    controller.signal.throwIfAborted();
    const polygons = water.data?.byteLength ? oceanPolygons(readTile(water.data)) : [];
    let data;
    if (!polygons.length) data = await empty(); // No extra DEM request inland.
    else {
      const tile = depthTile(z, x, y), heights = await dem.getDemTile(tile.z, tile.x, tile.y, controller);
      controller.signal.throwIfAborted();
      const image = canvas(256), context = image.getContext('2d');
      context.putImageData(new ImageData(colourPixels(heights, tile), 256, 256), 0, 0);
      maskOcean(context, polygons, 256);
      data = await (await png(image)).arrayBuffer();
    }
    controller.signal.throwIfAborted();
    cache.set(url, data);
    while (cache.size > keep) cache.delete(cache.keys().next().value);
    return {data: data.slice(0)};
  });
}
