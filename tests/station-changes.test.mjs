import * as responseReader from '../scripts/response-chunks.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as zlib from 'node:zlib';
import vm from 'node:vm';
import * as acquisition from '../scripts/station-acquisition.mjs';
import * as overview from '../scripts/station-overview.mjs';

// Synthetic stations and augmented diffs; no captured provider data.
const node = (id, lon, lat, version = 1, tags = {railway: 'station', name: 'Synthetic station'}) =>
  ({type: 'node', id, lon, lat, version, timestamp: '2026-10-19T00:00:00Z', tags});
const NOW = Date.parse('2026-11-01T06:00:00Z');
// A complete generation: every base region done, stations in the first.
// By default one keeping its elements; `recordsOnly` one of a cycle started
// before elements were kept.
function complete(source, started = '2026-10-20T00:00:00.000Z', {recordsOnly = false} = {}) {
  let first = acquisition.newStationAcquisition();
  if (recordsOnly) { const {elements, query, extraction, ...rest} = first; first = rest; }
  let {state, records, elements} = acquisition.applyStationRegion(first, [], first.pending[0].box, {elements: source}, recordsOnly ? undefined : []);
  state = {...state, pending: [], completed: [...state.completed, ...first.pending.slice(1).map(({box}) => ({box, count: 0}))], started};
  return {state, records, elements};
}
const base = Array.from({length: 40}, (_, i) => node(100 + i, -170 + i / 10, -80));
const osm = actions => `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="Overpass API">\n<meta osm_base="2026-11-01T05:00:00Z"/>\n${actions}\n</osm>\n`;
const xmlNode = ({id, lon, lat, version, tags}) => `<node id="${id}" lat="${lat}" lon="${lon}" version="${version}" timestamp="2026-10-31T00:00:00Z">${Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('')}</node>`;

test('a complete generation always takes changes, however old; only without one is a full cycle due', () => {
  const {state} = complete(base);
  assert.equal(acquisition.stationChangesSince(state), '2026-10-20T00:00:00Z', 'from its cycle start, at first');
  assert.equal(acquisition.stationChangesSince({...state, changesSince: '2026-10-31T00:00:00Z'}), '2026-10-31T00:00:00Z');
  assert.equal(acquisition.stationChangesSince({...state, changesSince: '2025-06-01T00:00:00Z'}), '2025-06-01T00:00:00Z', 'no age limit');
  assert.equal(acquisition.stationChangesSince({...state, pending: [{box: [-90, -180, -45, -135], depth: 0}]}), null, 'incomplete');
  assert.equal(acquisition.stationChangesSince(acquisition.newStationAcquisition()), null);
  assert.match(acquisition.stationChangesQuery('2026-10-20T00:00:00Z'),
    /^\[out:xml\]\[timeout:300\]\[maxsize:268435456\]\[adiff:"2026-10-20T00:00:00Z"\];\(nwr\[railway~"\^\(station\|halt\|tram_stop\)\$"\]\(-90,-180,90,180\);.*\);out meta center qt;$/);
});

for (const recordsOnly of [false, true]) test(`changes remove, replace and add stations by OSM identity and version, as a full download would${recordsOnly ? ' (records only)' : ''}`, () => {
  const {state, records, elements} = complete(base, undefined, {recordsOnly});
  const kept = recordsOnly ? {} : {elements};
  const changes = acquisition.parseStationChanges(osm([
    // Deleted; retagged so it is no longer a station; moved; a new station way with its centre.
    '<action type="delete"><old/><new><node id="100" visible="false"/></new></action>',
    `<action type="modify"><old/><new>${xmlNode(node(101, -169.9, -80, 2, {railway: 'platform'}))}</new></action>`,
    `<action type="modify"><old/><new>${xmlNode(node(102, -169.5, -80.5, 2))}</new></action>`,
    '<action type="create"><way id="7" version="1" timestamp="2026-10-31T00:00:00Z"><center lat="35.68" lon="139.76"/><nd ref="1"/><nd ref="2"/><tag k="railway" v="station"/><tag k="name" v="Way station"/></way></action>',
  ].join('\n')));
  const result = acquisition.applyStationChanges(state, records, changes, {now: '2026-11-01T06:00:00.000Z', ...kept});
  assert.equal(result.changed, 4);
  if (!recordsOnly) {
    assert.deepEqual(result.records, acquisition.stationRecords(result.elements));
    assert.deepEqual(result.elements.find(e => e.id === 101).tags, {railway: 'platform'}, 'still selected: kept as an element, not a station');
    assert.ok(!result.elements.some(e => e.id === 100));
  }
  assert.equal(result.state.changesSince, '2026-11-01T05:00:00Z', 'the next update starts from the new database time');
  const ids = result.records.map(r => r.id);
  assert.ok(!ids.includes('node-100') && !ids.includes('node-101'));
  assert.deepEqual([result.records.find(r => r.id === 'node-102').lat, result.records.find(r => r.id === 'node-102').osm_version], [-80.5, 2]);
  assert.deepEqual(result.records.find(r => r.id === 'way-7'), overview.stationPoint({type: 'way', id: 7, version: 1, timestamp: '2026-10-31T00:00:00Z',
    center: {lat: 35.68, lon: 139.76}, tags: {railway: 'station', name: 'Way station'}}));
  // An older version than the record is ignored; a version-less one refused.
  const older = acquisition.applyStationChanges(result.state, result.records,
    {timestamp: '2026-11-01T06:00:00Z', upserts: [node(102, 0, 0, 1)], deletes: []}, recordsOnly ? {} : {elements: result.elements});
  assert.equal(older.changed, 0);
  assert.throws(() => acquisition.applyStationChanges(state, records, {timestamp: '2026-11-01T06:00:00Z',
    upserts: [{...node(5, 0, 0), version: undefined}], deletes: []}, kept), /lacks version/);
  // Losing over 5% of the stations is not trusted.
  assert.throws(() => acquisition.applyStationChanges(state, records, {timestamp: '2026-11-01T06:00:00Z', upserts: [],
    deletes: base.slice(0, 5).map(n => `node/${n.id}`)}, kept), /drop the stations/);
});

// The real entrypoint, as in station-builder.test.mjs; only fetch, the
// filesystem root and timers are controlled.
const source = readFileSync(new URL('../scripts/build-station-snapshot.mjs', import.meta.url), 'utf8');
async function run(t, reply, {state, records, elements}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'station-changes-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await fs.mkdir(join(root, 'previous'));
  await fs.writeFile(join(root, 'previous/state.json'), JSON.stringify(state));
  await fs.writeFile(join(root, 'previous/stations.json.gz'), zlib.gzipSync(JSON.stringify(records)));
  if (state.elements) await fs.writeFile(join(root, 'previous/elements.json.gz'), zlib.gzipSync(JSON.stringify(elements)));
  const calls = [], timers = new Set();
  const io = Object.fromEntries(['mkdir', 'readFile', 'writeFile', 'rm'].map(name => [name, (path, ...args) => fs[name](join(root, path), ...args)]));
  const context = vm.createContext({
    process: {env: {PREVIOUS_DATA: 'previous', OVERPASS_URL: 'https://overpass.fixture.invalid/api/interpreter'}},
    URL, URLSearchParams, Buffer, AbortController, Date,
    setTimeout: () => { const id = {}; timers.add(id); return id; }, clearTimeout: id => timers.delete(id),
    console: {log() {}, warn() {}},
    fetch: async (url, options) => { calls.push(options.body.get('data')); assert.equal(options.redirect, 'error'); return reply(); },
  });
  const dependencies = {'node:fs/promises': io, 'node:path': {join}, 'node:zlib': zlib, './station-acquisition.mjs': acquisition, './station-overview.mjs': overview, './response-chunks.mjs': responseReader};
  const module = new vm.SourceTextModule(source, {context});
  await module.link(specifier => {
    const values = dependencies[specifier]; assert.ok(values, `unexpected import ${specifier}`);
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, {context});
  });
  await module.evaluate();
  assert.equal(timers.size, 0);
  const read = async path => JSON.parse(await fs.readFile(join(root, 'station-snapshot', path), 'utf8'));
  const gz = async path => JSON.parse(zlib.gunzipSync(await fs.readFile(join(root, 'station-snapshot', path))));
  const saved = await read('state.json');
  return {calls, state: saved, manifest: await read('manifest.json'), records: await gz('stations.json.gz'),
    elements: saved.elements ? await gz('elements.json.gz') : undefined};
}

for (const recordsOnly of [false, true]) test(`the builder updates a complete generation with one change request, and keeps it on failure${recordsOnly ? ' (records only)' : ''}`, async t => {
  // Started recently, so changes apply (the builder reads the wall clock).
  const recent = new Date(Date.now() - 86400000).toISOString();
  const {state, records, elements} = complete(base, recent, {recordsOnly});
  const since = recent.replace(/\.\d+Z$/, 'Z');
  const ok = await run(t, () => new Response(osm('<action type="delete"><old/><new><node id="100" visible="false"/></new></action>'), {status: 200}), {state, records, elements});
  assert.deepEqual(ok.calls, [acquisition.stationChangesQuery(since)], 'one worldwide change request, no region download');
  assert.equal(ok.records.length, records.length - 1);
  assert.equal(ok.manifest.complete, true);
  assert.equal(ok.manifest.changedRecords, 1);
  assert.equal(ok.state.changesSince, '2026-11-01T05:00:00Z');
  assert.ok(ok.manifest.bundles > 0, 'the complete generation is built for publication');
  // A failed request keeps the generation as it was; no new cycle starts.
  if (recordsOnly) assert.equal(ok.elements, undefined, 'a generation without elements stays one until its next cycle');
  else assert.equal(ok.elements.length, elements.length - 1);
  const failed = await run(t, () => new Response('busy', {status: 503}), {state, records, elements});
  assert.equal(failed.calls.length, 1);
  assert.deepEqual(failed.records, records);
  assert.deepEqual(failed.elements, elements);
  assert.equal(failed.state.pending.length, 0, 'still complete, not rotated into a new cycle');
  assert.equal(failed.manifest.changedRecords, 0);
  assert.match(failed.manifest.status, /changes deferred/);
});

test('the workflow publishes what the builder decided, and only a complete generation', () => {
  const workflow = readFileSync(new URL('../.github/workflows/station-points.yml', import.meta.url), 'utf8');
  assert.match(workflow, /const publish=manifest\.publish===true;\n\s+assert\.ok\(!publish\|\|complete/);
  assert.equal(workflow.match(/if: steps\.verify\.outputs\.publish == 'true'/g).length, 2, 'publication and redeploy');
  assert.doesNotMatch(workflow, /if: steps\.verify\.outputs\.complete == 'true'/);
  // The elements are restored and saved on the work branch only.
  assert.match(workflow, /git cat-file -e FETCH_HEAD:elements\.json\.gz/);
  assert.match(workflow, /git checkout --orphan station-points-data\n[\s\S]*?rm -f elements\.json\.gz\n/);
  assert.match(workflow, /cp "\$GITHUB_WORKSPACE\/station-snapshot\/elements\.json\.gz" \./);
  assert.match(readFileSync(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8'), /--exclude=stations\.json\.gz --exclude=elements\.json\.gz/);
});

test('a generation made by another record conversion or query starts a cycle; one predating versions counts as current', () => {
  const {state} = complete(base, undefined, {recordsOnly: true});
  const current = acquisition.stationExtraction();
  assert.equal(acquisition.stationChangesSince({...state, extraction: current}, current), '2026-10-20T00:00:00Z');
  assert.equal(acquisition.stationChangesSince({...state, extraction: 'another'}, current), null);
  assert.equal(acquisition.stationChangesSince(state, current), '2026-10-20T00:00:00Z', 'no version: made by this conversion');
  assert.equal(acquisition.stationVersion(state), current);
  // One keeping elements depends on its query alone.
  const kept = complete(base).state;
  assert.equal(acquisition.stationVersion(kept), acquisition.stationQueryVersion());
  assert.equal(acquisition.stationChangesSince(kept), '2026-10-20T00:00:00Z');
  assert.equal(acquisition.stationChangesSince({...kept, extraction: 'another'}), null);
});

test('the first changes after a cycle drop stations created and gone again while its regions were read', () => {
  const ghost = node(500, -169, -80.2, 1);
  ghost.timestamp = '2026-10-22T00:00:00Z';
  const kept = node(501, -169, -80.3, 3); kept.timestamp = '2026-10-23T00:00:00Z';
  const {state, records, elements} = complete([...base, ghost, kept]);
  // The changes since the cycle start mention 501 (changed again), not 500.
  const changes = {timestamp: '2026-11-01T05:00:00Z', deletes: [], upserts: [{...node(501, -169, -80.3, 4), timestamp: '2026-10-30T00:00:00Z'}]};
  const first = acquisition.applyStationChanges(state, records, changes, {elements});
  const ids = first.records.map(r => r.id);
  assert.ok(!ids.includes('node-500'), 'matched the query at neither end: gone');
  assert.ok(ids.includes('node-501'));
  assert.ok(ids.includes('node-100'), 'edited before the cycle start: kept');
  assert.equal(first.changed, 2);
  // Later changes start from a database time: nothing is dropped that way.
  const later = acquisition.applyStationChanges(first.state, first.records, {timestamp: '2026-11-02T00:00:00Z', upserts: [], deletes: []}, {elements: first.elements});
  assert.equal(later.records.length, first.records.length);
  assert.equal(later.changed, 0);
});

test('a complete generation is published when its tiles differ from the last published ones', async t => {
  const recent = new Date(Date.now() - 86400000).toISOString();
  const {state, records, elements} = complete(base, recent);
  const none = () => new Response(osm(''), {status: 200});
  const first = await run(t, none, {state, records, elements});
  assert.equal(first.manifest.changedRecords, 0);
  assert.equal(first.manifest.publish, true, 'never published from this state: published');
  assert.equal(first.state.publishedTiles, first.manifest.tilesDigest);
  const again = await run(t, none, {state: first.state, records: first.records, elements: first.elements});
  assert.equal(again.manifest.publish, false, 'nothing changed: not published again');
  const changed = await run(t, none, {state: {...first.state, publishedTiles: 'tiles of other code'}, records: first.records, elements: first.elements});
  assert.equal(changed.manifest.publish, true, 'new tile code: published');
  assert.equal(acquisition.stationTilesDigest(new Map([['b', Buffer.from('2')], ['a', Buffer.from('1')]])),
    acquisition.stationTilesDigest(new Map([['a', Buffer.from('1')], ['b', Buffer.from('2')]])), 'order does not matter');
});

test('an incomplete cycle without elements of another record conversion or query restarts keeping elements and its regions', async t => {
  const {elements: _, query, extraction: __, ...first} = acquisition.newStationAcquisition();
  const partial = acquisition.applyStationRegion(first, [], first.pending[0].box, {elements: base});
  const busy = () => new Response('busy', {status: 503});
  const regions = s => [...s.pending, ...s.completed].map(r => r.box.join(',')).sort();
  // Another version: no record of it is kept, and the cycle starts again over the same regions.
  const other = await run(t, busy, {state: {...partial.state, extraction: 'another'}, records: partial.records});
  assert.equal(other.records.length, 0, 'never mixed with records of the current conversion');
  assert.equal(other.state.completed.length, 0);
  assert.deepEqual(regions(other.state), regions(partial.state));
  assert.equal(other.state.elements, true, 'the new cycle keeps elements');
  assert.deepEqual(other.elements, []);
  assert.equal(other.state.extraction, acquisition.stationQueryVersion());
  assert.equal(other.state.query, acquisition.stationWorldQuery());
  // The current version, or none recorded (made by this conversion): the cycle goes on.
  for (const extraction of [acquisition.stationExtraction(), undefined]) {
    const going = await run(t, busy, {state: {...partial.state, extraction}, records: partial.records});
    assert.equal(going.records.length, partial.records.length);
    assert.equal(going.state.completed.length, partial.state.completed.length);
    assert.equal(going.state.elements, undefined);
  }
});

test('a cycle keeping elements restarts only for another query: another conversion re-converts the stored elements', async t => {
  const first = acquisition.newStationAcquisition();
  const partial = acquisition.applyStationRegion(first, [], first.pending[0].box, {elements: base}, []);
  const busy = () => new Response('busy', {status: 503});
  // Records of another conversion (stored names differ): converted again, no cycle restart.
  const stale = partial.records.map(r => ({...r, name: 'old conversion'}));
  const going = await run(t, busy, {state: partial.state, records: stale, elements: partial.elements});
  assert.deepEqual(going.records, partial.records);
  assert.equal(going.manifest.reconverted, true);
  assert.equal(going.state.completed.length, 1);
  assert.deepEqual(going.elements, partial.elements);
  // Another query: a new cycle.
  const other = await run(t, busy, {state: {...partial.state, extraction: 'another', query: 'another'}, records: partial.records, elements: partial.elements});
  assert.equal(other.state.completed.length, 0);
  assert.deepEqual([other.records, other.elements], [[], []]);
  assert.equal(other.state.query, acquisition.stationWorldQuery());
});

test('a complete generation keeping elements takes a changed query as its difference, not a new cycle', async t => {
  const recent = new Date(Date.now() - 86400000).toISOString();
  const since = recent.replace(/\.\d+Z$/, 'Z');
  const funicular = 'nwr[public_transport=station][funicular=yes](-90,-180,90,180);';
  const world = acquisition.stationWorldQuery();
  assert.ok(world.includes(funicular));
  const narrower = world.replace(funicular, '');
  const {state, records, elements} = complete(base, recent);
  const previous = {...state, query: narrower, extraction: 'narrower'};
  const added = {type: 'node', id: 900, lat: 46.5, lon: 7.9, version: 3, timestamp: '2026-10-01T00:00:00Z',
    tags: {public_transport: 'station', funicular: 'yes', name: 'Synthetic funicular'}};
  const json = body => new Response(JSON.stringify(body), {status: 200});
  const ids = [...elements.slice(1), added].map(({type, id}) => ({type, id}));
  const replies = [() => new Response(osm(''), {status: 200}), () => json({elements: ids}), () => json({elements: [added]})];
  const result = await run(t, () => replies.shift()(), {state: previous, records, elements});
  const at = '2026-11-01T05:00:00Z', selection = acquisition.stationSelectionQueries(previous, at);
  assert.deepEqual(result.calls, [acquisition.stationChangesQuery(since, narrower), selection.ids, selection.elements(['node/900'])],
    'the old query\'s changes, the new one\'s ids, the newly selected element by id');
  assert.equal(result.state.pending.length, 0, 'still complete');
  assert.equal(result.state.query, world);
  assert.equal(result.state.extraction, acquisition.stationQueryVersion());
  assert.deepEqual(result.elements.map(e => e.id), [...elements.slice(1).map(e => e.id), 900].sort((a, b) => `node-${a}`.localeCompare(`node-${b}`)));
  assert.ok(result.records.some(r => r.id === 'node-900') && !result.records.some(r => r.id === 'node-100'), 'one added, one no longer selected');
  assert.equal(result.manifest.changedRecords, 2);
  assert.equal(result.manifest.publish, true);
  // A request failing after the changes keeps them; the next run takes the difference from there.
  const partly = [() => new Response(osm(''), {status: 200}), () => new Response('busy', {status: 503})];
  const deferred = await run(t, () => partly.shift()(), {state: previous, records, elements});
  assert.equal(deferred.state.query, narrower);
  assert.equal(deferred.state.changesSince, at);
  assert.equal(deferred.state.pending.length, 0);
  // More newly selected elements than the requests allow: a new cycle.
  const many = Array.from({length: 13000}, (_, i) => ({type: 'node', id: 10000 + i}));
  const big = [() => new Response(osm(''), {status: 200}), () => json({elements: many})];
  const restarted = await run(t, () => big.shift()(), {state: previous, records, elements});
  assert.equal(restarted.calls.length, 2, 'none of them asked');
  assert.ok(restarted.state.pending.length > 0 && restarted.state.completed.length === 0);
  assert.equal(restarted.state.query, world);
  assert.match(restarted.manifest.status, /new cycle/);
});

for(const status of [200,503]) test(`station changes retain the complete generation without awaiting cancellation (HTTP ${status})`,async t=>{
 const recent=new Date(Date.now()-86400000).toISOString();
 const prior=complete(base,recent);
 let cancelled=false,release,timer,body;
 const cancellation=new Promise(resolve=>{release=resolve;});
 const result=run(t,()=>{
  body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(status===200?1024*1024:16384).fill(65));},cancel(){cancelled=true;return cancellation;}});
  return new Response(body,{status});
 },prior);
 try {
  const saved=await Promise.race([result,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('change checkpoint waited for cancellation')),1000);})]);
  assert.equal(cancelled,true);assert.equal(body.locked,false);assert.equal(saved.calls.length,1);
  assert.deepEqual(saved.records,prior.records);assert.deepEqual(saved.elements,prior.elements);
  assert.deepEqual(saved.state.pending,[]);assert.equal(saved.manifest.complete,true);
  assert.equal(saved.manifest.changedRecords,0);assert.match(saved.manifest.status,/changes deferred/);
  assert.equal(saved.manifest.requestBytes,status===200?16*1024*1024:80*1024);
 } finally {clearTimeout(timer);release();await result;}
});
