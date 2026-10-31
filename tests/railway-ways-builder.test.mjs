import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile, mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {STAGES} from '../scripts/download-stages.mjs';
import {quarters} from '../scripts/branch-lines.mjs';
import {railwayWaysQuery} from '../scripts/railway-ways.mjs';
import {buildRailwayWays, storedRegions, regionKey} from '../scripts/build-railway-ways.mjs';

// Synthetic responses only: no provider data.
const japan = STAGES.find(stage => stage.name === 'japan'), part = japan.parts[0];
const way = (id, tags) => ({type: 'way', id, version: 1, timestamp: '2026-10-01T00:00:00Z', tags, geometry: [{lon: 139.7, lat: 35.6}, {lon: 139.71, lat: 35.61}]});
const ok = elements => ({text: JSON.stringify({osm3s: {timestamp_osm_base: '2026-10-31T00:00:00Z'}, elements})});
const timedOut = {status: 504, text: 'runtime error: Query timed out in "query" at line 1 after 180 seconds.'};

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'railway-ways-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}
function overpass(answer) {
  const queries = [];
  const fetcher = async (url, options) => {
    const query = options.body.get('data');
    queries.push(query);
    const reply = answer(query, queries.length);
    return new Response(reply.text, {status: reply.status ?? 200});
  };
  return {queries, fetcher};
}
const quiet = {log: () => {}, warn: () => {}, sleep: async () => {}};
const run = (root, fetcher, extra = {}) => buildRailwayWays({output: join(root, 'out'), fetcher, ...quiet, ...extra});
// The next run reads this run's published store.
async function publish(root) {
  await rm(join(root, 'previous'), {recursive: true, force: true});
  await (await import('node:fs/promises')).rename(join(root, 'out'), join(root, 'previous'));
  return join(root, 'previous');
}

test('the first stage is fetched with the merged query and stored region by region', async t => {
  const root = await fixture(t);
  const {queries, fetcher} = overpass(() => ok([way(1, {railway: 'subway'})]));
  const manifest = await run(root, fetcher);
  assert.deepEqual(queries, [railwayWaysQuery(part, part.box)]);
  assert.equal(manifest.run.stage, 'japan'); assert.equal(manifest.run.status, 'acquired');
  const regions = [];
  for await (const region of storedRegions(join(root, 'out'))) regions.push(region);
  assert.equal(regions.length, 1);
  assert.deepEqual([regions[0].stage, regions[0].part, regions[0].box], ['japan', 0, part.box]);
  assert.equal(regions[0].response.elements[0].id, 1);
  const state = JSON.parse(await readFile(join(root, 'out', 'state.json'), 'utf8'));
  assert.ok(state.stages.japan.completed);
  assert.deepEqual(state.stages.japan.leaves.regions, [{part: 0, box: part.box}]);
});

test('a region that times out is split; the next pass asks for the parts, never the whole region', async t => {
  const root = await fixture(t);
  const whole = railwayWaysQuery(part, part.box);
  const first = overpass(query => query === whole ? timedOut : ok([]));
  await run(root, first.fetcher);
  assert.equal(first.queries.length, 5);
  const names = (await readdir(join(root, 'out', 'regions', 'japan'))).sort();
  assert.deepEqual(names, quarters(part.box).map(box => `${regionKey({part: 0, box})}.json.gz`).sort());
  // Two weeks on, with every other stage current, Japan is refreshed.
  const previous = await publish(root);
  const state = JSON.parse(await readFile(join(previous, 'state.json'), 'utf8'));
  for (const stage of STAGES) state.stages[stage.name] = stage.name === 'japan' ? {...state.stages.japan, completed: '2000-01-01T00:00:00Z'}
    : {completed: new Date().toISOString(), pending: null, seen: []};
  await writeFile(join(previous, 'state.json'), JSON.stringify(state));
  const second = overpass(() => ok([]));
  await run(root, second.fetcher, {previous});
  assert.deepEqual(second.queries, quarters(part.box).map(box => railwayWaysQuery(part, box)));
});

test('until a pass is complete, the stage keeps its previous regions; a stopped pass resumes', async t => {
  const root = await fixture(t);
  const whole = railwayWaysQuery(part, part.box);
  await run(root, overpass(query => query === whole ? timedOut : ok([way(1, {railway: 'subway'})])).fetcher);
  const previous = await publish(root);
  const state = JSON.parse(await readFile(join(previous, 'state.json'), 'utf8'));
  for (const stage of STAGES) if (stage.name !== 'japan') state.stages[stage.name] = {completed: new Date().toISOString(), pending: null, seen: []};
  state.stages.japan.completed = '2000-01-01T00:00:00Z';
  await writeFile(join(previous, 'state.json'), JSON.stringify(state));
  // The refresh stops after one region (the server stays unavailable).
  const partial = overpass((query, n) => n === 1 ? ok([way(2, {railway: 'subway'})]) : {status: 500, text: 'Internal error'});
  const manifest = await run(root, partial.fetcher, {previous});
  assert.equal(manifest.run.status, 'partial');
  // Japan's stored regions (the other stages are marked current without any).
  const japanIds = async () => Promise.all((await readdir(join(root, 'out', 'regions', 'japan'))).map(async name =>
    JSON.parse(gunzipSync(await readFile(join(root, 'out', 'regions', 'japan', name)))).response.elements[0].id));
  const stored = await japanIds();
  assert.deepEqual(stored, [1, 1, 1, 1], 'the previous pass stays until the new one is complete');
  assert.equal((await readdir(join(root, 'out', 'next', 'japan'))).length, 1, 'the new region is kept for the next run');
  const resumed = await publish(root);
  const rest = overpass(() => ok([way(3, {railway: 'subway'})]));
  await run(root, rest.fetcher, {previous: resumed});
  assert.equal(rest.queries.length, 3, 'only the remaining regions');
  assert.deepEqual((await japanIds()).sort(), [2, 3, 3, 3], 'the complete pass replaced the stage');
});

test('a malformed or refused response is never stored, and an unreadable store stops the run', async t => {
  const root = await fixture(t);
  const bad = overpass(() => ({text: JSON.stringify({elements: [], remark: 'runtime error: open64: 0 Success /osm3s_osm_base'})}));
  const manifest = await run(root, bad.fetcher);
  assert.equal(manifest.run.status, 'deferred');
  assert.equal(bad.queries.length, 5, 'retried, never split');
  for await (const region of storedRegions(join(root, 'out'))) assert.fail(`stored ${region.box}`);
  await mkdir(join(root, 'broken'));
  await writeFile(join(root, 'broken', 'state.json'), '{');
  await assert.rejects(run(root, bad.fetcher, {previous: join(root, 'broken')}), /could not be read/);
});

test('only the server\'s own time or memory limit splits a region; gateway errors and cut-off responses do not', async t => {
  const root = await fixture(t);
  const whole = railwayWaysQuery(part, part.box);
  for (const reply of [{status: 504, text: '<html>504 Gateway Time-out</html>'}, {text: '{"elements": [{"type": "way"'}, {status: 502, text: 'server at capacity; All query workers are busy'}]) {
    const {queries, fetcher} = overpass(() => reply);
    const manifest = await run(root, fetcher);
    assert.equal(manifest.run.splitBoxes, 0, JSON.stringify(reply));
    assert.equal(manifest.run.status, 'deferred');
    assert.deepEqual(new Set(queries), new Set([whole]), 'the same region, retried');
  }
  // A remark with the server's limit, with HTTP 200, does split.
  const limit = overpass(query => query === whole ? {text: JSON.stringify({elements: [], remark: 'runtime error: Query run out of memory using about 2048 MB of RAM.'})} : ok([]));
  assert.equal((await run(root, limit.fetcher)).run.splitBoxes, 1);
});

test('a stage complete in the store must have every region its pass recorded', async t => {
  const root = await fixture(t);
  await run(root, overpass(() => ok([way(1, {railway: 'subway'})])).fetcher);
  const store = join(root, 'out'), read = async () => { for await (const region of storedRegions(store)) void region; };
  await read();
  await rm(join(store, 'regions', 'japan'), {recursive: true});
  await assert.rejects(read, /ENOENT/, 'a missing folder is an error, not an empty stage');
  await mkdir(join(store, 'regions', 'japan'));
  await assert.rejects(read, /japan has 0 region/);
  const state = JSON.parse(await readFile(join(store, 'state.json'), 'utf8'));
  state.stages.japan.leaves.regions.push({part: 0, box: [0, 0, 1, 1]});
  await writeFile(join(store, 'state.json'), JSON.stringify(state));
  await writeFile(join(store, 'regions', 'japan', 'x.json.gz'), (await import('node:zlib')).gzipSync(JSON.stringify({stage: 'japan', response: {elements: []}})));
  await assert.rejects(read, /japan has 1 region\(s\), 2 expected/);
});
