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
// The same from UTF-8 bytes (a vector tile whose names are drawn as
// stored): U+20000-U+3FFFF are the 4-byte sequences F0 A0-BF xx xx.
export function rareHanBlocksInBytes(data, into = new Set()) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || new ArrayBuffer(0));
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] !== 0xF0 || bytes[i + 1] < 0xA0 || bytes[i + 1] > 0xBF) continue;
    const b2 = bytes[i + 2], b3 = bytes[i + 3];
    if ((b2 & 0xC0) !== 0x80 || (b3 & 0xC0) !== 0x80) continue;
    // The lead byte F0 contributes no bits; A0-BF gives 0x20-0x3F << 12.
    into.add((((bytes[i + 1] & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F)) >> 8);
    i += 3;
  }
  return into;
}
const hex = value => value.toString(16).toUpperCase();
export const rareHanRange = block => `U+${hex(block << 8)}-${hex((block << 8) + 255)}`;

// ensure(blocks) resolves once those slices are loaded, after `wait` ms, or
// at once for blocks without a slice; it never rejects, so a missing font
// cannot hold back the map. A failed slice or index is retried only after
// `retryDelay`, not by every tile that needs it.
export function createRareHanFonts({root, fetcher = fetch, FontFace = globalThis.FontFace, fonts = globalThis.document?.fonts, wait = 8000, retryDelay = 60000, now = Date.now} = {}) {
  const loads = new Map(), failed = new Map();
  let index, indexRetry = 0;
  const available = () => {
    if (!index && now() >= indexRetry) {
      index = Promise.resolve().then(() => fetcher(new URL('index.json', root).href))
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then(data => new Set(Array.isArray(data?.blocks) ? data.blocks : []))
        .catch(() => { index = undefined; indexRetry = now() + retryDelay; return new Set(); });
    }
    return index || Promise.resolve(new Set());
  };
  const load = block => {
    if (loads.has(block)) return loads.get(block);
    if (now() < (failed.get(block) ?? 0)) return Promise.resolve(false);
    const url = new URL(`${block.toString(16).padStart(3, '0')}.woff2`, root).href;
    const face = new FontFace(RARE_HAN_FAMILY, `url("${url}")`, {unicodeRange: rareHanRange(block)});
    fonts.add(face);
    const pending = face.load().then(() => true, () => {
      fonts.delete(face); loads.delete(block); failed.set(block, now() + retryDelay);
      return false;
    });
    loads.set(block, pending);
    return pending;
  };
  async function ensure(blocks) {
    if (!blocks?.size || !FontFace || !fonts) return;
    const have = await available();
    const pending = [...blocks].filter(block => have.has(block)).map(load);
    if (!pending.length) return;
    let timer;
    await Promise.race([Promise.all(pending), new Promise(resolve => { timer = setTimeout(resolve, wait); })]);
    clearTimeout(timer);
  }
  return {ensure};
}
