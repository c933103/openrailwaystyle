import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildExtractStreetRunning, isStreetWay, streetElements} from '../scripts/build-extract-street-running.mjs';
import {STREET_QUERY, streetFeatures, writeStreetSnapshot} from '../scripts/street-running-files.mjs';
import {checkMarker} from '../scripts/data-source.mjs';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';

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
  way(1, [[7.44, 46.95], [7.441, 46.951]], {railway: 'tram', embedded: 'yes', name: 'Marktgasse'}),
  way(2, [[4.89, 52.37], [4.891, 52.371]], {highway: 'primary', embedded_rails: 'tram', 'name:nl': 'Damrak'}),
  way(3, [[4.9, 52.38], [4.901, 52.381]], {highway: 'residential', embedded_rails: ''}),
  way(4, [[7.45, 46.96], [7.451, 46.961]], {railway: 'tram', embedded: 'Yes'}),
  way(5, [[7.46, 46.97], [7.461, 46.971]], {railway: 'tram', embedded: 'no'}),
  way(6, [[7.47, 46.98], [7.471, 46.981]], {railway: 'tram', embedded: 'partial'}),
  {type: 'node', id: 7, ...meta, lat: 1, lon: 1, tags: {embedded: 'yes'}},
  {type: 'relation', id: 8, ...meta, members: [], tags: {embedded_rails: 'tram'}},
];
const pick = ({type, id, tags, geometry}) => ({type, id, tags, geometry});
// The answer to STREET_QUERY (`out tags geom`).
const OVERPASS = [1, 2, 3].map(id => pick(ELEMENTS[id - 1]));

const fakeRead = (pool = ELEMENTS) => async (pbf, {keep, onElement}) => {
  const kept = pool.filter(e => (e.type !== 'node' || e.tags) && keep({type: e.type, id: e.id, tags: e.tags}));
  for (const e of kept) await onElement(structuredClone(e));
  return {read: pool.length, kept: kept.length, withoutGeometry: 0};
};

test('the selection is STREET_QUERY\'s: embedded=yes exactly, embedded_rails with any value, ways only', () => {
  assert.equal(STREET_QUERY, '[out:json][timeout:600][maxsize:536870912];(way[embedded=yes];way[embedded_rails];);out tags geom;');
  assert.deepEqual(ELEMENTS.filter(isStreetWay).map(e => e.id), [1, 2, 3]);
  assert.ok(!isStreetWay({type: 'way', tags: {embedded: ' yes'}}));
  assert.ok(!isStreetWay({type: 'way', tags: {'embedded_rails:lanes': 'tram'}}));
});

test('the same elements and files as from the Overpass answer', async t => {
  const {elements, counts} = await streetElements('assembled.osm.pbf', {read: fakeRead()});
  assert.deepEqual(elements, OVERPASS);
  assert.deepEqual(counts, {read: ELEMENTS.length, kept: 3, waysWithoutGeometry: 0});

  const dir = await mkdtemp(join(tmpdir(), 'extract-street-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const out = join(dir, 'street');
  const manifest = await buildExtractStreetRunning('assembled.osm.pbf', report({missingRegions: ['gap/0_0_45_45']}), out, {read: fakeRead(), now: () => new Date('2026-11-16T00:00:00Z')});
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(out, 'elements.json.gz')))), OVERPASS);
  const expected = streetFeatures(OVERPASS);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(out, 'street-running.geojson.gz')))), {type: 'FeatureCollection', features: expected});
  assert.equal(manifest.features, expected.length);
  assert.deepEqual(JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')), manifest);
  assert.deepEqual(Object.keys(manifest).slice(0, 5), ['generated', 'osmBase', 'update', 'features', 'tiles'], 'the Overpass manifest\'s fields first');
  assert.deepEqual([manifest.osmBase, manifest.query, manifest.complete], ['2026-11-03T21:24:23Z', STREET_QUERY, false]);
  const index = JSON.parse(await readFile(join(out, 'index.json'), 'utf8'));
  assert.equal(index.tiles.length, manifest.tiles);
  for (const key of index.tiles) assert.match(key, /^12\/\d+\/\d+$/), assert.ok(gunzipSync(await readFile(join(out, `${key}.pbf.gz`))).length > 0);
  const marker = await readFile(join(out, 'source.json'), 'utf8');
  assert.deepEqual(JSON.parse(marker), {schema: 1, dataset: 'street-running', source: 'extract', complete: false, osmTimestamp: '2026-11-03T21:24:23Z'});
  assert.match(checkMarker(marker, 'street-running'), /not complete/, 'the site keeps the Overpass branch');
});

test('the writer writes every file the site and the next Overpass run read', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'street-files-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const features = streetFeatures(OVERPASS);
  const manifest = await writeStreetSnapshot(join(dir, 's'), {elements: OVERPASS, features, head: {generated: 'g', osmBase: 'o', update: 'full'}, tail: {source: 's', query: 'q'}});
  const index = JSON.parse(await readFile(join(dir, 's', 'index.json'), 'utf8'));
  assert.deepEqual(index.tiles, [...index.tiles].sort());
  assert.deepEqual(manifest, {generated: 'g', osmBase: 'o', update: 'full', features: features.length, tiles: index.tiles.length, source: 's', query: 'q'});
  assert.equal(await readFile(join(dir, 's', 'manifest.json'), 'utf8'), JSON.stringify(manifest, null, 2));
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(dir, 's', 'elements.json.gz')))), OVERPASS);
});

test('tiles: layer street_running at zoom 12, every point kept, as the site draws them', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'street-files-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  // A middle point 3 tile units off the line between its neighbours (one
  // unit is 360° / 4096 / 8192 of longitude). geojson-vt does not simplify
  // at its maximum zoom, so the tolerance does not change these tiles.
  const unit = 360 / 4096 / 8192;
  const bent = {type: 'way', id: 9, tags: {railway: 'tram', embedded: 'yes'}, geometry: [{lon: 7.4405, lat: 46.95}, {lon: 7.4405 + 100 * unit, lat: 46.95 + 3 * unit}, {lon: 7.4405 + 200 * unit, lat: 46.95}]};
  const manifest = await writeStreetSnapshot(join(dir, 's'), {elements: [bent], features: streetFeatures([bent]), head: {}, tail: {}});
  const {tiles} = JSON.parse(await readFile(join(dir, 's', 'index.json'), 'utf8'));
  assert.equal(manifest.tiles, 1);
  const tile = new VectorTile(new Pbf(gunzipSync(await readFile(join(dir, 's', `${tiles[0]}.pbf.gz`)))));
  assert.deepEqual(Object.keys(tile.layers), ['street_running']);
  const feature = tile.layers.street_running.feature(0);
  assert.equal(feature.properties.evidence, streetFeatures([bent])[0].properties.evidence);
  assert.equal(feature.loadGeometry()[0].length, 3);
});

test('from a world assembly: complete; too few features are refused; a rebuild leaves nothing stale', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-street-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const many = Array.from({length: 100}, (_, i) => way(1000 + i, [[7 + i * 0.001, 47], [7.0005 + i * 0.001, 47]], {railway: 'tram', embedded: 'yes'}));
  const manifest = await buildExtractStreetRunning('x', report(), join(dir, 'ok'), {read: fakeRead(many)});
  assert.deepEqual([manifest.features, manifest.complete], [100, true]);
  assert.equal(checkMarker(await readFile(join(dir, 'ok', 'source.json'), 'utf8'), 'street-running'), null);

  await assert.rejects(buildExtractStreetRunning('x', report(), join(dir, 'few'), {read: fakeRead(many.slice(1))}), /small worldwide street-running extract: 99/);
  await assert.rejects(readdir(join(dir, 'few')), /ENOENT/, 'nothing written');
  await assert.rejects(buildExtractStreetRunning('x', {...report(), schema: 2}, join(dir, 'bad'), {read: () => assert.fail('nothing read')}), /Not an assembly report/);
  await assert.rejects(buildExtractStreetRunning('x', report({missingNodeRefs: 3}), join(dir, 'bad'), {read: () => assert.fail('nothing read')}), /missing 3 way nodes/);

  await writeFile(join(dir, 'ok', '12', 'stale.pbf.gz'), 'old');
  await buildExtractStreetRunning('x', report(), join(dir, 'ok'), {read: fakeRead(many)});
  await assert.rejects(readFile(join(dir, 'ok', '12', 'stale.pbf.gz')), /ENOENT/);
});

test('the assembly workflow builds it after conveying and aerialways, and publishes it only to its own branch, only on main', async () => {
  const workflow = await readFile(new URL('../.github/workflows/osm-assemble.yml', import.meta.url), 'utf8');
  const build = workflow.indexOf('scripts/build-extract-street-running.mjs assembled.osm.pbf assembled.osm.pbf.json street-running-extract');
  assert.ok(build > workflow.indexOf('- name: Publish conveying-extract-data and aerialways-extract-data'));
  assert.match(workflow, /- name: Publish street-running-extract-data\n\s+if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /git push --force origin HEAD:street-running-extract-data/);
  assert.doesNotMatch(workflow, /HEAD:street-data\b/, 'the Overpass branch is never written');
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium, from a real extract file: the same elements', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-street-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const x = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tags = t => Object.entries(t || {}).map(([k, v]) => `<tag k="${x(k)}" v="${x(v)}"/>`).join('');
  const at = `version="${meta.version}" timestamp="${meta.timestamp}"`;
  const ways = ELEMENTS.filter(e => e.type === 'way');
  await writeFile(join(dir, 'in.osm'), '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">'
    + ways.flatMap(w => w.nodes.map((id, i) => `<node id="${id}" ${at} lat="${w.geometry[i].lat}" lon="${w.geometry[i].lon}"/>`)).join('')
    + `<node id="7" ${at} lat="1" lon="1">${tags({embedded: 'yes'})}</node>`
    + ways.map(w => `<way id="${w.id}" ${at}>${w.nodes.map(n => `<nd ref="${n}"/>`).join('')}${tags(w.tags)}</way>`).join('')
    + `<relation id="8" ${at}>${tags({embedded_rails: 'tram'})}</relation></osm>`);
  assert.equal(spawnSync('osmium', ['sort', join(dir, 'in.osm'), '-o', join(dir, 'in.osm.pbf')]).status, 0);
  const {elements} = await streetElements(join(dir, 'in.osm.pbf'));
  assert.deepEqual(elements, OVERPASS);
});
