// Passive long-task observations and a low-frequency event-loop heartbeat.
// No repaint, source mutation, retry or acceptance decision. The installer is
// self-contained so Playwright can run it before each document's application.
export function installBrowserTiming(scope = globalThis) {
  scope.__atlasControlsTiming?.dispose();
  const now = () => scope.performance.now(), interval = 250, limit = 64;
  let observer, timer, disposed = false, start = now(), last = start;
  let longTaskSupported = false, heartbeatSupported = false;
  let longTasks, heartbeat;
  const empty = () => ({count: 0, totalMs: 0, maxMs: 0, recent: []});
  const reset = () => {longTasks = empty(); heartbeat = empty();};
  reset();
  const record = (stats, at, duration) => {
    if (!Number.isFinite(at) || !Number.isFinite(duration) || duration < 0 || at < start) return;
    stats.count++; stats.totalMs += duration; stats.maxMs = Math.max(stats.maxMs, duration);
    stats.recent.push({at: at - start, duration});
    if (stats.recent.length > limit) stats.recent.shift();
  };
  try {
    observer = new scope.PerformanceObserver(list => {
      if (disposed) return;
      for (const entry of list.getEntries()) record(longTasks, entry.startTime, entry.duration);
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
    begin() {
      observer?.takeRecords(); start = now(); last = start; reset();
    },
    snapshot() {
      // Include observer records queued behind a delayed task before reading.
      if (!disposed) for (const entry of observer?.takeRecords() || []) record(longTasks, entry.startTime, entry.duration);
      return {elapsed: now() - start, interval, longTaskSupported, heartbeatSupported,
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
