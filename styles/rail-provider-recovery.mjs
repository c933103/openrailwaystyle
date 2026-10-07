// Recover OpenRailwayMap vector sources after upstream outages. One shared
// TileJSON probe prevents every thematic source from polling independently;
// successful probes reload only sources that actually failed. There is no
// substitute geometry: an unavailable provider remains visibly unavailable.
const RETRY_DELAYS = [5_000, 15_000, 45_000, 120_000, 300_000];
export const isRetryableRailError = error => {
  const message = String(error?.message ?? error ?? '');
  if (/aborterror|operation was aborted|err_aborted/i.test(message)) return false;
  return /failed to fetch|fetch failed|ajaxerror|networkerror|net::err_|timed? ?out|timeout|\b(?:408|429|5\d\d)\b/i.test(message);
};

export function createRailProviderRecovery(map, {
  provider = 'https://openrailwaymap.app',
  fetcher = globalThis.fetch,
  active = () => globalThis.document?.visibilityState !== 'hidden' && globalThis.navigator?.onLine !== false,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = id => clearTimeout(id),
  timeoutMs = 12_000,
  onChange = () => {},
} = {}) {
  const failed = new Map();
  const providerHost = new URL(provider).host;
  let timer = null, inFlight = false, attempts = 0, disposed = false;
  const getSource = id => {
    const source = id && map.getSource(id);
    // All transformed source URLs preserve the actual provider host.
    return source?.url?.includes(providerHost) && typeof source.setUrl === 'function' ? source : null;
  };
  const delay = () => RETRY_DELAYS[Math.min(attempts, RETRY_DELAYS.length - 1)];
  function stopTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function schedule() {
    if (!disposed && failed.size && !inFlight && timer === null && active()) timer = setTimer(run, delay());
  }
  async function run() {
    timer = null;
    if (disposed || !failed.size || !active()) return;
    inFlight = true;
    attempts++;
    try {
      const response = await fetcher(`${provider.replace(/\/$/, '')}/railway_line_high`,
        {cache: 'no-store', signal: AbortSignal.timeout(timeoutMs)});
      if (!response.ok) throw new Error(`Railway provider returned ${response.status}`);
      const metadata = await response.json();
      if (!Array.isArray(metadata?.tiles) || !metadata.tiles.length) throw new Error('Invalid railway TileJSON');
      for (const [id, state] of failed) {
        const source = getSource(id);
        if (!source) { failed.delete(id); continue; }
        state.refreshing = true;
        try {
          // setUrl, including to the same URL, invalidates previously failed
          // tiles and re-requests metadata. Panning or a manual reload is not
          // required. Never manufacture an empty successful tile.
          source.setUrl(source.url);
        } catch {
          state.refreshing = false;
        }
      }
    } catch {
      // Keep the error visible; the next shared probe uses longer backoff.
    } finally {
      inFlight = false;
      onChange();
      schedule();
    }
  }
  function noteError(event) {
    if (disposed || !event?.sourceId || !isRetryableRailError(event.error) || !getSource(event.sourceId)) return false;
    // An error during a refresh must invalidate that refresh's success claim.
    failed.set(event.sourceId, {refreshing: false});
    onChange();
    schedule();
    return true;
  }
  function noteSourceData(event) {
    const state = failed.get(event?.sourceId);
    if (!state?.refreshing || !event.isSourceLoaded) return false;
    // A successful source load after its setUrl refresh is the recovery
    // signal, not an unrelated tile finishing before the retry.
    failed.delete(event.sourceId);
    if (!failed.size) { stopTimer(); attempts = 0; }
    onChange();
    return true;
  }
  // A hidden or offline tab does no polling. Its normal browser events wake
  // the pending work on return rather than running background timers.
  function wake() { schedule(); }
  function dispose() { disposed = true; stopTimer(); failed.clear(); }
  return {noteError, noteSourceData, wake, dispose, hasFailures: () => failed.size > 0,
    failedSourceIds: () => [...failed.keys()]};
}
