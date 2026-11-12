import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildExtractPowerMethods, isMethodElement, methodElements} from '../scripts/build-extract-power-methods.mjs';
import {powerMethodsGeoJSON} from '../scripts/power-method-data.mjs';
import {validatePowerMethodsSnapshot} from '../scripts/build-power-methods.mjs';

const report = (extra = {}) => ({schema: 1, index: '20261111T121854Z-42996345331', regions: 175, oldestTimestamp: '2026-11-03T21:24:23Z', newestTimestamp: '2026-11-11T10:58:20Z', missingNodeRefs: 0, missingRegions: [], ...extra});
const meta = {version: 2, timestamp: '2026-10-01T00:00:00Z'};
const node = (id, lat, lon, tags) => ({type: 'node', id, ...meta, lat, lon, ...(tags ? {tags} : {})});
const way = (id, coords, tags, ids) => {
  const geometry = coords.map(([lon, lat]) => ({lat, lon}));
  return {type: 'way', id, ...meta, nodes: ids || coords.map((_, i) => id * 10 + i),
    bounds: {minlat: Math.min(...geometry.map(p => p.lat)), minlon: Math.min(...geometry.map(p => p.lon)), maxlat: Math.max(...geometry.map(p => p.lat)), maxlon: Math.max(...geometry.map(p => p.lon))},
    geometry, ...(tags ? {tags} : {})};
};
// Conductor rails and other means on tracks, chargers with and without a
// railway hint, and a charging relation drawn from an untagged member way.
const RING = way(200, [[13.4, 52.5], [13.401, 52.5], [13.401, 52.501], [13.4, 52.501], [13.4, 52.5]], undefined, [2001, 2002, 2003, 2004, 2001]);
const ELEMENTS = [
  node(6, 51.5, -0.1, {railway: 'charging_station', name: 'Depot charger'}),
  node(7, 51.6, -0.2, {amenity: 'charging_station', train: 'yes'}),
  node(8, 51.7, -0.3, {amenity: 'charging_station', car: 'yes'}),
  node(9, 51.8, -0.4, {man_made: 'charge_point', usage: 'railway', railway: 'yes'}),
  node(11, 51.9, -0.5, {railway: 'level_crossing', electrified: 'rail'}),
  way(1, [[-0.12, 51.5], [-0.11, 51.51]], {railway: 'rail', electrified: 'rail', voltage: '750'}),
  way(2, [[2.3, 48.8], [2.31, 48.81]], {railway: 'subway', electrified: 'Rail ; 4th_rail', voltage: '600'}),
  way(3, [[8.5, 47.3], [8.51, 47.31]], {railway: 'rail', electrified: 'contact_line'}),
  way(4, [[8.6, 46.6], [8.61, 46.61]], {railway: 'rail', traction: 'rack'}),
  way(5, [[139.7, 35.6], [139.71, 35.61]], {railway: 'rail', 'disused:propulsion': 'linear_motor'}),
  way(12, [[9, 47], [9.01, 47.01]], {highway: 'primary', electrified: 'rail'}),
  RING,
  {type: 'relation', id: 300, ...meta, members: [{type: 'way', ref: 200, role: 'outer'}], tags: {type: 'multipolygon', amenity: 'charging_station', railway: 'power_supply'}},
  {type: 'relation', id: 301, ...meta, members: [{type: 'way', ref: 200, role: 'outer'}], tags: {type: 'multipolygon', amenity: 'charging_station'}},
];
const MEMBER_NODES = RING.nodes.slice(0, 4).map((id, i) => node(id, RING.geometry[i].lat, RING.geometry[i].lon));
const SELECTED = ['node6', 'node7', 'node9', 'way1', 'way2', 'way4', 'way5', 'way12', 'relation300'];
// The Overpass answer to powerMethodQuery: the selected elements as
// `out body geom` gives them.
const OVERPASS = ELEMENTS.filter(e => SELECTED.includes(`${e.type}${e.id}`)).map(e => e.type !== 'relation' ? e
  : {...e, bounds: RING.bounds, members: e.members.map(m => ({...m, geometry: RING.geometry}))});

const reads = [];
const fakeRead = async (pbf, {keep, onElement, untaggedNodes = false}) => {
  reads.push({pbf, untaggedNodes});
  const pool = pbf.endsWith('#members') ? [...MEMBER_NODES, RING] : ELEMENTS;
  const kept = pool.filter(e => (untaggedNodes || e.type !== 'node' || e.tags) && keep({type: e.type, id: e.id, tags: e.tags}));
  for (const e of kept) await onElement(structuredClone(e));
  return {read: pool.length, kept: kept.length, withoutGeometry: 0};
};
const subsets = [];
const fakeSubset = async (pbf, ids) => { subsets.push(ids); return {file: `${pbf}#members`, remove: async () => {}}; };

test('the selection is powerMethodSelection\'s: means on ways only, railway chargers, and chargers with a railway hint', () => {
  assert.deepEqual(ELEMENTS.filter(isMethodElement).map(e => `${e.type}${e.id}`), SELECTED);
  for (const prefix of ['', 'construction:', 'removed:']) assert.ok(isMethodElement({type: 'way', tags: {[`${prefix}traction`]: 'Cable'}}), prefix);
  assert.ok(isMethodElement({type: 'way', tags: {electrified: 'contact_line;\t4th_rail'}}), 'POSIX space before a value');
  assert.ok(isMethodElement({type: 'relation', tags: {'proposed:railway': 'charging_station'}}));
  assert.ok(isMethodElement({type: 'node', tags: {'disused:amenity': 'charging_station', 'abandoned:railway': 'funicular'}}));
  assert.ok(isMethodElement({type: 'node', tags: {amenity: 'charging_station', landuse: 'railway'}}));
  assert.ok(!isMethodElement({type: 'node', tags: {amenity: 'charging_station', train: 'no'}}));
  assert.ok(!isMethodElement({type: 'node', tags: {amenity: 'charging_station', railway: 'station'}}), 'not a track or supply value');
  assert.ok(!isMethodElement({type: 'way', tags: {electrified: 'rails'}}) && !isMethodElement({type: 'way', tags: {traction: 'rack_and_pinion'}}));
});

test('the same features as from the Overpass answer, and a snapshot the site accepts', async t => {
  reads.length = 0; subsets.length = 0;
  const {elements, counts} = await methodElements('assembled.osm.pbf', {read: fakeRead, subset: fakeSubset});
  assert.deepEqual(reads, [{pbf: 'assembled.osm.pbf', untaggedNodes: false}, {pbf: 'assembled.osm.pbf#members', untaggedNodes: true}]);
  assert.deepEqual(subsets, [['w200']]);
  assert.equal(counts.relations, 1);
  const expected = powerMethodsGeoJSON({elements: OVERPASS});
  assert.deepEqual(powerMethodsGeoJSON({elements}), expected);
  const ids = expected.features.map(f => f.id);
  assert.ok(ids.includes('way-1') && ids.includes('way-2') && ids.includes('way-4') && ids.includes('relation-300'));
  assert.ok(!ids.includes('way-12'), 'selected, but no track: the conversion leaves it out, as from Overpass');

  const dir = await mkdtemp(join(tmpdir(), 'extract-methods-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const manifest = await buildExtractPowerMethods('assembled.osm.pbf', report(), join(dir, 'power'), {read: fakeRead, subset: fakeSubset, now: () => new Date('2026-11-12T11:00:00Z')});
  const data = JSON.parse(await readFile(join(dir, 'power', 'power-methods.geojson'), 'utf8'));
  assert.deepEqual(data, expected);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(dir, 'power', 'power-methods.geojson.gz')))), expected);
  const written = JSON.parse(await readFile(join(dir, 'power', 'methods-manifest.json'), 'utf8'));
  assert.deepEqual(validatePowerMethodsSnapshot(data, written), written, 'what the site checks');
  assert.deepEqual({complete: manifest.complete, features: manifest.features, coverage: manifest.coverage.length, source: manifest.source},
    {complete: true, features: expected.features.length, coverage: 32, source: 'OpenStreetMap via the Geofabrik extracts'});
});

test('nothing from a partial assembly; an empty result is refused', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-methods-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  assert.equal(await buildExtractPowerMethods('x', report({missingRegions: ['gap/0_0_45_45']}), join(dir, 'p'), {read: () => assert.fail('nothing read')}), null);
  await assert.rejects(readdir(join(dir, 'p')), /ENOENT/);
  await assert.rejects(buildExtractPowerMethods('x', report(), join(dir, 'e'), {read: async () => ({kept: 0, withoutGeometry: 0}), subset: fakeSubset}), /empty worldwide conductor-rail/);
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium, from a real extract file: the same features', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-methods-'));
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
  const {elements} = await methodElements(join(dir, 'in.osm.pbf'));
  assert.deepEqual(powerMethodsGeoJSON({elements}), powerMethodsGeoJSON({elements: OVERPASS}));
});
