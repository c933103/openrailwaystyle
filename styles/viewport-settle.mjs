// Delay optional fan-out while a viewport is moving. Primary tiles never use
// this gate. Recheck every 120 ms: cancelled intermediate views do no work.
export function waitForViewport(signal, isMoving = () => false) {
  signal.throwIfAborted();
  if (!isMoving()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer;
    const finish = error => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const abort = () => finish(signal.reason || new DOMException('Aborted', 'AbortError'));
    const check = () => {
      try {
        signal.throwIfAborted();
        if (isMoving()) timer = setTimeout(check, 120);
        else finish();
      } catch (error) { finish(error); }
    };
    signal.addEventListener('abort', abort, {once: true});
    timer = setTimeout(check, 120);
  });
}

// The pinned contour manager exposes its worker through actor.dest. Send a
// separate message type so movement never consumes an RPC slot or tile budget.
export function bindTerrainViewport(map, dem) {
  const manager = dem?.manager, worker = manager?.actor?.dest;
  if (!Number.isInteger(manager?.managerId) || typeof worker?.postMessage !== 'function') return () => {};
  let previous;
  const send = moving => {
    if (moving === previous) return;
    previous = moving;
    worker.postMessage({type:'atlas-viewport', managerId:manager.managerId, moving});
  };
  const sync = () => send(Boolean(map.isMoving() || map.isZooming()));
  const events = ['movestart','moveend','zoomstart','zoomend'];
  const dispose = () => {
    for (const event of events) map.off(event, sync);
    map.off('remove', dispose);
    send(false);
  };
  for (const event of events) map.on(event, sync);
  map.on('remove', dispose);
  sync();
  return dispose;
}
