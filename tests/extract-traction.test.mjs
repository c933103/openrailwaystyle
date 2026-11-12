import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildExtractPowerFacilities, facilityElements, isFacilityElement, isHint} from '../scripts/build-extract-power-facilities.mjs';
import {TRACTION_FILES, buildExtractTraction, writeTractionMarker} from '../scripts/build-extract-traction.mjs';
import {powerFacilitiesGeoJSON} from '../scripts/power-facility-data.mjs';
import {checkMarker} from '../scripts/data-source.mjs';

const report = (extra = {}) => ({schema: 1, index: '20261111T121854Z-42996345331', regions: 175, oldestTimestamp: '2026-11-03T21:24:23Z', newestTimestamp: '2026-11-11T10:58:20Z', missingNodeRefs: 0, missingRegions: [], ...extra});
const meta = {version: 2, timestamp: '2026-10-01T00:00:00Z'};
const node = (id, lat, lon, tags) => ({type: 'node', id, ...meta, lat, lon, ...(tags ? {tags} : {})});
const way = (id, coords, tags, ids) => {
  const geometry = coords.map(([lon, lat]) => ({lat, lon}));
  return {type: 'way', id, ...meta, nodes: ids || coords.map((_, i) => id * 10 + i),
    bounds: {minlat: Math.min(...geometry.map(p => p.lat)), minlon: Math.min(...geometry.map(p => p.lon)), maxlat: Math.max(...geometry.map(p => p.lat)), maxlon: Math.max(...geometry.map(p => p.lon))},
    geometry, ...(tags ? {tags} : {})};
};
// Facilities the query selects, near misses it leaves out, and a
// multipolygon relation whose ring is two untagged member ways.
const OUTER_A = way(200, [[10, 50], [10.1, 50], [10.1, 50.1]], undefined, [2001, 2002, 2003]);
const OUTER_B = way(201, [[10.1, 50.1], [10, 50.1], [10, 50]], undefined, [2003, 2004, 2001]);
const INNER = way(202, [[10.02, 50.02], [10.04, 50.02], [10.04, 50.04], [10.02, 50.04], [10.02, 50.02]], undefined, [2021, 2022, 2023, 2024, 2021]);
const ELEMENTS = [
  node(1, 47.1, 8.1, {power: 'substation', substation: 'traction', name: 'Unterwerk'}),
  node(2, 47.2, 8.2, {railway: 'fuel'}),
  node(3, 47.3, 8.3, {'railway:electricity': 'power_supply'}),
  node(4, 47.4, 8.4, {'disused:railway': 'water_crane'}),
  node(5, 47.5, 8.5, {power: ' Substation ;minor_distribution', frequency: '16.7'}),
  node(6, 47.6, 8.6, {power: 'substation', frequency: '16.70'}),
  node(7, 47.7, 8.7, {amenity: 'charging_station', train: 'yes'}),
  node(8, 47.8, 8.8, {power: 'transformer', operator: 'DB Energie'}),
  node(9, 47.9, 8.9, {man_made: 'water_tower', 'abandoned:railway': 'yes'}),
  node(10, 47.95, 8.95, {railway: 'substation;signal_box'}),
  node(11, 46.0, 7.0, {railway: 'signal', 'railway:signal:main': 'CH-FDV:hp'}),
  node(12, 46.1, 7.1, {railway: 'signal', 'railway:signal:direction': 'forward', 'railway:signal:electricity': 'CH-FDV:fl'}),
  way(100, [[9, 48], [9.01, 48], [9.01, 48.01], [9, 48.01], [9, 48]], {power: 'substation', usage: 'traction', name: 'Area'}),
  way(101, [[9.1, 48.1], [9.2, 48.2]], {power: 'plant', landuse: 'railway'}),
  OUTER_A, OUTER_B, INNER,
  {type: 'relation', id: 300, ...meta, members: [{type: 'way', ref: 200, role: 'outer'}, {type: 'way', ref: 201, role: 'outer'}, {type: 'way', ref: 202, role: 'inner'}, {type: 'node', ref: 2001, role: ''}],
    tags: {type: 'multipolygon', power: 'substation', substation: 'traction'}},
  {type: 'relation', id: 301, ...meta, members: [{type: 'way', ref: 200, role: 'outer'}], tags: {type: 'multipolygon', power: 'substation'}},
  // No ring: the feature is the centre of the relation's bounds.
  {type: 'relation', id: 302, ...meta, members: [{type: 'node', ref: 2001, role: 'label'}, {type: 'way', ref: 200, role: 'part'}], tags: {type: 'site', power: 'substation', substation: 'traction'}},
];
// Untagged nodes of the member ways, as the extract holds them.
const MEMBER_NODES = [...new Map([OUTER_A, OUTER_B, INNER].flatMap(w => w.nodes.map((id, i) => [id, node(id, w.geometry[i].lat, w.geometry[i].lon)]))).values()];
const SELECTED = ['node1', 'node2', 'node3', 'node4', 'node5', 'node9', 'node10', 'way100', 'way101', 'relation300', 'relation302'];
// The Overpass answer: the selected elements as `out body geom` gives them.
const memberShape = m => m.type === 'way' ? {...m, geometry: ELEMENTS.find(e => e.type === 'way' && e.id === m.ref).geometry}
  : {...m, lat: 50, lon: 10};
const OVERPASS = ELEMENTS.filter(e => SELECTED.includes(`${e.type}${e.id}`)).map(e => e.type !== 'relation' ? e
  : {...e, bounds: e.id === 300 ? {minlat: 50, minlon: 10, maxlat: 50.1, maxlon: 10.1} : {minlat: 50, minlon: 10, maxlat: 50.1, maxlon: 10.1}, members: e.members.map(memberShape)});

const reads = [];
const fakeRead = async (pbf, {keep, onElement, untaggedNodes = false, geometry = true}) => {
  reads.push({pbf, untaggedNodes, geometry});
  const pool = pbf.endsWith('#members') ? [...MEMBER_NODES, OUTER_A, OUTER_B, INNER] : ELEMENTS;
  const kept = pool.filter(e => (untaggedNodes || e.type !== 'node' || e.tags) && keep({type: e.type, id: e.id, tags: e.tags}));
  for (const e of kept) await onElement(structuredClone(e));
  return {read: pool.length, kept: kept.length, withoutGeometry: 0};
};
const subsets = [];
const fakeSubset = async (pbf, ids) => { subsets.push(ids); return {file: `${pbf}#members`, remove: async () => {}}; };

test('the selection is powerFacilityQuery\'s: whole semicolon values, any case, with POSIX space; hints only where the query needs them', () => {
  assert.deepEqual(ELEMENTS.filter(isFacilityElement).map(e => `${e.type}${e.id}`), SELECTED);
  assert.ok(isHint({'razed:railway': 'Narrow_Gauge'}));
  assert.ok(isHint({frequency: '16.67'}) && isHint({frequency: '16.666'}) && isHint({frequency: '50;16.7'}));
  assert.ok(!isHint({frequency: '16.6'}) && !isHint({railway: 'rails'}) && !isHint({usage: 'main'}));
  assert.ok(isFacilityElement({tags: {'proposed:power': 'converter', 'proposed:railway': 'rail'}}));
  assert.ok(!isFacilityElement({tags: {power: 'line', railway: 'rail'}}), 'not a facility value');
  assert.ok(!isFacilityElement({tags: {man_made: 'charge_point', train: 'yes'}}), 'a charger is a facility only through a railway supply value');
});

test('the same features as from the Overpass answer, with mapped shapes, from two reads', async t => {
  reads.length = 0; subsets.length = 0;
  const {elements, counts} = await facilityElements('assembled.osm.pbf', {read: fakeRead, subset: fakeSubset});
  assert.deepEqual(reads, [{pbf: 'assembled.osm.pbf', untaggedNodes: false, geometry: true}, {pbf: 'assembled.osm.pbf#members', untaggedNodes: true, geometry: true}]);
  assert.deepEqual(subsets, [['n2001', 'w200', 'w201', 'w202']], 'each member once');
  assert.equal(counts.relations, 2);
  const expected = powerFacilitiesGeoJSON({elements: OVERPASS});
  assert.deepEqual(powerFacilitiesGeoJSON({elements}), expected);
  const byId = new Map(expected.features.map(f => [f.id, f]));
  assert.equal(byId.get('relation-300').geometry.type, 'Polygon');
  assert.equal(byId.get('relation-300').geometry.coordinates.length, 2, 'outer ring and its hole');
  assert.equal(byId.get('way-100').geometry.type, 'Polygon');
  assert.deepEqual(byId.get('relation-302').geometry, {type: 'Point', coordinates: [10.05, 50.05]}, 'an open member way makes no ring: the centre of the members\' bounds');
  assert.ok(!byId.has('node-7') && !byId.has('node-8') && !byId.has('node-6'));

  const dir = await mkdtemp(join(tmpdir(), 'extract-power-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const manifest = await buildExtractPowerFacilities('assembled.osm.pbf', report(), join(dir, 'power'), {read: fakeRead, subset: fakeSubset, now: () => new Date('2026-11-12T09:00:00Z')});
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'power', 'power-facilities.geojson'), 'utf8')), expected);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(dir, 'power', 'power-facilities.geojson.gz')))), expected);
  // What the site checks of power/manifest.json, and what the Help page reads.
  assert.equal(manifest.complete, true);
  assert.equal(manifest.features, expected.features.length);
  assert.equal(manifest.oldestSource, '2026-11-03T21:24:23Z');
  assert.equal(manifest.coverage.length, 8);
  assert.equal(manifest.source, 'OpenStreetMap via the Geofabrik extracts');
});

test('no energy supply snapshot from a partial assembly; none from an empty one', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-power-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  assert.equal(await buildExtractPowerFacilities('x', report({missingRegions: ['gap/0_0_45_45']}), join(dir, 'p'), {read: () => assert.fail('nothing read')}), null);
  await assert.rejects(readdir(join(dir, 'p')), /ENOENT/);
  await assert.rejects(buildExtractPowerFacilities('x', report(), join(dir, 'e'), {read: async () => ({kept: 0, withoutGeometry: 0}), subset: fakeSubset}), /empty worldwide railway energy supply/);
});

test('source.json is complete only with every traction-data file and a complete assembly', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-traction-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  // A complete assembly, without the power methods.
  const full = await buildExtractTraction('assembled.osm.pbf', report(), join(dir, 'full'), {read: fakeRead, subset: fakeSubset});
  assert.deepEqual(full.marker.missing, ['power/methods-manifest.json', 'power/power-methods.geojson.gz']);
  assert.equal(full.marker.complete, false);
  assert.match(checkMarker(await readFile(join(dir, 'full', 'source.json'), 'utf8'), 'traction'), /not complete/);
  assert.ok(full.facilities && full.electricity && full.signals.complete);
  // With them, it is complete and the switch takes it.
  await writeFile(join(dir, 'full', 'power', 'methods-manifest.json'), '{}');
  await writeFile(join(dir, 'full', 'power', 'power-methods.geojson.gz'), '');
  const marker = await writeTractionMarker(join(dir, 'full'), report());
  assert.deepEqual(marker.missing, []);
  assert.equal(checkMarker(await readFile(join(dir, 'full', 'source.json'), 'utf8'), 'traction'), null);
  // Every file present, but a partial assembly: not complete.
  assert.equal((await writeTractionMarker(join(dir, 'full'), report({missingRegions: ['x']}))).complete, false);
  // A partial assembly: the signals only.
  const partial = await buildExtractTraction('x', report({missingRegions: ['gap/0_0_45_45']}), join(dir, 'partial'), {read: fakeRead, subset: fakeSubset});
  assert.deepEqual(partial.marker.missing, TRACTION_FILES.filter(f => f.startsWith('power/')));
  assert.equal(partial.facilities, null);
  await mkdir(join(dir, 'empty'));
  assert.deepEqual((await writeTractionMarker(join(dir, 'empty'), report())).missing, [...TRACTION_FILES]);
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium, from a real extract file: the same features, the relation\'s ring from its untagged members', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-power-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const x = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tags = t => Object.entries(t || {}).map(([k, v]) => `<tag k="${x(k)}" v="${x(v)}"/>`).join('');
  const at = `version="${meta.version}" timestamp="${meta.timestamp}"`;
  const nodes = [...ELEMENTS.filter(e => e.type === 'node'), ...MEMBER_NODES,
    ...ELEMENTS.filter(e => e.type === 'way' && e.tags).flatMap(w => w.nodes.map((id, i) => node(id, w.geometry[i].lat, w.geometry[i].lon)))];
  await writeFile(join(dir, 'in.osm'), '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">'
    + [...new Map(nodes.map(n => [n.id, n])).values()].map(n => `<node id="${n.id}" ${at} lat="${n.lat}" lon="${n.lon}">${tags(n.tags)}</node>`).join('')
    + ELEMENTS.filter(e => e.type === 'way').map(w => `<way id="${w.id}" ${at}>${w.nodes.map(n => `<nd ref="${n}"/>`).join('')}${tags(w.tags)}</way>`).join('')
    + ELEMENTS.filter(e => e.type === 'relation').map(r => `<relation id="${r.id}" ${at}>${r.members.map(m => `<member type="${m.type}" ref="${m.ref}" role="${m.role}"/>`).join('')}${tags(r.tags)}</relation>`).join('') + '</osm>');
  assert.equal(spawnSync('osmium', ['sort', join(dir, 'in.osm'), '-o', join(dir, 'in.osm.pbf')]).status, 0);
  const {elements} = await facilityElements(join(dir, 'in.osm.pbf'));
  assert.deepEqual(powerFacilitiesGeoJSON({elements}), powerFacilitiesGeoJSON({elements: OVERPASS}));
});

test('the assembly workflow builds the traction dataset after the crossings, and publishes it only to its own branch, only on main', async () => {
  const workflow = await readFile(new URL('../.github/workflows/osm-assemble.yml', import.meta.url), 'utf8');
  const build = workflow.indexOf('scripts/build-extract-traction.mjs assembled.osm.pbf assembled.osm.pbf.json traction-extract');
  assert.ok(build > workflow.indexOf('- name: Publish crossings-extract-data'));
  assert.doesNotMatch(workflow, /build-extract-signals\.mjs/, 'the signals are built as part of the traction dataset');
  assert.match(workflow, /- name: Publish traction-extract-data\n\s+if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /git push --force origin HEAD:traction-extract-data/);
  assert.doesNotMatch(workflow, /HEAD:traction-data\b/, 'the Overpass branch is never written');
});
