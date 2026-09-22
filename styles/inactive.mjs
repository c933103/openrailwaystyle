// The public vector overview omits former lines. Query only the visible region,
// with one request at a time, a debounce, a cooldown and a small session cache.
export const INACTIVE_API = 'https://overpass-api.de/api/interpreter';
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
export const GROUPS = [
  {id:'planned', label:'planned and construction', states:['proposed','construction']},
  {id:'former', label:'former', states:['disused','abandoned','razed','demolished','removed']},
];
export function inactiveQuery(box, states = STATES) {
  const bbox = box.join(','), tracks = TRACKS.join('|');
  // Exact lifecycle keys avoid broad matching over tag names. Keep each
  // requested lifecycle group independent so it can render immediately.
  const selectors = [`way[railway~"^(${states.join('|')})$"](${bbox});`,
    ...states.map(state => `way["${state}:railway"~"^(${tracks})$"](${bbox});`)];
  return `[out:json][timeout:40][maxsize:268435456];(${selectors.join('')});out tags geom(${bbox});`;
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

export function createInactiveOverlay(map, enabled, onStatus, {
  fetcher = globalThis.fetch, debounce = 900, cooldown = 5000,
  retryDelay = 30000, requestTimeout = 65000, storage,
} = {}) {
  let timer, controller, running = false, generation = 0, nextRequest = 0, disposed = false;
  let retryUsed = false, viewKey = '';
  const cache = [], displayed = new Map();
  const storageKey = 'railway-atlas-regional-v2';
  if (storage === undefined) {try {storage = globalThis.localStorage;} catch { /* Disabled storage. */ }}
  try {
    for (const entry of JSON.parse(storage?.getItem(storageKey) || '[]')) {
      if (Date.now() - entry.time < 86400000 && Array.isArray(entry.box) && entry.box.length === 4 && entry.data?.type === 'FeatureCollection') cache.push(entry);
    }
  } catch { /* Storage is optional, including in private browsing. */ }
  const persist = () => {
    try {
      const json = JSON.stringify(cache.slice(0, 4));
      if (json.length < 2000000) storage?.setItem(storageKey, json);
    } catch { /* A full or disabled cache must not stop map loading. */ }
  };
  const status = (message = '', retry = false) => onStatus(message, {retry});
  const publish = () => map.getSource('inactiveRegional').setData({
    type:'FeatureCollection', features:[...displayed.values()].flatMap(data => data.features),
  });
  const inRange = () => !disposed && enabled() && map.getZoom() >= 7 && map.getZoom() < 12;
  const find = (group, box) => cache.find(entry => entry.group === group && contains(entry.box, box));
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  function describe(error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'the data service timed out';
    if (error.status === 429) return 'the data service is busy';
    if (error.status) return `the data service returned HTTP ${error.status}`;
    if (error.message.includes('Incomplete')) return 'the data service returned an incomplete result';
    return 'the data service could not be reached';
  }
  async function refresh(token = generation) {
    if (!inRange() || token !== generation || running) return;
    const box = viewBox(map.getBounds());
    if (!box) { status('Zoom in a little to load planned and former lines across this view.'); return; }
    const key = box.join(',');
    if (key !== viewKey) {viewKey = key; retryUsed = false;}
    running = true;
    const failures = [];
    try {
      // Planned/construction loads first and is published immediately. A failure
      // loading former lines must never erase successfully loaded planned lines.
      for (const group of GROUPS) {
        if (!inRange() || token !== generation) break;
        const hit = find(group.id, box);
        if (hit) { displayed.set(group.id, hit.data); publish(); continue; }
        const delay = Math.max(0, nextRequest - Date.now());
        status(`Loading ${group.label} railways…`);
        if (delay) await pause(delay);
        if (!inRange() || token !== generation) break;
        controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), requestTimeout);
        try {
          const response = await fetcher(INACTIVE_API, {
            method:'POST', body:new URLSearchParams({data:inactiveQuery(box, group.states)}), signal:controller.signal,
          });
          if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), {status:response.status});
          const data = toGeoJSON(await response.json());
          cache.unshift({box, group:group.id, data, time:Date.now()});
          if (cache.length > 8) cache.pop();
          persist();
          if (inRange() && token === generation) {displayed.set(group.id, data); publish();}
        } catch (error) {
          if (inRange() && token === generation) {
            failures.push({group:group.label, reason:describe(error)});
            console.warn('Regional railway request failed', {group:group.id, box, error});
          }
          nextRequest = Date.now() + retryDelay;
        } finally {
          clearTimeout(timeout); controller = undefined;
          nextRequest = Math.max(nextRequest, Date.now() + cooldown);
        }
      }
      if (token === generation && inRange()) {
        if (failures.length) {
          const message = failures.map(f => `${f.group[0].toUpperCase()+f.group.slice(1)} lines incomplete: ${f.reason}.`).join(' ');
          if (!retryUsed) {
            retryUsed = true;
            status(`${message} Retrying shortly…`, true);
            timer = setTimeout(() => refresh(generation), retryDelay);
          } else status(message, true);
        } else status('');
      }
    } finally {
      running = false;
      // A pan during a request previously left the new view unloaded. Finish the
      // old request into the cache, then always service the latest viewport.
      if (token !== generation && inRange()) timer = setTimeout(() => refresh(generation), debounce);
    }
  }
  function schedule({retry = false} = {}) {
    generation++; clearTimeout(timer);
    if (retry) retryUsed = false;
    if (!inRange()) {status(''); controller?.abort(); return;}
    timer = setTimeout(() => refresh(generation), debounce);
  }
  map.on('moveend', schedule);
  return {
    refresh: schedule,
    retry: () => schedule({retry:true}),
    destroy() {disposed = true; generation++; clearTimeout(timer); controller?.abort(); map.off('moveend', schedule);},
  };
}
