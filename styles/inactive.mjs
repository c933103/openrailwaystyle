// The public vector overview omits former lines. Query only the visible region,
// with one request at a time, a debounce, a cooldown and a small session cache.
export const INACTIVE_API = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
export const EMPTY = { type: 'FeatureCollection', features: [] };
export const STATES = ['proposed', 'construction', 'disused', 'abandoned', 'razed', 'demolished', 'removed'];
const TRACKS = ['rail', 'narrow_gauge', 'light_rail', 'subway', 'tram', 'monorail', 'funicular'];
const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;

export function viewBox(bounds) {
  const west = bounds.getWest(), east = bounds.getEast();
  const south = Math.max(-85, bounds.getSouth()), north = Math.min(85, bounds.getNorth());
  // A single bounded regional request; never silently crop a larger viewport.
  if (![west, east, south, north].every(Number.isFinite) || east <= west || north <= south || east - west > 18 || north - south > 12) return null;
  return [south, wrap(west), north, wrap(east)].map(n => Math.round(n * 100000) / 100000);
}
export function inactiveQuery(box) {
  const bbox = box.join(',');
  const states = STATES.join('|'), tracks = TRACKS.join('|');
  return `[out:json][timeout:25][maxsize:67108864];(way[railway~"^(${states})$"](${bbox});way[~"^(${states}):railway$"~"^(${tracks})$"](${bbox}););out tags geom(${bbox});`;
}
export function toGeoJSON(json) {
  if (json.remark || !Array.isArray(json.elements)) throw new Error('Incomplete regional railway response');
  const features = [];
  for (const way of json.elements) {
    if (way.type !== 'way') continue;
    const tags = way.tags || {};
    // Active track with an old lifecycle tag must not be drawn as closed.
    if (TRACKS.includes(tags.railway)) continue;
    const state = STATES.includes(tags.railway) ? tags.railway : STATES.find(s => TRACKS.includes(tags[`${s}:railway`]));
    if (!state) continue;
    const kind = tags[`${state}:railway`] || tags[state];
    if (kind && !TRACKS.includes(kind) && kind !== 'yes') continue;
    const lines = []; let line = [];
    for (const point of way.geometry || []) {
      if (point && Number.isFinite(point.lon) && Number.isFinite(point.lat)) line.push([point.lon, point.lat]);
      else { if (line.length > 1) lines.push(line); line = []; }
    }
    if (line.length > 1) lines.push(line);
    if (!lines.length) continue;
    features.push({ type: 'Feature', id: way.id, properties: {
      id: way.id, osm_id: way.id, state, feature: TRACKS.includes(kind) ? kind : 'rail',
      name: tags.name || tags['name:en'] || '', ref: tags.ref || '',
      usage: tags.usage || '', service: tags.service || '', operator: tags.operator || '',
    }, geometry: lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines } });
  }
  return { type: 'FeatureCollection', features };
}
const contains = (outer, inner) => outer[1] <= outer[3] && inner[1] <= inner[3]
  ? outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
  : outer.every((n, i) => n === inner[i]);

export function createInactiveOverlay(map, enabled, onStatus, { fetcher = globalThis.fetch, debounce = 900, cooldown = 5000 } = {}) {
  let timer, active, generation = 0, nextRequest = 0, disposed = false;
  const cache = [];
  let displayed;
  const setData = data => { if (data !== displayed) { map.getSource('inactiveRegional').setData(data); displayed = data; } };
  const inRange = () => enabled() && map.getZoom() >= 7 && map.getZoom() < 12;
  async function refresh() {
    if (disposed || !inRange()) return;
    const box = viewBox(map.getBounds());
    if (!box) { onStatus('Zoom in a little for former and planned lines across this view.'); return; }
    const hit = cache.find(entry => contains(entry.box, box));
    if (hit) { setData(hit.data); onStatus(''); return; }
    if (active || Date.now() < nextRequest) {
      timer = setTimeout(refresh, Math.max(1000, nextRequest - Date.now())); return;
    }
    const token = generation;
    const controller = new AbortController(); active = controller;
    const timeout = setTimeout(() => controller.abort(), 35000);
    onStatus('Loading former and planned railways…');
    try {
      const response = await fetcher(INACTIVE_API, {
        method: 'POST', body: new URLSearchParams({ data: inactiveQuery(box) }), signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Regional railway data: HTTP ${response.status}`);
      const data = toGeoJSON(await response.json());
      cache.unshift({ box, data }); if (cache.length > 4) cache.pop();
      if (!disposed && token === generation && inRange()) { setData(data); onStatus(''); }
    } catch (error) {
      if (!disposed && token === generation && inRange()) onStatus('Extra former-line coverage is unavailable here. Zoom closer for the standard railway detail.');
      nextRequest = Date.now() + 30000;
    } finally {
      clearTimeout(timeout); active = undefined;
      nextRequest = Math.max(nextRequest, Date.now() + cooldown);
    }
  }
  function schedule() {
    generation++; clearTimeout(timer);
    if (!inRange()) { onStatus(''); active?.abort(); return; }
    const box = viewBox(map.getBounds());
    const hit = box && cache.find(entry => contains(entry.box, box));
    if (hit) { setData(hit.data); onStatus(''); return; }
    // Keep already-loaded lines on screen while the next viewport loads.
    timer = setTimeout(refresh, debounce);
  }
  map.on('moveend', schedule);
  return { refresh: schedule, destroy() { disposed = true; clearTimeout(timer); active?.abort(); map.off('moveend', schedule); } };
}
