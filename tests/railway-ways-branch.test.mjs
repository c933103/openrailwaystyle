import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync, gunzipSync} from 'node:zlib';
import {readTable, writeTable, toFeatures} from '../scripts/branch-lines.mjs';
import {branchTableFromStore} from '../scripts/railway-ways-branch.mjs';

// Synthetic responses only.
const way = (id, tags, lon = 139.7) => ({type: 'way', id, version: 1, tags, geometry: [{lon, lat: 35.6}, {lon: lon + 0.01, lat: 35.61}]});
const branch = id => way(id, {railway: 'rail', usage: 'branch', name: `Line ${id}`});
const response = elements => ({osm3s: {timestamp_osm_base: '2026-10-31T00:00:00Z'}, elements});
const line = (id, stage) => ({...toFeatures(response([branch(id)]))[0], stage});
const quiet = {warn: () => {}};

test('a stored stage replaces the lines it owns; stages not in the store keep theirs', async () => {
  const previous = new Map([[1, line(1, 'japan')], [2, line(2, 'japan')], [9, line(9, 'india')]]);
  const regions = [{stage: 'japan', response: response([branch(1), branch(3), way(4, {railway: 'rail', usage: 'main'})])}];
  const {table, applied} = await branchTableFromStore(previous, regions, {japan: '2026-10-31T00:00:00Z'}, quiet);
  assert.deepEqual([...table.keys()].sort(), [1, 3, 9], 'line 2 is gone, line 3 is new, the main line is no branch line, India untouched');
  assert.deepEqual(applied, [{stage: 'japan', completed: '2026-10-31T00:00:00Z', removed: 1, kept: 0, lines: 2}]);
  assert.equal(table.get(9), previous.get(9));
});

test('a line belongs to the first stage whose regions return it', async () => {
  const regions = [
    {stage: 'china', response: response([branch(5)])},
    {stage: 'japan', response: response([branch(5), branch(6)])},
  ];
  const {table} = await branchTableFromStore(new Map(), regions, {japan: 'a', china: 'b'}, quiet);
  assert.equal(table.get(5).stage, 'japan', 'Japan comes before China in the stage order');
  // A line held by a stage the store does not have yet moves only to an earlier one.
  const held = new Map([[7, line(7, 'japan')], [8, line(8, 'india')]]);
  const later = await branchTableFromStore(held, [{stage: 'china', response: response([branch(7), branch(8)])}], {china: 'b'}, quiet);
  assert.equal(later.table.get(7).stage, 'japan');
  assert.equal(later.table.get(8).stage, 'china');
  // A stage still being downloaded in the store is not applied.
  const pending = await branchTableFromStore(held, [{stage: 'india', response: response([])}], {india: null}, quiet);
  assert.deepEqual([...pending.table.keys()], [7, 8]);
});

test('a stored stage that would lose over a fifth of its lines keeps them', async () => {
  const previous = new Map(Array.from({length: 200}, (_, i) => [i + 1, line(i + 1, 'japan')]));
  const warnings = [];
  const {table, applied} = await branchTableFromStore(previous, [{stage: 'japan', response: response(Array.from({length: 150}, (_, i) => branch(i + 1)))}],
    {japan: 'a'}, {warn: message => warnings.push(message)});
  assert.equal(table.size, 200);
  assert.equal(applied[0].kept, 50);
  assert.match(warnings[0], /would remove 50 of 200 lines/);
});

test('the builder, given the store, publishes from it without any Overpass request', async t => {
  const root = await mkdtemp(join(tmpdir(), 'branch-store-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  // A store with Japan complete.
  await mkdir(join(root, 'store', 'regions', 'japan'), {recursive: true});
  await writeFile(join(root, 'store', 'state.json'), JSON.stringify({version: 1, stages: {japan: {completed: '2026-10-31T00:00:00Z'}}, runs: []}));
  await writeFile(join(root, 'store', 'regions', 'japan', '0_20_122_46_154.json.gz'), gzipSync(JSON.stringify({stage: 'japan', part: 0, box: [20, 122, 46, 154], response: response([branch(1), branch(3)])})));
  // The published table: Japan's line 2 and India's line 9.
  await mkdir(join(root, 'previous'));
  await writeFile(join(root, 'previous', 'branch-lines.ndjson.gz'), gzipSync(writeTable(new Map([[2, line(2, 'japan')], [9, line(9, 'india')]]))));
  await writeFile(join(root, 'previous', 'state.json'), JSON.stringify({version: 3, downloadStages: 3, stages: {}, runs: []}));
  await writeFile(join(root, 'no-fetch.mjs'), 'globalThis.fetch = async () => { throw new Error("Overpass requested"); };');
  // A copy of the builders, so their output folder is inside this fixture.
  for (const dir of ['scripts', 'styles']) await cp(dir, join(root, 'app', dir), {recursive: true});
  await symlink(resolve('node_modules'), join(root, 'app', 'node_modules'), 'dir');
  const child = spawnSync(process.execPath, ['--import', join(root, 'no-fetch.mjs'), join(root, 'app', 'scripts', 'build-branch-lines.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 60_000,
    env: {...process.env, PREVIOUS_DATA: join(root, 'previous'), RAILWAY_WAYS_STORE: join(root, 'store'), GITHUB_OUTPUT: join(root, 'output')}});
  assert.equal(child.status, 0, child.stderr);
  const out = new URL(`file://${join(root, 'app', 'branch-data')}/`);
  const table = readTable(gunzipSync(await readFile(new URL('branch-lines.ndjson.gz', out))).toString());
  assert.deepEqual([...table.keys()].sort(), [1, 3, 9]);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', out), 'utf8'));
  assert.equal(manifest.source, 'railway-ways-data');
  assert.equal(manifest.stages.find(s => s.name === 'japan').completed, '2026-10-31T00:00:00Z');
  assert.equal(await readFile(join(root, 'output'), 'utf8'), 'publish=true\nredeploy=true\n');
});
