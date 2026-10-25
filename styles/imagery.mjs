// Satellite/Hybrid imagery: Esri World Imagery when the deployment configures
// an ArcGIS Location Platform key, with Sentinel-2 cloudless (EOX) as the
// fallback for any tile Esri cannot serve. A quota or authorization failure
// (the free tier ends with the service privilege removed) switches the whole
// device to EOX for a while instead of re-requesting every tile from Esri.
export const EOX_TILES = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg';
export const EOX_MAX_ZOOM = 14;
export const ESRI_TILES = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ESRI_MAX_ZOOM = 18;
export const ESRI_ATTRIBUTION = 'Powered by <a href="https://www.esri.com/">Esri</a> | Esri, Vantor, Earthstar Geographics, and the GIS User Community';
export const ESRI_OFF_KEY = 'atlas-imagery-esri-off-until';
export const ESRI_OFF_MS = 6 * 60 * 60 * 1000;
const AUTH_STATUS = new Set([401, 403, 498, 499]);

const fill = (template, z, x, y) => template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
const imageType = response => /^image\//i.test(response.headers?.get?.('content-type') || '');

// Reads the deployment's imagery configuration; any failure means EOX only.
export async function loadImageryConfig(url, {fetcher = fetch, timeout = 3000} = {}) {
  try {
    const response = await fetcher(url, {cache: 'no-store', signal: AbortSignal.timeout(timeout)});
    if (!response.ok) return {};
    const config = await response.json();
    return typeof config?.esriKey === 'string' && /^[A-Za-z0-9._-]{20,}$/.test(config.esriKey) ? {esriKey: config.esriKey} : {};
  } catch { return {}; }
}

// Applies an Esri key to the composed style before the map starts. Without a
// key the style's direct EOX source is left exactly as published.
export function applyImageryConfig(source, {esriKey} = {}) {
  if (!esriKey) return source;
  source.tiles = ['atlasimagery://{z}/{x}/{y}'];
  source.maxzoom = ESRI_MAX_ZOOM;
  source.attribution = `${ESRI_ATTRIBUTION}; where Esri is unavailable: ${source.attribution}`;
  return source;
}

export function createImageryProtocol({esriKey = '', fetcher = fetch, storage, now = Date.now, resample = resampleTile} = {}) {
  // Reading localStorage itself throws when the browser denies storage.
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  const read = () => { try { return Number(storage?.getItem(ESRI_OFF_KEY)) || 0; } catch { return 0; } };
  let offUntil = read();
  const esriActive = () => Boolean(esriKey) && now() >= Math.max(offUntil, read());
  const disableEsri = () => {
    offUntil = now() + ESRI_OFF_MS;
    try { storage?.setItem(ESRI_OFF_KEY, String(offUntil)); } catch { /* private mode: this session only */ }
  };
  const ancestors = new Map();
  const bytes = async (url, signal) => {
    const response = await fetcher(url, {signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  };
  // EOX ends at z14: deeper tiles crop and enlarge their z14 ancestor, which
  // several children share, so keep a few pending/settled ancestors.
  const eox = async (z, x, y, signal) => {
    if (z <= EOX_MAX_ZOOM) return bytes(fill(EOX_TILES, z, x, y), signal);
    const depth = z - EOX_MAX_ZOOM, ax = x >> depth, ay = y >> depth, key = `${ax}/${ay}`;
    if (!ancestors.has(key)) {
      const pending = bytes(fill(EOX_TILES, EOX_MAX_ZOOM, ax, ay));
      pending.catch(() => { if (ancestors.get(key) === pending) ancestors.delete(key); });
      ancestors.set(key, pending);
      while (ancestors.size > 8) ancestors.delete(ancestors.keys().next().value);
    }
    signal?.throwIfAborted();
    return resample(await ancestors.get(key), depth, x - (ax << depth), y - (ay << depth));
  };
  const tile = async (params, controller) => {
    const match = /^atlasimagery:\/\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url);
    if (!match) throw new Error('Invalid imagery tile');
    const [z, x, y] = match.slice(1).map(Number), signal = controller?.signal;
    if (esriActive() && z <= ESRI_MAX_ZOOM) {
      try {
        const response = await fetcher(`${fill(ESRI_TILES, z, x, y)}?token=${encodeURIComponent(esriKey)}`, {signal});
        if (response.ok && imageType(response)) return {data: await response.arrayBuffer()};
        // ArcGIS may report token/quota errors as JSON with HTTP 200.
        if (AUTH_STATUS.has(response.status) || (response.ok && !imageType(response))) disableEsri();
      } catch (error) { if (signal?.aborted) throw error; } // Network or body failure: this tile uses EOX.
    }
    return {data: await eox(z, x, y, signal)};
  };
  return {tile, esriActive};
}

// Crop the (dx, dy) child at `depth` levels below a 256 px tile and scale it
// back to 256 px. Browsers only; tests inject their own resampler.
export async function resampleTile(data, depth, dx, dy) {
  const image = await createImageBitmap(new Blob([data]));
  // Measure the decoded ancestor rather than assuming 256 px tiles.
  const width = image.width / 2 ** depth, height = image.height / 2 ** depth;
  const canvas = new OffscreenCanvas(256, 256), context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, dx * width, dy * height, width, height, 0, 0, 256, 256);
  image.close?.();
  return (await canvas.convertToBlob({type: 'image/jpeg', quality: 0.9})).arrayBuffer();
}
