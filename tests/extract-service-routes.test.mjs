import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildExtractServiceRoutes, serviceTable} from '../scripts/build-extract-service-routes.mjs';
import {EXTRACT_STAGE} from '../scripts/build-extract-branch-lines.mjs';
import {writeServiceFiles} from '../scripts/service-routes-files.mjs';
import {addResult, commitStage, readTable, routeView, toTable} from '../scripts/service-routes.mjs';
import {serviceView} from '../scripts/railway-ways.mjs';
import {checkMarker} from '../scripts/data-source.mjs';

const report = (extra = {}) => ({schema: 1, index: '20261110T023604Z-42630187750', regions: 163, oldestTimestamp: '2026-11-03T21:24:23Z', newestTimestamp: '2026-11-09T15:06:50Z', missingNodeRefs: 0, missingRegions: [], ...extra});
const way = (id, tags, coords, timestamp = '2026-11-01T00:00:00Z') => ({type: 'way', id, timestamp, version: 3,
  bounds: {minlat: Math.min(...coords.map(c => c[1])), minlon: Math.min(...coords.map(c => c[0])), maxlat: Math.max(...coords.map(c => c[1])), maxlon: Math.max(...coords.map(c => c[0]))},
  nodes: coords.map((_, i) => id * 10 + i), geometry: coords.map(([lon, lat]) => ({lat, lon})), tags});
const relation = (id, tags, members) => ({type: 'relation', id, timestamp: '2026-11-02T00:00:00Z', version: 7, members, tags});
// Two routes the selection takes (a metro, a commuter train) sharing a track,
// and what it leaves: a route of another kind, a platform member, a track no
// route uses, and a member that is not a track.
const ELEMENTS = [
  way(1, {railway: 'subway'}, [[139.70, 35.60], [139.71, 35.61]]),
  way(2, {railway: 'rail'}, [[139.71, 35.61], [139.73, 35.62]]),
  // Edited after the oldest region's time: observed, but not certified as of it.
  way(3, {railway: 'subway'}, [[139.73, 35.62], [139.75, 35.63]], '2026-11-08T00:00:00Z'),
  way(4, {railway: 'platform'}, [[139.70, 35.60], [139.7001, 35.6001]]),
  way(5, {railway: 'rail'}, [[139.9, 35.9], [139.91, 35.91]]),
  way(6, {highway: 'service'}, [[139.72, 35.61], [139.721, 35.611]]),
  relation(100, {type: 'route', route: 'subway', ref: 'M1', name: 'Metro 1', network: 'Metro', colour: '#ff0000'},
    [{type: 'way', ref: 1, role: ''}, {type: 'way', ref: 3, role: ''}, {type: 'way', ref: 4, role: 'platform'}, {type: 'node', ref: 99, role: 'stop'}]),
  relation(101, {type: 'route', route: 'train', service: 'commuter', ref: 'C', name: 'Commuter C', network: 'Rail'},
    [{type: 'way', ref: 1, role: ''}, {type: 'way', ref: 2, role: ''}, {type: 'way', ref: 6, role: ''}]),
  relation(102, {type: 'route', route: 'bus', ref: '7'}, [{type: 'way', ref: 6, role: ''}]),
];
// The reader as readElements is: in file order (ways, then relations), only
// what keep accepts, which sees {type, id, tags}.
const reads = [];
const fakeRead = async (pbf, {keep, onElement}) => {
  let kept = 0;
  reads.push(pbf);
  for (const e of ELEMENTS) if (keep({type: e.type, id: e.id, tags: e.tags})) { kept++; await onElement(structuredClone(e)); }
  return {read: ELEMENTS.length, kept, withoutGeometry: 0};
};

test('the extract build selects and converts routes as the Overpass build does, and tiles them the same', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-service-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  reads.length = 0;
  const manifest = await buildExtractServiceRoutes('assembled.osm.pbf', report(), join(dir, 'extract'), {read: fakeRead, now: () => new Date('2026-11-10T05:00:00Z')});
  assert.deepEqual(reads, ['assembled.osm.pbf', 'assembled.osm.pbf'], 'the relations, then the ways');
  assert.equal(manifest.routes, 2);
  assert.equal(manifest.ways, 3, 'the routes\' track ways only');
  assert.deepEqual({relations: manifest.extract.relations, memberWays: manifest.extract.memberWays, ways: manifest.extract.ways}, {relations: 2, memberWays: 5, ways: 3});
  // The Overpass build's path for the same answer at the same time: its
  // view, its conversion, the same writer.
  const answer = {osm3s: {timestamp_osm_base: report().oldestTimestamp}, elements: ELEMENTS};
  const source = {endpoint: 'osm-extract', acquired: report().index, stage: EXTRACT_STAGE, pass: report().index};
  const overpass = {routes: new Map(), ways: new Map()};
  addResult(overpass, toTable(serviceView(answer), source), EXTRACT_STAGE);
  commitStage(overpass, EXTRACT_STAGE);
  await writeServiceFiles(join(dir, 'overpass'), overpass);
  const files = async root => (await readdir(root, {recursive: true})).filter(f => f.endsWith('.pbf.gz') || f === 'index.json' || f === 'service-routes.ndjson.gz').sort();
  const written = await files(join(dir, 'extract'));
  assert.ok(written.filter(f => f.endsWith('.pbf.gz')).length > 1);
  assert.deepEqual(written, await files(join(dir, 'overpass')));
  for (const file of written) assert.deepEqual(await readFile(join(dir, 'extract', file)), await readFile(join(dir, 'overpass', file)), `${file} differs`);
  const table = readTable(gunzipSync(await readFile(join(dir, 'extract', 'service-routes.ndjson.gz'))).toString());
  assert.deepEqual([...table.routes.keys()].sort(), ['r100', 'r101']);
  assert.equal(routeView(table.routes.get('r100')).ref, 'M1');
  assert.deepEqual(Object.keys(table.ways.get(1).routes), [EXTRACT_STAGE]);
  assert.deepEqual(table.ways.get(1).routes[EXTRACT_STAGE], ['r100', 'r101'], 'a shared track carries both routes');
  // Observed as of the oldest region: the way edited after it is drawn but
  // not certified; the others are.
  assert.deepEqual(manifest.geometry.waysWithUnknownProvenance, [3]);
  assert.equal(table.ways.get(1).geometry.snapshot, '2026-11-03T21:24:23Z');
  assert.deepEqual(table.ways.get(1).geometry.sources[0], {observation: table.ways.get(1).geometry.sources[0].observation, dataset: 'openstreetmap', ...source});
  assert.ok(table.ways.get(3).lines.length, 'still drawn');
  assert.deepEqual(manifest.geometry.routeRelationsWithoutGeometry, []);
  assert.equal(manifest.oldestSource, '2026-11-03T21:24:23Z');
  assert.equal(JSON.parse(await readFile(join(dir, 'extract', 'manifest.json'), 'utf8')).source, 'extract');
  assert.equal(checkMarker(await readFile(join(dir, 'extract', 'source.json'), 'utf8'), 'service-routes'), null);
});

test('only member track ways are read whole: the second pass keeps nothing else', async () => {
  const kept = [];
  await serviceTable('x', report(), {read: async (pbf, {keep, onElement}) => {
    for (const e of ELEMENTS) if (keep({type: e.type, id: e.id, tags: e.tags})) { kept.push(`${e.type[0]}${e.id}`); await onElement(structuredClone(e)); }
    return {read: ELEMENTS.length, kept: 0, withoutGeometry: 0};
  }});
  assert.deepEqual(kept, ['r100', 'r101', 'w1', 'w2', 'w3']);
});

test('a build missing part of the world is published for comparison but never marked complete, and only a complete assembly is built from', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-service-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const manifest = await buildExtractServiceRoutes('x', report({missingRegions: ['gap/0_0_45_45']}), join(dir, 'partial'), {read: fakeRead});
  assert.equal(manifest.complete, false);
  assert.equal(manifest.routes, 2, 'the routes it has are still built');
  assert.deepEqual(manifest.extract.missingRegions, ['gap/0_0_45_45']);
  assert.match(checkMarker(await readFile(join(dir, 'partial', 'source.json'), 'utf8'), 'service-routes'), /not complete/);
  await assert.rejects(buildExtractServiceRoutes('x', report({missingNodeRefs: 2}), join(dir, 'never'), {read: () => assert.fail('nothing is read from an incomplete assembly')}), /missing 2/);
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium, from a real extract file', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-service-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const x = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tags = t => Object.entries(t).map(([k, v]) => `<tag k="${x(k)}" v="${x(v)}"/>`).join('');
  const ways = ELEMENTS.filter(e => e.type === 'way'), relations = ELEMENTS.filter(e => e.type === 'relation');
  await writeFile(join(dir, 'in.osm'), '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">'
    + ways.map(w => w.geometry.map((p, i) => `<node id="${w.nodes[i]}" version="1" timestamp="2026-11-01T00:00:00Z" lat="${p.lat}" lon="${p.lon}"/>`).join('')).join('')
    + ways.map(w => `<way id="${w.id}" version="${w.version}" timestamp="${w.timestamp}">${w.nodes.map(n => `<nd ref="${n}"/>`).join('')}${tags(w.tags)}</way>`).join('')
    + relations.map(r => `<relation id="${r.id}" version="${r.version}" timestamp="${r.timestamp}">${r.members.map(m => `<member type="${m.type}" ref="${m.ref}" role="${m.role}"/>`).join('')}${tags(r.tags)}</relation>`).join('')
    + '</osm>');
  assert.equal(spawnSync('osmium', ['sort', join(dir, 'in.osm'), '-o', join(dir, 'in.osm.pbf')]).status, 0);
  const real = await buildExtractServiceRoutes(join(dir, 'in.osm.pbf'), report(), join(dir, 'out'), {now: () => new Date('2026-11-10T05:00:00Z')});
  const fake = await buildExtractServiceRoutes('x', report(), join(dir, 'fake'), {read: fakeRead, now: () => new Date('2026-11-10T05:00:00Z')});
  assert.equal(real.extract.waysWithoutGeometry, 0);
  assert.deepEqual(real, fake);
  for (const file of ['index.json', 'service-routes.ndjson.gz']) assert.deepEqual(await readFile(join(dir, 'out', file)), await readFile(join(dir, 'fake', file)), file);
});

test('the assembly workflow builds service routes after publishing branch lines, and publishes them only to their own branch, only on main', async () => {
  const workflow = await readFile(new URL('../.github/workflows/osm-assemble.yml', import.meta.url), 'utf8');
  const build = workflow.indexOf('node --max-old-space-size=6144 scripts/build-extract-service-routes.mjs assembled.osm.pbf assembled.osm.pbf.json service-routes-extract');
  assert.ok(build > workflow.indexOf('- name: Publish branch-lines-extract-data'), 'a failed service build does not hold back the branch lines');
  assert.match(workflow, /- name: Publish service-routes-extract-data\n\s+if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /git push --force origin HEAD:service-routes-extract-data/);
  assert.doesNotMatch(workflow, /HEAD:service-data\b/, 'the Overpass branch is never written');
});
