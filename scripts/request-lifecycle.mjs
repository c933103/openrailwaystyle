// Observe the fixture boundary separately from the browser's response/body lifecycle.
// A fulfilled Playwright route does not establish that fetch/MapLibre received it.
export function createRequestLifecycle({now = Date.now, limit = 128} = {}) {
  const epoch = now(), records = new WeakMap(), active = new Set(), recent = [];
  const counts = {started: 0, fulfilled: 0, responded: 0, finished: 0, failed: 0};
  const safeAddress = value => {
    try { const url = new URL(value); return url.origin + url.pathname; }
    catch { return 'unavailable'; }
  };
  const at = () => now() - epoch;
  function start(request) {
    let record = records.get(request);
    if (!record) {
      record = {id: ++counts.started, url: safeAddress(request.url()), started: at()};
      records.set(request, record); active.add(record);
    }
    return record;
  }
  function mark(request, event, detail = {}) {
    const record = start(request);
    if (record[event] !== undefined) return;
    record[event] = at(); Object.assign(record, detail); counts[event]++;
    if (event === 'finished' || event === 'failed') {
      active.delete(record); recent.push(record);
      if (recent.length > limit) recent.shift();
    }
  }
  return {
    start,
    fulfilled: request => mark(request, 'fulfilled'),
    responded: response => mark(response.request(), 'responded', {status: response.status()}),
    finished: request => mark(request, 'finished'),
    failed: request => mark(request, 'failed'),
    snapshot: () => ({
      elapsed: at(), counts: {...counts}, pendingCount: active.size,
      pending: [...active].slice(0, limit).map(record => ({...record})),
      pendingTruncated: active.size > limit,
      recent: recent.map(record => ({...record})),
    }),
  };
}
