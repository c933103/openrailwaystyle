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

// --- The distribution carries the same shaping, self-contained ------------

test('the patched distribution embeds the module shaping verbatim and hooks it in', async () => {
  const original = await readFile(new URL('../node_modules/maplibre-gl/dist/maplibre-gl.js', import.meta.url));
  const patched = Buffer.from(await backportMapLibre524(original, webcrypto.subtle)).toString('utf8');
  assert.ok(patched.includes('t=atlasMongolianShapeText(t),t}'), 'the text transform shapes Mongolian after Arabic');
  assert.ok(patched.includes('atlasMongolianVerticalize(_,p,o)'), 'shaping restacks Mongolian runs');
  const embedded = /\/\*atlas-mongolian-start\*\/([\s\S]*?)\/\*atlas-mongolian-end\*\//.exec(patched);
  assert.ok(embedded, 'the embedded shaping is delimited');
  const dist = new Function(`${embedded[1]}; return {atlasMongolianShapeText, atlasMongolianVerticalize};`)();
  const label = 'Улаанбаатар ᠤᠯᠠᠭᠠᠨᠪᠠᠭᠠᠲᠤᠷ';
  assert.equal(dist.atlasMongolianShapeText(label), atlasMongolianShapeText(label), 'the embedded copy shapes identically');
  const glyph = positioned(form(A, 1), 10, 0);
  const shaping = shapingOf([[glyph]]);
  dist.atlasMongolianVerticalize(shaping, 0, 500);
  assert.deepEqual([glyph.x, glyph.y], [10, 0], 'the embedded copy runs standalone');
  assert.equal(MAPLIBRE_BACKPORT.target, 'vendor/maplibre-gl-5.24.0-atlas.3.js');
});
