// Keep requests tied to the current Canvas viewport and source generation.
// The caller owns source policy and decoding; an inactive/revoked source must
// be omitted, and any change of URL, scope, or permissions gets a new revision.
export function createFlatTileRequests({load, dispose = () => {}, changed = () => {}, concurrency = 8}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || typeof load !== 'function')
    throw new TypeError('Invalid flat tile request options');

  let sources = new Map(), running = 0, closed = false;
  const putAway = entry => {
    entry.active = false;
    entry.controller?.abort();
    if (entry.status === 'ready') dispose(entry.value);
  };
  const retire = (before, after) => {
    for (const [id, source] of before) {
      const keep = after.get(id)?.entries;
      for (const [key, entry] of source.entries) {
        if (keep?.get(key) !== entry) putAway(entry);
      }
    }
  };

  async function run(entry) {
    entry.status = 'loading';
    entry.controller = new AbortController();
    ++running;
    try {
      let value;
      try {
        // Start after reconciliation, even if the loader throws synchronously.
        await null;
        entry.controller.signal.throwIfAborted();
        value = await load({
          source: entry.source, revision: entry.revision, canonical: entry.canonical,
          controller: entry.controller,
        });
      } catch (error) {
        if (entry.active) {
          entry.error = error;
          entry.status = 'failed';
          changed();
        }
        return;
      }
      if (!entry.active) dispose(value);
      else {
        entry.value = value;
        entry.status = 'ready';
        changed();
      }
    } finally {
      --running;
      pump();
    }
  }

  function pump() {
    if (closed) return;
    for (const {entries} of sources.values()) {
      for (const entry of entries.values()) {
        if (running >= concurrency) return;
        if (entry.status === 'queued') void run(entry);
      }
    }
  }

  // Each plan contains one item per canonical tile, with any wrapped copies.
  // Reconcile by source, explicit revision and canonical key, not world copy.
  function update(plans) {
    if (closed) throw new Error('Flat tile requests are closed');
    const next = new Map();
    for (const [source, {revision, tiles}] of plans) {
      if (revision == null) throw new TypeError('Flat tile sources require a revision');
      const previous = sources.get(source);
      const existing = previous?.revision === revision ? previous.entries : undefined;
      const entries = new Map(), positions = new Map();
      for (const {key, canonical, copies} of tiles) {
        if (entries.has(key)) throw new Error('Duplicate flat canonical tile');
        const entry = existing?.get(key) ?? {
          source, revision, canonical, status: 'queued', active: true,
        };
        entries.set(key, entry);
        positions.set(key, copies);
      }
      next.set(source, {revision, entries, positions});
    }
    const before = sources;
    sources = next;
    retire(before, next);
    pump();
  }

  // The viewport owner schedules its own draw after update. Only an async
  // change to data still in that snapshot triggers the changed callback.
  function snapshot() {
    const frame = new Map(), errors = new Map();
    for (const [source, {entries, positions}] of sources) {
      const ready = [], failed = [];
      for (const [key, entry] of entries) {
        if (entry.status === 'ready') {
          for (const tile of positions.get(key)) ready.push({...entry.value, tile});
        } else if (entry.status === 'failed') failed.push({tile:entry.canonical, error:entry.error});
      }
      frame.set(source, ready);
      if (failed.length) errors.set(source, failed);
    }
    return {frame, errors};
  }

  function close() {
    closed = true;
    const before = sources;
    sources = new Map();
    retire(before, sources);
  }

  return {update, snapshot, close};
}
