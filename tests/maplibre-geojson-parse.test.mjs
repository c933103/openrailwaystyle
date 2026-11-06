import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {webcrypto} from 'node:crypto';
import {backportMapLibre524} from '../styles/map-controls.mjs';
import {verifyMapLibreGeoJSONSource} from '../scripts/maplibre-backport.mjs';

const root = new URL('../node_modules/maplibre-gl/', import.meta.url).pathname;
const source = await verifyMapLibreGeoJSONSource(root);
const modules = new Map();
async function workerModule(fixed) {
  if (modules.has(fixed)) return modules.get(fixed);
  const entry = ['source/geojson_worker_source', 'style/style_layer_index', 'render/subdivision_granularity_settings']
    .map(path => `export * from ${JSON.stringify(root + 'src/' + path + '.ts')};`).join('\n');
  const output = await build({stdin: {contents: entry, resolveDir: root}, bundle: true, write: false,
    platform: 'node', format: 'esm', tsconfigRaw: {compilerOptions: {useDefineForClassFields: false}},
    plugins: fixed ? [{name: 'reviewed-source-repair', setup(builder) {
      builder.onLoad({filter: /geojson_worker_source\.ts$/}, () => ({contents: source, loader: 'ts', resolveDir: root + 'src/source'}));
    }}] : []});
  const module = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
  modules.set(fixed, module);
  return module;
}

// Real pinned worker, parser, glyph layout and feature index. Only the actor's
// fixture glyph delivery is held; cancellation ordering uses no elapsed sleep.
async function interruptedParse(fixed, reloads) {
  const {GeoJSONWorkerSource, StyleLayerIndex, SubdivisionGranularitySetting} = await workerModule(fixed);
  const requests = [];
  const actor = {sendAsync: (message, controller) => new Promise(resolve => requests.push({message, controller, resolve}))};
  const layers = new StyleLayerIndex([{id: 'labels', source: 'source', type: 'symbol',
    layout: {'text-font': ['Fixture Font'], 'text-field': ['get', 'name']}}]);
  const worker = new GeoJSONWorkerSource(actor, layers, []);
  await worker.loadData({source: 'source', data: {type: 'FeatureCollection', features: [{type: 'Feature', id: 1,
    geometry: {type: 'Point', coordinates: [0, 0]}, properties: {name: 'A'}}]}, geojsonVtOptions: {}});
  const params = {source: 'source', uid: 0, zoom: 0, pixelRatio: 1, overscaling: 1, tileSize: 512,
    tileID: {overscaledZ: 0, wrap: 0, canonical: {x: 0, y: 0, z: 0, w: 0}},
    subdivisionGranularity: SubdivisionGranularitySetting.noSubdivision};
  let result = worker.loadTile(params);
  for (let i = 0; i < reloads; i++) result = worker.reloadTile(params);
  assert.equal(requests.length, reloads + 1);
  assert.equal(requests.filter(request => request.controller.signal.aborted).length, reloads);
  const request = requests.at(-1);
  request.resolve(Object.fromEntries(Object.entries(request.message.data.stacks).map(([font, ids]) => [font,
    Object.fromEntries(ids.map(id => [id, {id, bitmap: {width: 8, height: 12, data: new Uint8Array(96).fill(255)},
      metrics: {width: 8, height: 12, left: 0, top: 12, advance: 8}}]))])));
  const data = await result;
  assert.equal(data.buckets.length, 1, 'the result contains a real nonempty symbol bucket');
  assert.ok(data.featureIndex);
  // The main thread retains the previous empty tile bytes when the worker
  // omits them; exercise the same source-layer decoder as rendered queries.
  data.featureIndex.rawTileData = data.rawTileData ?? new ArrayBuffer(0);
  data.featureIndex.encoding = 'mvt';
  const decoded = data.featureIndex.loadVTLayers();
  return {data, decode: () => decoded[data.featureIndex.sourceLayerCoder.decode(0)].feature(0).properties};
}

test('two or more interrupted GeoJSON parses keep bytes paired with the final symbol index', async () => {
  const baseline = await interruptedParse(false, 0);
  assert.equal(baseline.decode().name, 'A');
  for (const reloads of [0, 1, 2, 3, 8]) {
    const fixed = await interruptedParse(true, reloads);
    assert.deepEqual(new Uint8Array(fixed.data.rawTileData), new Uint8Array(baseline.data.rawTileData));
    assert.equal(fixed.decode().name, 'A');
    if (reloads >= 2) {
      const original = await interruptedParse(false, reloads);
      assert.equal(original.data.rawTileData, undefined, 'sensitivity control reproduces dropped bytes');
      assert.throws(original.decode, /Out of bounds.*numberToString.length 0/, 'same renderer error as platform CI');
    }
  }
});

function distributionParse(bytes) {
  const text = Buffer.from(bytes).toString('utf8');
  const matches = [...text.matchAll(/_parseWorkerTile\(t,i,s\)\{return e\._\(this,void 0,void 0,\(function\*\(\)\{[\s\S]*?return r\}\)\)\}/g)]
    .filter(match => match[0].includes('encoding:"mvt"'));
  assert.equal(matches.length, 1);
  // Execute the exact embedded distribution method with its generator/extend
  // helpers. The asynchronous parse dependency is deliberately controlled.
  const helpers = {e: Object.assign, _: (context, _args, _promise, generator) => new Promise((resolve, reject) => {
    const iterator = generator.call(context);
    const step = (method, value) => {try {const next = iterator[method](value); if (next.done) resolve(next.value);
      else Promise.resolve(next.value).then(value => step('next', value), error => step('throw', error));} catch (error) {reject(error);}};
    step('next');
  })};
  return Function('e', 'return ({' + matches[0] + '})._parseWorkerTile;')(helpers);
}

test('actual distribution retains pending bytes through aborts, clears after success and isolates tile identities', async () => {
  const raw = await readFile(root + 'dist/maplibre-gl.js');
  const parse = distributionParse(await backportMapLibre524(raw, webcrypto.subtle));
  const context = {}, pending = [], params = {};
  const tile = {vectorTile: {}, parse: () => new Promise((resolve, reject) => pending.push({resolve, reject}))};
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const first = parse.call(context, tile, params, {rawData: bytes});
  const failed = assert.rejects(first, /aborted/);
  const final = parse.call(context, tile, params);
  pending[0].reject(new Error('aborted'));
  pending[1].resolve({featureIndex: 'new'});
  const result = await final;
  await failed;
  assert.deepEqual(new Uint8Array(result.rawTileData), new Uint8Array(bytes));
  assert.notEqual(result.rawTileData, bytes, 'the worker keeps its own buffer');
  assert.equal(result.featureIndex, 'new');
  const ordinary = parse.call(context, tile, params);pending[2].resolve({featureIndex: 'later'});
  assert.equal((await ordinary).rawTileData, undefined, 'successful delivery clears pending raw data');
  const other = {vectorTile: {}, parse: async () => ({featureIndex: 'other'})};
  assert.equal((await parse.call(context, other, params)).rawTileData, undefined, 'reused UID cannot borrow another worker tile\'s bytes');
});
