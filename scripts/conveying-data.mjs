// Build-time extract. Browsers never query Overpass for escalators or lifts.
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {conveying} from '../styles/conveying.mjs';
// Tiles at the zoom the lines first draw, at full precision: 8192 units span
// about 0.3 m at the equator, and no simplification drops a short piece.
// (MapLibre rounds tile coordinates to its own 8192 grid, so a lower zoom
// would lose short pieces for good, even when overzoomed.)
export const CONVEYING_ZOOM = 14, CONVEYING_EXTENT = 8192;
// Quadtile output avoids provider-side ID sorting; normalized features below
// are still sorted by ID. This is an optimization, not a gateway-error cure.
export const CONVEYING_QUERY = '[out:json][timeout:900][maxsize:1073741824];(way[conveying][conveying!=no];way[highway=elevator];);out tags geom qt;';

export const CONVEYING_ERROR_BYTES = 64 * 1024;
export const CONVEYING_REQUEST_MS = 960000;
export const CONVEYING_ACQUISITION_MS = 52 * 60000;
// Retry-After is a minimum, never a value to cap down to fit our deadline.
export function conveyingRetryDelay(error, retry, now = Date.now()) {
  const scheduled = error?.kind === 'admission' ? [120000, 240000][retry] : 120000;
  const header = String(error?.retryAfter ?? '').trim();
  let asked = 0;
  if (/^\d+$/.test(header)) asked = Number(header) * 1000;
  // Accept HTTP-date forms, not Date.parse's permissive numbers such as -5.
  else if (/^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4})$/.test(header)) {
    const date = Date.parse(header.endsWith(' GMT') ? header : `${header} GMT`);
    if (Number.isFinite(date)) asked = Math.max(0, date - now);
  }
  return Math.max(scheduled, asked);
}
// Use the monotonic clock for elapsed acquisition time; HTTP dates alone use
// wall time. Recheck after sleep too, because a delayed timer can overshoot.
export const conveyingRequestFits = (deadline, wait, now = performance.now()) =>
  Number.isFinite(wait) && wait >= 0 && now + wait + CONVEYING_REQUEST_MS <= deadline;
export function conveyingFailureKind(status, detail, truncated = false) {
  if (truncated) return 'incomplete-diagnostic';
  if (status === 429 || status === 503 || /dispatcher|too busy|rate.limited|at capacity|query workers (?:are )?busy|request queue (?:is )?full/i.test(detail)) return 'admission';
  if ((status === 200 || status >= 500) && /runtime error:\s*Query\b[^]*?(timed? ?out|out of memory)/i.test(detail)) return 'execution-limit';
  return status >= 500 ? 'gateway-or-server' : 'http-error';
}

// Like the station builder, retain only a bounded diagnostic, not an entire
// error page. Truncated evidence must never claim the query exceeded limits.
export async function conveyingHttpError(response, startedAt) {
  const reader = response.body?.getReader();
  const chunks = []; let bytes = 0, truncated = false;
  try {
    if (reader) while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      const keep = Math.min(value.byteLength, CONVEYING_ERROR_BYTES - bytes);
      if (keep) { chunks.push(Buffer.from(value.subarray(0, keep))); bytes += keep; }
      if (value.byteLength > keep || bytes === CONVEYING_ERROR_BYTES) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  } catch {
    truncated = true;
    await reader?.cancel().catch(() => {});
  } finally { reader?.releaseLock(); }
  const detail = Buffer.concat(chunks).toString('utf8')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\ufffd/g, '').replace(/<[^>]*>/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim();
  const kind = conveyingFailureKind(response.status, detail, truncated);
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const error = new Error(`Overpass HTTP ${response.status} after ${elapsedMs}ms [${kind}]: ${detail.slice(0, 240) || '(empty diagnostic)'}`);
  Object.assign(error, {status: response.status, elapsedMs, kind, diagnosticBytes: bytes, truncated,
    retryAfter: response.headers.get('retry-after')});
  // Keep bounded sanitized evidence available to callers without dumping it
  // in an uncaught error's enumerable properties or log output.
  Object.defineProperty(error, 'diagnostic', {value: detail});
  return error;
}
// A backward escalator is stored reversed, so every arrow points along its line.
// Tiles carry only what is drawn: kind and arrow direction (one_way, two_way).
export function conveyingGeoJSON(json) {
  if (json?.remark || !Array.isArray(json?.elements)) throw new Error(json?.remark || 'Incomplete conveying response');
  const features = [];
  for (const element of json.elements) {
    if (element.type !== 'way' || !Number.isSafeInteger(element.id)) continue;
    const found = conveying(element.tags || {});
    if (!found) continue;
    const coordinates = element.geometry?.map(p => [p.lon, p.lat]);
    if (!coordinates || coordinates.length < 2 || coordinates.some(p => !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw new Error(`Incomplete geometry for conveying way-${element.id}`);
    if (found.direction === 'backward') coordinates.reverse();
    const arrows = found.direction === 'reversible' ? 'two_way' : found.direction ? 'one_way' : '';
    features.push({type: 'Feature', id: element.id, geometry: {type: 'LineString', coordinates},
      properties: {osm_id: String(element.id), kind: found.kind, arrows}});
  }
  return {type: 'FeatureCollection', features: features.sort((a, b) => a.id - b.id)};
}
// Every tile any piece (with its buffer) touches, as encoded vector tiles.
export function conveyingTiles(features) {
  const z = CONVEYING_ZOOM, n = 2 ** z, extent = CONVEYING_EXTENT, buffer = 128;
  const index = geojsonvt({type: 'FeatureCollection', features}, {maxZoom: z, indexMaxZoom: 5, tolerance: 0, extent, buffer});
  const keys = new Set(), tileXY = ([lng, lat]) => [(lng + 180) / 360 * n, (1 - Math.asinh(Math.tan(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180)) / Math.PI) / 2 * n];
  for (const f of features) {
    const points = f.geometry.coordinates.map(tileXY), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    for (let x = Math.max(0, Math.floor(Math.min(...xs) - buffer / extent)); x <= Math.min(n - 1, Math.floor(Math.max(...xs) + buffer / extent)); x++)
      for (let y = Math.max(0, Math.floor(Math.min(...ys) - buffer / extent)); y <= Math.min(n - 1, Math.floor(Math.max(...ys) + buffer / extent)); y++) keys.add(`${z}/${x}/${y}`);
  }
  const tiles = new Map();
  for (const key of [...keys].sort()) {
    const [tz, x, y] = key.split('/').map(Number), tile = index.getTile(tz, x, y);
    if (tile?.features.length) tiles.set(key, Buffer.from(vtpbf.fromGeojsonVt({conveying: tile}, {extent})));
  }
  return tiles;
}

