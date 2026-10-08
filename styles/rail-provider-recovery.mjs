// Recovery is demand-driven. A failed tile does not justify clearing every
// healthy tile in its source, or sending a separate TileJSON health probe.
const RETRY_DELAYS = [5_000, 15_000, 45_000, 120_000, 300_000];
export function isRetryableRailError(error) {
  const message = String(error?.message ?? error ?? '');
  if (error?.name === 'AbortError' || /aborterror|operation was aborted|err_aborted/i.test(message)) return false;
  if (error?.name === 'ProviderDataError' || /provider returned an invalid vector tile/i.test(message)) return true;
  const status = Number(error?.status || /(?:returned|HTTP|AJAXError:)\s*(\d{3})\b/i.exec(message)?.[1]);
  if (status >= 400) return status === 408 || status === 429 || status >= 500;
  return error?.name === 'TimeoutError' || /failed to fetch|fetch failed|ajaxerror|networkerror|net::err_|timed? ?out|timeout/i.test(message);
}
const coordinate = event => event?.tile?.tileID?.canonical || event?.coord?.canonical || null;
const tileKey = c => c && `${c.z}/${c.x}/${c.y}`;

export function createRailProviderRecovery(map, {
  provider = 'https://openrailwaymap.app',
  active = () => globalThis.document?.visibilityState !== 'hidden' && globalThis.navigator?.onLine !== false,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = id => clearTimeout(id), onChange = () => {},
} = {}) {
  const failed = new Map(), origin = new URL(provider).origin;
  let timer = null, attempts = 0, disposed = false;
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
    for (const [id, state] of failed) {
      if (sourceFor(id) !== state.source) { failed.delete(id); continue; }
      for (const [key, record] of state.tiles) {
        if (record.tile?.aborted || ['unloaded', 'loaded'].includes(record.tile?.state) || !onScreen(record.coordinate)) state.tiles.delete(key);
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
        const tiles = [...state.tiles.values()].filter(record => !['loading', 'reloading'].includes(record.tile?.state)).map(record => record.coordinate);
        if (tiles.length && typeof map.refreshTiles === 'function') dispatch(() => map.refreshTiles(id, tiles));
      } catch { /* A style replacement may remove a source while recovering. */ }
    }
    onChange(); schedule();
  }
  function noteError(event) {
    if (disposed || !event?.sourceId || !isRetryableRailError(event.error)) return false;
    const source = sourceFor(event.sourceId);
    if (!source) return false;
    let state = failed.get(event.sourceId);
    if (!state || state.source !== source) { state = {source, metadata: false, tiles: new Map()}; failed.set(event.sourceId, state); }
    const c = coordinate(event);
    if (c) state.tiles.set(tileKey(c), {coordinate: {z: c.z, x: c.x, y: c.y}, tile: event.tile});
    else if (!event.tile) state.metadata = true;
    else { failed.delete(event.sourceId); return false; }
    schedule(); onChange(); return true;
  }
  function noteSourceData(event) {
    if (disposed) return false;
    const state = failed.get(event?.sourceId);
    if (!state) return false;
    let recovered = false;
    // isSourceLoaded also becomes true after failed tiles settle. Only a
    // successful metadata event or this particular loaded tile is evidence.
    if (state.metadata && event.sourceDataType === 'metadata') { state.metadata = false; recovered = true; }
    const key = tileKey(coordinate(event));
    if (key && event.tile?.state === 'loaded') recovered = state.tiles.delete(key) || recovered;
    prune(); onChange(); return recovered;
  }
  // Movement rechecks demand without postponing an already scheduled retry.
  function wake() { schedule(); }
  function dispose() { disposed = true; stopTimer(); failed.clear(); }
  return {noteError, noteSourceData, wake, dispose,
    hasFailures: () => { if (disposed) return false; prune(); return [...failed.keys()].some(visible); },
    failedSourceIds: () => [...failed.keys()]};
}
