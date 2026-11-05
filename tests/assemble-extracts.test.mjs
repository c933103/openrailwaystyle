import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {assemble, comparablePairs, deletions, parseOpl, whollyInside} from '../scripts/assemble-extracts.mjs';

const square = (x0, y0, x1, y1) => [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]];
const entry = (region, sourceTimestamp, extra = {}) => ({region, asset: `${region}.osm.pbf`, sourceTimestamp, filter: 'f', ...extra});

test('OPL lines give the object and what it refers to', () => {
  assert.deepEqual(parseOpl('n1 v1 dV c0 t2026-10-01T00:00:00Z i0 u Trailway=station x0 y0'), {id: 'n1', refs: []});
  assert.deepEqual(parseOpl('w10 v1 dV c0 t2026-10-01T00:00:00Z i0 u Trailway=rail Nn1,n2'), {id: 'w10', refs: ['n1', 'n2']});
  assert.deepEqual(parseOpl('r5 v1 dV c0 t2026-10-01T00:00:00Z i0 u Ttype=route Mw10@,n1@stop,r6@'), {id: 'r5', refs: ['w10', 'n1', 'r6']});
});

test('wholly inside means every node inside; a node a remaining way uses is kept', () => {
  // Nodes inside the newer region, and the ways and relations using one, with all their references.
  const insideNodes = ['n1', 'n3', 'n4', 'n6'];
  const objects = [{id: 'w10', refs: ['n3', 'n4']}, {id: 'w11', refs: ['n5', 'n6']}, {id: 'r1', refs: ['w10']}, {id: 'r2', refs: ['w11']}, {id: 'r3', refs: ['r1']}];
  assert.deepEqual([...whollyInside(objects, insideNodes)].sort(), ['n1', 'n3', 'n4', 'n6', 'r1', 'r3', 'w10']);
  // n6 is not in the newer region, but w11 reaches outside it and stays.
  assert.deepEqual([...deletions(objects, insideNodes, new Set(['n3']))].sort(), ['n1', 'n4', 'r1', 'r3', 'w10']);
  assert.ok(!deletions(objects, insideNodes, new Set()).has('n6'));
  assert.ok(deletions(objects, insideNodes, new Set()).has('n3'), 'a node of a way removed with it goes too');
});

test('only a newer region with a polygon is compared, and only with an older one made the same way that it touches', () => {
  const index = {regions: {a: entry('a', '2026-10-01T00:00:00Z'), b: entry('b', '2026-11-01T00:00:00Z'), c: entry('c', '2026-11-01T00:00:00Z', {filter: 'g'}),
    far: entry('far', '2026-09-01T00:00:00Z'), same: entry('same', '2026-11-01T00:00:00Z')},
    polygons: {a: square(0, 0, 2, 2), b: square(1, 0, 3, 2), c: square(1, 0, 3, 2), far: square(50, 50, 51, 51), same: square(1, 0, 3, 2)}};
  const {pairs, skipped} = comparablePairs(index);
  assert.deepEqual(pairs.map(p => `${p.newer.region}>${p.older.region}`).sort(), ['b>a', 'same>a']);
  assert.deepEqual(skipped, [{newer: 'c', older: 'a', reason: 'made with different filters'}]);
  // Equal dates are never compared; a region without a polygon is reported.
  delete index.polygons.b;
  assert.deepEqual(comparablePairs(index).skipped.filter(s => s.newer === 'b').map(s => s.reason), ['no polygon for the newer region', 'no polygon for the newer region']);
});

// The real osmium steps on two synthetic regions.
const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
const node = (id, version, lon, lat, tags = {}) => `<node id="${id}" version="${version}" timestamp="2026-10-0${version}T00:00:00Z" lat="${lat}" lon="${lon}">${Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('')}</node>`;
const way = (id, refs, tags = {railway: 'rail'}) => `<way id="${id}" version="1" timestamp="2026-10-01T00:00:00Z">${refs.map(r => `<nd ref="${r}"/>`).join('')}${Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('')}</way>`;
const osm = body => `<?xml version="1.0"?><osm version="0.6">${body}</osm>`;

async function regions(t, {bFilter = 'f'} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'assemble-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  // a (older, 0–2° E) and b (newer, 1–3° E) overlap between 1 and 2° E.
  const a = osm([
    node(1, 1, 1.5, 1, {railway: 'station'}), // deleted in b: wholly inside b, not in b
    node(2, 1, 0.5, 1, {railway: 'station'}), // outside b: kept
    node(3, 1, 1.2, 0.5), node(4, 1, 1.8, 0.5), // w10's nodes
    node(5, 1, 0.5, 1.5), node(6, 1, 1.5, 1.5), // w11's nodes
    node(7, 1, 1.5, 0.2, {railway: 'halt'}), // moved in b (version 2)
    node(8, 1, 1.4, 0.8, {railway: 'halt'}), // the same in both
    way(10, [3, 4]), // wholly inside b, gone from b
    way(11, [5, 6]), // reaches outside b: kept until a refreshes
  ].join(''));
  const b = osm([node(7, 2, 1.6, 0.2, {railway: 'halt'}), node(8, 1, 1.4, 0.8, {railway: 'halt'}), node(9, 1, 2.5, 1, {railway: 'station'})].join(''));
  for (const [name, text] of [['a', a], ['b', b]]) {
    await writeFile(join(dir, `${name}.osm`), text);
    assert.equal(spawnSync('osmium', ['cat', join(dir, `${name}.osm`), '-o', join(dir, `${name}.osm.pbf`)]).status, 0);
  }
  const index = {generation: 'g1', oldestTimestamp: '2026-10-01T00:00:00Z', newestTimestamp: '2026-11-01T00:00:00Z',
    regions: {a: entry('a', '2026-10-01T00:00:00Z'), b: entry('b', '2026-11-01T00:00:00Z', {filter: bFilter})},
    polygons: {a: square(0, 0, 2, 2), b: square(1, 0, 3, 2)}};
  const contents = async () => spawnSync('osmium', ['cat', join(dir, 'out.osm.pbf'), '-f', 'opl'], {encoding: 'utf8'}).stdout.trim().split('\n')
    .map(line => line.split(' ').slice(0, 2).join(' '));
  return {dir, index, contents};
}

test('with osmium installed, regions of different dates assemble into one file', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const {dir, index, contents} = await regions(t);
  const report = await assemble(index, dir, join(dir, 'out.osm.pbf'));
  assert.deepEqual(await contents(), ['n2 v1', 'n5 v1', 'n6 v1', 'n7 v2', 'n8 v1', 'n9 v1', 'w11 v1'],
    'deleted inside the newer region: n1, w10 and its nodes; the highest version of n7; one copy of n8');
  assert.deepEqual(report.deletions, {a: 4});
  assert.equal(report.pairsCompared, 1);
  assert.equal(report.missingNodeRefs, 0);
  assert.deepEqual(report.counts, {nodes: 6, ways: 1, relations: 0});
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'out.osm.pbf.json'), 'utf8')).deletions, {a: 4});
});

test('with osmium installed, regions made with different filters are only merged, and the skip is reported', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const {dir, index, contents} = await regions(t, {bFilter: 'other'});
  const report = await assemble(index, dir, join(dir, 'out.osm.pbf'));
  assert.deepEqual(await contents(), ['n1 v1', 'n2 v1', 'n3 v1', 'n4 v1', 'n5 v1', 'n6 v1', 'n7 v2', 'n8 v1', 'n9 v1', 'w10 v1', 'w11 v1']);
  assert.deepEqual(report.deletions, {});
  assert.deepEqual(report.pairsSkipped, [{newer: 'b', older: 'a', reason: 'made with different filters'}]);
});

test('with osmium installed, a way whose node is missing is counted, not dropped', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'assemble-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await writeFile(join(dir, 'a.osm'), osm(node(1, 1, 0, 0) + way(10, [1, 2, 3])));
  assert.equal(spawnSync('osmium', ['cat', join(dir, 'a.osm'), '-o', join(dir, 'a.osm.pbf')]).status, 0);
  const report = await assemble({regions: {a: entry('a', '2026-10-01T00:00:00Z')}, polygons: {}}, dir, join(dir, 'out.osm.pbf'));
  assert.equal(report.missingNodeRefs, 2);
  assert.deepEqual(report.counts, {nodes: 1, ways: 1, relations: 0});
});
