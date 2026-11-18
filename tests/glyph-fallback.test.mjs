import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodeGlyphPbf, encodeGlyphPbf, glyphWeight, routeForCodePoint, generationStack, createGlyphFallback} from '../styles/glyph-fallback.mjs';
import {WORLD_FONT_FAMILIES} from '../styles/world-font.mjs';
import {installLabelProtocols} from '../styles/tile-labels.mjs';

const glyph = id => ({id, bitmap: new Uint8Array(36), width: 1, height: 1, left: 0, top: -1, advance: 10});
const range = (name, rangeText, glyphs) => encodeGlyphPbf([{name, range: rangeText, glyphs}]);
const url = (stack, rangeText) => `https://tuiles.enliberte.fr/fonts/${encodeURIComponent(stack)}/${rangeText}.pbf`;
// A drawer that "can draw" exactly the code points `drawable` returns true
// for, and records every stack it was asked to draw with.
function fakeDrawer(drawable = () => true) {
  const calls = [];
  const draw = (char, options) => { calls.push({char, ...options}); return drawable(char.codePointAt(0)) ? {bitmap: new Uint8Array(36), width: 1, height: 1, left: 0, top: -1, advance: 10} : null; };
  return {draw, calls};
}

test('the browser glyph fixture decodes with its stack, range and glyph metrics', async () => {
  const bytes = await readFile(new URL('./fixtures/browser-glyphs/0-255.pbf', import.meta.url));
  const stacks = decodeGlyphPbf(bytes);
  assert.equal(stacks.length, 1);
  assert.equal(stacks[0].name, 'DejaVu Sans fixture');
  assert.equal(stacks[0].range, '0-255');
  assert.equal(stacks[0].glyphs.length, 224);
  const a = stacks[0].glyphs.find(g => g.id === 65);
  assert.deepEqual({width: a.width, height: a.height, left: a.left, top: a.top, advance: a.advance}, {width: 17, height: 18, left: 0, top: -5, advance: 16});
  assert.equal(a.bitmap.length, (17 + 6) * (18 + 6), 'the bitmap carries the 3 px border on every side');
  const roundTrip = decodeGlyphPbf(encodeGlyphPbf(stacks));
  assert.deepEqual(roundTrip[0].glyphs.map(g => g.id), stacks[0].glyphs.map(g => g.id));
  assert.equal(roundTrip[0].glyphs.find(g => g.id === 65).advance, 16);
});

test('a range the remote source populates is returned unchanged and draws nothing', async () => {
  const bytes = await readFile(new URL('./fixtures/browser-glyphs/0-255.pbf', import.meta.url));
  const {draw, calls} = fakeDrawer();
  const fallback = createGlyphFallback({drawGlyph: draw});
  const out = await fallback.augment(url('Noto Sans Regular', '0-255'), bytes);
  assert.deepEqual(new Uint8Array(out), new Uint8Array(bytes));
  assert.equal(calls.length, 0);
});

test('an empty range gains glyphs for the code points the drawer can draw, and only those', async () => {
  const bytes = range('Noto Sans Regular', '6144-6399', []);
  const {draw, calls} = fakeDrawer(code => code % 2 === 0);
  const fallback = createGlyphFallback({drawGlyph: draw});
  const stacks = decodeGlyphPbf(await fallback.augment(url('Noto Sans Regular', '6144-6399'), bytes));
  assert.equal(stacks[0].name, 'Noto Sans Regular');
  assert.equal(stacks[0].range, '6144-6399');
  assert.ok(stacks[0].glyphs.length > 80);
  assert.ok(stacks[0].glyphs.every(g => g.id % 2 === 0), 'undrawable code points stay missing');
  assert.ok(stacks[0].glyphs.some(g => g.id === 0x1810), 'Mongolian digits are generated');
  const mongolian = calls.find(c => c.char.codePointAt(0) === 0x1810);
  assert.deepEqual(mongolian.families, ['Atlas Mongolian']);
  assert.equal(mongolian.weight, 400);
});

test('existing glyphs are preserved and the requested weight is honoured', async () => {
  const bytes = range('Noto Sans Bold', '1536-1791', [glyph(1536)]);
  const {draw, calls} = fakeDrawer();
  const fallback = createGlyphFallback({drawGlyph: draw});
  const stacks = decodeGlyphPbf(await fallback.augment(url('Noto Sans Bold', '1536-1791'), bytes));
  assert.equal(stacks[0].glyphs[0].id, 1536);
  assert.ok(stacks[0].glyphs.length > 200);
  assert.ok(calls.every(c => c.weight === 700));
  assert.equal(glyphWeight('Noto Sans Bold'), 700);
  assert.equal(glyphWeight('Noto Sans Regular'), 400);
});

test('regional designs route distinctly: Urdu letters to Nastaliq, Persian letters to the Sans design', async () => {
  const bytes = range('Noto Sans Regular', '1536-1791', []);
  const {draw, calls} = fakeDrawer();
  const fallback = createGlyphFallback({drawGlyph: draw});
  await fallback.augment(url('Noto Sans Regular', '1536-1791'), bytes);
  const byCode = new Map(calls.map(c => [c.char.codePointAt(0), c]));
  assert.deepEqual(byCode.get(0x679).families, ['Atlas Nastaliq', 'Atlas Arabic', 'Atlas Naskh']);
  assert.equal(byCode.get(0x679).lang, 'ur');
  assert.deepEqual(byCode.get(0x6CC).families, ['Atlas Arabic', 'Atlas Naskh']);
  assert.equal(byCode.get(0x6CC).lang, 'fa');
  assert.deepEqual(byCode.get(0x627).families, ['Atlas Arabic', 'Atlas Naskh']);
  assert.equal(byCode.get(0x627).lang, 'ar');
});

test('control characters and surrogates are never generated', async () => {
  const {draw, calls} = fakeDrawer();
  const fallback = createGlyphFallback({drawGlyph: draw});
  await fallback.augment(url('Noto Sans Regular', '0-255'), range('Noto Sans Regular', '0-255', []));
  assert.ok(calls.length > 0);
  assert.ok(calls.every(c => c.char.codePointAt(0) >= 32), 'no Cc control is drawn');
  const surrogateBytes = range('Noto Sans Regular', '55296-55551', []);
  const out = await fallback.augment(url('Noto Sans Regular', '55296-55551'), surrogateBytes);
  assert.deepEqual(new Uint8Array(out), new Uint8Array(surrogateBytes), 'a surrogate range is returned as downloaded');
});

test('generation stacks contain packaged families only — never a system or generic family', () => {
  const packaged = new Set(Object.values(WORLD_FONT_FAMILIES));
  for (const code of [0x41, 0x3B1, 0x430, 0x627, 0x5D0, 0x531, 0x10D0, 0x901, 0xB95, 0xE01, 0xE81, 0xF40, 0x1000, 0x1780, 0x1820, 0x1200, 0x13A0, 0x1401, 0x2190, 0x2211, 0x2D30]) {
    const stack = generationStack(code);
    assert.ok(stack, `U+${code.toString(16)} has a route`);
    assert.ok(stack.families.every(name => packaged.has(name)), `U+${code.toString(16)} draws only from packaged families: ${stack.families}`);
    assert.ok(!stack.families.some(name => /sans-serif|serif$|monospace|arial|helvetica|system/i.test(name)));
  }
  // Scripts with their own routes stay unrouted here.
  assert.equal(generationStack(0x4E00), null, 'Han ideographs belong to the CJK fonts');
  assert.equal(generationStack(0x30A2), null, 'kana belongs to the CJK route');
  assert.equal(generationStack(0xAC00), null, 'Hangul syllables belong to the CJK route');
  assert.equal(generationStack(0x20000), null, 'rare Han belongs to the Jigmo slices');
  assert.deepEqual(routeForCodePoint(0x0E01).families, ['thai']);
  assert.deepEqual(routeForCodePoint(0x0F40).families, ['tibetan']);
});

test('the world font slices for a range load before drawing, and results are cached until invalidated', async () => {
  const requests = [];
  const worldFonts = {ensure: async set => requests.push([...set])};
  const {draw, calls} = fakeDrawer();
  const fallback = createGlyphFallback({worldFonts, drawGlyph: draw});
  const bytes = range('Noto Sans Regular', '6144-6399', []);
  await fallback.augment(url('Noto Sans Regular', '6144-6399'), bytes);
  assert.ok(requests[0].some(r => r.family === 'mongolian' && r.weight === 400 && r.block === 24), 'the Mongolian slice is requested');
  const drawn = calls.length;
  await fallback.augment(url('Noto Sans Regular', '6144-6399'), bytes);
  assert.equal(calls.length, drawn, 'a cached range is not generated twice');
  fallback.invalidate(new Set(['mongolian:400:24']));
  await fallback.augment(url('Noto Sans Regular', '6144-6399'), bytes);
  assert.ok(calls.length > drawn, 'a late slice drops the cached range so it is generated again');
  fallback.invalidate(new Set(['thai:400:14']));
  const before = calls.length;
  await fallback.augment(url('Noto Sans Regular', '6144-6399'), bytes);
  assert.equal(calls.length, before, 'an unrelated slice leaves the cache alone');
});

test('unexpected bytes and a failing drawer keep the downloaded range', async () => {
  const junk = new Uint8Array([9, 9, 9]).buffer;
  const fallback = createGlyphFallback({drawGlyph: () => { throw new Error('no canvas'); }});
  assert.equal(await fallback.augment(url('Noto Sans Regular', '6144-6399'), junk), junk);
  const bytes = range('Noto Sans Regular', '6144-6399', []);
  assert.deepEqual(new Uint8Array(await fallback.augment(url('Noto Sans Regular', '6144-6399'), bytes)), new Uint8Array(bytes));
  assert.deepEqual(new Uint8Array(await fallback.augment('https://example.org/style.json', bytes)), new Uint8Array(bytes), 'a non-glyph URL is untouched');
});

test('the atlasglyph protocol returns generated glyphs for a range the source leaves empty', async () => {
  const remote = range('Noto Sans Regular', '6144-6399', []);
  const protocols = {};
  const {draw} = fakeDrawer();
  installLabelProtocols({addProtocol: (id, fn) => protocols[id] = fn}, {}, async address => {
    assert.match(address, /6144-6399\.pbf$/);
    return {ok: true, arrayBuffer: async () => remote};
  }, {glyphFallback: createGlyphFallback({drawGlyph: draw})});
  const result = await protocols.atlasglyph({url: 'atlasglyph://https://tuiles.enliberte.fr/fonts/Noto%20Sans%20Regular/6144-6399.pbf'}, new AbortController());
  const stacks = decodeGlyphPbf(result.data);
  assert.ok(stacks[0].glyphs.some(g => g.id === 0x1820), 'a Mongolian letter reaches MapLibre');
});
