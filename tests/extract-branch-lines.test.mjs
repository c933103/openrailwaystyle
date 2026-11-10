import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildExtractBranchLines, branchTable, checkAssembly, coversWorld, EXTRACT_STAGE} from '../scripts/build-extract-branch-lines.mjs';
import {writeBranchFiles} from '../scripts/branch-lines-files.mjs';
import {toFeatures} from '../scripts/branch-lines.mjs';
import {branchView} from '../scripts/railway-ways.mjs';
import {checkMarker} from '../scripts/data-source.mjs';

const report = (extra = {}) => ({schema: 1, index: '20261110T023604Z-42630187750', regions: 163, oldestTimestamp: '2026-11-03T21:24:23Z', newestTimestamp: '2026-11-09T15:06:50Z', missingNodeRefs: 0, missingRegions: [], ...extra});
// Two lines the branch selection takes (a branch line, a metro line) and
// three it leaves (a main line, a branch siding, a disused branch).
const way = (id, tags, coords) => ({type: 'way', id, timestamp: '2026-11-01T00:00:00Z', version: 1,
  bounds: {minlat: Math.min(...coords.map(c => c[1])), minlon: Math.min(...coords.map(c => c[0])), maxlat: Math.max(...coords.map(c => c[1])), maxlon: Math.max(...coords.map(c => c[0]))},
  nodes: coords.map((_, i) => id * 10 + i), geometry: coords.map(([lon, lat]) => ({lat, lon})), tags});
const WAYS = [
  way(1, {railway: 'rail', usage: 'branch', name: 'Branch'}, [[11.5, 48.1], [11.6, 48.2]]),
  way(2, {railway: 'subway', name: 'U1'}, [[11.55, 48.13], [11.57, 48.14]]),
  way(6, {railway: 'narrow_gauge', usage: 'branch', name: 'Far east'}, [[60.5, 55.1], [60.6, 55.2]]),
  way(3, {railway: 'rail', usage: 'main'}, [[11.5, 48.0], [11.7, 48.0]]),
  way(4, {railway: 'rail', usage: 'branch', service: 'siding'}, [[11.6, 48.1], [11.61, 48.1]]),
  way(5, {railway: 'disused', usage: 'branch'}, [[11.4, 48.1], [11.41, 48.11]]),
];
const fakeRead = async (pbf, {keep, onElement}) => { let kept = 0; for (const w of WAYS) if (keep(w)) { kept++; onElement(w); } return {read: WAYS.length, kept, withoutGeometry: 0}; };

test('the extract build selects and converts lines as the Overpass build does, and tiles them the same', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-branch-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const manifest = await buildExtractBranchLines('assembled.osm.pbf', report(), join(dir, 'extract'), {read: fakeRead, now: () => new Date('2026-11-10T05:00:00Z')});
  assert.equal(manifest.lines, 3);
  // The Overpass build's path for the same answer: its view, its conversion, the same writer.
  const overpass = new Map(toFeatures(branchView({elements: WAYS})).map(f => [f.id, {...f, stage: 'europe-a'}]));
  await writeBranchFiles(join(dir, 'overpass'), overpass);
  const files = async root => (await readdir(root, {recursive: true})).filter(f => f.endsWith('.pbf.gz') || f === 'index.json').sort();
  const tiles = await files(join(dir, 'extract'));
  assert.ok(tiles.length > 1);
  assert.deepEqual(tiles, await files(join(dir, 'overpass')));
  const index = JSON.parse(await readFile(join(dir, 'extract', 'index.json'), 'utf8')).tiles;
  assert.deepEqual(index, [...index].sort(), 'the index lists tiles in order, as before');
  for (const file of tiles) assert.deepEqual(await readFile(join(dir, 'extract', file)), await readFile(join(dir, 'overpass', file)), `${file} differs`);
  // The table differs only in each line's stage.
  const rows = async root => gunzipSync(await readFile(join(dir, root, 'branch-lines.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
  assert.deepEqual((await rows('extract')).map(({stage, ...rest}) => rest), (await rows('overpass')).map(({stage, ...rest}) => rest));
  assert.ok((await rows('extract')).every(row => row.stage === EXTRACT_STAGE));
  // Dated by the oldest region it was built from, and marked complete for the site's switch.
  assert.equal(manifest.oldestSource, '2026-11-03T21:24:23Z');
  assert.equal(JSON.parse(await readFile(join(dir, 'extract', 'manifest.json'), 'utf8')).source, 'extract');
  assert.equal(checkMarker(await readFile(join(dir, 'extract', 'source.json'), 'utf8'), 'branch-lines'), null);
});

test('a build missing part of the world is published for comparison but never marked complete', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-branch-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  assert.equal(coversWorld(report()), true);
  for (const [extra, name] of [[{missingRegions: ['gap/0_0_45_45', 'africa']}, 'partial'], [{missingRegions: null}, 'unknown'], [{missingRegions: undefined}, 'older report']]) {
    assert.equal(coversWorld(report(extra)), false, name);
    const manifest = await buildExtractBranchLines('x', report(extra), join(dir, name), {read: fakeRead});
    assert.equal(manifest.complete, false);
    assert.equal(manifest.lines, 3, 'the lines it has are still built');
    assert.match(checkMarker(await readFile(join(dir, name, 'source.json'), 'utf8'), 'branch-lines'), /not complete/, `${name}: the site's switch falls back to Overpass`);
  }
  assert.deepEqual((await buildExtractBranchLines('x', report({missingRegions: ['africa']}), join(dir, 'listed'), {read: fakeRead})).extract.missingRegions, ['africa']);
});

test('only a complete assembly is built from', async () => {
  assert.equal(checkAssembly(report()).regions, 163);
  for (const [extra, message] of [[{schema: 2}, /regions/], [{regions: 0}, /regions/], [{oldestTimestamp: 'soon'}, /oldestTimestamp/],
    [{newestTimestamp: undefined}, /newestTimestamp/], [{missingNodeRefs: 3}, /missing 3 way nodes/], [{missingNodeRefs: null}, /unknown number/]])
    assert.throws(() => checkAssembly(report(extra)), message, JSON.stringify(extra));
  await assert.rejects(buildExtractBranchLines('x', report({missingNodeRefs: 1}), 'never-written', {read: () => assert.fail('nothing is read from an incomplete assembly')}), /missing 1/);
});

test('every line is one row, keyed by its way', () => {
  const table = branchTable(WAYS.filter(w => w.id <= 2));
  assert.deepEqual([...table.keys()], [1, 2]);
  assert.equal(table.get(1).stage, EXTRACT_STAGE);
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium, from a real extract file', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-branch-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const xml = WAYS.map(w => w.geometry.map((p, i) => `<node id="${w.nodes[i]}" version="1" timestamp="2026-11-01T00:00:00Z" lat="${p.lat}" lon="${p.lon}"/>`).join('')).join('')
    + WAYS.map(w => `<way id="${w.id}" version="1" timestamp="2026-11-01T00:00:00Z">${w.nodes.map(n => `<nd ref="${n}"/>`).join('')}${Object.entries(w.tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('')}</way>`).join('');
  await writeFile(join(dir, 'in.osm'), `<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">${xml}</osm>`);
  assert.equal(spawnSync('osmium', ['sort', join(dir, 'in.osm'), '-o', join(dir, 'in.osm.pbf')]).status, 0);
  const manifest = await buildExtractBranchLines(join(dir, 'in.osm.pbf'), report(), join(dir, 'out'));
  assert.equal(manifest.lines, 3);
  assert.equal(manifest.extract.waysWithoutGeometry, 0);
  const fromFake = await buildExtractBranchLines('x', report(), join(dir, 'fake'), {read: fakeRead});
  assert.deepEqual(await readFile(join(dir, 'out', 'index.json'), 'utf8'), await readFile(join(dir, 'fake', 'index.json'), 'utf8'));
  assert.equal(manifest.tileBytes, fromFake.tileBytes);
});

test('the assembly workflow builds from the assembled file and publishes only the extract branch, only on main', async () => {
  const workflow = await readFile(new URL('../.github/workflows/osm-assemble.yml', import.meta.url), 'utf8');
  const build = workflow.indexOf('node scripts/build-extract-branch-lines.mjs assembled.osm.pbf assembled.osm.pbf.json branch-lines-extract');
  assert.ok(build > workflow.indexOf('node scripts/assemble-extracts.mjs'), 'built after the assembly');
  assert.match(workflow, /- name: Publish branch-lines-extract-data\n\s+if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /git push --force origin HEAD:branch-lines-extract-data/);
  assert.doesNotMatch(workflow, /HEAD:branch-data\b/, 'the Overpass branch is never written');
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
});
