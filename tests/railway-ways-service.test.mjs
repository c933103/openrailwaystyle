import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync, gunzipSync} from 'node:zlib';
import {readTable, routeView} from '../scripts/service-routes.mjs';

// Synthetic responses only.
const meta = {version: 2, timestamp: '2026-10-01T00:00:00Z'};
const response = elements => ({osm3s: {timestamp_osm_base: '2026-10-31T00:00:00Z'}, elements});
const metro = response([
  {type: 'relation', id: 100, ...meta, tags: {type: 'route', route: 'subway', ref: 'M1', name: 'Metro 1', network: 'Metro'}, members: [{type: 'way', ref: 1, role: ''}]},
  {type: 'way', id: 1, ...meta, tags: {railway: 'subway'}, geometry: [{lon: 139.7, lat: 35.6}, {lon: 139.71, lat: 35.61}]},
  // A branch line no route uses: not a service-route way.
  {type: 'way', id: 2, ...meta, tags: {railway: 'rail', usage: 'branch'}, geometry: [{lon: 139.8, lat: 35.6}, {lon: 139.81, lat: 35.61}]},
]);

test('service routes, given the store, are built from it without any Overpass request, and only once per stored pass', async t => {
  const root = await mkdtemp(join(tmpdir(), 'service-store-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'store', 'regions', 'japan'), {recursive: true});
  await writeFile(join(root, 'store', 'state.json'), JSON.stringify({version: 1, stages: {japan: {completed: '2026-10-31T00:00:00Z'}, china: {completed: null}}, runs: []}));
  await writeFile(join(root, 'store', 'regions', 'japan', '0_20_122_46_154.json.gz'), gzipSync(JSON.stringify({stage: 'japan', part: 0, box: [20, 122, 46, 154],
    query: 'q', generated: '2026-10-30T00:00:00Z', response: metro})));
  await writeFile(join(root, 'no-fetch.mjs'), 'globalThis.fetch = async () => { throw new Error("Overpass requested"); };');
  for (const dir of ['scripts', 'styles']) await cp(dir, join(root, 'app', dir), {recursive: true});
  await symlink(resolve('node_modules'), join(root, 'app', 'node_modules'), 'dir');
  const run = async previous => {
    await writeFile(join(root, 'output'), '');
    const child = spawnSync(process.execPath, ['--import', join(root, 'no-fetch.mjs'), join(root, 'app', 'scripts', 'build-service-routes.mjs')], {
      cwd: root, encoding: 'utf8', timeout: 60_000,
      env: {...process.env, ...(previous ? {PREVIOUS_DATA: previous} : {}), RAILWAY_WAYS_STORE: join(root, 'store'), GITHUB_OUTPUT: join(root, 'output')}});
    assert.equal(child.status, 0, child.stderr);
    const out = join(root, 'app', 'service-data');
    return {table: readTable(gunzipSync(await readFile(join(out, 'service-routes.ndjson.gz'))).toString()),
      state: JSON.parse(await readFile(join(out, 'state.json'), 'utf8')), manifest: JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')),
      output: await readFile(join(root, 'output'), 'utf8'), out};
  };
  const first = await run();
  assert.deepEqual([...first.table.routes.keys()], ['r100']);
  assert.equal(routeView(first.table.routes.get('r100')).ref, 'M1');
  assert.deepEqual([...first.table.ways.keys()], [1], 'only the route\'s track ways');
  assert.equal(first.state.stages.japan.completed, '2026-10-31T00:00:00Z');
  assert.equal(first.state.stages.japan.storeCompleted, '2026-10-31T00:00:00Z');
  assert.equal(first.state.stages.china?.completed ?? null, null, 'a stage the store has not completed is not taken');
  assert.equal(first.manifest.source, 'railway-ways-data');
  assert.equal(first.output, 'publish=true\nredeploy=true\n');
  // The same stored pass again: nothing taken, nothing to redeploy.
  await cp(first.out, join(root, 'previous'), {recursive: true});
  const second = await run(join(root, 'previous'));
  assert.deepEqual(second.manifest.run.stages, []);
  assert.equal(second.output, 'publish=true\nredeploy=false\n');
  assert.deepEqual([...second.table.routes.keys()], ['r100']);
});
