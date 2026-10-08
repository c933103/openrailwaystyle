import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {inspect} from 'node:util';
import {gunzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import * as heritage from '../scripts/heritage-data.mjs';
import * as bundles from '../styles/tile-bundles.mjs';

const source = await fs.readFile(new URL('../scripts/build-heritage.mjs', import.meta.url), 'utf8');
const parent = [0, 0, 45, 45];
const parentQuery = heritage.heritageQuery(parent);
const empty = {elements:[]};
const complete = {osm3s:{timestamp_osm_base:'2026-10-08T00:00:00Z'}, elements:[{
  type:'way', id:42, tags:{historic:'district', name:'Synthetic historic district'},
  geometry:[[12, 12], [12.001, 12], [12.001, 12.001], [12, 12.001], [12, 12]].map(([lon, lat]) => ({lon, lat})),
}]};
// Entirely synthetic: realistic OSM3S HTML/license preamble with deliberately
// inserted failure text, NOT a captured upstream OOM/timeout response.
const html = detail => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>OSM3S Response</title></head><body>
<p>The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.</p>
<p>This is a synthetic regression response with a realistic HTML preamble, not a captured upstream failure.</p>
<p><strong>Error</strong>: ${detail}</p></body></html>`;
const oom = html('runtime error: Query run out of memory using about 2048 MB of RAM.');
const timeout = html('runtime error: Query timed out in "query" at line 1 after 301 seconds.');
const response = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status});

// Evaluate the unchanged executable, linking its real classifier/geometry/tile
// modules. Only external effects (fetch, time, filesystem root) are controlled.
async function run(t, reply, {writeError, byteLength} = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'heritage-builder-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  await fs.mkdir(join(root, '.snapshot-cache'));
  for (let s = -90; s < 90; s += 45) for (let w = -180; w < 180; w += 45) {
    const box = [s, w, s + 45, w + 45];
    if (String(box) === String(parent)) continue;
    await fs.writeFile(join(root, `.snapshot-cache/heritage-v2-${box.join('_')}.json`), JSON.stringify({query:heritage.heritageQuery(box), response:empty}));
  }
  // A failed acquisition must not remove previously published data.
  await fs.mkdir(join(root, 'heritage-data'));
  await fs.writeFile(join(root, 'heritage-data/sentinel'), 'previous snapshot');
  const calls = [], sleeps = [], warnings = [], writes = [], decisions = [];
  const io = {
    mkdir:(path, options) => fs.mkdir(join(root, path), options),
    readFile:(path, options) => fs.readFile(join(root, path), options),
    rm:(path, options) => fs.rm(join(root, path), options),
    writeFile:async (path, data) => {
      writes.push(path);
      if (writeError && path.startsWith('.snapshot-cache/')) throw writeError;
      return fs.writeFile(join(root, path), data);
    },
  };
  const context = vm.createContext({
    process:{env:{}}, URLSearchParams,
    Buffer:byteLength ? {byteLength} : Buffer,
    AbortSignal:{timeout:ms => { assert.equal(ms, 360000); return AbortSignal.timeout(ms); }},
    setTimeout:(callback, ms) => { sleeps.push(ms); callback(); },
    console:{log:() => {}, warn:(...args) => warnings.push(args.join(' '))},
    fetch:async (url, options) => {
      assert.equal(url, 'https://overpass-api.de/api/interpreter');
      assert.equal(options.method, 'POST');
      const query = options.body.get('data');
      calls.push(query);
      assert.ok(calls.length <= 40, 'unexpected request loop');
      return reply(query, calls.length);
    },
  });
  const dependencies = {
    'node:fs/promises':io,
    './heritage-data.mjs':{...heritage, heritageFailure:(...args) => {
      const decision = heritage.heritageFailure(...args);
      decisions.push({error:args[0], attempt:args[1], depth:args[2], decision});
      return decision;
    }},
    '../styles/tile-bundles.mjs':bundles,
  };
  const module = new vm.SourceTextModule(source, {context});
  await module.link(specifier => {
    const values = dependencies[specifier];
    assert.ok(values, `unexpected import ${specifier}`);
    return new vm.SyntheticModule(Object.keys(values), function() {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, {context});
  });
  let error;
  try { await module.evaluate(); } catch (caught) { error = caught; }
  return {root, calls, sleeps, warnings, writes, decisions, error};
}

async function checkPublished(result) {
  assert.ifError(result.error);
  const manifest = JSON.parse(await fs.readFile(join(result.root, 'heritage-data/manifest.json')));
  assert.equal(manifest.areas, 1, 'duplicate child IDs collapse before publication');
  assert.equal(manifest.coverage.length, 35, '31 cached parents and four children');
  assert.equal(manifest.coverage.filter(row => row.features === 1).length, 4);
  const index = JSON.parse(await fs.readFile(join(result.root, 'heritage-data/index.json')));
  let decoded = 0;
  for (const path of index.bundles) {
    const data = await fs.readFile(join(result.root, `heritage-data/${index.zoom}/${path}.bundle.gz`));
    for (const [, tile] of bundles.decodeBundle(gunzipSync(data))) {
      const layer = new VectorTile(new Pbf(tile)).layers.heritage;
      assert.equal(layer.length, 1, 'no duplicate feature in any emitted tile');
      assert.equal(layer.feature(0).properties.id, 'w42');
      assert.equal(layer.feature(0).properties.name, 'Synthetic historic district');
      decoded++;
    }
  }
  assert.equal(decoded, manifest.tiles);
  assert.ok(decoded > 0);
  return manifest;
}

for (const [name, body] of [['OOM', oom], ['timeout', timeout]]) {
  test(`builder splits HTTP executed-query ${name} beyond the display limit without refetching parent`, async t => {
    const sanitized = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(sanitized.indexOf('runtime error') > 160);
    const result = await run(t, query => response(query === parentQuery ? 504 : 200, query === parentQuery ? body : complete));
    await checkPublished(result);
    assert.equal(result.calls.filter(query => query === parentQuery).length, 1);
    assert.equal(result.calls.length, 5);
    assert.deepEqual(result.sleeps, [0, 10000, 10000, 10000, 10000]);
    assert.equal(result.decisions[0].error.responseBody, body);
    assert.equal(result.decisions[0].decision, 'split');
    assert.match(result.decisions[0].error.message, /^HTTP 504:/);
    assert.equal(result.decisions[0].error.message.length, 170);
    assert.ok(result.warnings.every(line => line.length <= parent.join(',').length + 1 + 170));
    assert.doesNotMatch(inspect(result.decisions[0].error), /runtime error|responseBody/, 'uncaught-error inspection also hides the full body');
    const files = await fs.readdir(join(result.root, '.snapshot-cache'));
    assert.equal(files.length, 35, 'failed parent never cached, all children persisted');
  });
}

for (const [name, body] of [
  ['server busy', html('runtime error: open64: 0 Success /osm3s_osm_base Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy to handle your request.')],
  ['Gateway timeout', 'Gateway timeout'],
]) {
  test(`builder retains all backoffs before splitting ${name}`, async t => {
    const result = await run(t, query => response(query === parentQuery ? 504 : 200, query === parentQuery ? body : complete));
    await checkPublished(result);
    assert.equal(result.calls.filter(query => query === parentQuery).length, 4);
    assert.deepEqual(result.sleeps, [0, 30000, 60000, 120000, 10000, 10000, 10000, 10000]);
    assert.deepEqual(result.decisions.map(row => row.decision), ['retry', 'retry', 'retry', 'split']);
  });
}

async function checkUnpublished(result, pattern, count) {
  assert.match(result.error?.message || '', pattern);
  assert.equal(result.calls.length, count);
  assert.equal(await fs.readFile(join(result.root, 'heritage-data/sentinel'), 'utf8'), 'previous snapshot');
  assert.ok(!result.writes.some(path => path.startsWith('heritage-data/')));
}

for (const status of [429, 400]) {
  test(`builder preserves HTTP ${status} even when the body mentions executed-query OOM`, async t => {
    const result = await run(t, () => response(status, oom));
    await checkUnpublished(result, new RegExp(`^HTTP ${status}:`), status === 429 ? 4 : 1);
    assert.ok(result.calls.every(query => query === parentQuery), 'no child requests');
    assert.deepEqual(result.sleeps, status === 429 ? [0, 30000, 60000, 120000] : [0]);
    assert.equal(result.decisions.at(-1).decision, 'fail');
  });
}

for (const code of ['ENOSPC', 'EACCES']) {
  test(`builder fails local ${code} persistence without redownloading or splitting`, async t => {
    const error = new Error(`${code}: local cache failure`);
    const result = await run(t, () => response(200, complete), {writeError:error});
    await checkUnpublished(result, new RegExp(code), 1);
    assert.equal(result.error, error);
    assert.equal(result.decisions.length, 0, 'persistence stays outside request policy');
  });
}

test('builder checks download budget before classifying a heavy HTTP response', async t => {
  const result = await run(t, () => response(504, oom), {byteLength:() => 1_500_000_001});
  await checkUnpublished(result, /download budget exceeded/, 1);
  assert.equal(result.decisions[0].decision, 'fail');
  assert.equal(result.decisions[0].error.responseBody, undefined);
});

test('builder accepts the exact download budget boundary', async t => {
  const result = await run(t, () => response(200, complete), {byteLength:() => 1_500_000_000});
  assert.ifError(result.error);
  const manifest = JSON.parse(await fs.readFile(join(result.root, 'heritage-data/manifest.json')));
  assert.equal(manifest.downloadedBytes, 1_500_000_000);
  assert.equal(result.calls.length, 1);
});

for (const name of ['incomplete remark', 'client timeout']) {
  test(`builder splits ${name} without caching partial success`, async t => {
    const result = await run(t, query => {
      if (query !== parentQuery) return response(200, complete);
      if (name === 'client timeout') throw new Error('The operation was aborted due to timeout');
      return response(200, {...complete, elements:[{...complete.elements[0], id:99}], remark:'runtime error: Query timed out after 301 seconds.'});
    });
    await checkPublished(result);
    assert.equal(result.calls.length, 5);
    assert.equal(result.decisions[0].decision, 'split');
    assert.match(result.decisions[0].error.message, /^(Network|Incomplete heritage response):/);
  });
}

test('builder enforces the existing six-level split depth', async t => {
  const result = await run(t, () => response(504, oom));
  await checkUnpublished(result, /^HTTP 504:/, 7);
  assert.deepEqual(result.decisions.map(row => row.depth), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(result.decisions.at(-1).decision, 'fail');
});

for (const name of ['invalid JSON', 'body read failure', 'network failure']) {
  test(`builder retries ${name} and persists only the recovered response`, async t => {
    const result = await run(t, (_query, attempt) => {
      if (attempt > 1) return response(200, complete);
      if (name === 'invalid JSON') return response(200, '{');
      if (name === 'body read failure') return {ok:true, status:200, text:async () => { throw new Error('connection reset'); }};
      throw new TypeError('fetch failed');
    });
    assert.ifError(result.error);
    assert.equal(result.calls.length, 2);
    assert.ok(result.calls.every(query => query === parentQuery));
    assert.deepEqual(result.sleeps, [0, 30000]);
    assert.equal(result.decisions[0].decision, 'retry');
    assert.equal(result.writes.filter(path => path.startsWith('.snapshot-cache/')).length, 1);
  });
}

test('builder accumulates download bytes across failed attempts', async t => {
  const result = await run(t, () => response(504, 'Gateway timeout'), {byteLength:() => 750_000_001});
  await checkUnpublished(result, /download budget exceeded/, 2);
  assert.deepEqual(result.decisions.map(row => row.decision), ['retry', 'fail']);
});
