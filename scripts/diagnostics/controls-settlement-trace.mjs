// One diagnostic window on the real controls path. This records operation
// boundaries and outcomes without retrying, swallowing or changing them.
export function createControlsSettlementTrace({now = Date.now} = {}) {
  let active = false, started = false;
  const record = {phase: 'first desktop detail-1 to detail-2', clock: 'Unix milliseconds',
    operations: [], operationCount: 0, operationsTruncated: false};
  return {
    start() {if (started) return; started = active = true; record.startedAt = now();},
    active: () => active,
    async observe(phase, operation) {
      if (!active) return operation();
      const entry = {phase, startedAt: now()};
      record.operationCount++;
      if (record.operations.length < 16) record.operations.push(entry); else record.operationsTruncated = true;
      try {const value = await operation(); entry.outcome = 'returned'; return value;}
      catch (error) {entry.outcome = 'threw'; throw error;}
      finally {entry.endedAt = now();}
    },
    stop(reason, requests) {
      if (!active) return false;
      active = false; record.endedAt = now(); record.stopReason = reason;
      record.requestsAtEnd = structuredClone(requests); return true;
    },
    snapshot: () => structuredClone(record),
  };
}

async function boundedRead(operation, timeout) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation).catch(() => ({unavailable: true, reason: 'page-evaluation-failed'})),
      new Promise(resolve => {timer = setTimeout(() => resolve({unavailable: true, reason: 'page-evaluation-timeout', timeout}), timeout);}),
    ]);
  } finally {clearTimeout(timer);}
}

// Install only the existing baseline observers. No visibility guard, painter
// intervention, extra body read, repaint or source/queue mutation is allowed.
// A delayed import after the diagnostic setup bound cannot arm a late window.
export function armControlsSettlementProbe(page, base, timeout = 2000) {
  const deadline = Date.now() + timeout;
  return boundedRead(() => page.evaluate(async ({base, deadline}) => {
    const {installControlsPainterProbe} = await import(base + '__controls-painter-probe.mjs');
    const {map} = await import(document.querySelector('script[type="module"]').src);
    if (Date.now() >= deadline) return {unavailable: true, reason: 'late-probe-setup'};
    const probe = installControlsPainterProbe(map, {guard: false});
    globalThis.__atlasControlsSettlementProbe = probe;
    probe.arm();
    const {timeOrigin, started} = probe.snapshot();
    return {timeOrigin, started};
  }, {base, deadline}), timeout);
}

// Read after acceptance ends, with its own unchanged two-second diagnostic
// bound. A failed/late read cannot turn a failed acceptance into a pass.
export function readControlsSettlementProbe(page, reason, timeout = 2000) {
  return boundedRead(() => page.evaluate(reason => {
    const probe = globalThis.__atlasControlsSettlementProbe;
    try {
      if (!probe) return {unavailable: true, reason: 'probe-not-installed'};
      probe.stop(reason);
      return probe.snapshot();
    } finally {probe?.dispose();globalThis.__atlasControlsFetchProbe?.dispose();}
  }, reason), timeout);
}
