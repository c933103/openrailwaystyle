// Change log of the lifecycle snapshot's earlier weekly update, which asked
// for ways changed since the previous run with the `changed` filter. Runs
// now bring each cached region up to date instead (build-snapshot.mjs), so
// no new entries are recorded; a log kept in the cache is still applied
// where it is newer than a region's data, and pruned once superseded.
export const DELTA_FILE = '.snapshot-cache/delta.json';

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
