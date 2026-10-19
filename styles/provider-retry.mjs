// Match the existing request-pool/rail policy: only 408, 429 and 5xx are
// transient HTTP failures. PMTiles 4.2.1 drops status fields, while MapLibre
// may deliver a serialized AJAXError, so recognize their explicit messages.
export function providerErrorStatus(error) {
  const status = Number(error?.status);
  if (Number.isInteger(status) && status >= 300 && status <= 599) return status;
  return Number(/(?:Bad response code:|returned|HTTP|AJAXError:)\s*(\d{3})\b/i.exec(String(error?.message ?? error ?? ''))?.[1]);
}
export function isRetryableProviderError(error) {
  const message = String(error?.message ?? error ?? '');
  if (error?.name === 'AbortError' || /aborterror|operation was aborted|err_aborted/i.test(message)) return false;
  const status = providerErrorStatus(error);
  if (status >= 300) return status === 408 || status === 429 || status >= 500;
  return error?.name === 'TimeoutError' || /failed to fetch|fetch failed|ajaxerror|networkerror|net::err_|timed? ?out|timeout/i.test(message);
}

export function providerRetryDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const abort = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, {once: true});
    timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  });
}

// One finite metadata budget per source instance/URL. Basemap retries already
// belong to atlasbase; reloading its metadata would multiply that budget.
export function createMetadataRetries(map, {provider, retries = [5000, 15000, 45000],
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id)} = {}) {
  const pending = new Map();
  let disposed = false;
  function clear(id) {
    const entry = pending.get(id);
    if (entry?.timer != null) clearTimer(entry.timer);
    pending.delete(id);
  }
  function noteError(event) {
    if (disposed || !event.sourceId) return;
    const id = event.sourceId, source = map.getSource(id), url = source?.url;
    let entry = pending.get(id);
    // Observe replacement before filtering the new event/source. Otherwise an
    // excluded source can leave an old timer alive across an ABA URL change.
    if (entry && (entry.source !== source || entry.url !== url)) { clear(id); entry = undefined; }
    if (!url || url.startsWith('atlasbase://') || (provider && url.includes(new URL(provider).host)) ||
      typeof source.setUrl !== 'function') { clear(id); return; }
    if (event.tile || event.coord) return;
    if (!isRetryableProviderError(event.error)) { clear(id); return; }
    // MapLibre marks failed metadata as loaded. Only an actual metadata
    // success event can retire this retry, not source.loaded().
    if (entry?.timer != null) return;
    if (!entry) { entry = {source, url, attempt: 0, timer: null}; pending.set(id, entry); }
    if (entry.attempt >= retries.length) return;
    entry.timer = setTimer(() => {
      entry.timer = null;
      if (disposed || pending.get(id) !== entry) return;
      const current = map.getSource(id);
      if (current !== source || current.url !== url) { clear(id); return; }
      source.setUrl(url);
    }, retries[entry.attempt++]);
  }
  return {noteError, clear, dispose() { disposed = true; for (const id of pending.keys()) clear(id); }};
}
