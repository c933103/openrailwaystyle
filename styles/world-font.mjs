// Packaged fonts for the local scripts of common languages
// (scripts/build-world-fonts.py), generalising the packaged CJK fonts: the
// remote glyph source serves only some Unicode ranges, so characters it
// lacks are generated on the device from these slices instead
// (glyph-fallback.mjs). A device with no font for a script therefore still
// renders its names, and every device renders the same glyphs. Regional
// designs are separate families — Arabic alone has three (the Sans design,
// Naskh and the Urdu Nastaliq) — because a name must be drawn in its own
// region's forms, never in one region's forms silently shipped as
// universal. Slices hold one family, one weight and 256 code points; only
// slices for characters in labels about to be drawn are fetched.
export const WORLD_FONT_FAMILIES = {
  base: 'Atlas Sans',
  arabic: 'Atlas Arabic',
  naskh: 'Atlas Naskh',
  nastaliq: 'Atlas Nastaliq',
  hebrew: 'Atlas Hebrew',
  armenian: 'Atlas Armenian',
  georgian: 'Atlas Georgian',
  devanagari: 'Atlas Devanagari',
  bengali: 'Atlas Bengali',
  gurmukhi: 'Atlas Gurmukhi',
  gujarati: 'Atlas Gujarati',
  oriya: 'Atlas Oriya',
  tamil: 'Atlas Tamil',
  telugu: 'Atlas Telugu',
  kannada: 'Atlas Kannada',
  malayalam: 'Atlas Malayalam',
  sinhala: 'Atlas Sinhala',
  thai: 'Atlas Thai',
  lao: 'Atlas Lao',
  myanmar: 'Atlas Myanmar',
  tibetan: 'Atlas Tibetan',
  khmer: 'Atlas Khmer',
  ethiopic: 'Atlas Ethiopic',
  mongolian: 'Atlas Mongolian',
  syriac: 'Atlas Syriac',
  tifinagh: 'Atlas Tifinagh',
  thaana: 'Atlas Thaana',
  nko: 'Atlas Nko',
  'canadian-aboriginal': 'Atlas Canadian Aboriginal',
  cherokee: 'Atlas Cherokee',
  symbols: 'Atlas Symbols',
  symbols2: 'Atlas Symbols 2',
  math: 'Atlas Math',
};
const hex = value => value.toString(16).toUpperCase();
export const worldFontRange = block => `U+${hex(block << 8).padStart(4, '0')}-${hex((block << 8) + 255).padStart(4, '0')}`;
export const worldFontKey = ({family, weight, block}) => `${family}:${weight}:${block}`;

// ensure(requests) takes a Set of {family, weight, block} (family ids, as
// in WORLD_FONT_FAMILIES and the published index) and resolves once those
// slices are loaded, after `wait` ms (the index included), or at once for
// slices the index does not list; it never rejects, so a missing font
// cannot hold back the map. Failure and retry handling mirror
// rare-han.mjs: a failed slice or index is retried only after a delay
// (doubling on each further failure up to 16 times), also without a new
// request when a glyph released without its slice is still waiting; an
// index request still unanswered after `indexTimeout` counts as failed.
// A slice that loads after its glyphs were released without it calls
// onLoad(keys) (gathered over `notifyDelay` ms) so the app can drop the
// cached glyphs drawn without it and redraw.
export function createWorldFonts({root, fetcher = fetch, FontFace = globalThis.FontFace, fonts = globalThis.document?.fonts, wait = 8000, retryDelay = 60000, indexTimeout = 30000, now = Date.now, onLoad, notifyDelay = 1000} = {}) {
  const loads = new Map(), failed = new Map(), loaded = new Set(), missed = new Set(), late = new Set();
  const attempts = new Map();
  let index, indexRetry = 0, notifyTimer;
  const backoff = key => { const n = attempts.get(key) ?? 0; attempts.set(key, n + 1); return retryDelay * 2 ** Math.min(n, 4); };
  const retryLater = delay => {
    const timer = setTimeout(() => {
      if (missed.size) available().then(have => { for (const key of missed) if (have.has(key)) load(key); });
    }, delay + 50);
    timer.unref?.();
  };
  const notify = key => {
    late.add(key);
    notifyTimer ??= setTimeout(() => { notifyTimer = undefined; const keys = new Set(late); late.clear(); onLoad?.(keys); }, notifyDelay);
  };
  const available = () => {
    if (!index && now() >= indexRetry) {
      let timer;
      const request = Promise.resolve().then(() => fetcher(new URL('index.json', root).href))
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)));
      index = Promise.race([request, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Index timed out')), indexTimeout); })])
        .finally(() => clearTimeout(timer))
        .then(data => {
          attempts.delete('index');
          const keys = new Set();
          for (const [family, weights] of Object.entries(data?.families || {}))
            for (const [weight, blocks] of Object.entries(weights || {}))
              if (Array.isArray(blocks)) for (const block of blocks) keys.add(`${family}:${weight}:${block}`);
          return keys;
        })
        .catch(() => { const delay = backoff('index'); index = undefined; indexRetry = now() + delay; retryLater(delay); return new Set(); });
    }
    return index || Promise.resolve(new Set());
  };
  const load = key => {
    if (loads.has(key)) return loads.get(key);
    if (now() < (failed.get(key) ?? 0)) return Promise.resolve(false);
    const [family, weight, block] = key.split(':'), blockNumber = Number(block);
    const url = new URL(`${family}-${weight}-${blockNumber.toString(16).padStart(3, '0')}.woff2`, root).href;
    const face = new FontFace(WORLD_FONT_FAMILIES[family] || family, `url("${url}")`, {unicodeRange: worldFontRange(blockNumber), weight: String(weight)});
    fonts.add(face);
    const pending = face.load().then(() => {
      loaded.add(key); attempts.delete(key);
      if (missed.delete(key)) notify(key);
      return true;
    }, () => {
      const delay = backoff(key);
      fonts.delete(face); loads.delete(key); failed.set(key, now() + delay); retryLater(delay);
      return false;
    });
    loads.set(key, pending);
    return pending;
  };
  async function ensure(requests) {
    if (!requests?.size || !FontFace || !fonts) return;
    const keys = [...requests].map(worldFontKey);
    const work = available().then(have => Promise.all(keys.filter(key => have.has(key)).map(load)));
    let timer;
    await Promise.race([work, new Promise(resolve => { timer = setTimeout(resolve, wait); })]);
    clearTimeout(timer);
    for (const key of keys) if (!loaded.has(key)) missed.add(key);
  }
  return {ensure, isLoaded: key => loaded.has(worldFontKey(key))};
}
