import {ByteCache} from './byte-cache.mjs';

// One queue for the provider adapters: visible geometry takes precedence over
// derived track counts. Timeouts start when a request is sent, not while it is
// waiting for a slot. Successful bytes remain bounded; failures never become
// empty successful tiles. A shared request survives cancellation of one reader.
export function createRequestPool({fetcher = fetch, concurrency = 6, perOrigin = 4,
  timeout = 12000, retries = [1000], cache = new ByteCache(), now = Date.now} = {}) {
  if (![concurrency, perOrigin].every(n => Number.isInteger(n) && n > 0)) throw new RangeError('Invalid request concurrency');
  const entries = new Map(), origins = new Map(), blocked = new Map();
  const stats = {started: 0, coalesced: 0, cacheHits: 0, cancelled: 0, retried: 0, peak: 0};
  let running = 0, sequence = 0, wakeTimer, disposed = false;
  const abortError = () => new DOMException('Aborted', 'AbortError');
  const keyFor = (url, json) => `${json ? 'json' : 'bytes'}:${url}`;
  const detach = entry => { if (entries.get(entry.key) === entry) entries.delete(entry.key); };
  const finish = (entry, error, value) => {
    detach(entry);
    for (const reader of entry.readers) {
      reader.signal?.removeEventListener('abort', reader.abort);
      if (error) reader.reject(error); else reader.resolve(value);
    }
    entry.readers.clear();
  };
  function drain() {
    clearTimeout(wakeTimer); wakeTimer = undefined;
    if (disposed) return;
    const time = now();
    const queued = [...entries.values()].filter(e => !e.running && e.readers.size);
    // Aging prevents optional derived data from starving during long sessions.
    const rank = e => e.priority - Math.floor((time - e.created) / 5000);
    queued.sort((a, b) => rank(a) - rank(b) || a.order - b.order);
    let next = Infinity;
    for (const entry of queued) {
      const ready = Math.max(entry.ready, blocked.get(entry.origin) || 0);
      if (ready > time) { next = Math.min(next, ready); continue; }
      if (running >= concurrency || (origins.get(entry.origin) || 0) >= perOrigin) continue;
      entry.running = true; running++;
      origins.set(entry.origin, (origins.get(entry.origin) || 0) + 1);
      stats.peak = Math.max(stats.peak, running);
      void send(entry);
    }
    if (next < Infinity) wakeTimer = setTimeout(drain, Math.max(1, Math.min(2 ** 31 - 1, next - now())));
  }
  async function send(entry) {
    const controller = new AbortController(); entry.controller = controller;
    let timer, removeAbort;
    const aborted = new Promise((_, reject) => {
      const abort = () => reject(controller.signal.reason || abortError());
      controller.signal.addEventListener('abort', abort, {once: true});
      removeAbort = () => controller.signal.removeEventListener('abort', abort);
    });
    timer = setTimeout(() => controller.abort(new DOMException('Map request timed out', 'TimeoutError')), timeout);
    stats.started++;
    try {
      const request = (async () => {
        const response = await fetcher(entry.url, {signal: controller.signal});
        if (!response.ok) {
          const error = new Error(`Map names returned ${response.status}`);
          error.status = response.status; error.url = entry.url;
          const raw = response.headers?.get?.('retry-after');
          if (raw) {
            const seconds = /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) * 1000 : Date.parse(raw) - now();
            if (Number.isFinite(seconds)) error.retryAfter = Math.max(0, seconds);
          }
          await response.body?.cancel?.().catch(() => {});
          throw error;
        }
        return entry.json ? response.json() : response.arrayBuffer();
      })();
      const value = await Promise.race([request, aborted]);
      if (!entry.readers.size || controller.signal.aborted || disposed) return;
      cache.set(entry.key, value);
      finish(entry, null, value);
    } catch (error) {
      if (!entry.readers.size || disposed) return;
      const retryable = error.status ? error.status === 408 || error.status === 429 || error.status >= 500
        : error.name !== 'AbortError' && error.name !== 'SyntaxError';
      // A server cooldown applies to other queued requests too, including
      // when this request has exhausted its retry allowance. Never truncate
      // Retry-After and send work before the server's stated deadline.
      if (error.status === 429 || error.status === 503 || (retryable && error.retryAfter > 0)) {
        const cooldown = Math.max(retries[entry.attempt] ?? 1000, error.retryAfter || 0);
        blocked.set(entry.origin, Math.max(blocked.get(entry.origin) || 0, now() + cooldown));
      }
      if (retryable && entry.attempt < retries.length) {
        const delay = Math.max(retries[entry.attempt++], error.retryAfter || 0);
        stats.retried++; entry.ready = now() + delay;
      } else finish(entry, error);
    } finally {
      clearTimeout(timer); removeAbort();
      running--; origins.set(entry.origin, (origins.get(entry.origin) || 1) - 1);
      entry.running = false; entry.controller = null;
      drain();
    }
  }
  function get(url, signal, {json = false, priority = 0} = {}) {
    if (disposed || signal?.aborted) return Promise.reject(signal?.reason || abortError());
    url = String(url);
    const key = keyFor(url, json);
    if (cache.has(key)) { stats.cacheHits++; return Promise.resolve(cache.get(key)); }
    let entry = entries.get(key);
    if (!entry) {
      entry = {key, url, json, origin: new URL(url).origin, priority, order: sequence++, created: now(), ready: 0,
        attempt: 0, running: false, readers: new Set(), controller: null};
      entries.set(key, entry);
    } else { stats.coalesced++; entry.priority = Math.min(priority, entry.priority); }
    const result = new Promise((resolve, reject) => {
      const reader = {resolve, reject, signal};
      reader.abort = () => {
        if (!entry.readers.delete(reader)) return;
        signal?.removeEventListener('abort', reader.abort);
        reject(signal?.reason || abortError());
        if (!entry.readers.size) { stats.cancelled++; detach(entry); entry.controller?.abort(abortError()); drain(); }
      };
      entry.readers.add(reader);
      signal?.addEventListener('abort', reader.abort, {once: true});
      if (signal?.aborted) reader.abort();
    });
    drain();
    return result;
  }
  function dispose() {
    disposed = true; clearTimeout(wakeTimer);
    for (const entry of [...entries.values()]) { entry.controller?.abort(abortError()); finish(entry, abortError()); }
  }
  return {get, dispose, stats: () => ({...stats, active: running, queued: [...entries.values()].filter(e => !e.running).length})};
}
