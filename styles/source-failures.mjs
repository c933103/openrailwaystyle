// Presentation only: no requests, retries, cache clearing or provider-wide
// health inference. Success belongs to a failed resource, never its siblings.
const coordinate = event => event?.tile?.tileID?.canonical || event?.coord?.canonical;
const key = c => c && Number.isInteger(c.z) && c.z >= 0 && c.z <= 30 &&
  Number.isInteger(c.x) && c.x >= 0 && c.x < 2 ** c.z &&
  Number.isInteger(c.y) && c.y >= 0 && c.y < 2 ** c.z ? `${c.z}/${c.x}/${c.y}` : null;
const unresolved = tile => tile && !tile.aborted && !['loaded','unloaded'].includes(tile.state);
const endpoint = source => JSON.stringify([source?.url,source?.tiles]);

export function createSourceFailures(map, id) {
  const source = map.getSource(id), address = endpoint(source);
  const tiles = new Set(), locations = new Set(), observed = new WeakSet();
  let metadata = false, unknownTile = false;
  const current = () => map.getSource(id) === source && endpoint(source) === address;
  function inventory() {
    try {
      const manager = map.style?.tileManagers?.[id];
      if (typeof manager?.getIds !== 'function' || typeof manager.getTileByID !== 'function' ||
          typeof manager.getSource !== 'function' || manager.getSource() !== source) return null;
      const ids = manager.getIds();
      if (!Array.isArray(ids)) return null;
      const active = ids.map(id => manager.getTileByID(id));
      return active.every(Boolean) ? active : null;
    } catch { return null; }
  }
  function prune() {
    if (!current()) return;
    const active = inventory();
    if (active) {
      // A previously failed tile can return from the renderer cache without a
      // fresh error event. Weak evidence keeps that failure, not unrelated ones.
      for (const tile of active) if (observed.has(tile) && unresolved(tile)) tiles.add(tile);
      for (const location of locations) {
        for (const tile of active) if (key(tile.tileID?.canonical) === location && unresolved(tile)) {
          tiles.add(tile); observed.add(tile);
        }
        locations.delete(location);
      }
    }
    for (const tile of tiles) {
      if (!unresolved(tile)) { tiles.delete(tile); observed.delete(tile); }
      else if (active && !active.includes(tile)) tiles.delete(tile);
    }
  }
  return {
    source, current,
    noteError(event) {
      if (event.tile && typeof event.tile === 'object') { tiles.add(event.tile); observed.add(event.tile); }
      else if (key(coordinate(event))) locations.add(key(coordinate(event)));
      else if (event.tile != null || event.coord != null) unknownTile = true;
      else metadata = true;
    },
    noteSourceData(event) {
      if (event.sourceDataType === 'metadata') metadata = false;
      if (event.tile?.state === 'loaded') {
        tiles.delete(event.tile); observed.delete(event.tile);
        // With a renderer inventory, prune binds coordinate-only evidence to
        // every unresolved world copy before any sibling can clear it.
        if (inventory() === null) locations.delete(key(coordinate(event)));
      }
      prune();
    },
    hasFailures() {
      if (!current()) return false;
      prune(); return metadata || unknownTile || tiles.size > 0 || locations.size > 0;
    },
  };
}
