// Rare Han characters (CJK Extensions B to J, U+20000-U+3FFFF) that the
// packaged or installed Chinese font lacks come from Jigmo slices of 256 code
// points each (scripts/build-rare-han.py), fetched only for characters in
// labels about to be drawn. MapLibre draws each Han glyph once with the
// layer's font stack and keeps the bitmap, and a canvas does not wait for a
// font it has not loaded, so a tile's slices load before the tile is handed
// to the map. The family follows the Chinese family in every stack, so an
// installed or packaged glyph still wins.
export const RARE_HAN_FAMILY = 'Atlas Rare Han';
export const RARE_HAN_FIRST = 0x20000, RARE_HAN_LAST = 0x3FFFF;

// The 256-code-point blocks of the rare characters in text, added to `into`.
export function rareHanBlocks(text, into = new Set()) {
  if (typeof text !== 'string') return into;
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code >= RARE_HAN_FIRST && code <= RARE_HAN_LAST) into.add(code >> 8);
  }
  return into;
}
const hex = value => value.toString(16).toUpperCase();
export const rareHanRange = block => `U+${hex(block << 8)}-${hex((block << 8) + 255)}`;

// ensure(blocks) resolves once those slices are loaded, after `wait` ms
// (the index included), or at once for blocks without a slice; it never
// rejects, so a missing font cannot hold back the map. A failed slice or
// index is retried only after `retryDelay` (doubling on each further failure
// up to 16 times), not by every tile that needs it, and then also without a
// new tile when a label released without its slice is still waiting; an
// index request still unanswered after `indexTimeout` counts as failed.
// MapLibre keeps the bitmap of a glyph drawn before its slice arrived, so a
// slice that loads after a tile was released without it calls onLoad(blocks)
// (gathered over `notifyDelay` ms) for the app to redraw its labels.
export function createRareHanFonts({root, fetcher = fetch, FontFace = globalThis.FontFace, fonts = globalThis.document?.fonts, wait = 8000, retryDelay = 60000, indexTimeout = 30000, now = Date.now, onLoad, notifyDelay = 1000} = {}) {
  const loads = new Map(), failed = new Map(), loaded = new Set(), missed = new Set(), late = new Set();
  const attempts = new Map();
  let index, indexRetry = 0, notifyTimer;
  const backoff = key => { const n = attempts.get(key) ?? 0; attempts.set(key, n + 1); return retryDelay * 2 ** Math.min(n, 4); };
  const retryLater = delay => {
    const timer = setTimeout(() => {
      if (missed.size) available().then(have => { for (const block of missed) if (have.has(block)) load(block); });
    }, delay + 50);
    timer.unref?.();
  };
  const notify = block => {
    late.add(block);
    notifyTimer ??= setTimeout(() => { notifyTimer = undefined; const blocks = new Set(late); late.clear(); onLoad?.(blocks); }, notifyDelay);
  };
  const available = () => {
    if (!index && now() >= indexRetry) {
      let timer;
      const request = Promise.resolve().then(() => fetcher(new URL('index.json', root).href))
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)));
      index = Promise.race([request, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Index timed out')), indexTimeout); })])
        .finally(() => clearTimeout(timer))
        .then(data => { attempts.delete('index'); return new Set(Array.isArray(data?.blocks) ? data.blocks : []); })
        .catch(() => { const delay = backoff('index'); index = undefined; indexRetry = now() + delay; retryLater(delay); return new Set(); });
    }
    return index || Promise.resolve(new Set());
  };
  const load = block => {
    if (loads.has(block)) return loads.get(block);
    if (now() < (failed.get(block) ?? 0)) return Promise.resolve(false);
    const url = new URL(`${block.toString(16).padStart(3, '0')}.woff2`, root).href;
    const face = new FontFace(RARE_HAN_FAMILY, `url("${url}")`, {unicodeRange: rareHanRange(block)});
    fonts.add(face);
    const pending = face.load().then(() => {
      loaded.add(block); attempts.delete(block);
      if (missed.delete(block)) notify(block);
      return true;
    }, () => {
      const delay = backoff(block);
      fonts.delete(face); loads.delete(block); failed.set(block, now() + delay); retryLater(delay);
      return false;
    });
    loads.set(block, pending);
    return pending;
  };
  async function ensure(blocks) {
    if (!blocks?.size || !FontFace || !fonts) return;
    const work = available().then(have => Promise.all([...blocks].filter(block => have.has(block)).map(load)));
    let timer;
    await Promise.race([work, new Promise(resolve => { timer = setTimeout(resolve, wait); })]);
    clearTimeout(timer);
    for (const block of blocks) if (!loaded.has(block)) missed.add(block);
  }
  return {ensure};
}
