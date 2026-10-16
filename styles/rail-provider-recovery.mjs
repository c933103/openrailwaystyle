// Recovery is demand-driven. A failed tile does not justify clearing every
// healthy tile in its source, or sending a separate TileJSON health probe.
const RETRY_DELAYS = [5_000, 15_000, 45_000, 120_000, 300_000];
const errorStatus = error => Number(error?.status || /(?:returned|HTTP|AJAXError:)\s*(\d{3})\b/i.exec(String(error?.message ?? error ?? ''))?.[1]);
export function isRetryableRailError(error) {
  const message = String(error?.message ?? error ?? '');
  if (error?.name === 'AbortError' || /aborterror|operation was aborted|err_aborted/i.test(message)) return false;
  if (error?.name === 'ProviderDataError' || /provider returned an invalid vector tile/i.test(message)) return true;
  const status = errorStatus(error);
  if (status >= 400) return status === 408 || status === 429 || status >= 500;
  return error?.name === 'TimeoutError' || /failed to fetch|fetch failed|ajaxerror|networkerror|net::err_|timed? ?out|timeout/i.test(message);
}
const coordinate = event => event?.tile?.tileID?.canonical || event?.coord?.canonical || null;
const tileKey = c => c && `${c.z}/${c.x}/${c.y}`;
const validCoordinate = c => c && Number.isInteger(c.z) && c.z >= 0 && c.z <= 30 &&
  Number.isInteger(c.x) && c.x >= 0 && c.x < 2 ** c.z &&
  Number.isInteger(c.y) && c.y >= 0 && c.y < 2 ** c.z;
const inFlight = tile => !tile?.aborted && ['loading', 'reloading', 'expired'].includes(tile?.state);

export function createRailProviderRecovery(map, {
  provider = 'https://openrailwaymap.app',
  active = () => globalThis.document?.visibilityState !== 'hidden' && globalThis.navigator?.onLine !== false,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = id => clearTimeout(id), onChange = () => {},
} = {}) {
  const failed = new Map(), observed = new Map(), origin = new URL(provider).origin;
  let timer = null, attempts = 0, disposed = false;
  function remember(id, source, tile) {
    let evidence = observed.get(id);
    if (!evidence || evidence.source !== source || evidence.url !== source.url) {
      evidence = {source, url: source.url, tiles: new WeakSet()};observed.set(id, evidence);
    }
    evidence.tiles.add(tile);
  }
  function sourceFor(id) {
    const source = id && map.getSource(id), text = source?.url || '';
    const at = text.indexOf('https://');
    try { return at >= 0 && new URL(text.slice(at)).origin === origin ? source : null; }
    catch { return null; }
  }
  function visible(id) {
    if (!map.getStyle || !map.getZoom) return true;
    const zoom = map.getZoom();
    return map.getStyle()?.layers?.some(layer => layer.source === id && layer.layout?.visibility !== 'none'
      && (!layer.minzoom || zoom >= layer.minzoom) && (!layer.maxzoom || zoom < layer.maxzoom));
  }
  function activeTiles(id, source) {
    // The pinned renderer's inventory includes active non-renderable copies.
    // Without it, compatibility callers can only guard recorded instances.
    try {
      const manager = map.style?.tileManagers?.[id];
      if (typeof manager?.getIds !== 'function' || typeof manager.getTileByID !== 'function' ||
          typeof manager.getSource !== 'function' || manager.getSource() !== source) return null;
      const ids = manager.getIds();
      if (!Array.isArray(ids)) return null;
      const tiles = ids.map(key => manager.getTileByID(key));
      return tiles.every(Boolean) ? tiles : null;
    } catch { return null; } // A style transition may invalidate the snapshot.
  }
  function onScreen(c) {
    if (!c || !map.getBounds) return true;
    const bounds = map.getBounds();
    if (!bounds?.getWest) return true;
    const n = 2 ** c.z, latitude = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    if (latitude(c.y) < bounds.getSouth?.() || latitude(c.y + 1) > bounds.getNorth?.()) return false;
    const west = bounds.getWest(), east = bounds.getEast?.();
    // Unknown longitude cannot establish exclusion; known latitude still can.
    if (!Number.isFinite(west) || !Number.isFinite(east)) return true;
    let width = east - west;
    if (!Number.isFinite(width)) return true;
    if (width >= 360) return true;
    if (width < 0) width = (width % 360 + 360) % 360; // antimeridian bounds
    const start = (west % 360 + 360) % 360;
    const left = c.x / n * 360 - 180, right = (c.x + 1) / n * 360 - 180;
    // An integer world offset must place the tile across this interval.
    return Math.ceil((start - right) / 360) <= Math.floor((start + width - left) / 360);
  }
  function prune() {
    // MapLibre can cache an expired retry before it fails. Returning that exact
    // tile does not emit another error, so resume demand from weak evidence of
    // its original retryable failure, never from an arbitrary errored tile.
    for (const [id, evidence] of observed) {
      const source = sourceFor(id);
      if (source !== evidence.source || source?.url !== evidence.url) { observed.delete(id);continue; }
      for (const tile of activeTiles(id, source) || []) {
        if (!evidence.tiles.has(tile)) continue;
        if (tile.aborted || ['loaded', 'unloaded'].includes(tile.state)) { evidence.tiles.delete(tile);continue; }
        const c = tile.tileID?.canonical;
        if (!validCoordinate(c) || !onScreen(c)) continue;
        let state = failed.get(id);
        if (!state || state.source !== source || state.url !== source.url) {
          state = {source, url: source.url, metadata: false, tiles: new Map()};failed.set(id, state);
        }
        const key = tileKey(c);
        let record = state.tiles.get(key);
        if (!record) { record = {coordinate: {z: c.z, x: c.x, y: c.y}, instances: new Set()};state.tiles.set(key, record); }
        record.instances.add(tile);
      }
    }
    for (const [id, state] of failed) {
      if (sourceFor(id) !== state.source || state.source.url !== state.url) { failed.delete(id); continue; }
      const inventory = activeTiles(id, state.source);
      for (const [key, record] of state.tiles) {
        // Bind coordinate-only evidence to unresolved active copies when the
        // inventory is known; an empty match retires a stale location marker.
        if (inventory !== null && record.instances.delete(null)) {
          for (const tile of inventory) {
            if (!tile.aborted && !['loaded', 'unloaded'].includes(tile.state) &&
                validCoordinate(tile.tileID?.canonical) && tileKey(tile.tileID.canonical) === key) {
              record.instances.add(tile);remember(id, state.source, tile);
            }
          }
        }
        for (const tile of record.instances) {
          // Removed copies can finish failing in MapLibre's cache without
          // being aborted. Refreshing their coordinate cannot recover them.
          const retired = inventory !== null && !inventory.includes(tile);
          if (retired || tile?.aborted || ['unloaded', 'loaded'].includes(tile?.state)) record.instances.delete(tile);
        }
        if (!record.instances.size || !onScreen(record.coordinate)) state.tiles.delete(key);
      }
      if (!state.metadata && !state.tiles.size) failed.delete(id);
    }
    if (!failed.size) { attempts = 0; stopTimer(); }
  }
  function stopTimer() { if (timer !== null) clearTimer(timer); timer = null; }
  function schedule() {
    if (disposed) return;
    prune();
    if (!active() || ![...failed.keys()].some(visible)) { stopTimer(); return; }
    if (timer === null) timer = setTimer(run, RETRY_DELAYS[Math.min(attempts, RETRY_DELAYS.length - 1)]);
  }
  function run() {
    timer = null;
    if (disposed || !active()) return;
    prune();
    let dispatched = false;
    const dispatch = callback => {
      // Count this round once, only when work is invoked. Advance before the
      // call so synchronous source events also see the new backoff step.
      if (!dispatched) { attempts++; dispatched = true; }
      callback();
    };
    for (const [id, state] of failed) {
      if (!visible(id)) continue;
      try {
        if (state.metadata) {
          if (typeof state.source.setUrl === 'function') dispatch(() => state.source.setUrl(state.source.url));
          continue;
        }
        // A canonical refresh also reaches sibling world copies. Wait while
        // any recorded or active instance is in flight instead of restarting it.
        // MapLibre keeps refreshed tiles 'expired' until their load settles.
        const busy = new Set((activeTiles(id, state.source) || []).filter(inFlight)
          .map(tile => tile.tileID?.canonical).filter(validCoordinate).map(tileKey));
        const tiles = [...state.tiles.values()].filter(record => [...record.instances]
          .every(tile => !inFlight(tile)) && !busy.has(tileKey(record.coordinate))).map(record => record.coordinate);
        if (tiles.length && typeof map.refreshTiles === 'function') dispatch(() => map.refreshTiles(id, tiles));
      } catch { /* A style replacement may remove a source while recovering. */ }
    }
    onChange(); schedule();
  }
  function noteError(event) {
    if (disposed || !event?.sourceId) return false;
    const c = coordinate(event);
    // An explicitly supplied but invalid location is not a metadata outage.
    // Reject it before creating or changing any existing recovery state.
    if (('tile' in event || 'coord' in event) && !validCoordinate(c)) return false;
    const source = sourceFor(event.sourceId);
    if (!source) return false;
    if (!isRetryableRailError(event.error)) {
      // A later access/nonretryable HTTP response supersedes that instance's
      // earlier outage, including while it is cached offscreen. It remains a
      // presentation failure, but cannot retain authority to retry the request.
      const aborted = event.error?.name === 'AbortError' || /aborterror|operation was aborted|err_aborted/i.test(String(event.error?.message ?? event.error ?? ''));
      if (!aborted && errorStatus(event.error) >= 400) {
        const evidence = observed.get(event.sourceId), state = failed.get(event.sourceId);
        if (event.tile && evidence?.source === source && evidence.url === source.url) evidence.tiles.delete(event.tile);
        if (state?.source === source && state.url === source.url) {
          if (c) state.tiles.get(tileKey(c))?.instances.delete(event.tile ?? null);
          else state.metadata = false;
        }
        schedule();onChange();
      }
      return false;
    }
    if (c && event.tile) remember(event.sourceId, source, event.tile);
    let state = failed.get(event.sourceId);
    if (!state || state.source !== source || state.url !== source.url) {
      state = {source, url: source.url, metadata: false, tiles: new Map()}; failed.set(event.sourceId, state);
    }
    if (c) {
      const key = tileKey(c);
      let record = state.tiles.get(key);
      if (!record) { record = {coordinate: {z: c.z, x: c.x, y: c.y}, instances: new Set()}; state.tiles.set(key, record); }
      record.instances.add(event.tile ?? null);
    }
    else state.metadata = true;
    schedule(); onChange(); return true;
  }
  function noteSourceData(event) {
    if (disposed || !event?.sourceId) return false;
    const c = coordinate(event), located = 'tile' in event || 'coord' in event;
    if (located && !validCoordinate(c)) return false;
    if (event.tile && (event.tile.aborted || ['loaded', 'unloaded'].includes(event.tile.state)))
      observed.get(event.sourceId)?.tiles.delete(event.tile);
    const state = failed.get(event?.sourceId);
    if (!state) return false;
    let recovered = false;
    // isSourceLoaded also becomes true after failed tiles settle. Only a
    // successful metadata event or this particular loaded tile is evidence.
    if (!located && state.metadata && event.sourceDataType === 'metadata') { state.metadata = false; recovered = true; }
    const key = tileKey(c);
    const record = key && state.tiles.get(key);
    if (record && event.tile?.state === 'loaded') {
      const instance = record.instances.delete(event.tile);
      // Coordinate-only errors have no tile identity. A loaded tile settles
      // that marker, but never another known instance at the same coordinate.
      const coordinateOnly = record.instances.delete(null);
      recovered = instance || coordinateOnly || recovered;
    }
    prune(); onChange(); return recovered;
  }
  // Movement rechecks demand without postponing an already scheduled retry.
  function wake() { schedule(); }
  function dispose() { disposed = true; stopTimer(); failed.clear(); observed.clear(); }
  return {noteError, noteSourceData, wake, dispose,
    hasFailures: () => { if (disposed) return false; prune(); return [...failed.keys()].some(visible); },
    failedSourceIds: () => [...failed.keys()],
    hasSourceFailure: (id, source) => failed.get(id)?.source === source};
}
