// Passive long-task observations and a low-frequency event-loop heartbeat.
// No repaint, source mutation, retry or acceptance decision. The installer is
// self-contained so Playwright can run it before each document's application.
// Snapshots never reset observations: late reads after a diagnostic timeout
// cannot erase unreported stalls. Compare cumulative counts/totals and relative
// timestamps across snapshots from the same timeOrigin/startedAt.
export function installBrowserTiming(scope = globalThis) {
  scope.__atlasControlsTiming?.dispose();
  const now = () => scope.performance.now(), interval = 250, limit = 64, start = now();
  let observer, timer, disposed = false, last = start;
  let longTaskSupported = false, heartbeatSupported = false;
  const empty = () => ({count: 0, totalMs: 0, maxMs: 0, recent: []});
  const longTasks = empty(), heartbeat = empty();
  const record = (stats, at, duration) => {
    if (!Number.isFinite(at) || !Number.isFinite(duration) || duration < 0) return;
    stats.count++; stats.totalMs += duration; stats.maxMs = Math.max(stats.maxMs, duration);
    stats.recent.push({at: at - start, duration});
    if (stats.recent.length > limit) stats.recent.shift();
  };
  const recordTask = entry => {
    // Keep a task overlapping installation with its original duration and a
    // negative relative start. Older completed tasks do not belong to this run.
    if (entry.startTime + entry.duration > start) record(longTasks, entry.startTime, entry.duration);
  };
  try {
    observer = new scope.PerformanceObserver(list => {
      if (disposed) return;
      for (const entry of list.getEntries()) recordTask(entry);
    });
    observer.observe({type: 'longtask', buffered: false});
    longTaskSupported = true;
  } catch {observer?.disconnect(); observer = undefined;}
  try {
    timer = scope.setInterval(() => {
      if (disposed) return;
      const at = now(), delay = Math.max(0, at - last - interval); last = at;
      record(heartbeat, at, delay);
    }, interval);
    heartbeatSupported = true;
  } catch {}
  const copy = stats => ({...stats, recent: stats.recent.map(entry => ({...entry})), truncated: stats.count > limit});
  const api = {
    snapshot() {
      // Include observer records queued behind a delayed task before reading.
      if (!disposed) for (const entry of observer?.takeRecords() || []) recordTask(entry);
      return {window: 'document-lifetime',
        timeOrigin: Number.isFinite(scope.performance.timeOrigin) ? scope.performance.timeOrigin : null,
        startedAt: start, elapsed: now() - start,
        interval, longTaskSupported, heartbeatSupported,
        longTasks: copy(longTasks), heartbeat: copy(heartbeat)};
    },
    dispose() {
      if (disposed) return;
      disposed = true; observer?.disconnect();
      if (timer !== undefined) scope.clearInterval(timer);
    },
  };
  scope.__atlasControlsTiming = api;
  return api;
}

// Diagnostics must not hang the runner after the acceptance deadline expires.
export async function readBrowserTiming(page, timeout = 2000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => page.evaluate(() => globalThis.__atlasControlsTiming?.snapshot() ?? {unavailable: true}))
        .catch(() => ({unavailable: true})),
      new Promise(resolve => {timer = setTimeout(() => resolve({unavailable: true, timeout}), timeout);}),
    ]);
  } finally {clearTimeout(timer);}
}
