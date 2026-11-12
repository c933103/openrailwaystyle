import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildExtractSignals, isSignalElement} from '../scripts/build-extract-signals.mjs';
import {signalFeatures, signalFiles} from '../scripts/signals-data.mjs';
import {electricitySignalsGeoJSON} from '../scripts/electricity-signal-data.mjs';
import {validateElectricitySignalsSnapshot} from '../scripts/build-electricity-signals.mjs';

const report = (extra = {}) => ({schema: 1, index: '20261111T121854Z-42996345331', regions: 175, oldestTimestamp: '2026-11-03T21:24:23Z', newestTimestamp: '2026-11-11T10:58:20Z', missingNodeRefs: 0, missingRegions: [], ...extra});
const meta = {version: 3, timestamp: '2026-10-01T00:00:00Z'};
const node = (id, lat, lon, tags) => ({type: 'node', id, ...meta, lat, lon, ...(tags ? {tags} : {})});
// Signals without and with a direction, electrification signals, and what
// combinedSignalQuery leaves out.
const ELEMENTS = [
  node(1, 52.52, 13.40, {railway: 'signal', 'railway:signal:main': 'DE-ESO:hp', ref: 'A', name: 'Einfahrt'}),
  node(2, 52.53, 13.41, {railway: 'signal', 'railway:signal:direction': 'forward', 'railway:signal:main': 'DE-ESO:hp'}),
  node(3, 48.85, 2.35, {railway: 'signal', 'railway:signal:direction': 'backward', 'railway:signal:electricity': 'FR:CC_EXE', 'railway:signal:electricity:type': 'power_off'}),
  node(4, 48.86, 2.36, {railway: 'signal', 'railway:signal:electricity': 'AT:Fahrleitung', 'railway:signal:electricity:deactivated': 'yes'}),
  node(5, 48.87, 2.37, {railway: 'signal', 'railway:signal:direction': 'forward', 'railway:signal:electricity': 'no'}),
  node(6, 35.0, 139.0, {railway: 'signal', 'railway:signal:direction': 'forward', 'railway:signal:electricity': ''}),
  node(7, 45, 0, {railway: 'signal', 'railway:signal:speed_limit': 'DE-ESO:zs3', 'railway:signal:speed_limit:deactivated': 'yes'}),
  node(8, 35.1, 139.1, {railway: 'level_crossing'}),
  node(9, 64.0, 180, {railway: 'signal', 'railway:signal:direction': 'both', 'railway:signal:electricity': 'SE:x'}),
  node(10, 35.2, 139.2),
  {type: 'way', id: 100, ...meta, nodes: [1, 2], tags: {railway: 'signal'}},
];
// What Overpass answers to combinedSignalQuery for these elements, as
// out body gives it: id, lat, lon, tags; each node once, whatever boxes it
// is on the edge of (the builder merges by id).
const OVERPASS = ELEMENTS.filter(e => e.type === 'node' && [1, 3, 4, 6, 7, 9].includes(e.id)).map(({type, id, lat, lon, tags}) => ({type, id, lat, lon, tags}));
const reads = [];
const fakeRead = async (pbf, {keep, onElement}) => {
  reads.push(pbf);
  const kept = ELEMENTS.filter(e => (e.type !== 'node' || e.tags) && keep({type: e.type, id: e.id, tags: e.tags}));
  for (const e of kept) await onElement(structuredClone(e));
  return {read: ELEMENTS.length, kept: kept.length, withoutGeometry: 0};
};
const files = async dir => {
  const out = [];
  const walk = async d => { for (const e of await readdir(d, {withFileTypes: true})) e.isDirectory() ? await walk(join(d, e.name)) : out.push(relative(dir, join(d, e.name))); };
  await walk(dir);
  return out.sort();
};

test('the selection is combinedSignalQuery\'s', () => {
  assert.deepEqual(ELEMENTS.filter(isSignalElement).map(e => e.id), [1, 3, 4, 6, 7, 9]);
  assert.ok(!isSignalElement({type: 'node', tags: {railway: 'signal', 'railway:signal:direction': '', 'railway:signal:electricity': 'no'}}), 'an empty direction is a direction');
  assert.ok(isSignalElement({type: 'node', tags: {railway: 'signal', 'railway:signal:direction': 'forward', 'railway:signal:electricity': 'No'}}), 'the value test is case-sensitive, as in Overpass');
});

test('the same features and files as from Overpass, and a valid electricity snapshot', async t => {
  reads.length = 0;
  const dir = await mkdtemp(join(tmpdir(), 'extract-signals-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const out = join(dir, 'out');
  const {signals, electricity} = await buildExtractSignals('assembled.osm.pbf', report(), out, {read: fakeRead, now: () => new Date('2026-11-12T05:00:00Z')});
  assert.deepEqual(reads, ['assembled.osm.pbf'], 'one read');
  // The signal supplement, as build-signals.mjs makes it from the answer.
  const features = signalFeatures({elements: OVERPASS}).sort((a, b) => a.id - b.id);
  assert.deepEqual(features.map(f => f.id), [1, 4, 7]);
  const expected = signalFiles(features).files;
  assert.deepEqual(await files(join(out, 'signals')), [...expected.keys(), 'manifest.json'].sort());
  for (const [path, bytes] of expected) assert.deepEqual(await readFile(join(out, 'signals', path)), Buffer.from(bytes), path);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(out, 'signals', 'railway-signals.geojson.gz')))).features, features);
  assert.deepEqual({complete: signals.complete, signals: signals.signals, oldestSource: signals.oldestSource, license: signals.license}, {complete: true, signals: 3, oldestSource: '2026-11-03T21:24:23Z', license: 'ODbL-1.0'});
  // The electricity signals, as the Overpass build publishes them.
  const data = JSON.parse(await readFile(join(out, 'power', 'electricity-signals.geojson'), 'utf8'));
  assert.deepEqual(data, electricitySignalsGeoJSON({elements: OVERPASS}));
  assert.deepEqual(data.features.map(f => f.id), ['node-3', 'node-4', 'node-9']);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(out, 'power', 'electricity-signals.geojson.gz')))), data);
  const manifest = JSON.parse(await readFile(join(out, 'power', 'electricity-signals-manifest.json'), 'utf8'));
  assert.deepEqual(validateElectricitySignalsSnapshot(data, manifest), manifest, 'what the site checks');
  assert.equal(manifest.source, 'OpenStreetMap via the Geofabrik extracts');
  assert.equal(manifest.coverage.length, 32);
  assert.equal(manifest.coverage.find(c => c.bbox.join() === '45,135,90,180').features, 1, 'a signal at 180° E is in the box it borders');
  assert.equal(electricity.features, 3);
  assert.deepEqual(await readdir(out), ['power', 'signals'], 'source.json is the traction build\'s');
});

test('a partial assembly is not complete; an incomplete one is refused; no signal at all is refused', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-signals-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const {signals, electricity} = await buildExtractSignals('x', report({missingRegions: ['gap/0_0_45_45']}), join(dir, 'partial'), {read: fakeRead});
  assert.equal(signals.complete, false);
  // The electricity writer certifies a whole world: nothing is published from a partial assembly.
  assert.equal(electricity, null);
  assert.deepEqual(await readdir(join(dir, 'partial')), ['signals']);
  await assert.rejects(buildExtractSignals('x', report({missingNodeRefs: 1}), join(dir, 'never'), {read: () => assert.fail('nothing read')}), /missing 1/);
  await assert.rejects(buildExtractSignals('x', report(), join(dir, 'empty'), {read: async () => ({kept: 0})}), /Empty worldwide railway signal supplement/);
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium, from a real extract file: the same features', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-signals-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const x = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tags = t => Object.entries(t || {}).map(([k, v]) => `<tag k="${x(k)}" v="${x(v)}"/>`).join('');
  const at = `version="${meta.version}" timestamp="${meta.timestamp}"`;
  await writeFile(join(dir, 'in.osm'), '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">'
    + ELEMENTS.filter(e => e.type === 'node').map(n => `<node id="${n.id}" ${at} lat="${n.lat}" lon="${n.lon}">${tags(n.tags)}</node>`).join('')
    + '<way id="100" ' + at + '><nd ref="1"/><nd ref="2"/><tag k="railway" v="signal"/></way></osm>');
  assert.equal(spawnSync('osmium', ['sort', join(dir, 'in.osm'), '-o', join(dir, 'in.osm.pbf')]).status, 0);
  await buildExtractSignals(join(dir, 'in.osm.pbf'), report(), join(dir, 'out'));
  const features = signalFeatures({elements: OVERPASS}).sort((a, b) => a.id - b.id);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(dir, 'out', 'signals', 'railway-signals.geojson.gz')))).features, features);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'out', 'power', 'electricity-signals.geojson'), 'utf8')), electricitySignalsGeoJSON({elements: OVERPASS}));
});
