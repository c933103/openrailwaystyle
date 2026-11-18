import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD_FONT_FAMILIES, worldFontRange, worldFontKey, createWorldFonts} from '../styles/world-font.mjs';

const INDEX = {families: {arabic: {'400': [6, 7], '700': [6]}, thai: {'400': [14]}, mongolian: {'400': [24]}}};
const req = (family, weight, block) => ({family, weight, block});

function fakeFonts({fail = new Set(), hang = new Set(), defer = new Map()} = {}) {
  const faces = [], added = new Set();
  class FontFace {
    constructor(family, source, descriptors) { Object.assign(this, {family, source, descriptors}); faces.push(this); }
    load() {
      const key = /\/([a-z-]+)-(\d+)-([0-9a-f]+)\.woff2/.exec(this.source);
      const id = `${key[1]}:${key[2]}:${parseInt(key[3], 16)}`;
      if (hang.has(id)) return new Promise(() => {});
      if (defer.has(id)) return new Promise(resolve => defer.set(id, () => resolve(this)));
      return fail.has(id) ? Promise.reject(new Error('offline')) : Promise.resolve(this);
    }
  }
  return {faces, FontFace, fonts: {add: face => added.add(face), delete: face => added.delete(face), added}};
}

test('family ids name the packaged regional designs, and keys and ranges are well formed', () => {
  assert.equal(WORLD_FONT_FAMILIES.arabic, 'Atlas Arabic');
  assert.equal(WORLD_FONT_FAMILIES.naskh, 'Atlas Naskh');
  assert.equal(WORLD_FONT_FAMILIES.nastaliq, 'Atlas Nastaliq');
  assert.equal(WORLD_FONT_FAMILIES.mongolian, 'Atlas Mongolian');
  assert.equal(worldFontRange(6), 'U+0600-06FF');
  assert.equal(worldFontRange(0x2a7), 'U+2A700-2A7FF');
  assert.equal(worldFontKey(req('arabic', 400, 6)), 'arabic:400:6');
});

test('slices load once each, only for family/weight/blocks the published index lists', async () => {
  const {faces, FontFace, fonts} = fakeFonts();
  let indexRequests = 0;
  const loader = createWorldFonts({root: 'https://atlas.example/fonts/world-v1/', FontFace, fonts,
    fetcher: async url => { indexRequests++; assert.equal(url, 'https://atlas.example/fonts/world-v1/index.json'); return {ok: true, json: async () => INDEX}; }});
  await loader.ensure(new Set([req('arabic', 400, 6), req('arabic', 400, 9), req('thai', 700, 14)]));
  await loader.ensure(new Set([req('arabic', 400, 6), req('arabic', 700, 6)]));
  assert.deepEqual(faces.map(f => [f.family, f.source, f.descriptors.unicodeRange, f.descriptors.weight]), [
    ['Atlas Arabic', 'url("https://atlas.example/fonts/world-v1/arabic-400-006.woff2")', 'U+0600-06FF', '400'],
    ['Atlas Arabic', 'url("https://atlas.example/fonts/world-v1/arabic-700-006.woff2")', 'U+0600-06FF', '700'],
  ], 'block 9 has no slice and Thai has no Bold slice, so neither is fetched');
  assert.equal(indexRequests, 1);
  assert.equal(fonts.added.size, 2);
  assert.equal(loader.isLoaded(req('arabic', 400, 6)), true);
  assert.equal(loader.isLoaded(req('thai', 400, 14)), false);
});

test('a failed slice or missing index does not stall glyphs and is retried only after a delay', async () => {
  let clock = 0;
  const {faces, FontFace, fonts} = fakeFonts({fail: new Set(['arabic:400:6'])});
  let indexOk = false, indexRequests = 0;
  const loader = createWorldFonts({root: 'https://atlas.example/f/', FontFace, fonts, now: () => clock, retryDelay: 1000,
    fetcher: async () => { indexRequests++; return indexOk ? {ok: true, json: async () => INDEX} : {ok: false, status: 404}; }});
  await loader.ensure(new Set([req('arabic', 400, 6)]));
  await loader.ensure(new Set([req('arabic', 400, 6)]));
  assert.equal(indexRequests, 1, 'a missing index is not requested by every glyph range');
  clock = 1500; indexOk = true;
  await loader.ensure(new Set([req('arabic', 400, 6)]));
  assert.equal(faces.length, 1);
  assert.equal(fonts.added.size, 0, 'a failed face is removed');
  await loader.ensure(new Set([req('arabic', 400, 6)]));
  assert.equal(faces.length, 1, 'a failed slice waits before the next attempt');
  clock = 3000;
  await loader.ensure(new Set([req('arabic', 400, 6)]));
  assert.equal(faces.length, 2);
});

test('a slow slice holds glyph generation back no longer than the wait', async () => {
  const {FontFace, fonts} = fakeFonts({hang: new Set(['mongolian:400:24'])});
  const loader = createWorldFonts({root: 'https://atlas.example/f/', FontFace, fonts, wait: 30,
    fetcher: async () => ({ok: true, json: async () => INDEX})});
  const started = Date.now();
  await loader.ensure(new Set([req('mongolian', 400, 24)]));
  assert.ok(Date.now() - started < 1000);
  await createWorldFonts({root: 'https://atlas.example/f/', FontFace: undefined, fonts}).ensure(new Set([req('mongolian', 400, 24)]));
});

test('a slice that loads after its glyphs were released reports its key for cache invalidation', async () => {
  const defer = new Map([['arabic:400:6', null], ['thai:400:14', null]]), notified = [];
  const {FontFace, fonts} = fakeFonts({defer});
  const loader = createWorldFonts({root: 'https://atlas.example/f/', FontFace, fonts, wait: 30, notifyDelay: 10, onLoad: keys => notified.push([...keys]),
    fetcher: async () => ({ok: true, json: async () => INDEX})});
  const inTime = loader.ensure(new Set([req('thai', 400, 14)]));
  for (let i = 0; i < 20 && !defer.get('thai:400:14'); i++) await new Promise(resolve => setTimeout(resolve, 0));
  defer.get('thai:400:14')(); await inTime;
  await loader.ensure(new Set([req('arabic', 400, 6)]));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(notified, [], 'nothing was drawn without its glyphs yet');
  defer.get('arabic:400:6')();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(notified, [['arabic:400:6']]);
  await loader.ensure(new Set([req('arabic', 400, 6)]));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(notified.length, 1, 'a loaded slice does not report again');
});
