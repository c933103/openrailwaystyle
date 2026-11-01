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
function complete(elements, started = '2026-10-20T00:00:00.000Z') {
  const first = acquisition.newStationAcquisition();
  let {state, records} = acquisition.applyStationRegion(first, [], first.pending[0].box, {elements});
  state = {...state, pending: [], completed: [...state.completed, ...first.pending.slice(1).map(({box}) => ({box, count: 0}))], started};
  return {state, records};
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

test('changes remove, replace and add stations by OSM identity and version, as a full download would', () => {
  const {state, records} = complete(base);
  const changes = acquisition.parseStationChanges(osm([
    // Deleted; retagged so it is no longer a station; moved; a new station way with its centre.
    '<action type="delete"><old/><new><node id="100" visible="false"/></new></action>',
    `<action type="modify"><old/><new>${xmlNode(node(101, -169.9, -80, 2, {railway: 'platform'}))}</new></action>`,
    `<action type="modify"><old/><new>${xmlNode(node(102, -169.5, -80.5, 2))}</new></action>`,
    '<action type="create"><way id="7" version="1" timestamp="2026-10-31T00:00:00Z"><center lat="35.68" lon="139.76"/><nd ref="1"/><nd ref="2"/><tag k="railway" v="station"/><tag k="name" v="Way station"/></way></action>',
  ].join('\n')));
  const result = acquisition.applyStationChanges(state, records, changes, {now: '2026-11-01T06:00:00.000Z'});
  assert.equal(result.changed, 4);
  assert.equal(result.state.changesSince, '2026-11-01T05:00:00Z', 'the next update starts from the new database time');
  const ids = result.records.map(r => r.id);
  assert.ok(!ids.includes('node-100') && !ids.includes('node-101'));
  assert.deepEqual([result.records.find(r => r.id === 'node-102').lat, result.records.find(r => r.id === 'node-102').osm_version], [-80.5, 2]);
  assert.deepEqual(result.records.find(r => r.id === 'way-7'), overview.stationPoint({type: 'way', id: 7, version: 1, timestamp: '2026-10-31T00:00:00Z',
    center: {lat: 35.68, lon: 139.76}, tags: {railway: 'station', name: 'Way station'}}));
  // An older version than the record is ignored; a version-less one refused.
  const older = acquisition.applyStationChanges(result.state, result.records,
    {timestamp: '2026-11-01T06:00:00Z', upserts: [node(102, 0, 0, 1)], deletes: []});
  assert.equal(older.changed, 0);
  assert.throws(() => acquisition.applyStationChanges(state, records, {timestamp: '2026-11-01T06:00:00Z',
    upserts: [{...node(5, 0, 0), version: undefined}], deletes: []}), /lacks version/);
  // Losing over 5% of the stations is not trusted.
  assert.throws(() => acquisition.applyStationChanges(state, records, {timestamp: '2026-11-01T06:00:00Z', upserts: [],
    deletes: base.slice(0, 5).map(n => `node/${n.id}`)}), /drop the stations/);
});

// The real entrypoint, as in station-builder.test.mjs; only fetch, the
// filesystem root and timers are controlled.
const source = readFileSync(new URL('../scripts/build-station-snapshot.mjs', import.meta.url), 'utf8');
async function run(t, reply, {state, records}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'station-changes-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await fs.mkdir(join(root, 'previous'));
  await fs.writeFile(join(root, 'previous/state.json'), JSON.stringify(state));
  await fs.writeFile(join(root, 'previous/stations.json.gz'), zlib.gzipSync(JSON.stringify(records)));
  const calls = [], timers = new Set();
  const io = Object.fromEntries(['mkdir', 'readFile', 'writeFile', 'rm'].map(name => [name, (path, ...args) => fs[name](join(root, path), ...args)]));
  const context = vm.createContext({
    process: {env: {PREVIOUS_DATA: 'previous', OVERPASS_URL: 'https://overpass.fixture.invalid/api/interpreter'}},
    URL, URLSearchParams, Buffer, AbortController, Date,
    setTimeout: () => { const id = {}; timers.add(id); return id; }, clearTimeout: id => timers.delete(id),
    console: {log() {}, warn() {}},
    fetch: async (url, options) => { calls.push(options.body.get('data')); assert.equal(options.redirect, 'error'); return reply(); },
  });
  const dependencies = {'node:fs/promises': io, 'node:path': {join}, 'node:zlib': zlib, './station-acquisition.mjs': acquisition, './station-overview.mjs': overview};
  const module = new vm.SourceTextModule(source, {context});
  await module.link(specifier => {
    const values = dependencies[specifier]; assert.ok(values, `unexpected import ${specifier}`);
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, {context});
  });
  await module.evaluate();
  assert.equal(timers.size, 0);
  const read = async path => JSON.parse(await fs.readFile(join(root, 'station-snapshot', path), 'utf8'));
  return {calls, state: await read('state.json'), manifest: await read('manifest.json'),
    records: JSON.parse(zlib.gunzipSync(await fs.readFile(join(root, 'station-snapshot/stations.json.gz'))))};
}

test('the builder updates a complete generation with one change request, and keeps it on failure', async t => {
  // Started recently, so changes apply (the builder reads the wall clock).
  const recent = new Date(Date.now() - 86400000).toISOString();
  const {state, records} = complete(base, recent);
  const since = recent.replace(/\.\d+Z$/, 'Z');
  const ok = await run(t, () => new Response(osm('<action type="delete"><old/><new><node id="100" visible="false"/></new></action>'), {status: 200}), {state, records});
  assert.deepEqual(ok.calls, [acquisition.stationChangesQuery(since)], 'one worldwide change request, no region download');
  assert.equal(ok.records.length, records.length - 1);
  assert.equal(ok.manifest.complete, true);
  assert.equal(ok.manifest.changedRecords, 1);
  assert.equal(ok.state.changesSince, '2026-11-01T05:00:00Z');
  assert.ok(ok.manifest.bundles > 0, 'the complete generation is built for publication');
  // A failed request keeps the generation as it was; no new cycle starts.
  const failed = await run(t, () => new Response('busy', {status: 503}), {state, records});
  assert.equal(failed.calls.length, 1);
  assert.deepEqual(failed.records, records);
  assert.equal(failed.state.pending.length, 0, 'still complete, not rotated into a new cycle');
  assert.equal(failed.manifest.changedRecords, 0);
  assert.match(failed.manifest.status, /changes deferred/);
});

test('the workflow publishes what the builder decided, and only a complete generation', () => {
  const workflow = readFileSync(new URL('../.github/workflows/station-points.yml', import.meta.url), 'utf8');
  assert.match(workflow, /const publish=manifest\.publish===true;\n\s+assert\.ok\(!publish\|\|complete/);
  assert.equal(workflow.match(/if: steps\.verify\.outputs\.publish == 'true'/g).length, 2, 'publication and redeploy');
  assert.doesNotMatch(workflow, /if: steps\.verify\.outputs\.complete == 'true'/);
});

test('a generation made by another record conversion or query starts a cycle; one predating versions counts as current', () => {
  const {state} = complete(base);
  const current = acquisition.stationExtraction();
  assert.equal(acquisition.stationChangesSince({...state, extraction: current}, current), '2026-10-20T00:00:00Z');
  assert.equal(acquisition.stationChangesSince({...state, extraction: 'another'}, current), null);
  assert.equal(acquisition.stationChangesSince(state, current), '2026-10-20T00:00:00Z', 'no version: made by this conversion');
  });

test('the first changes after a cycle drop stations created and gone again while its regions were read', () => {
  const ghost = node(500, -169, -80.2, 1);
  ghost.timestamp = '2026-10-22T00:00:00Z';
  const kept = node(501, -169, -80.3, 3); kept.timestamp = '2026-10-23T00:00:00Z';
  const {state, records} = complete([...base, ghost, kept]);
  // The changes since the cycle start mention 501 (changed again), not 500.
  const changes = {timestamp: '2026-11-01T05:00:00Z', deletes: [], upserts: [{...node(501, -169, -80.3, 4), timestamp: '2026-10-30T00:00:00Z'}]};
  const first = acquisition.applyStationChanges(state, records, changes);
  const ids = first.records.map(r => r.id);
  assert.ok(!ids.includes('node-500'), 'matched the query at neither end: gone');
  assert.ok(ids.includes('node-501'));
  assert.ok(ids.includes('node-100'), 'edited before the cycle start: kept');
  assert.equal(first.changed, 2);
  // Later changes start from a database time: nothing is dropped that way.
  const later = acquisition.applyStationChanges(first.state, first.records, {timestamp: '2026-11-02T00:00:00Z', upserts: [], deletes: []});
  assert.equal(later.records.length, first.records.length);
  assert.equal(later.changed, 0);
});

test('a complete generation is published when its tiles differ from the last published ones', async t => {
  const recent = new Date(Date.now() - 86400000).toISOString();
  const {state, records} = complete(base, recent);
  const none = () => new Response(osm(''), {status: 200});
  const first = await run(t, none, {state, records});
  assert.equal(first.manifest.changedRecords, 0);
  assert.equal(first.manifest.publish, true, 'never published from this state: published');
  assert.equal(first.state.publishedTiles, first.manifest.tilesDigest);
  const again = await run(t, none, {state: first.state, records: first.records});
  assert.equal(again.manifest.publish, false, 'nothing changed: not published again');
  const changed = await run(t, none, {state: {...first.state, publishedTiles: 'tiles of other code'}, records: first.records});
  assert.equal(changed.manifest.publish, true, 'new tile code: published');
  assert.equal(acquisition.stationTilesDigest(new Map([['b', Buffer.from('2')], ['a', Buffer.from('1')]])),
    acquisition.stationTilesDigest(new Map([['a', Buffer.from('1')], ['b', Buffer.from('2')]])), 'order does not matter');
});
