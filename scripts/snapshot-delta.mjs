// Change log of the lifecycle snapshot: each change a region update applied,
// by way ID, with the database time of that update. A way can lie in several
// cached regions; one whose update failed keeps an older copy, so the
// assembled snapshot takes the logged state wherever it is newer than the
// region data a way came from (applyDelta), deletions included. An entry is
// pruned once every region is newer.
import {toGeoJSON} from './lifecycle.mjs';

export const DELTA_FILE = '.snapshot-cache/delta.json';

// Log the differences between a region's elements before and after its
// update at `time`: a changed or new way with its feature (null when it is
// no longer a planned, construction or former line), a removed one as null.
// A way that left the region (`box`) may only have moved into another one:
// when another region already logged it lying outside this box, that copy
// stands and no removal is logged. (When that region updates later, its
// newer entry replaces the removal.) A way deleted from OSM (`deleted`, its
// way IDs) is removed in any case. An entry is never replaced by an older
// one, as when a region's earlier data is logged late (build-snapshot.mjs,
// reconcile).
const touches = (feature, [s, w, n, e]) => {
  const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return lines.some(line => line.some(([lon, lat]) => lat >= s && lat <= n && lon >= w && lon <= e));
};
export function recordChanges(delta, time, before, after, box, deleted = []) {
  const gone = new Set(deleted.map(Number));
  const changes = {...(delta?.changes || {})};
  const old = new Map(before.filter(e => e.type === 'way').map(e => [e.id, JSON.stringify(e)]));
  const now = new Set(), newer = id => changes[id] && changes[id].time > time;
  for (const element of after) {
    if (element.type !== 'way') continue;
    now.add(element.id);
    if (old.get(element.id) === JSON.stringify(element) || newer(element.id)) continue;
    changes[element.id] = {time, feature: toGeoJSON({elements: [element]}).features[0] || null};
  }
  for (const id of old.keys()) {
    if (now.has(id) || newer(id)) continue;
    const logged = changes[id]?.feature;
    if (!gone.has(id) && box && logged && !touches(logged, box)) continue;
    changes[id] = {time, feature: null};
  }
  return {...(delta || {}), changes};
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
