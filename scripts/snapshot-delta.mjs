// Incremental update of the lifecycle snapshot (each scheduled run). Instead
// of waiting for a region's turn in the rotation of full refreshes, each run asks Overpass only for
// ways changed since the previous run:
//   1. lifecycle ways (planned, construction, former) changed since then,
//      with geometry: added or updated;
//   2. IDs of operating railways changed since then: any of them still in
//      the snapshot has opened (or reopened) and is removed.
// Changes are kept in .snapshot-cache/delta.json, keyed by way ID with the
// OSM time of the response, and applied over the cached regions whenever
// they are newer than the region's own data.
import {toGeoJSON} from './lifecycle.mjs';

export const DELTA_FILE = '.snapshot-cache/delta.json';
const LIFECYCLE = 'proposed|construction|disused|abandoned|razed|demolished|removed';
const TRACKS = 'rail|narrow_gauge|light_rail|subway|tram|monorail|funicular';

export function deltaQueries(since, bbox = '') {
  const area = bbox ? `(${bbox})` : '';
  const changed = `(changed:"${since}")`;
  return {
    // One key-regex selector covers every "<state>:railway" tag.
    lifecycle: `[out:json][timeout:300];(way[railway~"^(${LIFECYCLE})$"]${changed}${area};way[~"^(${LIFECYCLE}):railway$"~"^(${TRACKS})$"]${changed}${area};);out tags geom qt;`,
    opened: `[out:json][timeout:300];way[railway~"^(${TRACKS})$"]${changed}${area};out ids qt;`,
  };
}

// Record one run's responses: lifecycle features replace older entries;
// opened IDs become removals.
export function mergeDelta(delta, lifecycleJson, openedJson) {
  const time = lifecycleJson.osm3s?.timestamp_osm_base;
  if (!time) throw new Error('Overpass response has no timestamp');
  const changes = {...(delta?.changes || {})};
  for (const f of toGeoJSON(lifecycleJson).features) changes[f.id] = {time, feature: f};
  const lifecycleIds = new Set(Object.keys(changes).filter(id => changes[id].time === time && changes[id].feature));
  for (const el of openedJson.elements || []) {
    if (el.type === 'way' && !lifecycleIds.has(String(el.id))) changes[el.id] = {time, feature: null};
  }
  return {since: time, changes};
}

// Apply recorded changes over the assembled features. base maps way ID to
// the OSM time of the region response it came from. Returns the counts and
// the change log without entries that no longer do anything: superseded by
// newer region data, or removals of ways the snapshot does not contain.
export function applyDelta(features, base, delta) {
  let added = 0, updated = 0, removed = 0;
  const kept = {};
  // A change older than every region response is superseded everywhere.
  const oldest = [...base.values()].filter(Boolean).sort()[0];
  for (const [id, change] of Object.entries(delta?.changes || {})) {
    const key = Number(id), known = features.has(key), {time, feature} = change;
    if (known && base.get(key) && base.get(key) >= time) continue; // region data is newer
    if (oldest && oldest >= time) continue;
    if (!feature) { if (known) { features.delete(key); removed++; kept[id] = change; } continue; }
    features.set(key, feature); known ? updated++ : added++; kept[id] = change;
  }
  return {added, updated, removed, delta: delta && {...delta, changes: kept}};
}
