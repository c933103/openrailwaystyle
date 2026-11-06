import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile, mkdir} from 'node:fs/promises';
import {gunzipSync, gzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {STAGES} from '../scripts/download-stages.mjs';
import {quarters} from '../scripts/branch-lines.mjs';
import {railwayWaysQuery, railwayWaysQueries} from '../scripts/railway-ways.mjs';
import {adiffQuery, selectionChangeQueries} from '../scripts/overpass-adiff.mjs';
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
// Stored regions whose query cannot be compared with the current one (not
// a railway-ways query at all): only a full pass can bring them up to date.
async function staleQueries(store, stage = 'japan') {
  const dir = join(store, 'regions', stage);
  for (const name of await readdir(dir)) {
    const region = JSON.parse(gunzipSync(await readFile(join(dir, name))));
    await writeFile(join(dir, name), gzipSync(JSON.stringify({...region, query: 'an earlier query'})));
  }
}
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
  // Two weeks on, with every other stage current, Japan is refreshed; its
  // query changed since, so in full.
  const previous = await publish(root);
  await staleQueries(previous);
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
  await staleQueries(previous);
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

// Synthetic augmented diffs: no captured provider data.
const adiff = (base, actions = '') => ({text: `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="Overpass API">\n<meta osm_base="${base}"/>\n${actions}\n</osm>\n`});
const wayXml = (id, tags) => `<way id="${id}" version="2" timestamp="2026-11-01T00:00:00Z"><nd ref="1" lat="35.6" lon="139.7"/><nd ref="2" lat="35.61" lon="139.71"/>${Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('')}</way>`;
const japanRegions = async root => Promise.all((await readdir(join(root, 'out', 'regions', 'japan'))).sort().map(async name =>
  JSON.parse(gunzipSync(await readFile(join(root, 'out', 'regions', 'japan', name))))));
async function currentExceptJapan(previous) {
  const state = JSON.parse(await readFile(join(previous, 'state.json'), 'utf8'));
  for (const stage of STAGES) if (stage.name !== 'japan') state.stages[stage.name] = {completed: new Date().toISOString(), pending: null, seen: []};
  state.stages.japan.completed = '2000-01-01T00:00:00Z';
  await writeFile(join(previous, 'state.json'), JSON.stringify(state));
}

test('a due stage takes the changes since each region\'s time, two requests per region, not a new download', async t => {
  const root = await fixture(t);
  await run(root, overpass(() => ok([way(1, {railway: 'subway'}), way(2, {railway: 'rail', usage: 'branch'})])).fetcher);
  const previous = await publish(root);
  await currentExceptJapan(previous);
  const queries = railwayWaysQueries(railwayWaysQuery(part, part.box));
  const changes = overpass(query => query.includes('(.r;);out meta;')
    ? adiff('2026-11-01T05:00:00Z')
    : adiff('2026-11-01T05:00:00Z', [`<action type="modify"><old/><new>${wayXml(1, {railway: 'subway', name: 'Line 1'})}</new></action>`,
      '<action type="delete"><old/><new><way id="2" visible="true"/></new></action>'].join('')));
  const manifest = await run(root, changes.fetcher, {previous});
  assert.deepEqual(changes.queries, [adiffQuery(queries.relations, '2026-10-31T00:00:00Z'),
    adiffQuery(queries.ways, '2026-10-31T00:00:00Z', '2026-11-01T05:00:00Z')], 'relations, then ways up to the same time');
  assert.ok(changes.queries.every(q => !q.includes('[out:json]')), 'no full download');
  assert.equal(manifest.run.status, 'acquired');
  const [region] = await japanRegions(root);
  assert.equal(region.response.osm3s.timestamp_osm_base, '2026-11-01T05:00:00Z', 'the next changes start here');
  assert.deepEqual(region.response.elements.map(e => [e.id, e.tags.name ?? null]), [[1, 'Line 1']], 'changed, and the way no longer selected removed');
  assert.equal(region.query, railwayWaysQuery(part, part.box));
  const state = JSON.parse(await readFile(join(root, 'out', 'state.json'), 'utf8'));
  assert.notEqual(state.stages.japan.completed, '2000-01-01T00:00:00Z', 'the stage is current again, so the datasets built from it take it');
  assert.equal(state.stages.japan.changePass, null);
});

test('a stopped change pass keeps every region as it was and resumes with the rest', async t => {
  const root = await fixture(t);
  const whole = railwayWaysQuery(part, part.box);
  await run(root, overpass(query => query === whole ? timedOut : ok([way(1, {railway: 'subway'})])).fetcher);
  const previous = await publish(root);
  await currentExceptJapan(previous);
  // The first region's two requests succeed; the server then stays unavailable.
  const partial = overpass((query, n) => n <= 2 ? adiff('2026-11-01T05:00:00Z') : {status: 500, text: 'Internal error'});
  const manifest = await run(root, partial.fetcher, {previous});
  assert.equal(manifest.run.status, 'acquired', 'no region left pending');
  let state = JSON.parse(await readFile(join(root, 'out', 'state.json'), 'utf8'));
  assert.equal(state.stages.japan.completed, '2000-01-01T00:00:00Z', 'not current until every region is');
  assert.equal(state.stages.japan.changePass.done.length, 1);
  assert.match(state.stages.japan.lastAttempt.reason, /deferred/);
  const regions = await japanRegions(root);
  assert.equal(regions.length, 4, 'no region lost');
  assert.deepEqual(regions.map(r => r.response.osm3s.timestamp_osm_base).sort(),
    ['2026-10-31T00:00:00Z', '2026-10-31T00:00:00Z', '2026-10-31T00:00:00Z', '2026-11-01T05:00:00Z']);
  const resumed = await publish(root);
  const rest = overpass(() => adiff('2026-11-01T06:00:00Z'));
  await run(root, rest.fetcher, {previous: resumed});
  assert.equal(rest.queries.length, 6, 'only the three regions left, two requests each');
  state = JSON.parse(await readFile(join(root, 'out', 'state.json'), 'utf8'));
  assert.notEqual(state.stages.japan.completed, '2000-01-01T00:00:00Z');
});

test('a stored region of another, comparable query takes only the difference, not a full pass', async t => {
  const root = await fixture(t);
  await run(root, overpass(() => ok([way(1, {railway: 'subway'})])).fetcher);
  const previous = await publish(root);
  await currentExceptJapan(previous);
  // The stored region was made by a query whose way selection was narrower.
  const current = railwayWaysQuery(part, part.box), older = current.replace('|funicular)$"];.b;.p;);out meta geom qt;', ')$"];.b;.p;);out meta geom qt;');
  assert.notEqual(older, current);
  const dir = join(previous, 'regions', 'japan');
  for (const name of await readdir(dir)) {
    const region = JSON.parse(gunzipSync(await readFile(join(dir, name))));
    await writeFile(join(dir, name), gzipSync(JSON.stringify({...region, query: older})));
  }
  const funicular = way(3, {railway: 'funicular'});
  const changes = overpass(query => query.includes('[adiff:') ? adiff('2026-11-01T05:00:00Z')
    : query.endsWith('out ids;') ? ok([{type: 'way', id: 1}, {type: 'way', id: 3}]) : ok([funicular]));
  const manifest = await run(root, changes.fetcher, {previous});
  const before = railwayWaysQueries(older), after = railwayWaysQueries(current);
  const {ids, elements} = selectionChangeQueries(before.ways, after.ways, '2026-11-01T05:00:00Z');
  assert.deepEqual(changes.queries, [adiffQuery(before.relations, '2026-10-31T00:00:00Z'),
    adiffQuery(before.ways, '2026-10-31T00:00:00Z', '2026-11-01T05:00:00Z'), ids, elements(['way/3'])],
    'the changes of both parts, then the new way selection\'s ids and only the new way; no full download');
  assert.equal(manifest.run.status, 'acquired');
  const [region] = await japanRegions(root);
  assert.deepEqual(region.response.elements.map(e => e.id).sort(), [1, 3]);
  assert.equal(region.query, current, 'stored under the current query');
});

test('a stage whose part boxes no longer match its stored regions takes a full pass, not changes', async t => {
  const root = await fixture(t);
  await run(root, overpass(() => ok([way(1, {railway: 'subway'})])).fetcher);
  const previous = await publish(root);
  await currentExceptJapan(previous);
  // As if the stage's box had grown since: the stored region covers less than the part.
  const dir = join(previous, 'regions', 'japan');
  for (const name of await readdir(dir)) {
    const region = JSON.parse(gunzipSync(await readFile(join(dir, name))));
    const box = [region.box[0], region.box[1], region.box[2] - 1, region.box[3]];
    await writeFile(join(dir, name), gzipSync(JSON.stringify({...region, box, query: railwayWaysQuery(part, box)})));
  }
  // A change pass had stopped partway: its progress must not outlive the full pass.
  const names = await readdir(dir);
  const state = JSON.parse(await readFile(join(previous, 'state.json'), 'utf8'));
  state.stages.japan.changePass = {started: '2026-10-31T00:00:00Z', done: names};
  await writeFile(join(previous, 'state.json'), JSON.stringify(state));
  const full = overpass(() => ok([way(1, {railway: 'subway'})]));
  await run(root, full.fetcher, {previous});
  assert.ok(full.queries.length && full.queries.every(q => q.startsWith('[out:json]') && !q.includes('[adiff:')), 'the whole part, downloaded');
  assert.equal(full.queries[0], railwayWaysQuery(part, part.box));
  assert.equal(JSON.parse(await readFile(join(root, 'out', 'state.json'), 'utf8')).stages.japan.changePass, null, 'the stopped change pass forgotten');
  // The next refresh asks every region for its changes, none skipped.
  const next = await publish(root);
  await currentExceptJapan(next);
  const changes = overpass(() => adiff('2026-11-02T05:00:00Z'));
  await run(root, changes.fetcher, {previous: next});
  assert.equal(changes.queries.filter(q => q.includes('[adiff:')).length, 2 * names.length, 'relations and ways for each region');
});

test('a change pass resumed after the query changed brings its done regions to the new query too', async t => {
  const root = await fixture(t);
  await run(root, overpass(() => ok([way(1, {railway: 'subway'})])).fetcher);
  const previous = await publish(root);
  await currentExceptJapan(previous);
  const current = railwayWaysQuery(part, part.box), older = current.replace('|funicular)$"];.b;.p;);out meta geom qt;', ')$"];.b;.p;);out meta geom qt;');
  const dir = join(previous, 'regions', 'japan'), names = await readdir(dir);
  for (const name of names) {
    const region = JSON.parse(gunzipSync(await readFile(join(dir, name))));
    await writeFile(join(dir, name), gzipSync(JSON.stringify({...region, query: older})));
  }
  // The earlier run of this pass had done every region, under the older query.
  const state = JSON.parse(await readFile(join(previous, 'state.json'), 'utf8'));
  state.stages.japan.changePass = {started: '2026-10-31T00:00:00Z', done: names};
  await writeFile(join(previous, 'state.json'), JSON.stringify(state));
  const changes = overpass(query => query.includes('[adiff:') ? adiff('2026-11-01T05:00:00Z') : ok([{type: 'way', id: 1}]));
  await run(root, changes.fetcher, {previous});
  assert.ok(changes.queries.some(q => q.includes('[adiff:')), 'not skipped');
  const [region] = await japanRegions(root);
  assert.equal(region.query, current);
});

test('a relation the power selection chose takes the changes of that query, not the route relations\'', async t => {
  const root = await fixture(t);
  const route = {type: 'relation', id: 10, version: 1, timestamp: '2026-10-01T00:00:00Z', tags: {type: 'route', route: 'subway', name: 'Line'}, members: []};
  const charger = {type: 'relation', id: 20, version: 1, timestamp: '2026-10-01T00:00:00Z', tags: {type: 'multipolygon', amenity: 'charging_station', railway: 'charging_station'},
    members: [{type: 'way', ref: 5, role: 'outer', geometry: [{lon: 139.7, lat: 35.6}, {lon: 139.701, lat: 35.6}, {lon: 139.701, lat: 35.601}, {lon: 139.7, lat: 35.6}]}]};
  // As the merged query outputs them: the route relations, then the rest.
  await run(root, overpass(() => ok([route, way(1, {railway: 'subway'}), charger])).fetcher);
  const previous = await publish(root);
  await currentExceptJapan(previous);
  const changes = overpass(query => query.includes('(.r;);out meta;')
    ? adiff('2026-11-01T05:00:00Z')
    : adiff('2026-11-01T05:00:00Z', '<action type="delete"><old/><new><relation id="20" visible="false"/></new></action>'));
  await run(root, changes.fetcher, {previous});
  const [region] = await japanRegions(root);
  assert.deepEqual(region.response.elements.map(e => `${e.type}/${e.id}`), ['relation/10', 'way/1'], 'the deleted charger goes; the route stays, once');
  assert.equal(region.relations, 1, 'where the route relations end, for the next pass');
});

test('stored elements split at the end of the route relations\' output', async () => {
  const {storedOutputs} = await import('../scripts/railway-ways.mjs');
  const route = id => ({type: 'relation', id, tags: {type: 'route', route: 'tram'}}), charger = id => ({type: 'relation', id, tags: {amenity: 'charging_station'}});
  const ids = ({relations, ways}) => [relations.map(e => e.id), ways.map(e => e.id)];
  const elements = [route(1), route(2), {type: 'node', id: 3}, charger(4)];
  assert.deepEqual(ids(storedOutputs({response: {elements}})), [[1, 2], [3, 4]], 'a full download: at its first node or way');
  assert.deepEqual(ids(storedOutputs({relations: 1, response: {elements}})), [[1], [2, 3, 4]], 'as the change pass recorded');
  assert.deepEqual(ids(storedOutputs({response: {elements: [route(1), charger(4)]}})), [[1], [4]], 'no node or way: at the first relation no route selection chose');
  assert.deepEqual(ids(storedOutputs({response: {elements: [route(1), route(1)]}})), [[1], [1]], 'or at a relation output twice');
});

test('a world pass begun with the earlier three boxes is started again with the current tiles', async t => {
  const root = await fixture(t);
  await run(root, overpass(() => ok([way(1, {railway: 'subway'})])).fetcher);
  const previous = await publish(root);
  // Every stage current except the world, whose pass stopped partway through the old boxes.
  const state = JSON.parse(await readFile(join(previous, 'state.json'), 'utf8'));
  for (const stage of STAGES) state.stages[stage.name] = {completed: new Date().toISOString(), pending: null, seen: []};
  state.stages.world = {completed: null, started: '2026-10-20T00:00:00Z', seen: [], fetched: [{part: 0, box: [-35, -20, 37.5, 52]}],
    pending: [{part: 1, box: [-50, 110, -11, 180]}, {part: 2, box: [-50, -180, 0, -150]}]};
  await writeFile(join(previous, 'state.json'), JSON.stringify(state));
  const world = STAGES.find(stage => stage.name === 'world');
  const {queries, fetcher} = overpass(() => ok([]));
  await run(root, fetcher, {previous});
  assert.deepEqual(queries, world.parts.map(part => railwayWaysQuery(part, part.box)), 'the eight tiles, none of the old boxes');
  const after = JSON.parse(await readFile(join(root, 'out', 'state.json'), 'utf8')).stages.world;
  assert.deepEqual(after.leaves.regions.map(region => region.box), world.parts.map(part => part.box), 'recorded under the tiles it fetched');
});

for(const status of [200,503]) test(`railway-ways byte-limit checkpoint does not await stuck cancellation (HTTP ${status})`,async t=>{
 const root=await fixture(t);let cancelled=false,release,timer,body,calls=0;
 const cancellation=new Promise(resolve=>{release=resolve;});
 const result=run(root,async()=>{
  calls++;body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(10_000_001));},cancel(){cancelled=true;return cancellation;}});
  return new Response(body,{status});
 },{runBudget:10_000_000});
 try {
  const saved=await Promise.race([result,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('railway-ways checkpoint waited for cancellation')),1000);})]);
  assert.equal(cancelled,true);assert.equal(body.locked,false);assert.equal(calls,1);
  assert.equal(saved.run.downloadedBytes,10_000_001);assert.equal(saved.run.fetchedBoxes,0);
  assert.equal(saved.run.splitBoxes,status===200?1:0);assert.equal(saved.run.status,'deferred');
  const state=JSON.parse(await readFile(join(root,'out/state.json'),'utf8'));
  assert.deepEqual(state.stages.japan.pending.map(item=>item.box),status===200?quarters(part.box):[part.box]);
  for await(const region of storedRegions(join(root,'out')))assert.fail(`partial body stored for ${region.box}`);
 } finally {clearTimeout(timer);release();await result;}
});
