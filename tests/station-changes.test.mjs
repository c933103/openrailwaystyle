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

test('a complete generation updated within 28 days takes changes; otherwise a full cycle is due', () => {
  const {state} = complete(base);
  assert.equal(acquisition.stationChangesSince(state, NOW), '2026-10-20T00:00:00Z', 'from its cycle start, at first');
  assert.equal(acquisition.stationChangesSince({...state, changesSince: '2026-10-31T00:00:00Z'}, NOW), '2026-10-31T00:00:00Z');
  assert.equal(acquisition.stationChangesSince({...state, changesSince: '2026-09-01T00:00:00Z'}, NOW), null, 'too long without an update');
  assert.equal(acquisition.stationChangesSince({...state, pending: [{box: [-90, -180, -45, -135], depth: 0}]}, NOW), null, 'incomplete');
  assert.equal(acquisition.stationChangesSince(acquisition.newStationAcquisition(), NOW), null);
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

test('the workflow publishes a complete generation only when it was completed or changed', () => {
  const workflow = readFileSync(new URL('../.github/workflows/station-points.yml', import.meta.url), 'utf8');
  assert.match(workflow, /const publish=complete&&\(manifest\.regionUpdated===true\|\|manifest\.changedRecords>0\);/);
  assert.equal(workflow.match(/if: steps\.verify\.outputs\.publish == 'true'/g).length, 2, 'publication and redeploy');
  assert.doesNotMatch(workflow, /if: steps\.verify\.outputs\.complete == 'true'/);
});
