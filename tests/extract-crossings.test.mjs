import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import {buildExtractCrossings, crossingTable, crossingTags, isMinorTrack, overpassCsvValue} from '../scripts/build-extract-crossings.mjs';
import {SEP, TAG_KEYS, crossingFiles, parseCsv, replaceRegion, startRegions} from '../scripts/crossing-data.mjs';
import {parseLine, readElements} from '../scripts/extract-elements.mjs';
import {checkMarker} from '../scripts/data-source.mjs';

const report = (extra = {}) => ({schema: 1, index: '20261110T023604Z-42630187750', regions: 163, oldestTimestamp: '2026-11-03T21:24:23Z', newestTimestamp: '2026-11-09T15:06:50Z', missingNodeRefs: 0, missingRegions: [], ...extra});
const meta = {version: 2, timestamp: '2026-10-01T00:00:00Z'};
const node = (id, lat, lon, tags) => ({type: 'node', id, ...meta, lat, lon, ...(tags ? {tags} : {})});
const way = (id, nodes, tags) => ({type: 'way', id, ...meta, nodes, tags});
// Crossings on each kind of track the query tells apart, and what it leaves out.
const ELEMENTS = [
  node(1, 51.5007292, -0.1246254, {railway: 'level_crossing', 'crossing:barrier': 'full', name: 'Main St', ref: 'km 18,145', description: `BÜ "Nord"; it's`, note: 'not a crossing tag'}),
  node(2, 51.51, -0.12, {railway: 'crossing', crossing: 'uncontrolled'}),
  node(3, 51.52, -0.12, {railway: 'level_crossing'}),
  node(4, 51.53, -0.12, {railway: 'crossing'}),
  node(5, 51.54, -0.12, {railway: 'level_crossing'}),
  node(6, 51.55, -0.12, {railway: 'level_crossing'}),
  node(7, 51.56, -0.12, {railway: 'level_crossing'}),
  node(8, 51.57, -0.12, {railway: 'level_crossing'}),
  node(9, 51.58, -0.12, {railway: 'level_crossing'}),
  node(10, 51.59, -0.12, {railway: 'level_crossing'}),
  node(11, -33.86, 151.2, {railway: 'level_crossing', name: '', ref: `a${SEP}b`}),
  node(12, 35.0, 139.0, {railway: 'signal'}),
  node(13, 64.0, 180, {railway: 'level_crossing'}),
  node(14, 89.9, 0, {railway: 'crossing', name: 'line one\nline two\tend'}),
  node(15, 35.1, 139.1),
  way(100, [1, 15], {railway: 'rail'}),
  way(101, [2, 15], {railway: 'tram'}),
  way(102, [3, 15], {railway: 'rail'}),
  way(103, [3], {railway: 'tram'}),
  way(104, [5], {railway: 'abandoned', 'abandoned:railway': 'tram'}),
  way(105, [6], {railway: 'rail', service: 'siding'}),
  way(106, [7], {railway: 'rail', embedded: 'yes'}),
  way(107, [8], {railway: 'disused', 'disused:railway': 'rail'}),
  way(108, [9], {railway: 'light_rail', 'construction:railway': 'rail'}),
  way(109, [10], {railway: 'rail', proposed: 'tram'}),
  way(110, [4, 11], {highway: 'residential'}),
  way(111, [14], {railway: 'miniature'}),
];
// The Overpass answer to regionQuery for these elements, as the query's
// set operations give it: majors, the minor marker, minors, the end marker.
// 13 (at 180° E) is answered by the region it borders and dropped by inBox.
// Values as Overpass's escape_csv writes them (its loop, not a regex).
const csv = value => value.includes('\n') || value.includes(',') || value.includes('"') ? `"${value.split('"').join('""')}"` : value;
const row = (id, lat, lon, railway, tags = {}) => [id, lat, lon, railway, ...TAG_KEYS.map(key => csv(tags[key] ?? ''))].join(SEP);
const OVERPASS = [
  row(1, '51.5007292', '-0.1246254', 'level_crossing', {'crossing:barrier': 'full', name: 'Main St', ref: 'km 18,145', description: `BÜ "Nord"; it's`}),
  row(3, '51.5200000', '-0.1200000', 'level_crossing'), row(4, '51.5300000', '-0.1200000', 'crossing'),
  row(8, '51.5700000', '-0.1200000', 'level_crossing'), row(10, '51.5900000', '-0.1200000', 'level_crossing'),
  row(11, '-33.8600000', '151.2000000', 'level_crossing', {ref: `a${SEP}b`}),
  row(13, '64.0000000', '180.0000000', 'level_crossing'),
  `${SEP}${SEP}${SEP}minor`,
  row(2, '51.5100000', '-0.1200000', 'crossing', {crossing: 'uncontrolled'}),
  row(5, '51.5400000', '-0.1200000', 'level_crossing'), row(6, '51.5500000', '-0.1200000', 'level_crossing'),
  row(7, '51.5600000', '-0.1200000', 'level_crossing'), row(9, '51.5800000', '-0.1200000', 'level_crossing'),
  row(14, '89.9000000', '0.0000000', 'crossing', {name: 'line one\nline two\tend'}),
  `${SEP}${SEP}${SEP}end`].join('\n') + '\n';
const overpassTable = () => {
  const table = new Map(), rows = parseCsv(OVERPASS);
  for (const {box} of startRegions()) replaceRegion(table, box, rows);
  return table;
};
// The reader as readElements is: nodes before ways, tagged nodes only; with
// geometry false, ways carry their node ids.
const reads = [];
const fakeRead = async (pbf, {keep, onElement, geometry = true}) => {
  reads.push({pbf, geometry});
  const kept = ELEMENTS.filter(e => (e.type !== 'node' || e.tags) && keep({type: e.type, id: e.id, tags: e.tags}));
  for (const e of kept) await onElement(structuredClone(e));
  return {read: ELEMENTS.length, kept: kept.length, withoutGeometry: 0};
};

test('a minor track is one of MINOR_TRACKS\' four kinds', () => {
  for (const tags of [{railway: 'tram'}, {railway: 'light_rail'}, {railway: 'funicular'}, {railway: 'miniature'}, {railway: 'abandoned', 'abandoned:railway': 'tram'},
    {railway: 'construction', construction: 'light_rail'}, {railway: 'razed', 'razed:railway': 'funicular'}, {railway: 'rail', service: 'yard'}, {railway: 'rail', service: ''}, {railway: 'rail', embedded: 'yes'}])
    assert.ok(isMinorTrack(tags), JSON.stringify(tags));
  for (const tags of [{railway: 'rail'}, {railway: 'rail', proposed: 'tram'}, {railway: 'subway', 'disused:railway': 'tram'}, {railway: 'disused', 'disused:railway': 'rail'},
    {railway: 'abandoned', 'was:railway': 'tram'}, {railway: 'abandoned', 'abandoned:railway': 'trams'}, {railway: 'rail', embedded: 'partial'}, {railway: 'tramway'}])
    assert.ok(!isMinorTrack(tags), JSON.stringify(tags));
});

test('tags as the CSV rows give them: the crossing tag keys with a value, quoted as Overpass quotes them; a separator in a value leaves them unreadable', () => {
  assert.deepEqual(crossingTags({railway: 'level_crossing', name: 'A', access: '', note: 'x'}), {name: 'A'});
  // As the published Overpass table holds them (crossing-data, 2026-11-01:
  // nodes 21766873, 286510577 and 261798913).
  assert.equal(overpassCsvValue('km 18,145'), '"km 18,145"');
  assert.equal(overpassCsvValue('BÜ 28 "Gerlingweg"'), '"BÜ 28 ""Gerlingweg"""');
  assert.equal(overpassCsvValue('Streckennummer: 2550\nStraße: K14 "Nörder Straße"'), '"Streckennummer: 2550\nStraße: K14 ""Nörder Straße"""');
  for (const value of ['a;b', "it's", 'a\tb', 'a\rb', '']) assert.equal(overpassCsvValue(value), value);
  assert.deepEqual(crossingTags({ref: 'km 1,2'}), {ref: '"km 1,2"'});
  assert.equal(crossingTags({ref: `1${SEP}2`}), null);
  assert.deepEqual(crossingTags({note: `1${SEP}2`}), {});
});

test('the table is the Overpass query\'s, row for row, and gives the same files', async t => {
  reads.length = 0;
  const {table, counts} = await crossingTable('assembled.osm.pbf', {read: fakeRead});
  assert.deepEqual(reads, [{pbf: 'assembled.osm.pbf', geometry: false}], 'one read, without geometry');
  const expected = overpassTable();
  assert.deepEqual([...table].sort((a, b) => a[0] - b[0]), [...expected].sort((a, b) => a[0] - b[0]));
  assert.deepEqual([...table.keys()].filter(id => table.get(id)[3]).sort((a, b) => a - b), [2, 5, 6, 7, 9, 14]);
  assert.equal(table.get(11)[4], null);
  assert.ok(!table.has(13), 'at 180° E: in no region box');
  assert.deepEqual(counts, {read: 24, railwayWays: 11, crossings: 13, outsideWorldBoxes: 1});

  const dir = await mkdtemp(join(tmpdir(), 'extract-crossings-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const out = join(dir, 'out');
  const manifest = await buildExtractCrossings('assembled.osm.pbf', report(), out, {read: fakeRead, now: () => new Date('2026-11-11T05:00:00Z')});
  const {files} = crossingFiles(expected);
  const written = [];
  const walk = async d => { for (const e of await readdir(d, {withFileTypes: true})) e.isDirectory() ? await walk(join(d, e.name)) : written.push(relative(out, join(d, e.name))); };
  await walk(out);
  assert.deepEqual(written.sort(), [...files.keys(), 'manifest.json', 'source.json'].sort());
  for (const [path, bytes] of files) assert.deepEqual(await readFile(join(out, path)), Buffer.from(bytes), path);
  assert.deepEqual({complete: manifest.complete, tags: manifest.tags, crossings: manifest.crossings, road: manifest.road, pedestrian: manifest.pedestrian, onMinorTracksOnly: manifest.onMinorTracksOnly, oldestSource: manifest.oldestSource, license: manifest.license},
    {complete: true, tags: true, crossings: 12, road: 9, pedestrian: 3, onMinorTracksOnly: 6, oldestSource: '2026-11-03T21:24:23Z', license: 'ODbL-1.0'});
  assert.equal(checkMarker(await readFile(join(out, 'source.json'), 'utf8'), 'crossings'), null);
});

test('a partial assembly is not complete; an incomplete one is refused; an unsorted file stops the build', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-crossings-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const manifest = await buildExtractCrossings('x', report({missingRegions: ['gap/0_0_45_45']}), join(dir, 'partial'), {read: fakeRead});
  assert.equal(manifest.complete, false);
  assert.match(checkMarker(await readFile(join(dir, 'partial', 'source.json'), 'utf8'), 'crossings'), /not complete/);
  await assert.rejects(buildExtractCrossings('x', report({missingNodeRefs: 1}), join(dir, 'never'), {read: () => assert.fail('nothing read')}), /missing 1/);
  const unsorted = async (pbf, {onElement}) => { await onElement(way(100, [1], {railway: 'rail'})); await onElement(node(1, 0, 0, {railway: 'crossing'})); };
  await assert.rejects(crossingTable('x', {read: unsorted}), /Node 1 after a way/);
});

test('without geometry, a way gives its node ids, also of nodes the extract lacks', () => {
  const line = 'w10 v1 dV c0 t2026-01-01T00:00:00Z i0 u Trailway=rail Nn1x1y1,n2x2y2,n3xy';
  assert.equal(parseLine(line), null, 'with geometry it is left out');
  assert.deepEqual(parseLine(line, undefined, {geometry: false}), {type: 'way', id: 10, timestamp: '2026-01-01T00:00:00Z', version: 1, nodes: [1, 2, 3], tags: {railway: 'rail'}});
  assert.deepEqual(parseLine('w11 v1 Trailway=rail Nn5,n6', undefined, {geometry: false}).nodes, [5, 6]);
  assert.throws(() => parseLine('w12 v1 Trailway=rail Nw5', undefined, {geometry: false}), /Not an OPL node reference/);
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium, from a real extract file: the same table, a way through a missing node included', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-crossings-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const x = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;').replace(/\u001f/g, '');
  const tags = t => Object.entries(t || {}).map(([k, v]) => `<tag k="${x(k)}" v="${x(v)}"/>`).join('');
  const at = `version="${meta.version}" timestamp="${meta.timestamp}"`;
  // XML cannot hold the separator, so crossing 11 is written without it here.
  const elements = ELEMENTS.map(e => e.id === 11 ? {...e, tags: {railway: 'level_crossing', ref: 'ab'}} : e);
  await writeFile(join(dir, 'in.osm'), '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">'
    + elements.filter(e => e.type === 'node').map(n => `<node id="${n.id}" ${at} lat="${n.lat}" lon="${n.lon}">${tags(n.tags)}</node>`).join('')
    // Way 112 runs through crossing 4 and node 999, which the file lacks.
    + [...elements.filter(e => e.type === 'way'), way(112, [4, 999], {railway: 'tram'})].map(w => `<way id="${w.id}" ${at}>${w.nodes.map(n => `<nd ref="${n}"/>`).join('')}${tags(w.tags)}</way>`).join('') + '</osm>');
  assert.equal(spawnSync('osmium', ['sort', join(dir, 'in.osm'), '-o', join(dir, 'in.osm.pbf')]).status, 0);
  const {table, counts} = await crossingTable(join(dir, 'in.osm.pbf'));
  const expected = overpassTable();
  expected.set(11, [-33.86, 151.2, 'road', false, {ref: 'ab'}]);
  expected.get(4)[3] = true; // only on the tram way 112
  assert.deepEqual([...table].sort((a, b) => a[0] - b[0]), [...expected].sort((a, b) => a[0] - b[0]));
  assert.equal(counts.railwayWays, 12);
  // readElements with geometry would have left way 112 out.
  const ids = [];
  await readElements(join(dir, 'in.osm.pbf'), {keep: e => e.type === 'way', onElement: e => ids.push(e.id)});
  assert.ok(!ids.includes(112));
});

test('the assembly workflow builds crossings after the station points, and publishes them only to their own branch, only on main', async () => {
  const workflow = await readFile(new URL('../.github/workflows/osm-assemble.yml', import.meta.url), 'utf8');
  const build = workflow.indexOf('scripts/build-extract-crossings.mjs assembled.osm.pbf assembled.osm.pbf.json crossings-extract');
  assert.ok(build > workflow.indexOf('- name: Publish station-points-extract-data'));
  assert.match(workflow, /- name: Publish crossings-extract-data\n\s+if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /git push --force origin HEAD:crossings-extract-data/);
  assert.doesNotMatch(workflow, /HEAD:crossing-data\b/, 'the Overpass branch is never written');
});
