import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {buildSignals} from '../scripts/build-signals.mjs';
import {signalQuery, combinedSignalQuery, electricWithDirectionQuery} from '../scripts/signals-data.mjs';
import {validateElectricitySignalsSnapshot} from '../scripts/build-electricity-signals.mjs';

// Signals in the region [45,0,90,45]: an undirected main signal, an undirected
// French end-of-catenary sign and a directed German El 2.
const UNDIRECTED = {type: 'node', id: 1, lat: 48.8, lon: 2.3, tags: {railway: 'signal', 'railway:signal:main': 'FR:CARRE'}};
const ELECTRIC = {type: 'node', id: 2, lat: 48.9, lon: 2.4, tags: {railway: 'signal', 'railway:signal:electricity': 'FR:end_of_catenary'}};
const DIRECTED_ELECTRIC = {type: 'node', id: 3, lat: 50.1, lon: 8.6, tags: {railway: 'signal', 'railway:signal:direction': 'forward', 'railway:signal:electricity': 'DE-ESO:el2'}};
const HOME = '45,0,90,45';
const box = query => /\((-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+)\)/.exec(query)[1];

async function dirs() {
  const root = await mkdtemp(join(tmpdir(), 'signals-'));
  return {root, cacheRoot: pathToFileURL(join(root, 'cache') + '/'), output: pathToFileURL(join(root, 'signal-data') + '/'), powerOutput: join(root, 'power-data')};
}
function fakeOverpass(answer) {
  const queries = [];
  const fetcher = async (url, {body}) => {
    const query = new URLSearchParams(String(body)).get('data');
    queries.push(query);
    const result = answer(query);
    if (result.status) return {ok: false, status: result.status, text: async () => 'busy'};
    return {ok: true, text: async () => JSON.stringify({osm3s: {timestamp_osm_base: '2026-10-31T00:00:00Z'}, ...result})};
  };
  return {queries, fetcher};
}
const quiet = {sleep: async () => {}, log() {}, warn() {}, now: () => Date.parse('2026-10-31T12:00:00Z')};

test('one combined request per region yields both the undirected supplement and the electrification snapshot', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const {queries, fetcher} = fakeOverpass(query => ({elements: box(query) === HOME ? [UNDIRECTED, ELECTRIC, DIRECTED_ELECTRIC] : []}));
  const result = await buildSignals({...d, ...quiet, fetcher});
  assert.equal(queries.length, 32, 'one request per world region');
  assert.ok(queries.every(q => q === combinedSignalQuery(box(q).split(',').map(Number))));
  const undirected = JSON.parse(gunzipSync(await readFile(new URL('railway-signals.geojson.gz', d.output))));
  assert.deepEqual(undirected.features.map(f => f.id), [1, 2], 'a directed signal stays with the provider');
  const electric = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals-manifest.json'), 'utf8'));
  assert.deepEqual(electric.features.map(f => f.id), ['node-2', 'node-3'], 'electrification signals with and without a direction');
  validateElectricitySignalsSnapshot(electric, manifest);
  assert.equal(manifest.coverage.length, 32);
  assert.equal(result.signals.signals, 2);
});

test('a region cached before the downloads were combined is reused; only its directed electrification signals are fetched', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const home = HOME.split(',').map(Number);
  await (await import('node:fs/promises')).mkdir(d.cacheRoot, {recursive: true});
  await writeFile(new URL(`signals-v1-${home.join('_')}.json`, d.cacheRoot), JSON.stringify({query: signalQuery(home), generated: '2026-10-25T00:00:00Z',
    response: {osm3s: {timestamp_osm_base: '2026-10-25T00:00:00Z'}, elements: [UNDIRECTED, ELECTRIC]}}));
  const {queries, fetcher} = fakeOverpass(query => ({elements: query === electricWithDirectionQuery(home) ? [DIRECTED_ELECTRIC] : []}));
  await buildSignals({...d, ...quiet, fetcher});
  assert.ok(queries.includes(electricWithDirectionQuery(home)));
  assert.ok(!queries.includes(combinedSignalQuery(home)) && !queries.includes(signalQuery(home)), 'the cached direction response is not downloaded again');
  const electric = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8'));
  assert.deepEqual(electric.features.map(f => f.id), ['node-2', 'node-3']);
  // A second build needs no request for that region at all.
  const again = fakeOverpass(() => ({elements: []}));
  await buildSignals({...d, ...quiet, fetcher: again.fetcher});
  assert.ok(again.queries.every(q => !q.includes(`(${HOME})`)));
});

test('a cached region whose remainder request times out splits that request alone and keeps the cached response', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const home = HOME.split(',').map(Number);
  await (await import('node:fs/promises')).mkdir(d.cacheRoot, {recursive: true});
  await writeFile(new URL(`signals-v1-${home.join('_')}.json`, d.cacheRoot), JSON.stringify({query: signalQuery(home), generated: '2026-10-25T00:00:00Z',
    response: {elements: [UNDIRECTED, ELECTRIC]}}));
  const {queries, fetcher} = fakeOverpass(query => {
    if (query === electricWithDirectionQuery(home)) return {elements: [], remark: 'runtime error: Query ran out of memory in "query"'};
    return {elements: query === electricWithDirectionQuery([45, 0, 67.5, 22.5]) ? [DIRECTED_ELECTRIC] : []};
  });
  await buildSignals({...d, ...quiet, fetcher});
  assert.ok(!queries.includes(signalQuery(home)) && !queries.includes(combinedSignalQuery(home)), 'the cached response is kept');
  for (const quarter of [[45, 0, 67.5, 22.5], [45, 22.5, 67.5, 45], [67.5, 0, 90, 22.5], [67.5, 22.5, 90, 45]]) assert.ok(queries.includes(electricWithDirectionQuery(quarter)));
  const electric = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals-manifest.json'), 'utf8'));
  assert.deepEqual(electric.features.map(f => f.id), ['node-2', 'node-3']);
  validateElectricitySignalsSnapshot(electric, manifest);
  const again = fakeOverpass(() => ({elements: []}));
  await buildSignals({...d, ...quiet, fetcher: again.fetcher});
  assert.ok(again.queries.every(q => !q.includes(`(${HOME})`) && !q.includes('(45,0,67.5,22.5)')), 'the split and its quarters are checkpointed');
});

test('a region that times out is split into quarters that still partition the world', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const {fetcher} = fakeOverpass(query => box(query) === HOME ? {elements: [], remark: 'runtime error: Query timed out in "query"'}
    : {elements: box(query) === '45,0,67.5,22.5' ? [ELECTRIC] : []});
  const result = await buildSignals({...d, ...quiet, fetcher});
  const manifest = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals-manifest.json'), 'utf8'));
  assert.equal(manifest.coverage.length, 35, 'one region replaced by its four quarters');
  validateElectricitySignalsSnapshot(JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8')), manifest);
  assert.equal(result.electricity.features, 1);
});

test('a region that keeps failing publishes neither snapshot', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const {fetcher} = fakeOverpass(query => box(query) === HOME ? {status: 502} : {elements: [ELECTRIC]});
  await assert.rejects(buildSignals({...d, ...quiet, fetcher}), /Overpass HTTP 502/);
  await assert.rejects(readdir(d.output));
  await assert.rejects(readdir(d.powerOutput));
});
