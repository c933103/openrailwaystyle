// Glyphs the remote glyph source does not serve, generated on the device
// from the packaged world fonts (world-font.mjs). The style's glyph URL
// serves only some Unicode ranges — 28 of the 256 BMP ranges at the last
// audit; Arabic, Thai, most Indic scripts, Mongolian and more come back
// with a font stack and no glyphs, and MapLibre then drops those
// characters from basemap and railway labels alike. The atlasglyph
// protocol (tile-labels.mjs) passes every downloaded range through
// augment() here: code points the range lacks are drawn with TinySDF —
// the same conversion MapLibre applies to its local glyphs — from the
// packaged slices for the character's script, and merged into the range
// before MapLibre sees it. Generation uses ONLY the packaged families:
// no system family and no generic family is ever in the drawing stack,
// so a device with no font for a script renders the same glyphs as any
// other, and regional designs (Atlas Arabic / Naskh / Nastaliq, ...)
// stay distinct. Characters whose script has no packaged family are left
// missing, exactly as the remote source leaves them.
import Pbf from 'pbf';
import TinySDF from '@mapbox/tiny-sdf';
import {WORLD_FONT_FAMILIES} from './world-font.mjs';

// The glyph PBF geometry of the remote source (fontnik): 24 px font,
// 3 px border, signed distances over an 8 px radius.
export const GLYPH_FONT_SIZE = 24, GLYPH_BUFFER = 3, GLYPH_RADIUS = 8, GLYPH_CUTOFF = 0.25;

// --- Glyph PBF (fontstacks message: stack{name, range, glyphs[]}) ------
function readGlyph(tag, glyph, pbf) {
  if (tag === 1) glyph.id = pbf.readVarint();
  else if (tag === 2) glyph.bitmap = pbf.readBytes();
  else if (tag === 3) glyph.width = pbf.readVarint();
  else if (tag === 4) glyph.height = pbf.readVarint();
  else if (tag === 5) glyph.left = pbf.readSVarint();
  else if (tag === 6) glyph.top = pbf.readSVarint();
  else if (tag === 7) glyph.advance = pbf.readVarint();
}
function readStack(tag, stack, pbf) {
  if (tag === 1) stack.name = pbf.readString();
  else if (tag === 2) stack.range = pbf.readString();
  else if (tag === 3) stack.glyphs.push(pbf.readMessage(readGlyph, {}));
}
export function decodeGlyphPbf(bytes) {
  const stacks = new Pbf(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).readFields(
    (tag, stacks, pbf) => { if (tag === 1) stacks.push(pbf.readMessage(readStack, {glyphs: []})); }, []);
  for (const stack of stacks) if (typeof stack.name !== 'string' || typeof stack.range !== 'string') throw new Error('Glyph stack without a name or range');
  return stacks;
}
function writeGlyph(glyph, pbf) {
  pbf.writeVarintField(1, glyph.id);
  if (glyph.bitmap?.length) pbf.writeBytesField(2, glyph.bitmap);
  pbf.writeVarintField(3, glyph.width || 0);
  pbf.writeVarintField(4, glyph.height || 0);
  pbf.writeSVarintField(5, glyph.left || 0);
  pbf.writeSVarintField(6, glyph.top || 0);
  pbf.writeVarintField(7, Math.round(glyph.advance || 0));
}
function writeStack(stack, pbf) {
  pbf.writeStringField(1, stack.name);
  pbf.writeStringField(2, stack.range);
  for (const glyph of stack.glyphs) pbf.writeMessage(3, writeGlyph, glyph);
}
export function encodeGlyphPbf(stacks) {
  const pbf = new Pbf();
  for (const stack of stacks) pbf.writeMessage(1, writeStack, stack);
  return pbf.finish();
}

// --- Which packaged families draw a code point --------------------------
// Font routing only: the families (ids in world-font.mjs) that may draw
// each range, in priority order, with the language whose regional forms
// apply where a script's variants are OpenType features of one design.
// Ranges with no route have no packaged family: CJK ideographs, kana and
// Hangul (the packaged CJK fonts and the rare Han slices serve those),
// historic scripts, and scripts Noto does not ship a living design for.
const ROUTES = [
  [0x0000, 0x036F, ['base']],                       // Latin, IPA, combining diacritics
  [0x0370, 0x03FF, ['base']],                       // Greek and Coptic (Coptic letters are in the base design)
  [0x0400, 0x052F, ['base']],                       // Cyrillic and its supplement
  [0x0530, 0x058F, ['armenian']],
  [0x0590, 0x05FF, ['hebrew']],
  [0x0700, 0x074F, ['syriac']],
  [0x0780, 0x07BF, ['thaana']],
  [0x07C0, 0x07FF, ['nko']],
  [0x0900, 0x097F, ['devanagari']],
  [0x0980, 0x09FF, ['bengali']],                    // Bengali and Assamese share the design
  [0x0A00, 0x0A7F, ['gurmukhi']],
  [0x0A80, 0x0AFF, ['gujarati']],
  [0x0B00, 0x0B7F, ['oriya']],
  [0x0B80, 0x0BFF, ['tamil']],
  [0x0C00, 0x0C7F, ['telugu']],
  [0x0C80, 0x0CFF, ['kannada']],
  [0x0D00, 0x0D7F, ['malayalam']],
  [0x0D80, 0x0DFF, ['sinhala']],
  [0x0E00, 0x0E7F, ['thai']],
  [0x0E80, 0x0EFF, ['lao']],
  [0x0F00, 0x0FFF, ['tibetan']],
  [0x1000, 0x109F, ['myanmar']],
  [0x10A0, 0x10FF, ['georgian']],
  [0x1200, 0x139F, ['ethiopic']],
  [0x13A0, 0x13FF, ['cherokee']],
  [0x1400, 0x167F, ['canadian-aboriginal']],
  [0x1780, 0x17FF, ['khmer']],
  [0x1800, 0x18AF, ['mongolian']],
  [0x19E0, 0x19FF, ['khmer']],                      // Khmer symbols
  [0x1C80, 0x1C8F, ['base']],                       // Cyrillic Extended-C
  [0x1D00, 0x1DFF, ['base']],                       // Phonetic extensions
  [0x1E00, 0x1EFF, ['base']],                       // Latin Extended Additional (Vietnamese)
  [0x1F00, 0x1FFF, ['base']],                       // Greek Extended
  [0x2000, 0x206F, ['base', 'symbols']],            // General punctuation
  [0x2070, 0x20FF, ['base', 'symbols']],            // Super/subscripts, currency
  [0x2100, 0x218F, ['base', 'symbols']],            // Letterlike, number forms
  [0x2190, 0x21FF, ['symbols', 'base']],            // Arrows
  [0x2200, 0x22FF, ['math', 'symbols', 'base']],    // Mathematical operators
  [0x2300, 0x27BF, ['symbols', 'symbols2', 'base']],// Technical, enclosed, box, geometric, dingbats
  [0x27C0, 0x27EF, ['math', 'symbols2']],
  [0x27F0, 0x29FF, ['symbols2', 'math']],
  [0x2A00, 0x2AFF, ['math']],
  [0x2B00, 0x2BFF, ['symbols2', 'symbols']],
  [0x2C60, 0x2C7F, ['base']],                       // Latin Extended-C
  [0x2D00, 0x2D2F, ['georgian']],                   // Georgian Supplement
  [0x2D30, 0x2D7F, ['tifinagh']],
  [0x2D80, 0x2DDF, ['ethiopic']],                   // Ethiopic Extended
  [0x2DE0, 0x2DFF, ['base']],                       // Cyrillic Extended-A
  [0xA640, 0xA69F, ['base']],                       // Cyrillic Extended-B
  [0xA700, 0xA71F, ['base']],                       // Modifier tone letters
  [0xA720, 0xA7FF, ['base']],                       // Latin Extended-D
  [0xA8E0, 0xA8FF, ['devanagari']],                 // Combining Devanagari
  [0xA9E0, 0xA9FF, ['myanmar']],                    // Myanmar Extended-B
  [0xAA60, 0xAA7F, ['myanmar']],                    // Myanmar Extended-A
  [0xAB00, 0xAB2F, ['ethiopic']],                   // Ethiopic Extended-A
  [0xAB30, 0xAB6F, ['base']],                       // Latin Extended-E
  [0xAB70, 0xABBF, ['cherokee']],                   // Cherokee Supplement
  [0xFB00, 0xFB12, ['base']],                       // Latin ligatures
  [0xFB13, 0xFB17, ['armenian']],                   // Armenian ligatures
  [0xFB1D, 0xFB4F, ['hebrew']],                     // Hebrew presentation forms
  [0xFE20, 0xFE2F, ['base']],                       // Combining half marks
  [0xFE50, 0xFE6F, ['base']],                       // Small form variants
  [0x11B00, 0x11B5F, ['devanagari']],               // Devanagari Extended-A
  [0x11C70, 0x11CBF, ['tamil']],                    // Tamil Supplement
  [0x11660, 0x1167F, ['mongolian']],                // Mongolian Supplement
  [0x1D400, 0x1D7FF, ['math']],                     // Mathematical alphanumerics
  [0x1E030, 0x1E08F, ['base']],                     // Cyrillic Extended-D
  [0x1F000, 0x1F02F, ['symbols2']],                 // Mahjong, dominoes
  [0x1F0A0, 0x1F0FF, ['symbols2']],                 // Playing cards
  [0x1F100, 0x1F1FF, ['symbols2']],                 // Enclosed alphanumeric supplement
  [0x1F300, 0x1FAFF, ['symbols2']],                 // Pictographs and symbols (monochrome designs)
];
// The Arabic script's regional designs are distinct families. Urdu's own
// letters (the aspirated and retroflex additions) route to the Nastaliq
// design; the Persian additions route to the Sans design, whose forms are
// the Persian ones; everything else follows the label language when it is
// an Arabic-script one, else the Sans design with Naskh behind it.
const URDU_LETTERS = new Set([0x0679, 0x0688, 0x0691, 0x06BE, 0x06C1, 0x06D2, 0x06D3]);
const PERSIAN_LETTERS = new Set([0x067E, 0x0686, 0x0698, 0x06A9, 0x06AF, 0x06CC]);
const ARABIC_RANGES = [[0x0600, 0x06FF], [0x0750, 0x077F], [0x08A0, 0x08FF], [0xFB50, 0xFDFF], [0xFE70, 0xFEFF]];
function arabicRoute(code, language) {
  if (URDU_LETTERS.has(code)) return {families: ['nastaliq', 'arabic', 'naskh'], lang: 'ur'};
  if (PERSIAN_LETTERS.has(code) || (code >= 0x06F0 && code <= 0x06F9)) return {families: ['arabic', 'naskh'], lang: 'fa'};
  if (language === 'ur') return {families: ['nastaliq', 'arabic', 'naskh'], lang: 'ur'};
  if (language === 'fa') return {families: ['arabic', 'naskh'], lang: 'fa'};
  return {families: ['arabic', 'naskh'], lang: 'ar'};
}
export function routeForCodePoint(code, language = 'local') {
  if (ARABIC_RANGES.some(([first, last]) => code >= first && code <= last)) return arabicRoute(code, language);
  for (const [first, last, families] of ROUTES) if (code >= first && code <= last) return {families, lang: undefined};
  return null;
}
// The drawing stack for a code point: packaged family names only.
export function generationStack(code, language = 'local') {
  const route = routeForCodePoint(code, language);
  if (!route) return null;
  return {families: route.families.map(id => WORLD_FONT_FAMILIES[id]), ids: route.families, lang: route.lang};
}
export const glyphWeight = stackName => /\bbold\b/i.test(String(stackName).split(',')[0]) ? 700 : 400;
const isControl = code => /^\p{Cc}$/u.test(String.fromCodePoint(code));

// The default drawer: TinySDF over a canvas, one instance per stack. The
// metrics follow the remote source's convention (see
// scripts/build-browser-glyph-fixture.py): left is the ink's left edge
// from the pen origin, top is the ink's top relative to the font's
// ascent line, advance and sizes in 24 px units. A character no packaged
// font can draw comes back as the fonts' .notdef (or nothing); the
// sentinel — U+10FFFF, unassigned in every font — identifies it, so a
// missing glyph stays missing instead of becoming a box.
export function createCanvasDrawer() {
  const instances = new Map();
  const instance = (families, weight, lang) => {
    const key = `${weight}|${lang || ''}|${families.join(',')}`;
    let entry = instances.get(key);
    if (!entry) {
      const sdf = new TinySDF({fontSize: GLYPH_FONT_SIZE, buffer: GLYPH_BUFFER, radius: GLYPH_RADIUS, cutoff: GLYPH_CUTOFF,
        fontFamily: families.map(name => `"${name}"`).join(','), fontWeight: String(weight), lang});
      entry = {sdf, sentinel: sdf.draw('\u{10FFFF}')};
      instances.set(key, entry);
    }
    return entry;
  };
  return (char, {families, weight, lang}) => {
    const {sdf, sentinel} = instance(families, weight, lang);
    const drawn = sdf.draw(char);
    if (!drawn.glyphWidth || !drawn.glyphHeight) {
      // No ink: a spacing character still needs its advance (a space the
      // packaged font knows), anything else stays missing.
      return drawn.glyphAdvance > 0 ? {bitmap: drawn.data, width: 0, height: 0, left: 0, top: -GLYPH_FONT_SIZE, advance: drawn.glyphAdvance} : null;
    }
    if (drawn.glyphWidth === sentinel.glyphWidth && drawn.glyphHeight === sentinel.glyphHeight
      && drawn.data.length === sentinel.data.length && drawn.data.every((value, i) => value === sentinel.data[i])) return null;
    const ascent = sdf.ctx.measureText(char).fontBoundingBoxAscent || GLYPH_FONT_SIZE;
    return {bitmap: drawn.data, width: drawn.glyphWidth, height: drawn.glyphHeight,
      left: drawn.glyphLeft, top: Math.round(drawn.glyphTop - ascent), advance: drawn.glyphAdvance};
  };
}

// createGlyphFallback({worldFonts, drawGlyph, language}) → {augment,
// invalidate}. augment(url, bytes) returns the range with its missing
// code points generated, or the original bytes whenever anything about
// the range is unexpected or generation fails: a labelling failure must
// not hide map data. Results are cached per stack and range (bounded);
// invalidate(keys) drops the ranges a late-loading slice can improve.
export function createGlyphFallback({worldFonts, drawGlyph = createCanvasDrawer(), language = () => 'local', cacheSize = 256} = {}) {
  const cache = new Map();
  const remember = (key, block, value) => {
    cache.set(key, {block, value});
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
    return value;
  };
  async function augment(url, bytes) {
    try {
      const parts = new URL(url).pathname.split('/'), range = /^(\d+)-(\d+)$/.exec(parts.at(-1).replace(/\.pbf$/, ''));
      if (!range) return bytes;
      const stackName = decodeURIComponent(parts.at(-2)), first = Number(range[1]), block = first >> 8;
      const key = `${stackName}|${first}`;
      if (cache.has(key)) return cache.get(key).value;
      const stacks = decodeGlyphPbf(bytes);
      if (stacks.length !== 1) return remember(key, block, bytes);
      const stack = stacks[0], present = new Set(stack.glyphs.map(glyph => glyph.id));
      const weight = glyphWeight(stackName), lang = language();
      const missing = [];
      for (let code = first; code <= first + 255; code++) {
        if (present.has(code) || (code >= 0xD800 && code <= 0xDFFF) || isControl(code)) continue;
        const route = generationStack(code, lang);
        if (route) missing.push({code, route});
      }
      if (!missing.length) return remember(key, block, bytes);
      if (worldFonts) {
        const requests = new Set();
        for (const {code, route} of missing) for (const family of route.ids) requests.add({family, weight, block: code >> 8});
        try { await worldFonts.ensure(requests); } catch { /* slices are best effort; drawing proceeds */ }
      }
      const generated = [];
      for (const {code, route} of missing) {
        const glyph = drawGlyph(String.fromCodePoint(code), {families: route.families, weight, lang: route.lang});
        if (glyph) generated.push({id: code, ...glyph});
      }
      if (!generated.length) return remember(key, block, bytes);
      stack.glyphs = [...stack.glyphs, ...generated].sort((a, b) => a.id - b.id);
      const encoded = encodeGlyphPbf(stacks);
      return remember(key, block, encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength));
    } catch {
      return bytes;
    }
  }
  function invalidate(keys) {
    const blocks = new Set([...keys].map(key => Number(String(key).split(':')[2])));
    for (const [key, entry] of cache) if (blocks.has(entry.block)) cache.delete(key);
  }
  return {augment, invalidate};
}
