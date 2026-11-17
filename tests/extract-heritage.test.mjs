import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {buildExtractHeritage, heritageElements, isHeritageElement} from '../scripts/build-extract-heritage.mjs';
import {heritageFeatures} from '../scripts/heritage-data.mjs';
import {writeHeritageSnapshot, HERITAGE_SELECTION} from '../scripts/heritage-files.mjs';
import {decodeBundle} from '../styles/tile-bundles.mjs';
import {checkMarker} from '../scripts/data-source.mjs';

const report = (extra = {}) => ({schema: 1, index: '20261111T121854Z-42996345331', regions: 175, oldestTimestamp: '2026-11-03T21:24:23Z', newestTimestamp: '2026-11-11T10:58:20Z', missingNodeRefs: 0, missingRegions: [], ...extra});
const meta = {version: 2, timestamp: '2026-10-01T00:00:00Z'};
const node = (id, lat, lon, tags) => ({type: 'node', id, ...meta, lat, lon, ...(tags ? {tags} : {})});
// A closed way as readElements gives it.
const way = (id, coords, tags) => {
  const geometry = coords.map(([lon, lat]) => ({lat, lon}));
  return {type: 'way', id, ...meta, nodes: coords.map((_, i) => i === coords.length - 1 ? id * 10 : id * 10 + i),
    bounds: {minlat: Math.min(...geometry.map(p => p.lat)), minlon: Math.min(...geometry.map(p => p.lon)), maxlat: Math.max(...geometry.map(p => p.lat)), maxlon: Math.max(...geometry.map(p => p.lon))},
    geometry, ...(tags ? {tags} : {})};
};
// Rounded to the 7 decimals an OSM file holds.
const r7 = v => Math.round(v * 1e7) / 1e7;
const square = (x, y, d) => [[x, y], [r7(x + d), y], [r7(x + d), r7(y + d)], [x, r7(y + d)], [x, y]];
const OUTER = way(200, square(12, 41.8, 0.1)), INNER = way(201, square(12.03, 41.83, 0.02));
const ELEMENTS = [
  way(1, square(23.72, 37.97, 0.01), {historic: 'archaeological_site', name: 'Agora', 'name:en': 'Ancient Agora'}),
  way(2, square(-1.83, 51.17, 0.01), {heritage: '1', name: 'Stonehenge'}),
  way(3, square(8.5, 47.3, 0.01), {boundary: 'protected_area', protect_class: '22'}),
  way(4, square(-0.6, 50.9, 0.01), {historic: 'battlefield'}),
  way(5, square(2.3, 48.8, 0.01), {historic: 'castle'}),
  way(6, square(2.4, 48.8, 0.01), {historic: 'Archaeological_site'}),
  way(7, square(2.5, 48.8, 0.01), {heritage: '2'}),
  OUTER, INNER,
  {type: 'relation', id: 300, ...meta, members: [{type: 'way', ref: 200, role: 'outer'}, {type: 'way', ref: 201, role: 'inner'}], tags: {type: 'multipolygon', historic: 'district', name: 'Centro storico'}},
  {type: 'relation', id: 301, ...meta, members: [{type: 'way', ref: 200, role: 'outer'}], tags: {type: 'boundary', heritage: '1'}},
  {type: 'relation', id: 302, ...meta, members: [{type: 'way', ref: 200, role: 'outer'}], tags: {type: 'site', heritage: '1'}},
  {type: 'relation', id: 303, ...meta, members: [{type: 'way', ref: 200, role: 'outer'}], tags: {type: 'Multipolygon', heritage: '1'}},
  node(9, 41.9, 12.5, {historic: 'archaeological_site'}),
];
const MEMBER_NODES = [...OUTER.nodes.slice(0, 4).map((id, i) => node(id, OUTER.geometry[i].lat, OUTER.geometry[i].lon)),
  ...INNER.nodes.slice(0, 4).map((id, i) => node(id, INNER.geometry[i].lat, INNER.geometry[i].lon))];
const SELECTED = ['way1', 'way2', 'way3', 'way4', 'relation300', 'relation301'];
// The Overpass answer to heritageQuery over the world: the selected ways and
// relations as `out geom` gives them.
const geometryOf = {200: OUTER.geometry, 201: INNER.geometry};
const OVERPASS = ELEMENTS.filter(e => SELECTED.includes(`${e.type}${e.id}`)).map(e => e.type !== 'relation' ? e
  : {...e, members: e.members.map(m => ({...m, geometry: geometryOf[m.ref]}))});

const reads = [];
const fakeRead = (pool = ELEMENTS) => async (pbf, {keep, onElement, untaggedNodes = false}) => {
  reads.push({pbf, untaggedNodes});
  const source = pbf.endsWith('#members') ? [...MEMBER_NODES, OUTER, INNER] : pool;
  const kept = source.filter(e => (untaggedNodes || e.type !== 'node' || e.tags) && keep({type: e.type, id: e.id, tags: e.tags}));
  for (const e of kept) await onElement(structuredClone(e));
  return {read: source.length, kept: kept.length, withoutGeometry: 0};
};
const subsets = [];
const fakeSubset = async (pbf, ids) => { subsets.push(ids); return {file: `${pbf}#members`, remove: async () => {}}; };

test('the selection is heritageQuery\'s: exact tag values, ways, and multipolygon or boundary relations', () => {
  assert.deepEqual(ELEMENTS.filter(isHeritageElement).map(e => `${e.type}${e.id}`), SELECTED);
  assert.ok(isHeritageElement({type: 'relation', tags: {type: 'boundary', protect_class: '22'}}));
  assert.ok(!isHeritageElement({type: 'relation', tags: {historic: 'district'}}), 'a relation without type');
  assert.ok(!isHeritageElement({type: 'relation', tags: {type: 'multipolygon', landuse: 'grass'}}), 'a multipolygon without the tags');
  assert.ok(!isHeritageElement({type: 'way', tags: {protect_class: '22 '}}));
  assert.ok(!isHeritageElement({type: 'relation', tags: {type: ' multipolygon', heritage: '1'}}));
});

test('the same areas as from the Overpass answer', async () => {
  reads.length = 0; subsets.length = 0;
  const {elements, counts} = await heritageElements('assembled.osm.pbf', {read: fakeRead(), subset: fakeSubset});
  assert.deepEqual(reads, [{pbf: 'assembled.osm.pbf', untaggedNodes: false}, {pbf: 'assembled.osm.pbf#members', untaggedNodes: true}]);
  assert.deepEqual(subsets, [['w200', 'w201']]);
  assert.deepEqual(counts.relations, 2);
  const expected = heritageFeatures({elements: OVERPASS});
  assert.deepEqual(heritageFeatures({elements}), expected);
  assert.deepEqual(expected.map(f => f.properties.id), ['w1', 'w2', 'w3', 'w4', 'r300', 'r301']);
  assert.equal(expected.find(f => f.properties.id === 'r300').geometry.coordinates.length, 2, 'the inner ring is a hole of the district');
});

test('a snapshot in the Overpass layout: bundles, index, manifest, and source.json', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-heritage-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const out = join(dir, 'heritage');
  const manifest = await buildExtractHeritage('assembled.osm.pbf', report(), out, {read: fakeRead(), subset: fakeSubset, now: () => new Date('2026-11-16T00:00:00Z')});
  assert.deepEqual(Object.keys(manifest).slice(0, 5), ['version', 'built', 'source', 'license', 'complete'], 'the Overpass manifest\'s fields first');
  assert.deepEqual([manifest.complete, manifest.areas, manifest.oldestSource, manifest.selection], [true, 6, '2026-11-03T21:24:23Z', HERITAGE_SELECTION]);
  assert.deepEqual(manifest.counts, {archaeological_site: 1, world_heritage: 2, cultural_protected_area: 1, battlefield: 1, historic_district: 1});
  assert.equal(manifest.coverage.length, 32, 'the 45-degree regions of the world');
  assert.equal(manifest.coverage.reduce((n, c) => n + c.features, 0), 6, 'each area in the one region holding it');
  assert.deepEqual(JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')), manifest);
  const index = JSON.parse(await readFile(join(out, 'index.json'), 'utf8'));
  assert.equal(index.bundles.length, manifest.bundles);
  const ids = new Set();
  for (const path of index.bundles)
    for (const [, tile] of decodeBundle(gunzipSync(await readFile(join(out, `${index.zoom}/${path}.bundle.gz`))))) {
      const layer = new VectorTile(new Pbf(tile)).layers.heritage;
      for (let i = 0; i < layer.length; i++) ids.add(layer.feature(i).properties.id);
    }
  assert.deepEqual([...ids].sort(), ['r300', 'r301', 'w1', 'w2', 'w3', 'w4']);
  assert.equal(checkMarker(await readFile(join(out, 'source.json'), 'utf8'), 'heritage'), null);
  await assert.rejects(readdir(join(out, 'elements')), /ENOENT/, 'no per-region elements: the Overpass build keeps those for its change updates');
});

test('the writer writes what the Overpass build wrote, through the file functions it is given', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'heritage-files-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const features = heritageFeatures({elements: OVERPASS});
  const calls = [];
  const fs = await import('node:fs/promises');
  const io = {mkdir: (...a) => (calls.push('mkdir'), fs.mkdir(...a)), rm: (...a) => (calls.push('rm'), fs.rm(...a)), writeFile: (...a) => (calls.push('writeFile'), fs.writeFile(...a))};
  await writeFile(join(dir, 'stale'), 'old');
  const manifest = await writeHeritageSnapshot(dir, features, {head: {version: 2}, tail: {coverage: []}}, io);
  assert.equal(calls[0], 'rm');
  assert.ok(calls.includes('writeFile') && calls.includes('mkdir'));
  await assert.rejects(readFile(join(dir, 'stale')), /ENOENT/, 'the output is replaced');
  assert.equal(await readFile(join(dir, 'manifest.json'), 'utf8'), `${JSON.stringify(manifest, null, 2)}\n`);
  assert.deepEqual(Object.keys(manifest), ['version', 'format', 'minzoom', 'maxzoom', 'bundleZoom', 'areas', 'counts', 'tiles', 'bundles', 'bytes', 'coverage']);
});

test('from a partial assembly: written, not complete; an empty world is refused', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-heritage-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const partial = await buildExtractHeritage('x', report({missingRegions: ['gap/0_0_45_45']}), join(dir, 'p'), {read: fakeRead(), subset: fakeSubset});
  assert.equal(partial.complete, false);
  assert.match(checkMarker(await readFile(join(dir, 'p', 'source.json'), 'utf8'), 'heritage'), /not complete/);
  const older = await buildExtractHeritage('x', report({olderFilter: ['gap/0_-180_45_-135']}), join(dir, 'o'), {read: fakeRead(), subset: fakeSubset});
  assert.equal(older.complete, false, 'a tile asked with an older query');
  // A partial world with no areas is still written, not complete.
  const none = await buildExtractHeritage('x', report({missingRegions: ['africa']}), join(dir, 'n'), {read: fakeRead([]), subset: fakeSubset});
  assert.deepEqual([none.complete, none.areas, none.bundles], [false, 0, 0]);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'n', 'index.json'), 'utf8')).bundles, []);
  assert.match(checkMarker(await readFile(join(dir, 'n', 'source.json'), 'utf8'), 'heritage'), /not complete/);
  await assert.rejects(buildExtractHeritage('x', report(), join(dir, 'e'), {read: fakeRead([]), subset: fakeSubset}), /empty worldwide historic area/);
  await assert.rejects(buildExtractHeritage('x', {...report(), schema: 2}, join(dir, 'b'), {read: () => assert.fail('nothing read')}), /Not an assembly report/);
});

test('the assembly workflow builds it after street running, and publishes it only to its own branch, only on main', async () => {
  const workflow = await readFile(new URL('../.github/workflows/osm-assemble.yml', import.meta.url), 'utf8');
  const build = workflow.indexOf('scripts/build-extract-heritage.mjs assembled.osm.pbf assembled.osm.pbf.json heritage-extract');
  assert.ok(build > workflow.indexOf('- name: Publish street-running-extract-data'));
  assert.match(workflow, /- name: Publish heritage-extract-data\n\s+if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /git push --force origin HEAD:heritage-extract-data/);
  assert.doesNotMatch(workflow, /HEAD:heritage-data\b/, 'the Overpass branch is never written');
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium, from a real extract file: the same areas', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-heritage-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const x = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tags = t => Object.entries(t || {}).map(([k, v]) => `<tag k="${x(k)}" v="${x(v)}"/>`).join('');
  const at = `version="${meta.version}" timestamp="${meta.timestamp}"`;
  const ways = ELEMENTS.filter(e => e.type === 'way');
  const nodes = new Map(ways.flatMap(w => w.nodes.map((id, i) => [id, w.geometry[i]])));
  await writeFile(join(dir, 'in.osm'), '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">'
    + [...nodes].map(([id, p]) => `<node id="${id}" ${at} lat="${p.lat}" lon="${p.lon}"/>`).join('')
    + `<node id="9" ${at} lat="41.9" lon="12.5">${tags({historic: 'archaeological_site'})}</node>`
    + ways.map(w => `<way id="${w.id}" ${at}>${w.nodes.map(n => `<nd ref="${n}"/>`).join('')}${tags(w.tags)}</way>`).join('')
    + ELEMENTS.filter(e => e.type === 'relation').map(r => `<relation id="${r.id}" ${at}>${r.members.map(m => `<member type="${m.type}" ref="${m.ref}" role="${m.role}"/>`).join('')}${tags(r.tags)}</relation>`).join('') + '</osm>');
  assert.equal(spawnSync('osmium', ['sort', join(dir, 'in.osm'), '-o', join(dir, 'in.osm.pbf')]).status, 0);
  const {elements} = await heritageElements(join(dir, 'in.osm.pbf'));
  assert.deepEqual(heritageFeatures({elements}), heritageFeatures({elements: OVERPASS}));
});
