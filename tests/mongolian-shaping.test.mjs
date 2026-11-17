import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {
  atlasMongolianShapeText, atlasMongolianVerticalize,
  encodeMongolianForm, decodeMongolianForm, isMongolianFormCode, mongolianLetterIndex,
} from '../styles/mongolian-shaping.mjs';
import {
  createCanvasDrawer, createGlyphFallback, decodeGlyphPbf, emptyGlyphRangePbf,
  encodeGlyphPbf, rotateFormGlyph, routeForCodePoint,
} from '../styles/glyph-fallback.mjs';
import {MAPLIBRE_BACKPORT, backportMapLibre524} from '../styles/map-controls.mjs';

const codes = text => [...atlasMongolianShapeText(text)].map(char => char.codePointAt(0));
const A = 0x1820; // ᠠ MONGOLIAN LETTER A, index 0
const form = (letter, position, fvs = 0) => encodeMongolianForm(letter, position, fvs);

test('joining forms: an isolated letter and words of two, three and more letters', () => {
  assert.deepEqual(codes('ᠠ'), [form(A, 0)], 'a lone letter is isolated');
  assert.deepEqual(codes('ᠠᠠ'), [form(A, 1), form(A, 3)], 'two letters: initial, final');
  assert.deepEqual(codes('ᠠᠠᠠ'), [form(A, 1), form(A, 2), form(A, 3)], 'three letters: initial, medial, final');
  assert.deepEqual(codes('ᠠᠠᠠᠠ'), [form(A, 1), form(A, 2), form(A, 2), form(A, 3)], 'inner letters are medial');
});

test('joining forms: the Ulaanbaatar mixed label shapes only its Mongolian run', () => {
  const label = 'Улаанбаатар ᠤᠯᠠᠭᠠᠨᠪᠠᠭᠠᠲᠤᠷ';
  const shaped = atlasMongolianShapeText(label);
  assert.equal([...shaped].length, [...label].length, 'substitution is one-for-one');
  const out = codes(label);
  assert.deepEqual(out.slice(0, 12), [...'Улаанбаатар '].map(char => char.codePointAt(0)), 'Cyrillic and the space are untouched');
  const run = out.slice(12);
  assert.equal(run.length, 13);
  assert.equal(run[0], form(0x1824, 1), 'first letter initial');
  assert.ok(run.slice(1, -1).every(code => decodeMongolianForm(code).form === 2), 'inner letters medial');
  assert.equal(run.at(-1), form(0x1837, 3), 'last letter final');
});

test('joining forms: spaces, digits and other scripts break a run', () => {
  assert.deepEqual(codes('ᠠ ᠠ'), [form(A, 0), 0x20, form(A, 0)], 'space');
  assert.deepEqual(codes('ᠠ1ᠠ'), [form(A, 0), 0x31, form(A, 0)], 'digit');
  assert.deepEqual(codes('ᠠБᠠ'), [form(A, 0), 0x411, form(A, 0)], 'Cyrillic');
  assert.deepEqual(codes('ᠠᠠ ᠠᠠ'), [form(A, 1), form(A, 3), 0x20, form(A, 1), form(A, 3)], 'two words shape independently');
});

test('joining forms: FVS selectors attach to the preceding letter and select its variant', () => {
  assert.deepEqual(codes('ᠠ\u180B'), [form(A, 0, 1), 0x180B], 'isolated with FVS1');
  assert.deepEqual(codes('ᠠ\u180Bᠠ'), [form(A, 1, 1), 0x180B, form(A, 3)], 'the selector does not break joining');
  assert.deepEqual(codes('ᠠᠠ\u180F'), [form(A, 1), form(A, 3, 4), 0x180F], 'FVS4 on the final letter');
});

test('joining forms: MVS and NNBSP join forward only; NIRUGU and ZWJ join both ways', () => {
  // ᠬᠠᠨ + MVS + ᠠ: the letter before MVS keeps a joining (medial) form,
  // the letter after MVS starts a new word.
  assert.deepEqual(codes('ᠬᠠᠨ\u180Eᠠ'),
    [form(0x182C, 1), form(A, 2), form(0x1828, 2), 0x180E, form(A, 0)], 'MVS');
  assert.deepEqual(codes('ᠠ\u202Fᠠ'), [form(A, 1), 0x202F, form(A, 0)], 'NNBSP behaves like MVS');
  assert.deepEqual(codes('ᠠ\u180Aᠠ'), [form(A, 1), 0x180A, form(A, 3)], 'NIRUGU joins across');
  assert.deepEqual(codes('\u200Dᠠ'), [0x200D, form(A, 3)], 'a leading ZWJ makes the letter final');
});

test('joining forms: the Mongolian Supplement block joins too, and other scripts are untouched', () => {
  assert.deepEqual(codes('\u{11660}\u{11660}'), [form(0x11660, 1), form(0x11660, 3)]);
  const other = 'abc XYZ 123 العربية 中文';
  assert.equal(atlasMongolianShapeText(other), other);
});

test('the private-use allocation round-trips and stays out of the BMP image-section range', () => {
  for (const [letter, position, fvs] of [[0x1820, 0, 0], [0x1820, 2, 0], [0x1837, 3, 0], [0x18AA, 3, 4], [0x11660, 1, 2], [0x1167F, 3, 4], [0x1824, 1, 1]]) {
    const code = encodeMongolianForm(letter, position, fvs);
    assert.ok(isMongolianFormCode(code), `U+${code.toString(16)} is a form code`);
    assert.ok(code >= 0xF0000, 'plane 15, never the BMP private-use area');
    assert.deepEqual(decodeMongolianForm(code), {base: letter, form: position, fvs});
  }
  assert.equal(mongolianLetterIndex(0x1820), 0);
  assert.equal(mongolianLetterIndex(0x11660), 139);
  assert.equal(mongolianLetterIndex(0x41), -1);
  assert.ok(!isMongolianFormCode(0xE000) && !isMongolianFormCode(0x1820) && !isMongolianFormCode(0xF0DB0));
  assert.equal(decodeMongolianForm(0x41), null);
  assert.equal(encodeMongolianForm(0x41, 0), null);
});

// --- Layout: the vertical restack ----------------------------------------

const positioned = (glyph, x, y, advance = 10, scale = 1) =>
  ({glyph, x, y, vertical: false, scale, metrics: {advance, left: 0, top: 20, width: 8, height: 20}});
const shapingOf = lines => ({positionedLines: lines.map(positionedGlyphs => ({positionedGlyphs})), top: 0, bottom: 24, left: 0, right: 0});

test('verticalize stacks a Mongolian run downward on one x, other glyphs untouched', () => {
  const latin = positioned(0x41, 0, 0), first = positioned(form(A, 1), 10, 0), mid = positioned(form(A, 2), 20, 0),
    last = positioned(form(A, 3), 30, 0), tail = positioned(0x42, 40, 0);
  const shaping = shapingOf([[latin, first, mid, last, tail]]);
  atlasMongolianVerticalize(shaping, 0, 500);
  assert.deepEqual([first.x, mid.x, last.x], [10, 10, 10], 'one column x');
  assert.deepEqual([first.y, mid.y, last.y], [0, 10, 20], 'advance-stacked top to bottom');
  assert.deepEqual([latin.x, latin.y, tail.x, tail.y], [0, 0, 40, 0], 'the rest of the label is unchanged');
  assert.ok(shaping.bottom >= 30, 'the bottom covers the column');
});

test('verticalize honours scale and treats spaces inside a run as vertical gaps', () => {
  const first = positioned(form(A, 1), 0, 0, 10, 0.5), space = positioned(0x20, 10, 0, 6, 0.5), last = positioned(form(A, 3), 20, 0, 10, 0.5);
  const shaping = shapingOf([[first, space, last]]);
  atlasMongolianVerticalize(shaping, 0, 500);
  assert.deepEqual([first.y, space.y, last.y], [0, 5, 8], 'steps are advance × scale, the space included');
  assert.equal(space.x, 0, 'the whole run shares the column x');
});

test('verticalize is a no-op for vertical writing mode and for line placement', () => {
  for (const [writingMode, maxWidth] of [[2, 500], [0, Infinity], [1, Infinity]]) {
    const glyph = positioned(form(A, 1), 10, 0);
    const shaping = shapingOf([[glyph]]);
    atlasMongolianVerticalize(shaping, writingMode, maxWidth);
    assert.deepEqual([glyph.x, glyph.y], [10, 0]);
    assert.equal(shaping.bottom, 24);
  }
});

test('verticalize breaks a long run into columns at the height bound, order preserved', () => {
  const glyphs = Array.from({length: 10}, (_, i) => positioned(form(A, i === 0 ? 1 : i === 9 ? 3 : 2), i * 10, 0));
  const shaping = shapingOf([glyphs]);
  atlasMongolianVerticalize(shaping, 0, 45);
  // Advance sums of 40, 40, 20 against the bound of 45: three columns.
  // No line height is passed, so the pitch is the ink width (8).
  assert.deepEqual(glyphs.map(g => g.x), [0, 0, 0, 0, 8, 8, 8, 8, 16, 16], 'columns progress in +x');
  assert.deepEqual(glyphs.map(g => g.y), [0, 10, 20, 30, 0, 10, 20, 30, 0, 10], 'each column restacks from the top, reading order kept');
  assert.ok(shaping.bottom >= 40, 'the bottom covers the tallest column');
  assert.ok(shaping.right >= 23, 'the right covers the last column’s ink');
});

test('verticalize prefers a break at a space, which stays with the column it ends', () => {
  const first = positioned(form(A, 1), 0, 0), second = positioned(form(A, 2), 10, 0), space = positioned(0x20, 20, 0, 6),
    third = positioned(form(A, 1), 30, 0), fourth = positioned(form(A, 2), 40, 0), fifth = positioned(form(A, 3), 50, 0);
  const shaping = shapingOf([[first, second, space, third, fourth, fifth]]);
  atlasMongolianVerticalize(shaping, 0, 40);
  assert.equal(space.x, first.x, 'the space ends the first column, it does not start the second');
  assert.equal(third.x, first.x + 8, 'the second word starts the second column');
  assert.deepEqual([third.y, fourth.y, fifth.y], [0, 10, 20], 'the second column restacks from the top');
});

test('verticalize breaks mid-word at the bound when a word has no space, and pitches by line height', () => {
  const glyphs = Array.from({length: 6}, (_, i) => positioned(form(A, 2), i * 10, 0));
  const shaping = shapingOf([glyphs]);
  atlasMongolianVerticalize(shaping, 0, 25, 30);
  assert.deepEqual(glyphs.map(g => g.x), [0, 0, 30, 30, 60, 60], 'the pitch is the line height when it exceeds the ink width');
  assert.deepEqual(glyphs.map(g => g.y), [0, 10, 0, 10, 0, 10]);
});

test('verticalize merges a run that horizontal shaping wrapped across two lines', () => {
  // Two words, already wrapped by horizontal shaping at the bound: the
  // second word sits on its own positioned line, one line height lower.
  // Restacking the pieces separately would overlap them at one x; the
  // run must merge and break into columns from its own origin instead.
  const word1 = [positioned(form(A, 1), 0, 0), positioned(form(A, 2), 10, 0), positioned(form(A, 3), 20, 0)];
  const word2 = [positioned(form(A, 1), 0, 24), positioned(form(A, 2), 10, 24), positioned(form(A, 3), 20, 24)];
  const shaping = shapingOf([word1, word2]);
  atlasMongolianVerticalize(shaping, 0, 45, 24);
  // The wrap consumed the space, so no break opportunity survives:
  // the merged run fills the first column to the bound (four glyphs,
  // 40 of 45) and continues in a second column at the line-height
  // pitch, starting at the run’s top — never one line lower at the
  // same x, where the pieces would interleave.
  assert.deepEqual(word1.map(g => [g.x, g.y]), [[0, 0], [0, 10], [0, 20]], 'the first word stacks from the run origin');
  assert.deepEqual(word2.map(g => [g.x, g.y]), [[0, 30], [24, 0], [24, 10]],
    'the second word continues the merged run across the columns');
  assert.ok(shaping.bottom >= 40 && shaping.right >= 31, 'the bounds cover both columns');
});

test('verticalize places a lone glyph taller than the bound anyway', () => {
  const glyph = positioned(form(A, 0), 5, 3, 100);
  const shaping = shapingOf([[glyph]]);
  atlasMongolianVerticalize(shaping, 0, 50);
  assert.deepEqual([glyph.x, glyph.y], [5, 3], 'no break is possible inside one glyph');
  assert.ok(shaping.bottom >= 103, 'the bottom still covers it');
});

// --- Glyph supply ----------------------------------------------------------

test('form codes route to the Mongolian family, and empty astral ranges synthesize', () => {
  assert.deepEqual(routeForCodePoint(form(A, 0)), {families: ['mongolian'], lang: undefined});
  const url = 'https://tuiles.enliberte.fr/fonts/Noto%20Sans%20Regular/983040-983295.pbf';
  const stacks = decodeGlyphPbf(emptyGlyphRangePbf(url));
  assert.deepEqual(stacks, [{name: 'Noto Sans Regular', range: '983040-983295', glyphs: []}]);
  assert.equal(emptyGlyphRangePbf('https://example.org/style.json'), null);
});

test('rotateFormGlyph rotates the padded grid clockwise and remaps the metrics', () => {
  // A 2×1 ink box (grid 8×7 with the 3 px buffer) with one hot corner.
  const bitmap = new Uint8ClampedArray(8 * 7);
  bitmap[0] = 255; // grid (0,0): the padded top-left
  const rotated = rotateFormGlyph({bitmap, width: 2, height: 1, left: 1, top: -16, advance: 12}, 24);
  assert.equal(rotated.width, 1);
  assert.equal(rotated.height, 2);
  assert.equal(rotated.bitmap.length, bitmap.length);
  assert.equal(rotated.bitmap.reduce((sum, value) => sum + value, 0), 255, 'ink is preserved');
  assert.equal(rotated.bitmap[6], 255, 'the top-left corner lands at the top-right: a clockwise quarter turn');
  assert.deepEqual({left: rotated.left, top: rotated.top, advance: rotated.advance}, {left: 7, top: -25, advance: 12});
});

// A canvas stand-in for the real TinySDF pipeline: measureText reports
// deterministic, context-dependent ink boxes and fillText paints a
// hash-dependent ink pattern, so each joining context of a letter yields
// a different glyph, and U+10FFFF yields the .notdef sentinel.
const textHash = text => { let hash = 2166136261; for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); } return hash >>> 0; };
class FakeContext {
  static drawn = [];
  constructor() { this.ink = null; }
  measureText(text) {
    const width = [...text].reduce((sum, char) => sum + (char === '\u200D' || '\u180B' <= char && char <= '\u180F' ? 0 : 10), 0);
    if (text === '\u{10FFFF}') return {width, actualBoundingBoxAscent: 4, actualBoundingBoxDescent: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 4, fontBoundingBoxAscent: 24};
    const hash = textHash(text);
    return {width, actualBoundingBoxAscent: 10 + hash % 5, actualBoundingBoxDescent: 2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 5 + hash % 3, fontBoundingBoxAscent: 24};
  }
  clearRect() { this.ink = null; }
  fillText(text, x, y) {
    FakeContext.drawn.push(text);
    const metrics = this.measureText(text);
    this.ink = {x, top: y - metrics.actualBoundingBoxAscent, width: metrics.actualBoundingBoxRight, height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent, hash: textHash(text)};
  }
  getImageData(x, y, width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    if (this.ink) for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const gx = x + col - this.ink.x, gy = y + row - this.ink.top;
      if (gx >= 0 && gx < this.ink.width && gy >= 0 && gy < this.ink.height && ((this.ink.hash >>> ((gx * 3 + gy * 5) % 29)) & 1) === 1)
        data[(row * width + col) * 4 + 3] = 255;
    }
    return {data};
  }
}
class FakeOffscreenCanvas {
  constructor() { this.context = new FakeContext(); }
  getContext() { return this.context; }
}

test('the canvas drawer generates the four forms of a letter as distinct rotated glyphs', () => {
  const previous = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = FakeOffscreenCanvas;
  try {
    FakeContext.drawn = [];
    const draw = createCanvasDrawer();
    const options = {families: ['Atlas Mongolian'], weight: 400, lang: undefined};
    const forms = [0, 1, 2, 3].map(position => draw(String.fromCodePoint(form(A, position)), options));
    assert.ok(forms.every(glyph => glyph), 'every form generates');
    const keys = forms.map(glyph => `${glyph.width}x${glyph.height}:${Buffer.from(glyph.bitmap).toString('base64')}`);
    assert.equal(new Set(keys).size, 4, 'the four forms have distinct bitmaps');
    assert.ok(FakeContext.drawn.includes('ᠠ\u200D'), 'initial context: letter + ZWJ');
    assert.ok(FakeContext.drawn.includes('\u200Dᠠ\u200D'), 'medial context: ZWJ + letter + ZWJ');
    assert.ok(FakeContext.drawn.includes('\u200Dᠠ'), 'final context: ZWJ + letter');
    const horizontal = draw('ᠠ', options);
    assert.equal(forms[0].width, horizontal.height, 'the bitmap is rotated: width and height swap');
    assert.equal(forms[0].height, horizontal.width);
    assert.ok(forms.every(glyph => glyph.advance === 10), 'each form keeps the letter advance');
    assert.equal(draw(String.fromCodePoint(form(0x11660, 0)), options)?.advance, 10, 'supplement letters generate too');
  } finally {
    if (previous === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = previous;
  }
});

test('augment fills an astral form range from the packaged Mongolian route', async () => {
  const requests = [];
  const worldFonts = {ensure: async set => requests.push([...set])};
  const drawGlyph = (char, options) => ({bitmap: new Uint8Array(36), width: 1, height: 1, left: 0, top: -1, advance: 10});
  const fallback = createGlyphFallback({worldFonts, drawGlyph});
  const url = 'https://tuiles.enliberte.fr/fonts/Noto%20Sans%20Regular/983040-983295.pbf';
  const stacks = decodeGlyphPbf(await fallback.augment(url, emptyGlyphRangePbf(url)));
  assert.equal(stacks[0].glyphs.length, 256, 'the whole 0xF0000 block generates');
  assert.ok(stacks[0].glyphs.some(glyph => glyph.id === form(A, 0)));
  assert.ok(requests[0].some(request => request.family === 'mongolian' && request.block === 0x18),
    'the base Mongolian slice is ensured, not a private-use slice');
});

// --- Continuity: the stacked column's spine must not break ---------------
//
// A shaping-faithful canvas stand-in: measureText returns the values
// measured in Blink for the packaged Atlas Mongolian font at 24 px for
// each joining context of the test word (width, actualBoundingBoxLeft,
// actualBoundingBoxRight, actualBoundingBoxAscent,
// actualBoundingBoxDescent), and fillText paints that context's joining
// spine — a band 11 px above the baseline, spanning the letter's
// advance share of the context, which is how the shaped word's spine
// runs. So the real TinySDF + rotation + PBF pipeline runs on geometry
// with the same advances, bearings and ink extents as the browser.
// Strings outside the table (the other letters of the generated range)
// get a generic box; only the word's forms are load-bearing.
const SPINE_ZWJ = '\u200D';
const SPINE_METRICS = new Map(Object.entries({
  '': [0, 0, 0, 0, 0],
  [SPINE_ZWJ]: [0, 0, 0, 0, 0],
  '\u{10FFFF}': [10, 0, 4, 4, 0],
  // The word ᠤᠯᠠᠭᠠᠨᠪᠠᠭᠠᠲᠤᠷ in context: initial ᠤ, medial
  // ᠯ ᠠ ᠭ ᠠ ᠨ ᠠ ᠪ ᠠ ᠭ ᠲ ᠤ, final ᠷ.
  [`ᠤ${SPINE_ZWJ}`]: [25.56, 0, 27, 16, -3],
  [`${SPINE_ZWJ}ᠯ${SPINE_ZWJ}`]: [6.82, 4, 8, 18, -4],
  [`${SPINE_ZWJ}ᠠ${SPINE_ZWJ}`]: [6.82, 0, 8, 11, -4],
  [`${SPINE_ZWJ}ᠭ${SPINE_ZWJ}`]: [13.63, 0, 15, 11, 2],
  [`${SPINE_ZWJ}ᠨ${SPINE_ZWJ}`]: [6.82, 0, 8, 11, 2],
  [`${SPINE_ZWJ}ᠪ${SPINE_ZWJ}`]: [12.26, 1, 15, 19, -3],
  [`${SPINE_ZWJ}ᠲ${SPINE_ZWJ}`]: [14.71, 0, 16, 11, 2],
  [`${SPINE_ZWJ}ᠤ${SPINE_ZWJ}`]: [13.75, 0, 15, 11, -3],
  [`${SPINE_ZWJ}ᠷ`]: [12.10, 1, 12, 17, -2],
  // Prefix + letter sub-contexts: widths from the same Blink session.
  'ᠤ': [22.37, 0, 10, 12, 0],
  [`${SPINE_ZWJ}ᠯ`]: [9.19, 0, 10, 12, 0],
  [`${SPINE_ZWJ}ᠠ`]: [10.25, 0, 10, 12, 0],
  [`${SPINE_ZWJ}ᠭ`]: [15.91, 0, 10, 12, 0],
  [`${SPINE_ZWJ}ᠨ`]: [10.25, 0, 10, 12, 0],
  [`${SPINE_ZWJ}ᠪ`]: [17.93, 0, 10, 12, 0],
  [`${SPINE_ZWJ}ᠲ`]: [20.98, 0, 10, 12, 0],
  [`${SPINE_ZWJ}ᠤ`]: [15.22, 0, 10, 12, 0],
}));
const spineMetricsOf = text => SPINE_METRICS.get(text) ?? [
  [...text].reduce((sum, char) => sum + (char === SPINE_ZWJ || '\u180B' <= char && char <= '\u180F' ? 0 : 10), 0), 0, 10, 12, 0];
class SpineContext {
  constructor(width, height) { this.width = width; this.height = height; this.store = new Uint8Array(width * height); }
  measureText(text) {
    const [width, left, right, ascent, descent] = spineMetricsOf(text);
    return {width, actualBoundingBoxLeft: left, actualBoundingBoxRight: right,
      actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent, fontBoundingBoxAscent: 24};
  }
  clearRect(x, y, width, height) {
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++)
      if (row >= 0 && row < this.height && col >= 0 && col < this.width) this.store[row * this.width + col] = 0;
  }
  fillText(text, x, y) {
    const [width, , , ascent, descent] = spineMetricsOf(text);
    const t = Math.round(y - ascent), b = Math.round(y + descent);
    const spine = t + (ascent - 11);
    const l = Math.round(x), r = Math.round(x + width);
    for (let row = Math.max(t, spine); row < Math.min(b, spine + 3); row++) for (let col = l; col < r; col++)
      if (row >= 0 && row < this.height && col >= 0 && col < this.width) this.store[row * this.width + col] = 255;
  }
  getImageData(x, y, width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++)
      data[(row * width + col) * 4 + 3] = this.store[(y + row) * this.width + (x + col)] ?? 0;
    return {data};
  }
}
class SpineCanvas {
  constructor(width, height) { this.context = new SpineContext(width, height); }
  getContext() { return this.context; }
}

test('generated forms stack into a continuous column for ᠤᠯᠠᠭᠠᠨᠪᠠᠭᠠᠲᠤᠷ', async () => {
  const previous = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = SpineCanvas;
  try {
    const fallback = createGlyphFallback({worldFonts: {ensure: async () => {}}, drawGlyph: createCanvasDrawer()});
    const url = 'https://tuiles.enliberte.fr/fonts/Noto%20Sans%20Regular/983040-983295.pbf';
    const stacks = decodeGlyphPbf(await fallback.augment(url, emptyGlyphRangePbf(url)));
    const byId = new Map(stacks[0].glyphs.map(glyph => [glyph.id, glyph]));
    const word = 'ᠤᠯᠠᠭᠠᠨᠪᠠᠭᠠᠲᠤᠷ';
    const formCodes = [...atlasMongolianShapeText(word)].map(char => char.codePointAt(0));
    assert.equal(formCodes.length, 13);
    let pen = 0;
    const glyphs = formCodes.map(code => {
      const glyph = byId.get(code);
      assert.ok(glyph, `form U+${code.toString(16)} is generated`);
      const positioned = {glyph: code, x: pen, y: 0, vertical: false, scale: 1,
        metrics: {advance: glyph.advance, left: glyph.left, top: glyph.top, width: glyph.width, height: glyph.height},
        bitmap: glyph.bitmap};
      pen += glyph.advance;
      return positioned;
    });
    // The column's total advance must be the word's true advance
    // (147.07 measured whole-word; the per-form shares sum to ~146.6,
    // PBF-rounded to 149), not the ~179 the suffix-dropping measure
    // produced.
    assert.ok(pen >= 140 && pen <= 158, `column advance ${pen} is the word's true advance`);
    const shaping = {positionedLines: [{positionedGlyphs: glyphs}], top: 0, bottom: 24, left: 0, right: pen};
    atlasMongolianVerticalize(shaping, 0, 500);
    assert.ok(glyphs.every(glyph => glyph.x === glyphs[0].x), 'one column');
    // Composite exactly as the renderer places glyph quads: each
    // glyph's SDF bitmap (buffer included) with its top-left at
    // pen + (left - 1, -top - 1), unioned by maximum byte; a pixel is
    // ink at byte >= 191, the SDF byte at the glyph edge
    // (255 * (1 - cutoff) for the drawer's 0.25 cutoff).
    const placed = glyphs.map(glyph => {
      const cols = glyph.metrics.width + 6, rows = glyph.metrics.height + 6;
      const ox = Math.round(glyph.x + glyph.metrics.left - 1), oy = Math.round(glyph.y - glyph.metrics.top - 1);
      let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++)
        if (glyph.bitmap[row * cols + col] >= 191) {
          top = Math.min(top, oy + row); bottom = Math.max(bottom, oy + row);
          left = Math.min(left, ox + col); right = Math.max(right, ox + col);
        }
      return {ox, oy, cols, rows, bitmap: glyph.bitmap, top, bottom, left, right};
    });
    const width = Math.max(...placed.map(p => p.ox + p.cols)), height = Math.max(...placed.map(p => p.oy + p.rows));
    const image = new Uint8Array(width * height);
    for (const p of placed) for (let row = 0; row < p.rows; row++) for (let col = 0; col < p.cols; col++) {
      const at = (p.oy + row) * width + (p.ox + col);
      if (p.bitmap[row * p.cols + col] > image[at]) image[at] = p.bitmap[row * p.cols + col];
    }
    // Continuity criterion: the rotation maps every glyph's spine to
    // the same composite columns (run x + 12 ± 1: the glyph-dependent
    // bearing terms cancel). At every joint, inside the band spanning
    // the two glyphs' facing ink edges (±2 rows), no more than 2
    // consecutive rows may be empty across the spine columns. Ground
    // truth itself dips for at most 2 rows at two joints of this
    // word; the atlas.3 generation left 3–6 empty rows at most joints.
    const spineL = glyphs[0].x + 11, spineR = glyphs[0].x + 13;
    for (let i = 0; i + 1 < placed.length; i++) {
      const a = placed[i], b = placed[i + 1];
      const bandTop = Math.min(a.bottom, b.top) - 2, bandBottom = Math.max(a.bottom, b.top) + 2;
      let empty = 0, worst = 0;
      for (let row = bandTop; row <= bandBottom; row++) {
        let ink = false;
        for (let col = spineL; col <= spineR && !ink; col++) ink = image[row * width + col] >= 191;
        empty = ink ? 0 : empty + 1;
        worst = Math.max(worst, empty);
      }
      assert.ok(worst <= 2, `joint ${i} (glyphs ${i}->${i + 1}): worst empty run ${worst} rows <= 2`);
    }
  } finally {
    if (previous === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = previous;
  }
});

// --- The distribution carries the same shaping, self-contained ------------

test('the patched distribution embeds the module shaping verbatim and hooks it in', async () => {
  const original = await readFile(new URL('../node_modules/maplibre-gl/dist/maplibre-gl.js', import.meta.url));
  const patched = Buffer.from(await backportMapLibre524(original, webcrypto.subtle)).toString('utf8');
  assert.ok(patched.includes('t=atlasMongolianShapeText(t),t}'), 'the text transform shapes Mongolian after Arabic');
  assert.ok(patched.includes('atlasMongolianVerticalize(_,p,o,a)'), 'shaping restacks Mongolian runs, with the line height');
  const embedded = /\/\*atlas-mongolian-start\*\/([\s\S]*?)\/\*atlas-mongolian-end\*\//.exec(patched);
  assert.ok(embedded, 'the embedded shaping is delimited');
  const dist = new Function(`${embedded[1]}; return {atlasMongolianShapeText, atlasMongolianVerticalize};`)();
  const label = 'Улаанбаатар ᠤᠯᠠᠭᠠᠨᠪᠠᠭᠠᠲᠤᠷ';
  assert.equal(dist.atlasMongolianShapeText(label), atlasMongolianShapeText(label), 'the embedded copy shapes identically');
  const glyph = positioned(form(A, 1), 10, 0);
  const shaping = shapingOf([[glyph]]);
  dist.atlasMongolianVerticalize(shaping, 0, 500);
  assert.deepEqual([glyph.x, glyph.y], [10, 0], 'the embedded copy runs standalone');
  assert.equal(MAPLIBRE_BACKPORT.target, 'vendor/maplibre-gl-5.24.0-atlas.4.js');
});
