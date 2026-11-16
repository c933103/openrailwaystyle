// One passive Chromium CPU sample window for the first desktop detail-2
// transition. This never evaluates page code, repaints, fetches or decides
// readiness. Setup/collection have their own bounds; the UI deadline is not
// changed. No heap, source text, arguments, request bodies or headers are kept.
const MAX_NODES = 4096, MAX_SAMPLES = 12000;
export function sanitizeCpuProfile(profile) {
  if (!profile || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples)
    || !Array.isArray(profile.timeDeltas) || profile.samples.length !== profile.timeDeltas.length)
    return {unavailable: true, reason: 'invalid-profile'};
  const counts = {nodes: profile.nodes.length, samples: profile.samples.length};
  if (counts.nodes > MAX_NODES || counts.samples > MAX_SAMPLES)
    return {unavailable: true, reason: 'profile-limit', counts};
  if (profile.nodes.some(node => !node || typeof node !== 'object'
    || node.children !== undefined && !Array.isArray(node.children)))
    return {unavailable: true, reason: 'invalid-profile'};
  if (profile.nodes.reduce((count, node) => count + (node.children?.length || 0), 0) > MAX_NODES)
    return {unavailable: true, reason: 'profile-limit', counts};
  const address = value => {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? (url.origin + url.pathname).slice(0, 512) : url.protocol;
    } catch { return ''; }
  };
  const integer = value => Number.isSafeInteger(value) ? value : 0;
  return {counts, profile: {
    startTime: Number.isFinite(profile.startTime) ? profile.startTime : 0,
    endTime: Number.isFinite(profile.endTime) ? profile.endTime : 0,
    nodes: profile.nodes.map(node => ({id: integer(node.id), hitCount: integer(node.hitCount),
      callFrame: {functionName: String(node.callFrame?.functionName || '').slice(0, 128),
        scriptId: String(node.callFrame?.scriptId || '').slice(0, 32),
        url: address(node.callFrame?.url), lineNumber: integer(node.callFrame?.lineNumber),
        columnNumber: integer(node.callFrame?.columnNumber)},
      children: (node.children || []).slice(0, MAX_NODES).map(integer)})),
    samples: profile.samples.map(integer), timeDeltas: profile.timeDeltas.map(integer),
  }};
}

export function createControlsCpuProfile(createSession, {operationTimeout = 2000,
  captureLimit = 60000, samplingInterval = 10000, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  let session, starting, stopping, timer, retired = false, running = false, detached = false;
  let result = {unavailable: true, reason: 'not-started'};
  const metadata = {phase: 'first desktop detail-1 to detail-2', samplingIntervalUs: samplingInterval,
    captureLimitMs: captureLimit, operationTimeoutMs: operationTimeout};
  const detach = () => {
    if (session && !detached) {detached = true; void Promise.resolve().then(() => session.detach()).catch(() => {});}
  };
  async function bounded(work) {
    let timeout;
    try {
      return await Promise.race([
        Promise.resolve().then(work).then(value => ({value}), () => ({unavailable: true, reason: 'protocol-error'})),
        new Promise(resolve => {timeout = setTimer(() => resolve({unavailable: true, reason: 'protocol-timeout'}), operationTimeout);}),
      ]);
    } finally {clearTimer(timeout);}
  }
  function stop(reason = 'settlement-finished') {
    if (stopping) return stopping;
    if (!starting) return Promise.resolve(result);
    retired = true; clearTimer(timer);
    metadata.stoppedAt = now(); metadata.stopReason = reason;
    if (!running) {
      if (result.reason === 'not-started') result = {unavailable: true, reason: 'setup-interrupted'};
      detach(); stopping = Promise.resolve(result); return stopping;
    }
    running = false;
    stopping = bounded(() => session.send('Profiler.stop')).then(read => {
      result = read.unavailable ? read : sanitizeCpuProfile(read.value?.profile);
      metadata.receivedAt = now();
      return result;
    }).catch(() => {result = {unavailable: true, reason: 'invalid-profile'}; return result;}).finally(detach);
    return stopping;
  }
  function start() {
    if (starting) return starting;
    metadata.requestedAt = now();
    starting = bounded(async () => {
      session = await createSession();
      if (retired) {detach(); return;}
      await session.send('Profiler.enable');
      if (retired) {detach(); return;}
      await session.send('Profiler.setSamplingInterval', {interval: samplingInterval});
      if (retired) {detach(); return;}
      await session.send('Profiler.start');
      if (retired) {detach(); return;}
      running = true; metadata.startedAt = now(); result = {unavailable: true, reason: 'recording'};
      timer = setTimer(() => {void stop('capture-limit');}, captureLimit);
    }).then(read => {
      if (read.unavailable) {result = read; retired = true; detach();}
      return running;
    });
    return starting;
  }
  return {start, stop, snapshot: () => ({...metadata, ...result})};
}
