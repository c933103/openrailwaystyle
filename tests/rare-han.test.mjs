import test from 'node:test';
import assert from 'node:assert/strict';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {RARE_HAN_FAMILY, rareHanBlocks, rareHanBlocksInBytes, rareHanRange, createRareHanFonts} from '../styles/rare-han.mjs';
import {isLocalFamily} from '../styles/cjk-font.mjs';
import {localizeTile, glyphRequestURL} from '../styles/tile-labels.mjs';

// 𪜀 U+2A700 (Extension C), 𠮷 U+20BB7 (Extension B), 𰀀 U+30000 (Extension G).
const text = 'a中\u{2A700}\u{20BB7}\u{30000}\u{1F600}\u{10000}';

test('rare Han blocks come from Extensions B to J only, from text and from UTF-8 tile bytes', () => {
  assert.deepEqual([...rareHanBlocks(text)].sort(), [0x20b, 0x2a7, 0x300]);
  assert.deepEqual([...rareHanBlocksInBytes(new TextEncoder().encode(text))].sort(), [0x20b, 0x2a7, 0x300]);
  assert.deepEqual([...rareHanBlocks(undefined)], []);
  assert.equal(rareHanRange(0x2a7), 'U+2A700-2A7FF');
});

test('the rare Han family joins the local families left out of remote glyph requests', () => {
  assert.equal(isLocalFamily(RARE_HAN_FAMILY), true);
  const url = glyphRequestURL(`atlasglyph://https://glyphs.example/fonts/${encodeURIComponent(`Noto Sans Regular,Atlas CJK TC,${RARE_HAN_FAMILY}`)}/0-255.pbf`);
  assert.equal(decodeURIComponent(new URL(url).pathname.split('/').at(-2)), 'Noto Sans Regular');
});

test('localizing a tile reports the blocks of the names it writes, not of other languages', () => {
  const feature = (name, extra = {}) => ({type: 'Feature', properties: {name, ...extra}, geometry: {type: 'Point', coordinates: [114.17, 22.3]}});
  const index = geojsonvt({type: 'FeatureCollection', features: [feature('\u{2A700}村'), feature('Plain', {'name:zh': '\u{30000}'})]}, {maxZoom: 14, indexMaxZoom: 0});
  const tile = index.getTile(0, 0, 0), data = vtpbf.fromGeojsonVt({place: tile}, {version: 2});
  const found = new Set();
  const localized = localizeTile(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), 'local', {z: 0, x: 0, y: 0}, found);
  assert.deepEqual([...found], [0x2a7], 'the local name is drawn; the unused Chinese translation is not');
  const names = new VectorTile(new Pbf(new Uint8Array(localized))).layers.place;
  assert.equal(names.feature(0).properties.atlas_name, '\u{2A700}村');
});

function fakeFonts({fail = new Set(), hang = new Set()} = {}) {
  const faces = [], added = new Set();
  class FontFace {
    constructor(family, source, descriptors) { Object.assign(this, {family, source, descriptors}); faces.push(this); }
    load() {
      const block = parseInt(/\/([0-9a-f]{3})\.woff2/.exec(this.source)[1], 16);
      if (hang.has(block)) return new Promise(() => {});
      return fail.has(block) ? Promise.reject(new Error('offline')) : Promise.resolve(this);
    }
  }
  return {faces, FontFace, fonts: {add: face => added.add(face), delete: face => added.delete(face), added}};
}

test('slices load once each, only for blocks the published index lists, with their unicode range', async () => {
  const {faces, FontFace, fonts} = fakeFonts();
  let indexRequests = 0;
  const loader = createRareHanFonts({root: 'https://atlas.example/fonts/rare-han/', FontFace, fonts,
    fetcher: async url => { indexRequests++; assert.equal(url, 'https://atlas.example/fonts/rare-han/index.json'); return {ok: true, json: async () => ({blocks: [0x2a7, 0x300]})}; }});
  await loader.ensure(new Set([0x2a7, 0x20b]));
  await loader.ensure(new Set([0x2a7, 0x300]));
  assert.deepEqual(faces.map(f => [f.family, f.source, f.descriptors.unicodeRange]), [
    [RARE_HAN_FAMILY, 'url("https://atlas.example/fonts/rare-han/2a7.woff2")', 'U+2A700-2A7FF'],
    [RARE_HAN_FAMILY, 'url("https://atlas.example/fonts/rare-han/300.woff2")', 'U+30000-300FF'],
  ]);
  assert.equal(indexRequests, 1);
  assert.equal(fonts.added.size, 2);
});

test('a failed slice or missing index does not stall tiles and is retried only after a delay', async () => {
  let clock = 0;
  const {faces, FontFace, fonts} = fakeFonts({fail: new Set([0x2a7])});
  let indexOk = false, indexRequests = 0;
  const loader = createRareHanFonts({root: 'https://atlas.example/f/', FontFace, fonts, now: () => clock, retryDelay: 1000,
    fetcher: async () => { indexRequests++; return indexOk ? {ok: true, json: async () => ({blocks: [0x2a7]})} : {ok: false, status: 404}; }});
  await loader.ensure(new Set([0x2a7]));
  await loader.ensure(new Set([0x2a7]));
  assert.equal(indexRequests, 1, 'a missing index is not requested by every tile');
  clock = 1500; indexOk = true;
  await loader.ensure(new Set([0x2a7]));
  assert.equal(faces.length, 1);
  assert.equal(fonts.added.size, 0, 'a failed face is removed');
  await loader.ensure(new Set([0x2a7]));
  assert.equal(faces.length, 1, 'a failed slice waits before the next attempt');
  clock = 3000;
  await loader.ensure(new Set([0x2a7]));
  assert.equal(faces.length, 2);
});

test('a slow slice holds a tile back no longer than the wait', async () => {
  const {FontFace, fonts} = fakeFonts({hang: new Set([0x2a7])});
  const loader = createRareHanFonts({root: 'https://atlas.example/f/', FontFace, fonts, wait: 30,
    fetcher: async () => ({ok: true, json: async () => ({blocks: [0x2a7]})})});
  const started = Date.now();
  await loader.ensure(new Set([0x2a7]));
  assert.ok(Date.now() - started < 1000);
  await createRareHanFonts({root: 'https://atlas.example/f/', FontFace: undefined, fonts}).ensure(new Set([0x2a7]));
});
