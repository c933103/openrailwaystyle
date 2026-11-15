import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildExtractConveying, conveyingElements, isAerialwayWay, isConveyingWay} from '../scripts/build-extract-conveying.mjs';
import {writeLineSnapshot} from '../scripts/conveying-files.mjs';
import {aerialwaysGeoJSON, conveyingGeoJSON} from '../scripts/conveying-data.mjs';
import {validateAerialwaySnapshot} from '../scripts/validate-aerialway-snapshot.mjs';
import {checkMarker} from '../scripts/data-source.mjs';

const report = (extra = {}) => ({schema: 1, index: '20261111T121854Z-42996345331', regions: 175, oldestTimestamp: '2026-11-03T21:24:23Z', newestTimestamp: '2026-11-11T10:58:20Z', missingNodeRefs: 0, missingRegions: [], ...extra});
const meta = {version: 2, timestamp: '2026-10-01T00:00:00Z'};
// A way as readElements gives it: with node ids, bounds and its edit metadata.
const way = (id, coords, tags) => {
  const geometry = coords.map(([lon, lat]) => ({lat, lon}));
  return {type: 'way', id, ...meta, nodes: coords.map((_, i) => id * 10 + i),
    bounds: {minlat: Math.min(...geometry.map(p => p.lat)), minlon: Math.min(...geometry.map(p => p.lon)), maxlat: Math.max(...geometry.map(p => p.lat)), maxlon: Math.max(...geometry.map(p => p.lon))},
    geometry, tags};
};
const ELEMENTS = [
  way(1, [[139.7, 35.68], [139.7001, 35.6801]], {conveying: 'forward', highway: 'steps', name: 'East escalator'}),
  way(2, [[139.7002, 35.68], [139.7003, 35.6801]], {conveying: 'backward', highway: 'steps'}),
  way(3, [[2.35, 48.85], [2.3501, 48.8501]], {conveying: 'reversible', highway: 'footway'}),
  way(4, [[2.36, 48.85], [2.3601, 48.8501]], {highway: 'elevator'}),
  way(5, [[2.37, 48.85], [2.3701, 48.8501]], {conveying: 'no', highway: 'steps'}),
  way(6, [[2.38, 48.85], [2.3801, 48.8501]], {conveying: 'No', highway: 'footway'}),
  way(7, [[8.6, 46.6], [8.62, 46.62]], {aerialway: 'gondola', name: 'Gondelbahn', 'name:en': 'Gondola', operator: 'Bergbahnen'}),
  way(8, [[8.7, 46.7], [8.71, 46.71]], {aerialway: 't-bar'}),
  way(9, [[8.8, 46.8], [8.81, 46.81]], {aerialway: 'Gondola'}),
  way(10, [[8.9, 46.9], [8.91, 46.91]], {aerialway: 'station'}),
  way(11, [[9, 47], [9.01, 47.01]], {aerialway: 'chair_lift', conveying: 'yes', highway: 'footway'}),
  {type: 'node', id: 12, ...meta, lat: 1, lon: 1, tags: {highway: 'elevator'}},
  {type: 'relation', id: 13, ...meta, members: [], tags: {aerialway: 'gondola'}},
];
const pick = ({type, id, tags, geometry}) => ({type, id, tags, geometry});
// The answers to CONVEYING_QUERY and AERIALWAY_QUERY (`out tags geom`).
const CONVEYING = [1, 2, 3, 4, 6, 11].map(id => pick(ELEMENTS[id - 1]));
const AERIALWAYS = [7, 8, 11].map(id => pick(ELEMENTS[id - 1]));

const fakeRead = (pool = ELEMENTS) => async (pbf, {keep, onElement}) => {
  const kept = pool.filter(e => (e.type !== 'node' || e.tags) && keep({type: e.type, id: e.id, tags: e.tags}));
  for (const e of kept) await onElement(structuredClone(e));
  return {read: pool.length, kept: kept.length, withoutGeometry: 0};
};

test('the selection is the Overpass queries\': exact values, ways only, an aerialway subclass matched case-sensitively', () => {
  assert.deepEqual(ELEMENTS.filter(isConveyingWay).map(e => e.id), [1, 2, 3, 4, 6, 11]);
  assert.deepEqual(ELEMENTS.filter(isAerialwayWay).map(e => e.id), [7, 8, 11]);
  assert.ok(isConveyingWay({type: 'way', tags: {conveying: ''}}), '[conveying] holds an empty value');
  assert.ok(!isConveyingWay({type: 'way', tags: {highway: 'Elevator'}}));
  for (const value of ['cable_car', 'mixed_lift', 'drag_lift', 'j-bar', 'platter']) assert.ok(isAerialwayWay({type: 'way', tags: {aerialway: value}}), value);
  for (const value of [' gondola', 'gondola ', 'gondola;chair_lift', 'tbar', 'xgondola', 'zip_line']) assert.ok(!isAerialwayWay({type: 'way', tags: {aerialway: value}}), value);
});

test('the same elements and features as from the Overpass answers', async t => {
  const {conveying, aerialways, counts} = await conveyingElements('assembled.osm.pbf', {read: fakeRead()});
  assert.deepEqual(conveying, CONVEYING);
  assert.deepEqual(aerialways, AERIALWAYS);
  assert.deepEqual(counts, {read: ELEMENTS.length, kept: 8, waysWithoutGeometry: 0});

  const dir = await mkdtemp(join(tmpdir(), 'extract-conveying-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const manifests = await buildExtractConveying('assembled.osm.pbf', report({missingRegions: ['gap/0_0_45_45']}), dir, {read: fakeRead(), now: () => new Date('2026-11-15T12:00:00Z')});
  for (const [dataset, file, convert, expected] of [['conveying', 'conveying', conveyingGeoJSON, CONVEYING], ['aerialways', 'aerialways', aerialwaysGeoJSON, AERIALWAYS]]) {
    const root = join(dir, dataset);
    assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(root, 'elements.json.gz')))), expected, dataset);
    assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(root, `${file}.geojson.gz`)))), convert({elements: expected}), dataset);
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest, manifests[dataset]);
    assert.deepEqual(Object.keys(manifest).slice(0, 7), ['generated', 'osmBase', 'update', 'features', 'kinds', 'zoom', 'tiles'], 'the Overpass manifest\'s fields first');
    assert.equal(manifest.osmBase, '2026-11-03T21:24:23Z', 'the oldest region\'s date, which Help shows');
    assert.equal(manifest.complete, false);
    const marker = await readFile(join(root, 'source.json'), 'utf8');
    assert.deepEqual(JSON.parse(marker), {schema: 1, dataset, source: 'extract', complete: false, osmTimestamp: '2026-11-03T21:24:23Z'});
    assert.match(checkMarker(marker, dataset), /not complete/, 'the site keeps the Overpass branch');
  }
  assert.deepEqual(manifests.conveying.kinds, {escalator: 2, travelator: 2, elevator: 1}, 'as conveying() classifies them');
  assert.equal(manifests.conveying.features, 5, 'way 11 (conveying=yes on a footway) is selected; the conversion decides it, as from Overpass');
  assert.deepEqual(manifests.aerialways.kinds, {cableway: 1, lift: 2});
});

test('the writer writes every file the site and the next Overpass run read', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'conveying-files-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const {features} = conveyingGeoJSON({elements: CONVEYING});
  const manifest = await writeLineSnapshot(join(dir, 'c'), {elements: CONVEYING, features, file: 'conveying', layer: 'conveying', zoom: 14,
    kindIds: ['escalator', 'travelator', 'elevator'], head: {generated: 'g', osmBase: 'o', update: 'full'}, tail: {source: 's', query: 'q'}});
  const index = JSON.parse(await readFile(join(dir, 'c', 'index.json'), 'utf8'));
  assert.deepEqual(index.tiles, [...index.tiles].sort());
  assert.ok(index.tiles.length >= 2 && index.tiles.every(key => key.startsWith('14/')));
  for (const key of index.tiles) assert.ok(gunzipSync(await readFile(join(dir, 'c', `${key}.pbf.gz`))).length > 0, key);
  assert.deepEqual(manifest, {generated: 'g', osmBase: 'o', update: 'full', features: 5, kinds: {escalator: 2, travelator: 2, elevator: 1}, zoom: 14, tiles: index.tiles.length, source: 's', query: 'q'});
  assert.equal(await readFile(join(dir, 'c', 'manifest.json'), 'utf8'), JSON.stringify(manifest, null, 2));
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(dir, 'c', 'elements.json.gz')))), CONVEYING);
});

test('from a world assembly: complete, accepted by the site\'s checks; too few features are refused', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-conveying-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  // 10,000 escalators and 5,000 lifts, the Overpass builds' floors.
  const many = [...Array.from({length: 10000}, (_, i) => way(100000 + i, [[10 + (i % 100) * 0.001, 50 + Math.floor(i / 100) * 0.001], [10.0005 + (i % 100) * 0.001, 50 + Math.floor(i / 100) * 0.001]], {conveying: 'yes'})),
    ...Array.from({length: 5000}, (_, i) => way(200000 + i, [[20 + (i % 50) * 0.01, 45 + Math.floor(i / 50) * 0.01], [20.005 + (i % 50) * 0.01, 45.005 + Math.floor(i / 50) * 0.01]], {aerialway: 'drag_lift'}))];
  const manifests = await buildExtractConveying('assembled.osm.pbf', report(), dir, {read: fakeRead(many)});
  assert.deepEqual([manifests.conveying.features, manifests.aerialways.features, manifests.conveying.complete], [10000, 5000, true]);
  assert.deepEqual(await validateAerialwaySnapshot(join(dir, 'aerialways')), {features: 5000, tiles: manifests.aerialways.tiles});
  for (const dataset of ['conveying', 'aerialways']) assert.equal(checkMarker(await readFile(join(dir, dataset, 'source.json'), 'utf8'), dataset), null, dataset);

  await assert.rejects(buildExtractConveying('x', report(), join(dir, 'few'), {read: fakeRead(many.slice(1))}), /small worldwide conveying extract: 9999/);
  await assert.rejects(buildExtractConveying('x', report(), join(dir, 'few'), {read: fakeRead(many.slice(0, -1))}), /small worldwide aerialways extract: 4999/);
  await assert.rejects(readdir(join(dir, 'few', 'aerialways')), /ENOENT/, 'nothing written for the refused dataset');
  await assert.rejects(buildExtractConveying('x', {...report(), schema: 2}, join(dir, 'bad'), {read: () => assert.fail('nothing read')}), /Not an assembly report/);
  await assert.rejects(buildExtractConveying('x', report({missingNodeRefs: 3}), join(dir, 'bad'), {read: () => assert.fail('nothing read')}), /missing 3 way nodes/);

  // A rebuild into the same directory leaves nothing of the previous build.
  await writeFile(join(dir, 'conveying', '14', 'stale.pbf.gz'), 'old');
  await buildExtractConveying('assembled.osm.pbf', report(), dir, {read: fakeRead(many)});
  await assert.rejects(readFile(join(dir, 'conveying', '14', 'stale.pbf.gz')), /ENOENT/);
});

test('the assembly workflow builds both after the traction dataset, and publishes each only to its own branch, only on main', async () => {
  const workflow = await readFile(new URL('../.github/workflows/osm-assemble.yml', import.meta.url), 'utf8');
  const build = workflow.indexOf('scripts/build-extract-conveying.mjs assembled.osm.pbf assembled.osm.pbf.json conveying-extract');
  assert.ok(build > workflow.indexOf('- name: Publish traction-extract-data'));
  assert.match(workflow, /- name: Publish conveying-extract-data and aerialways-extract-data\n\s+if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /for dataset in conveying aerialways; do/);
  assert.match(workflow, /git push --force origin "HEAD:\$dataset-extract-data"/);
  assert.doesNotMatch(workflow, /HEAD:(conveying|aerialway)-data\b/, 'the Overpass branches are never written');
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium, from a real extract file: the same elements', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-conveying-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const x = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tags = t => Object.entries(t || {}).map(([k, v]) => `<tag k="${x(k)}" v="${x(v)}"/>`).join('');
  const at = `version="${meta.version}" timestamp="${meta.timestamp}"`;
  const ways = ELEMENTS.filter(e => e.type === 'way');
  await writeFile(join(dir, 'in.osm'), '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">'
    + ways.flatMap(w => w.nodes.map((id, i) => `<node id="${id}" ${at} lat="${w.geometry[i].lat}" lon="${w.geometry[i].lon}"/>`)).join('')
    + `<node id="12" ${at} lat="1" lon="1">${tags({highway: 'elevator'})}</node>`
    + ways.map(w => `<way id="${w.id}" ${at}>${w.nodes.map(n => `<nd ref="${n}"/>`).join('')}${tags(w.tags)}</way>`).join('')
    + `<relation id="13" ${at}>${tags({aerialway: 'gondola'})}</relation></osm>`);
  assert.equal(spawnSync('osmium', ['sort', join(dir, 'in.osm'), '-o', join(dir, 'in.osm.pbf')]).status, 0);
  const {conveying, aerialways} = await conveyingElements(join(dir, 'in.osm.pbf'));
  assert.deepEqual(conveying, CONVEYING);
  assert.deepEqual(aerialways, AERIALWAYS);
});
