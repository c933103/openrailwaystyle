import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildExtractStationPoints, isStationElement, osmiumSubset, stationElements} from '../scripts/build-extract-station-points.mjs';
import {overpassCentre} from '../scripts/osm-centre.mjs';
import {stationElement, stationRecords} from '../scripts/station-acquisition.mjs';
import {stationOverviewData} from '../scripts/station-overview.mjs';
import {checkMarker} from '../scripts/data-source.mjs';

const report = (extra = {}) => ({schema: 1, index: '20261110T023604Z-42630187750', regions: 163, oldestTimestamp: '2026-11-03T21:24:23Z', newestTimestamp: '2026-11-09T15:06:50Z', missingNodeRefs: 0, missingRegions: [], ...extra});
const meta = {version: 4, timestamp: '2026-10-01T00:00:00Z'};
const node = (id, lat, lon, tags) => ({type: 'node', id, ...meta, lat, lon, ...(tags ? {tags} : {})});
const way = (id, coords, tags) => ({type: 'way', id, ...meta, nodes: coords.map((_, i) => id * 10 + i), geometry: coords.map(([lon, lat]) => ({lat, lon})), ...(tags ? {tags} : {})});
// A station node, a station way, a public-transport station relation of a
// platform way and a stop node, a former station, and what is not a station.
const ELEMENTS = [
  node(1, 35.6812362, 139.7671248, {railway: 'station', name: 'Tokyo'}),
  node(2, 35.69, 139.70, {public_transport: 'stop_position', train: 'yes'}),
  node(3, 35.70, 139.71, {railway: 'station', disused: 'yes', name: 'Gone'}),
  node(4, 35.6585, 139.7013),
  node(5, 35.70, 139.72, {railway: 'signal'}),
  way(10, [[139.7000001, 35.6000001], [139.7000004, 35.6000004], [139.7000002, 35.6000010]], {railway: 'halt', name: 'Halt'}),
  way(11, [[139.80, 35.65], [139.81, 35.66]], {railway: 'platform'}),
  {type: 'relation', id: 100, ...meta, members: [{type: 'way', ref: 11, role: 'platform'}, {type: 'node', ref: 4, role: 'stop'}, {type: 'relation', ref: 999, role: ''}],
    tags: {public_transport: 'station', train: 'yes', name: 'Area'}},
  {type: 'relation', id: 101, ...meta, members: [{type: 'relation', ref: 100, role: ''}], tags: {railway: 'station', name: 'Only relations'}},
];
const keepOf = (elements, keep) => elements.filter(e => keep({type: e.type, id: e.id, tags: e.tags}));
const reads = [];
// The reader as readElements is; untagged nodes only with untaggedNodes.
const fakeRead = async (pbf, {keep, onElement, untaggedNodes = false}) => {
  reads.push({pbf, untaggedNodes});
  const kept = keepOf(ELEMENTS.filter(e => untaggedNodes || e.type !== 'node' || e.tags), keep);
  for (const e of kept) await onElement(structuredClone(e));
  return {read: ELEMENTS.length, kept: kept.length, withoutGeometry: 0};
};
const subsets = [];
const fakeSubset = async (pbf, ids) => { subsets.push(ids); return {file: `${pbf}#members`, remove: async () => {}}; };

test('the centre is Overpass\'s: the middle of the bounding box, latitudes held offset by 91 and printed to 7 decimals', () => {
  // Real station ways whose Overpass centre ends in a half unit (2026-10).
  assert.deepEqual(overpassCentre([{lat: 30.4327493, lon: 114.2562614}, {lat: 30.4342663, lon: 114.2565896}]), {lat: 30.4335078, lon: 114.2564255});
  // Where averaging the plain latitudes would print one unit off: Overpass's
  // centres of ways 4814134 (Grenoble), 14912317 and 16945503 (2026-10).
  assert.deepEqual(overpassCentre([{lat: 45.1893378, lon: 5.7129231}, {lat: 45.1934807, lon: 5.7152679}]), {lat: 45.1914093, lon: 5.7140955});
  assert.deepEqual(overpassCentre([{lat: 31.2236456, lon: 121.5274232}, {lat: 31.2237763, lon: 121.5276404}]), {lat: 31.2237109, lon: 121.5275318});
  assert.deepEqual(overpassCentre([{lat: -23.5432834, lon: -46.5907627}, {lat: -23.5425549, lon: -46.5888865}]), {lat: -23.5429192, lon: -46.5898246});
  assert.deepEqual(overpassCentre([{lat: 1, lon: 2}]), {lat: 1, lon: 2});
  assert.deepEqual(overpassCentre([{lat: -10, lon: -20}, {lat: 10, lon: 20}, {lat: 0, lon: 0}]), {lat: 0, lon: 0});
  assert.equal(overpassCentre([]), null);
  // As Overpass prints it: (35.6000001 + 35.6000010) / 2 in its own form.
  const lat = ((356000001 + 910000000) / 1e7 - 91 + (356000010 + 910000000) / 1e7 - 91) / 2;
  assert.equal(overpassCentre(ELEMENTS[5].geometry).lat, Number(lat.toFixed(7)));
});

test('the selection is the Overpass query\'s', () => {
  assert.deepEqual(ELEMENTS.filter(isStationElement).map(e => `${e.type}${e.id}`), ['node1', 'node3', 'way10', 'relation100', 'relation101']);
  assert.ok(isStationElement({tags: {railway: 'tram_stop'}}));
  for (const mode of ['train', 'subway', 'light_rail', 'tram', 'monorail', 'funicular']) assert.ok(isStationElement({tags: {public_transport: 'station', [mode]: 'yes'}}), mode);
  assert.ok(!isStationElement({tags: {public_transport: 'station', bus: 'yes'}}));
  assert.ok(!isStationElement({tags: {railway: 'stationery'}}));
});

test('stations, with centres for ways and relations as Overpass gives them, and the same records and tiles', async t => {
  reads.length = 0; subsets.length = 0;
  const {elements, counts} = await stationElements('assembled.osm.pbf', {read: fakeRead, subset: fakeSubset});
  assert.deepEqual(reads, [{pbf: 'assembled.osm.pbf', untaggedNodes: false}, {pbf: 'assembled.osm.pbf#members', untaggedNodes: true}]);
  assert.deepEqual(subsets, [['n4', 'w11']], 'only the relations\' node and way members are cut out');
  // The Overpass path: the same elements with `out center`, kept as a cycle keeps them.
  const centre = {10: overpassCentre(ELEMENTS[5].geometry), 100: overpassCentre([{lat: 35.6585, lon: 139.7013}, ...ELEMENTS[6].geometry])};
  const overpass = ELEMENTS.filter(isStationElement).filter(e => e.id !== 101).map(e => stationElement(e.type === 'node' ? e : {...e, center: centre[e.id]}));
  assert.deepEqual(elements.map(e => `${e.type}${e.id}`).sort(), overpass.map(e => `${e.type}${e.id}`).sort());
  assert.deepEqual(stationRecords(elements), stationRecords(overpass));
  assert.deepEqual(centre[100], {lat: 35.655, lon: 139.75565}, 'the relation\'s box is its node and way members\'; its member relation has no effect');
  assert.deepEqual(counts.relationsWithoutCentre, [101], 'only relation members: no centre, as in Overpass');
  assert.equal(stationRecords(elements).length, 3, 'the former station is no record');
  const dir = await mkdtemp(join(tmpdir(), 'extract-station-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const manifest = await buildExtractStationPoints('assembled.osm.pbf', report(), join(dir, 'out'), {read: fakeRead, subset: fakeSubset, now: () => new Date('2026-11-10T05:00:00Z')});
  const tiles = stationOverviewData(stationRecords(overpass));
  for (const [path, bytes] of tiles.archives) assert.deepEqual(await readFile(join(dir, 'out', path)), bytes, path);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'out', 'index.json'), 'utf8')), tiles.index);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(dir, 'out', 'stations.json.gz')))), stationRecords(overpass));
  // What the site checks of a station snapshot (site.yml).
  assert.deepEqual({complete: manifest.complete, schema: manifest.schema, license: manifest.license, pendingRegions: manifest.pendingRegions, polar: manifest.polar, minzoom: manifest.minzoom, maxzoom: manifest.maxzoom},
    {complete: true, schema: 1, license: 'ODbL-1.0', pendingRegions: 0, polar: 0, minzoom: 3, maxzoom: 7});
  assert.ok(manifest.completedRegions >= 32 && manifest.stations === 3 && manifest.bundles === tiles.index.bundles.length);
  assert.equal(checkMarker(await readFile(join(dir, 'out', 'source.json'), 'utf8'), 'station-points'), null);
  assert.ok(!(await readdir(join(dir, 'out'))).includes('state.json'));
});

test('without station relations the extract is read once; a partial assembly is not complete; an incomplete one is refused', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-station-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  reads.length = 0;
  await stationElements('x', {read: (pbf, options) => fakeRead(pbf, {...options, keep: e => e.type !== 'relation' && options.keep(e)}), subset: () => assert.fail('nothing to cut out')});
  assert.equal(reads.length, 1);
  const manifest = await buildExtractStationPoints('x', report({missingRegions: ['gap/0_0_45_45']}), join(dir, 'partial'), {read: fakeRead, subset: fakeSubset});
  assert.equal(manifest.complete, false);
  assert.equal(manifest.pendingRegions, 1);
  assert.match(checkMarker(await readFile(join(dir, 'partial', 'source.json'), 'utf8'), 'station-points'), /not complete/);
  await assert.rejects(buildExtractStationPoints('x', report({missingNodeRefs: 1}), join(dir, 'never'), {read: () => assert.fail('nothing read')}), /missing 1/);
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium, from a real extract file, the members cut out and read with their untagged nodes', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-station-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const x = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tags = t => Object.entries(t || {}).map(([k, v]) => `<tag k="${x(k)}" v="${x(v)}"/>`).join('');
  const nodes = ELEMENTS.filter(e => e.type === 'node'), ways = ELEMENTS.filter(e => e.type === 'way'), relations = ELEMENTS.filter(e => e.type === 'relation');
  const at = `version="${meta.version}" timestamp="${meta.timestamp}"`;
  await writeFile(join(dir, 'in.osm'), '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">'
    + nodes.map(n => `<node id="${n.id}" ${at} lat="${n.lat}" lon="${n.lon}">${tags(n.tags)}</node>`).join('')
    + ways.map(w => w.geometry.map((p, i) => `<node id="${w.nodes[i]}" ${at} lat="${p.lat}" lon="${p.lon}"/>`).join('')).join('')
    + ways.map(w => `<way id="${w.id}" ${at}>${w.nodes.map(n => `<nd ref="${n}"/>`).join('')}${tags(w.tags)}</way>`).join('')
    + relations.map(r => `<relation id="${r.id}" ${at}>${r.members.map(m => `<member type="${m.type}" ref="${m.ref}" role="${m.role}"/>`).join('')}${tags(r.tags)}</relation>`).join('') + '</osm>');
  assert.equal(spawnSync('osmium', ['sort', join(dir, 'in.osm'), '-o', join(dir, 'in.osm.pbf')]).status, 0);
  const cutFiles = [];
  const real = await stationElements(join(dir, 'in.osm.pbf'), {subset: async (pbf, ids) => { const cut = await osmiumSubset(pbf, ids); cutFiles.push(cut.file); return cut; }});
  assert.equal(cutFiles.length, 1);
  assert.notEqual(spawnSync('osmium', ['fileinfo', cutFiles[0]]).status, 0, 'the cut-out file is removed after its read');
  const fake = await stationElements('x', {read: fakeRead, subset: fakeSubset});
  assert.deepEqual(stationRecords(real.elements), stationRecords(fake.elements));
  assert.deepEqual(real.counts.relationsWithoutCentre, [101]);
  // The cut-out file holds the members and their ways' nodes, and is removed.
  const cut = await osmiumSubset(join(dir, 'in.osm.pbf'), ['n4', 'w11', 'w404']);
  const opl = spawnSync('osmium', ['cat', cut.file, '-f', 'opl'], {encoding: 'utf8'}).stdout;
  assert.deepEqual(opl.trim().split('\n').map(line => line.split(' ')[0]), ['n4', 'n110', 'n111', 'w11']);
  await cut.remove();
  assert.equal(spawnSync('osmium', ['fileinfo', cut.file]).status !== 0, true);
});

test('the assembly workflow builds station points after the services, and publishes them only to their own branch, only on main', async () => {
  const workflow = await readFile(new URL('../.github/workflows/osm-assemble.yml', import.meta.url), 'utf8');
  const build = workflow.indexOf('scripts/build-extract-station-points.mjs assembled.osm.pbf assembled.osm.pbf.json station-points-extract');
  assert.ok(build > workflow.indexOf('- name: Publish service-routes-extract-data'));
  assert.match(workflow, /- name: Publish station-points-extract-data\n\s+if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /git push --force origin HEAD:station-points-extract-data/);
  assert.doesNotMatch(workflow, /HEAD:station-points-(data|work)\b/, 'the Overpass branches are never written');
});
