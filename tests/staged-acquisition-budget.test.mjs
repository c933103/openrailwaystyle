import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync, gunzipSync} from 'node:zlib';
import {STAGES, quarters, toFeatures, writeTable as writeBranches} from '../scripts/branch-lines.mjs';
import {addResult, commitStage, toTable, writeTable as writeServices} from '../scripts/service-routes.mjs';

const body = {osm3s: {timestamp_osm_base: '2026-10-07T00:00:00Z'}, elements: [
  {type: 'relation', id: 1, version: 1, timestamp: '2026-10-01T00:00:00Z',
    tags: {route: 'subway', ref: '1', name: 'Fixture line', network: 'Fixture'},
    members: [{type: 'way', ref: 10, role: ''}]},
  {type: 'way', id: 10, version: 1, timestamp: '2026-10-01T00:00:00Z',
    tags: {railway: 'subway'}, nodes: [1, 2], geometry: [{lon: 139.7, lat: 35.68}, {lon: 139.71, lat: 35.69}]},
]};
const part = STAGES.find(stage => stage.name === 'japan').parts[0];
const queue = quarters(part.box).slice(0, 2).map(box => ({part: 0, box, depth: 1}));
const pipelines = [
  {name: 'service', script: 'build-service-routes.mjs', folder: 'service-data', tableFile: 'service-routes.ndjson.gz', version: 1,
    table: () => {const table = {routes: new Map(), ways: new Map()}; addResult(table, toTable(body), 'japan'); commitStage(table, 'japan'); return writeServices(table);}},
  {name: 'branch', script: 'build-branch-lines.mjs', folder: 'branch-data', tableFile: 'branch-lines.ndjson.gz', version: 3,
    table: () => writeBranches(new Map(toFeatures(body).map(feature => [feature.id, {...feature, stage: 'japan'}])))},
];

async function fixture(pipeline, fn) {
  const root = await mkdtemp(join(tmpdir(), 'atlas-staged-budget-'));
  try {
    await cp('scripts', join(root, 'scripts'), {recursive: true});
    await mkdir(join(root, 'styles'));
    for (const name of ['pbf-utf8.mjs', 'service-frequency.mjs']) await cp(`styles/${name}`, join(root, 'styles', name));
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    await mkdir(join(root, 'previous'));
    await writeFile(join(root, 'mock.mjs'), `import {readFileSync, appendFileSync} from 'node:fs';
const observations = JSON.parse(readFileSync(process.env.MOCK_PATH, 'utf8')); let count = 0;
globalThis.setTimeout = (callback, ms) => {appendFileSync(process.env.MOCK_SLEEPS, JSON.stringify(ms) + '\\n'); callback(); return 0;};
globalThis.fetch = async (url, options) => {
  appendFileSync(process.env.MOCK_LOG, JSON.stringify({url, query: options.body.get('data')}) + '\\n');
  const next = observations[count++]; if (!next) throw new Error('Unexpected fixture request');
  const text = next.text ?? JSON.stringify(next.body);
  return new Response(text.padEnd(next.bytes ?? text.length, ' '), {status: next.status ?? 200});
};`);
    const initial = pipeline.table();
    const run = async (responses, {runs = [], state, previous = initial} = {}) => {
      const prior = state ?? {version: pipeline.version, downloadStages: 3, runs,
        stages: {...Object.fromEntries(STAGES.map(stage => [stage.name, {completed: new Date().toISOString(), pending: null, seen: []}])), japan: {completed: '2026-10-01T00:00:00Z', started: '2026-10-07T00:00:00Z', pending: queue, seen: []}}};
      await writeFile(join(root, 'responses.json'), JSON.stringify(responses));
      await writeFile(join(root, 'previous/state.json'), JSON.stringify(prior));
      await writeFile(join(root, 'previous', pipeline.tableFile), gzipSync(previous));
      await writeFile(join(root, 'requests.ndjson'), '');
      await writeFile(join(root, 'sleeps.ndjson'), '');
      await writeFile(join(root, 'github-output'), '');
      const child = spawnSync(process.execPath, ['--import', join(root, 'mock.mjs'), join(root, 'scripts', pipeline.script)], {
        cwd: root, encoding: 'utf8', timeout: 30_000, env: {...process.env,
          PREVIOUS_DATA: join(root, 'previous'), OVERPASS_URL: 'https://overpass.invalid/test',
          BUDGET_BYTES: '20000000', DAY_BUDGET_BYTES: '30000000',
          MOCK_PATH: join(root, 'responses.json'), MOCK_LOG: join(root, 'requests.ndjson'), MOCK_SLEEPS: join(root, 'sleeps.ndjson'), GITHUB_OUTPUT: join(root, 'github-output')},
      });
      assert.equal(child.status, 0, `${child.error ?? ''}\n${child.stderr}`);
      const saved = JSON.parse(await readFile(join(root, pipeline.folder, 'state.json'), 'utf8'));
      return {saved, attempt: saved.stages.japan.lastAttempt,
        requests: (await readFile(join(root, 'requests.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse),
        sleeps: (await readFile(join(root, 'sleeps.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse),
        table: gunzipSync(await readFile(join(root, pipeline.folder, pipeline.tableFile))).toString(),
        output: await readFile(join(root, 'github-output'), 'utf8')};
    };
    await fn(run, initial);
  } finally {await rm(root, {recursive: true, force: true});}
}

const deferred = (result, initial, bytes, requests) => {
  assert.equal(result.attempt.splitBoxes, 0, 'exhausted allowance is not evidence of an oversized region');
  assert.equal(result.attempt.fetchedBoxes, 0);
  assert.equal(result.attempt.status, 'deferred');
  assert.match(result.attempt.reason, /download budget reached/);
  assert.equal(result.attempt.downloadedBytes, bytes);
  assert.equal(result.requests.length, requests);
  assert.equal(new Set(result.requests.map(item => item.query)).size, 1, 'retries retain the original region');
  assert.deepEqual(result.saved.stages.japan.pending, queue, 'the whole pending queue and split depth stay intact');
  assert.equal(result.table, initial, 'accepted geometry and membership stay intact');
  assert.equal(result.output, 'publish=true\nredeploy=false\n');
};

for (const pipeline of pipelines) {
  for (const status of [429, 502, 503, 504]) {
    test(`${pipeline.name} acquisition: an over-budget HTTP ${status} body never subdivides the region`, async () => fixture(pipeline, async (run, initial) => {
      const result = await run([{status, text: 'Gateway Timeout: server at capacity; request queue is full.', bytes: 20_000_001}]);
      deferred(result, initial, 20_000_001, 1);
      assert.equal(result.saved.runs.at(-1).bytes, 20_000_001, 'failed response bytes still count');
    }));
  }
  test(`${pipeline.name} acquisition: a reduced daily allowance defers without splitting and resumes the same queue`, async () => fixture(pipeline, async (run, initial) => {
    const result = await run([{body, bytes: 10_000_001}], {runs: [{at: new Date().toISOString(), bytes: 20_000_000}]});
    deferred(result, initial, 10_000_001, 1);
    assert.equal(result.saved.runs.reduce((sum, item) => sum + item.bytes, 0), 30_000_001);
    const state = structuredClone(result.saved);
    for (const item of state.runs) item.at = '2000-01-01T00:00:00Z';
    const resumed = await run([{body}, {body}], {state, previous: result.table});
    assert.equal(resumed.requests.length, 2);
    assert.equal(resumed.requests[0].query, result.requests[0].query, 'next eligible run resumes the untouched original box');
    assert.equal(resumed.attempt.splitBoxes, 0); assert.equal(resumed.attempt.fetchedBoxes, 2);
    assert.equal(resumed.saved.stages.japan.pending, null);
    assert.equal(resumed.attempt.status, 'acquired');
  }));
  test(`${pipeline.name} acquisition: earlier failed response bytes do not turn a fitting region into an oversized one`, async () => fixture(pipeline, async (run, initial) => {
    const result = await run([{status: 503, text: 'Service unavailable', bytes: 1_000_000}, {body, bytes: 19_000_001}]);
    deferred(result, initial, 20_000_001, 2);
  }));
  test(`${pipeline.name} acquisition: a successful response exceeding a full run allowance still subdivides`, async () => fixture(pipeline, async run => {
    const result = await run([{body, bytes: 20_000_001}]);
    assert.equal(result.attempt.splitBoxes, 1); assert.equal(result.attempt.fetchedBoxes, 0);
    assert.equal(result.attempt.downloadedBytes, 20_000_001); assert.equal(result.requests.length, 1);
    assert.deepEqual(result.saved.stages.japan.pending, [
      ...quarters(queue[0].box).map(box => ({part: 0, box, depth: 2})), queue[1],
    ]);
  }));
  for (const failedBytes of [0, 1_000_000]) {
    test(`${pipeline.name} acquisition: a complete response ending exactly at the allowance is accepted after ${failedBytes} failed bytes`, async () => fixture(pipeline, async run => {
      const result = await run([
        ...(failedBytes ? [{status: 503, text: 'Service unavailable', bytes: failedBytes}] : []),
        {body, bytes: 20_000_000 - failedBytes},
      ]);
      assert.equal(result.attempt.splitBoxes, 0); assert.equal(result.attempt.fetchedBoxes, 1);
      assert.equal(result.attempt.downloadedBytes, 20_000_000);
      assert.equal(result.requests.length, failedBytes ? 2 : 1);
      assert.equal(result.attempt.status, 'partial');
      assert.deepEqual(result.saved.stages.japan.pending, [queue[1]]);
    }));
  }
  test(`${pipeline.name} acquisition: an oversized response after progress defers the remaining region`, async () => fixture(pipeline, async run => {
    const result = await run([{body}, {body, bytes: 20_000_001}]);
    assert.equal(result.attempt.splitBoxes, 0); assert.equal(result.attempt.fetchedBoxes, 1);
    assert.equal(result.attempt.downloadedBytes, Buffer.byteLength(JSON.stringify(body)) + 20_000_001);
    assert.equal(result.requests.length, 2); assert.equal(result.attempt.status, 'partial');
    assert.deepEqual(result.saved.stages.japan.pending, [queue[1]]);
  }));
}

for (const pipeline of pipelines) {
  for (const status of [429, 500, 502, 503]) {
    test(`${pipeline.name} retry budget: a complete HTTP ${status} error at the full allowance starts no retry`, async () => fixture(pipeline, async (run, initial) => {
      const result = await run([{status, text: 'Service unavailable', bytes: 20_000_000}, {body}]);
      deferred(result, initial, 20_000_000, 1);
      assert.deepEqual(result.sleeps, [0], 'do not wait for a retry that cannot be made');
      assert.equal(result.saved.runs.at(-1).bytes, 20_000_000);
    }));
  }
  test(`${pipeline.name} retry budget: a complete error at the reduced daily allowance starts no retry`, async () => fixture(pipeline, async (run, initial) => {
    const result = await run([{status: 503, text: 'Service unavailable', bytes: 10_000_000}, {body}],
      {runs: [{at: new Date().toISOString(), bytes: 20_000_000}]});
    deferred(result, initial, 10_000_000, 1);
    assert.deepEqual(result.sleeps, [0]);
    assert.equal(result.saved.runs.reduce((sum, item) => sum + item.bytes, 0), 30_000_000);
    const state = structuredClone(result.saved);
    for (const item of state.runs) item.at = '2000-01-01T00:00:00Z';
    const resumed = await run([{body}, {body}], {state, previous: result.table});
    assert.equal(resumed.requests[0].query, result.requests[0].query);
    assert.equal(resumed.requests.length, 2); assert.equal(resumed.attempt.fetchedBoxes, 2);
    assert.equal(resumed.saved.stages.japan.pending, null);
  }));
  test(`${pipeline.name} retry budget: cumulative failed bodies exhaust the allowance before the next sleep or request`, async () => fixture(pipeline, async (run, initial) => {
    const result = await run([
      {status: 503, text: 'Service unavailable', bytes: 7_000_000},
      {status: 503, text: 'Service unavailable', bytes: 13_000_000}, {body},
    ]);
    deferred(result, initial, 20_000_000, 2);
    assert.deepEqual(result.sleeps, [0, 60000]);
  }));
  test(`${pipeline.name} retry budget: one byte of remaining allowance still permits the existing bounded retry`, async () => fixture(pipeline, async (run, initial) => {
    const result = await run([{status: 503, text: 'Service unavailable', bytes: 19_999_999}, {body}]);
    deferred(result, initial, 19_999_999 + Buffer.byteLength(JSON.stringify(body)), 2);
    assert.deepEqual(result.sleeps, [0, 60000]);
  }));
  test(`${pipeline.name} retry budget: ordinary retries with available bytes still complete both queued boxes`, async () => fixture(pipeline, async run => {
    const result = await run([{status: 503, text: 'Service unavailable', bytes: 1_000_000}, {body}, {body}]);
    assert.equal(result.requests.length, 3); assert.equal(result.attempt.fetchedBoxes, 2);
    assert.equal(result.attempt.splitBoxes, 0); assert.equal(result.attempt.status, 'acquired');
    assert.equal(result.attempt.downloadedBytes, 1_000_000 + 2 * Buffer.byteLength(JSON.stringify(body)));
    assert.deepEqual(result.sleeps, [0, 60000, 15000]);
    assert.equal(result.saved.stages.japan.pending, null);
  }));
}
