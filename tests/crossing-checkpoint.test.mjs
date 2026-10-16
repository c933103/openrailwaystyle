import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as zlib from 'node:zlib';
import vm from 'node:vm';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import * as crossings from '../scripts/crossing-data.mjs';
import * as checkpoints from '../scripts/crossing-checkpoint.mjs';

const source = await fs.readFile(new URL('../scripts/build-crossings.mjs', import.meta.url), 'utf8');
const api = 'https://overpass.fixture.invalid/api/interpreter', parentSnapshot = 'a'.repeat(40);
const identity = await checkpoints.crossingCheckpointIdentity(api, parentSnapshot, 3);
const options = directory => ({directory, source: api, parentSnapshot, tableVersion: 3});
const exec = promisify(execFile);
const roots = crossings.startRegions();
const empty = `1${crossings.SEP}${crossings.SEP}${crossings.SEP}minor\n2${crossings.SEP}${crossings.SEP}${crossings.SEP}end\n`;
const csv = (box, id = 1) => `${id}${crossings.SEP}${(box[0]+box[2])/2}${crossings.SEP}${(box[1]+box[3])/2}${crossings.SEP}level_crossing\n${empty}`;
const observed = () => ({requestStartedAt: new Date().toISOString(), observedAt: new Date().toISOString()});
async function temporary(t) {
  const path = await fs.mkdtemp(join(tmpdir(), 'crossing-checkpoint-test-'));
  t.after(() => fs.rm(path, {recursive: true, force: true}));
  return path;
}
async function state(directory) { return JSON.parse(await fs.readFile(join(directory, 'state.json'))).state; }
async function changeState(directory, change) {
  const envelope = JSON.parse(await fs.readFile(join(directory, 'state.json')));
  await change(envelope.state);
  envelope.sha256 = checkpoints.sha256(JSON.stringify(envelope.state));
  await fs.writeFile(join(directory, 'state.json'), JSON.stringify(envelope));
}
async function leafFixture(directory) {
  const checkpoint = await checkpoints.openCrossingCheckpoint(options(directory));
  await checkpoint.leaf(roots[0].box, crossings.parseCsv(csv(roots[0].box)), observed());
  return checkpoint;
}

// Actual builder, query/parser and disk-backed checkpoint module. The only
// provider is this synchronous fixture. Published output writes are forbidden.
async function run(directory, reply, extraEnv = {}) {
  const calls = [], writes = [], warnings = [];
  const context = vm.createContext({
    process: {env: {OVERPASS_URL: api, CROSSING_CHECKPOINT_DIR: directory, PREVIOUS_SNAPSHOT_ID: parentSnapshot, ...extraEnv}},
    URL, URLSearchParams, Buffer, AbortSignal: {timeout: () => undefined},
    console: {log() {}, warn: (...args) => warnings.push(args.join(' '))},
    setTimeout: callback => callback(),
    fetch: async (url, request) => {
      assert.equal(url, api);
      const query = request.body.get('data'); calls.push(query);
      assert.ok(calls.length <= 60);
      return reply(query, calls.length);
    },
  });
  const dependencies = {
    'node:fs/promises': {...fs, ...Object.fromEntries(['rm', 'mkdir', 'writeFile'].map(name => [name, async (...args) => {
      writes.push({name, args}); throw new Error(`Unexpected published output ${name}`);
    }]))},
    'node:zlib': zlib, './crossing-data.mjs': crossings, './crossing-checkpoint.mjs': checkpoints,
  };
  const module = new vm.SourceTextModule(source, {context, initializeImportMeta: meta => { meta.url = 'file:///fixture/scripts/build-crossings.mjs'; }});
  await module.link(specifier => {
    const values = dependencies[specifier]; assert.ok(values, specifier);
    return new vm.SyntheticModule(Object.keys(values), function() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, {context});
  });
  let error;
  try { await module.evaluate(); } catch (caught) { error = caught; }
  assert.deepEqual(writes, [], 'failure must not modify the served snapshot');
  return {calls, error, warnings};
}

test('ordinary failure saves parsed and empty leaves; resume fetches only unresolved regions', async t => {
  const dir = await temporary(t);
  const first = await run(dir, (_query, n) => n <= 3 ? new Response(n === 2 ? empty : csv(roots[n-1].box, n)) : new Response('at capacity', {status: 502}));
  assert.match(first.error.message, /stayed unavailable/);
  const before = await state(dir), oldLeaf = await fs.readFile(join(dir, before.nodes[0].payload));
  assert.equal(before.nodes.length, 3);
  assert.deepEqual(before.nodes.map(n => n.rows), [1, 0, 1]);
  const resumed = await run(dir, () => new Response(empty));
  assert.match(resumed.error.message, /Suspiciously few crossings worldwide: 2/);
  assert.deepEqual(resumed.calls, roots.slice(3).map(({box}) => crossings.regionQuery(box)));
  const after = await state(dir);
  assert.equal(after.epoch, before.epoch);
  assert.equal(after.acquisitionStartedAt, before.acquisitionStartedAt);
  assert.equal(after.watermark, before.watermark);
  assert.deepEqual(after.nodes.slice(0, 3), before.nodes);
  assert.deepEqual(await fs.readFile(join(dir, before.nodes[0].payload)), oldLeaf);
  const replay = await run(dir, () => assert.fail('complete cache must make zero provider calls'));
  assert.equal(replay.calls.length, 0);
  assert.match(replay.error.message, /Suspiciously few crossings worldwide: 2/);
});

test('split decisions and empty children survive failure without re-requesting their parent', async t => {
  const dir = await temporary(t), children = crossings.quarters(roots[0].box);
  const first = await run(dir, (_query, n) => n === 1 ? new Response('Query timed out', {status: 504}) : n <= 3 ? new Response(empty) : new Response('at capacity', {status: 502}));
  assert.match(first.error.message, /stayed unavailable/);
  assert.deepEqual((await state(dir)).nodes.map(n => n.kind), ['split', 'leaf', 'leaf']);
  const second = await run(dir, () => new Response(empty));
  assert.deepEqual(second.calls, [...children.slice(2), ...roots.slice(1).map(r => r.box)].map(box => crossings.regionQuery(box)));
  assert.match(second.error.message, /Suspiciously few crossings worldwide: 0/);
});

test('a skipped earlier root or split child is rejected, even with valid payload hashes', async t => {
  for (const split of [false, true]) {
    const dir = await temporary(t), checkpoint = await checkpoints.openCrossingCheckpoint(options(dir));
    const boxes = split ? crossings.quarters(roots[0].box) : roots.slice(0, 2).map(r => r.box);
    if (split) await checkpoint.split(roots[0].box);
    for (const box of boxes.slice(0, 2)) await checkpoint.leaf(box, [], observed());
    await changeState(dir, async s => {
      const [removed] = s.nodes.splice(split ? 1 : 0, 1);
      await fs.rm(join(dir, removed.payload));
    });
    await assert.rejects(checkpoints.loadCrossingCheckpoint(dir, identity), /traversal prefix/);
  }
});

test('a moved-ID hole discards the older generation before fresh observations can be overwritten', async t => {
  const dir = await temporary(t), checkpoint = await checkpoints.openCrossingCheckpoint(options(dir));
  await checkpoint.leaf(roots[0].box, [], observed());
  await checkpoint.leaf(roots[1].box, crossings.parseCsv(csv(roots[1].box, 7)), observed());
  await changeState(dir, async s => {
    const [removed] = s.nodes.splice(0, 1); await fs.rm(join(dir, removed.payload));
  });
  const result = await run(dir, (_query, n) => new Response(n === 1 ? csv(roots[0].box, 7) : empty));
  assert.match(result.error.message, /Suspiciously few crossings worldwide: 1/);
  assert.deepEqual(result.calls, roots.map(({box}) => crossings.regionQuery(box)), 'no old leaf from the holey generation is replayed');
  assert.notEqual((await state(dir)).epoch, checkpoint.epoch);
});

test('cache epoch, original observations and watermark survive the next weekly retry', async t => {
  const dir = await temporary(t), began = Date.now() - 8 * 86400_000;
  const checkpoint = await checkpoints.openCrossingCheckpoint({...options(dir), now: began});
  const original = new Date(began + 1000).toISOString();
  await checkpoint.leaf(roots[0].box, [], {requestStartedAt: original, observedAt: original});
  const resumed = await checkpoints.openCrossingCheckpoint(options(dir));
  assert.equal(resumed.epoch, checkpoint.epoch);
  assert.equal(resumed.watermark, checkpoints.crossingWatermark(began));
  assert.deepEqual(await resumed.get(roots[0].box), {kind: 'leaf', rows: []});
  assert.equal(resumed.summary().observationCompletedAt, original);
  assert.equal(resumed.summary().startedAt, new Date(began).toISOString());
  assert.equal(resumed.summary().resumedLeaves, 1);
});

test('standalone staging retains OpenStreetMap attribution and ODbL license', async t => {
  const dir = await temporary(t); await leafFixture(dir);
  const envelope = JSON.parse(await fs.readFile(join(dir, 'state.json')));
  assert.equal(envelope.license, 'ODbL-1.0');
  assert.equal(envelope.attribution, '© OpenStreetMap contributors');
  assert.equal(envelope.attributionUrl, 'https://www.openstreetmap.org/copyright');
  for (const field of ['license', 'attribution', 'attributionUrl']) {
    const incomplete = {...envelope}; delete incomplete[field];
    await fs.writeFile(join(dir, 'state.json'), JSON.stringify(incomplete));
    await assert.rejects(checkpoints.loadCrossingCheckpoint(dir, identity), /Wrong checkpoint/);
  }
});

for (const [name, mutate] of [
  ['query identity', s => { s.identity.query = 'b'.repeat(64); }],
  ['endpoint', s => { s.identity.source = 'https://other.fixture.invalid'; }],
  ['parser source', s => { s.identity.parser = 'b'.repeat(64); }],
  ['schema', s => { s.identity.schema++; }],
  ['table version', s => { s.identity.tableVersion++; }],
  ['previous published snapshot', s => { s.identity.parentSnapshot = 'b'.repeat(40); }],
  ['leaf query', s => { s.nodes[0].query = 'b'.repeat(64); }],
  ['bbox', s => { s.nodes[0].box = [-90, -180, -89, -179]; s.nodes[0].query = checkpoints.sha256(crossings.regionQuery(s.nodes[0].box)); }],
  ['epoch', s => { s.epoch = '00000000-0000-0000-0000-000000000000'; }],
  ['watermark', s => { s.watermark = '2020-01-01T00:00:00Z'; }],
  ['future observation', s => { s.nodes[0].observedAt = '2099-01-01T00:00:00.000Z'; }],
  ['row count', s => { s.nodes[0].rows++; }],
  ['compressed bound', s => { s.nodes[0].bytes = checkpoints.CHECKPOINT_LIMITS.leafBytes + 1; }],
  ['expanded bound', s => { s.nodes[0].expandedBytes = checkpoints.CHECKPOINT_LIMITS.expandedLeafBytes + 1; }],
]) test(`rejects ${name}, even with a recalculated state hash`, async t => {
  const dir = await temporary(t); await leafFixture(dir); await changeState(dir, mutate);
  await assert.rejects(checkpoints.loadCrossingCheckpoint(dir, identity));
});

test('payload corruption, missing/partial files and incorrect state checksum are rejected', async t => {
  const dir = await temporary(t); await leafFixture(dir);
  const saved = await state(dir), file = join(dir, saved.nodes[0].payload), original = await fs.readFile(file);
  await fs.writeFile(file, Buffer.alloc(original.length));
  await assert.rejects(checkpoints.loadCrossingCheckpoint(dir, identity), /Corrupt checkpoint payload/);
  await fs.rm(file);
  await assert.rejects(checkpoints.loadCrossingCheckpoint(dir, identity), /ENOENT/);
  await fs.writeFile(file, original);
  await fs.writeFile(join(dir, 'state.json.tmp'), '{');
  await assert.rejects(checkpoints.loadCrossingCheckpoint(dir, identity), /Partial/);
  await fs.rm(join(dir, 'state.json.tmp'));
  const envelope = JSON.parse(await fs.readFile(join(dir, 'state.json'))); envelope.state.epoch = 'wrong';
  await fs.writeFile(join(dir, 'state.json'), JSON.stringify(envelope));
  await assert.rejects(checkpoints.loadCrossingCheckpoint(dir, identity), /Corrupt checkpoint state/);
});

test('decompression and parsed-row bounds are independently enforced', async t => {
  const dir = await temporary(t); await leafFixture(dir);
  await changeState(dir, async s => {
    const node = s.nodes[0], oldPath = join(dir, node.payload);
    const payload = JSON.parse(zlib.gunzipSync(await fs.readFile(oldPath)));
    payload.rows[0].lat = 999;
    const expanded = Buffer.from(JSON.stringify(payload)), bytes = zlib.gzipSync(expanded);
    await fs.rm(oldPath);
    node.payloadHash = checkpoints.sha256(bytes); node.payload = `${node.payloadHash}.json.gz`;
    node.bytes = bytes.length; node.expandedBytes = expanded.length;
    await fs.writeFile(join(dir, node.payload), bytes);
  });
  await assert.rejects(checkpoints.loadCrossingCheckpoint(dir, identity), /outside checkpoint bbox/);
  await changeState(dir, s => { s.nodes[0].expandedBytes = 1; });
  await assert.rejects(checkpoints.loadCrossingCheckpoint(dir, identity), /Cannot create a Buffer larger|larger than|output length/i);
});

test('total compressed/decoded bytes and state-file limits are checked before payload reads', async t => {
  const dir = await temporary(t), checkpoint = await checkpoints.openCrossingCheckpoint(options(dir));
  for (const {box} of roots.slice(0, 9)) await checkpoint.leaf(box, [], observed());
  const original = await fs.readFile(join(dir, 'state.json'));
  await changeState(dir, s => { for (const node of s.nodes) node.bytes = checkpoints.CHECKPOINT_LIMITS.leafBytes; });
  await assert.rejects(checkpoints.loadCrossingCheckpoint(dir, identity), /Oversized compressed checkpoint/);
  await fs.writeFile(join(dir, 'state.json'), original);
  await changeState(dir, s => { for (const node of s.nodes) node.expandedBytes = checkpoints.CHECKPOINT_LIMITS.expandedLeafBytes; });
  await assert.rejects(checkpoints.loadCrossingCheckpoint(dir, identity), /Oversized expanded checkpoint/);
  await fs.truncate(join(dir, 'state.json'), checkpoints.CHECKPOINT_LIMITS.stateBytes + 1);
  await assert.rejects(checkpoints.loadCrossingCheckpoint(dir, identity), /Oversized or non-file/);
});

test('stale data and already-published epochs cannot become a fresh acquisition', async t => {
  const dir = await temporary(t); const old = await leafFixture(dir), before = await state(dir);
  await assert.rejects(checkpoints.loadCrossingCheckpoint(dir, identity, Date.parse(before.acquisitionStartedAt) + checkpoints.CHECKPOINT_LIMITS.maxAgeMs + 1), /Stale/);
  const warnings = [];
  const next = await checkpoints.openCrossingCheckpoint({...options(dir), parentSnapshot: 'b'.repeat(40), warn: m => warnings.push(m)});
  assert.notEqual(next.epoch, old.epoch);
  assert.equal(await next.get(roots[0].box), null);
  assert.equal(warnings.length, 1);
  assert.equal((await state(dir)).nodes.length, 0);
});

test('unrecognized staging content is preserved and fails closed', async t => {
  const dir = await temporary(t); await leafFixture(dir);
  await fs.writeFile(join(dir, 'user-notes.txt'), 'retain me');
  await assert.rejects(checkpoints.openCrossingCheckpoint(options(dir)), /unexpected staging content/);
  assert.equal(await fs.readFile(join(dir, 'user-notes.txt'), 'utf8'), 'retain me');
  await fs.rm(join(dir, 'user-notes.txt'));
  const disguised = join(dir, `${'e'.repeat(64)}.json.gz`);
  await fs.writeFile(disguised, 'user data');
  await assert.rejects(checkpoints.openCrossingCheckpoint(options(dir)), /unexpected staging files/);
  assert.equal(await fs.readFile(disguised, 'utf8'), 'user data');
  await fs.rm(disguised);
  await fs.writeFile(join(dir, 'state.json'), JSON.stringify({purpose: 'user data'}));
  await assert.rejects(checkpoints.openCrossingCheckpoint(options(dir)), /unrecognized staging ownership/);
  assert.equal(JSON.parse(await fs.readFile(join(dir, 'state.json'))).purpose, 'user data');
});

test('symlink roots/entries and disguised subdirectories fail closed without deleting user content', async t => {
  const root = await temporary(t), dir = join(root, 'owned'), link = join(root, 'link');
  await leafFixture(dir);
  await fs.symlink(dir, link);
  await assert.rejects(checkpoints.openCrossingCheckpoint(options(link)), /symlink staging root/);
  const disguised = join(dir, `${'f'.repeat(64)}.json.gz`);
  await fs.mkdir(disguised);
  await fs.writeFile(join(disguised, 'user.txt'), 'preserve');
  await assert.rejects(checkpoints.openCrossingCheckpoint(options(dir)), /non-file\/symlink staging entry/);
  assert.equal(await fs.readFile(join(disguised, 'user.txt'), 'utf8'), 'preserve');
  await fs.rm(disguised, {recursive: true});
  const outside = join(root, 'outside'); await fs.writeFile(outside, 'preserve');
  await fs.symlink(outside, join(dir, 'state.json.tmp'));
  await assert.rejects(checkpoints.openCrossingCheckpoint(options(dir)), /symlink staging entry/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'preserve');
});

test('incremental acquisition never reads or writes rebuild staging', async t => {
  const dir = await temporary(t), previous = await temporary(t);
  await fs.writeFile(join(dir, 'user-notes.txt'), 'unrelated');
  const since = '2026-10-01T00:00:00Z';
  await fs.writeFile(join(previous, 'regions.json'), JSON.stringify({version: 3, since, regions: roots.map(r => ({...r, fetched: since}))}));
  await fs.writeFile(join(previous, 'crossings.tsv.gz'), zlib.gzipSync('1\t0\t0\troad\t\n'));
  const result = await run(dir, () => new Response('at capacity', {status: 502}), {PREVIOUS_DATA: previous});
  assert.match(result.error.message, /stayed unavailable/);
  assert.equal(result.calls[0], crossings.regionQuery(roots[0].box, since));
  assert.deepEqual(await fs.readdir(dir), ['user-notes.txt']);
});

test('restore validates flat, bounded blob tree before extraction', () => {
  const line = (name, size = 10, mode = '100644') => `${mode} blob ${'a'.repeat(40)} ${size}\t${name}\n`;
  checkpoints.validateCrossingCheckpointTree(line('state.json') + line(`${'b'.repeat(64)}.json.gz`));
  for (const invalid of [line('user.txt'), line('state.json', 1, '120000'), line('state.json') + line('../outside'), line('state.json', checkpoints.CHECKPOINT_LIMITS.stateBytes + 1), line('state.json') + line(`${'b'.repeat(64)}.json.gz`, checkpoints.CHECKPOINT_LIMITS.leafBytes + 1)]) {
    assert.throws(() => checkpoints.validateCrossingCheckpointTree(invalid));
  }
});

test('workflow failure persistence is isolated, leased and success-only publication remains', async () => {
  const workflow = await fs.readFile(new URL('../.github/workflows/crossings.yml', import.meta.url), 'utf8');
  const preserve = workflow.slice(workflow.indexOf('      - name: Preserve validated'), workflow.indexOf('      - name: Publish complete'));
  assert.match(preserve, /!cancelled\(\).*steps\.update\.outputs\.checkpoint == 'true'.*steps\.update\.outcome == 'failure'/);
  assert.match(preserve, /node scripts\/crossing-checkpoint\.mjs validate/);
  assert.match(preserve, /--force-with-lease="refs\/heads\/crossing-rebuild-work:\$PREVIOUS_CHECKPOINT_SHA"/);
  assert.doesNotMatch(preserve, /HEAD:crossing-data/);
  const publish = workflow.slice(workflow.indexOf('      - name: Publish complete'), workflow.indexOf('      - name: Redeploy'));
  assert.doesNotMatch(publish, /if:|always\(\)|continue-on-error/);
  assert.match(publish, /HEAD:crossing-data/);
  assert.match(workflow, /permissions:\n  contents: write\n  actions: write\n/);
  assert.match(workflow, /scripts\/crossing-checkpoint.mjs tree[\s\S]*git archive FETCH_HEAD/);
  assert.match(workflow, /Restore isolated full-rebuild staging\n        if: steps\.previous\.outputs\.full_rebuild == 'true'/);
});

test('actual previous-table preflight isolates incremental runs from malformed staging', async t => {
  const root = await temporary(t), previous = join(root, 'previous'), output = join(root, 'output');
  const staging = join(root, 'staging'); await fs.mkdir(staging);
  await fs.writeFile(join(staging, 'state.json'), 'malformed unrelated checkpoint');
  const workflow = await fs.readFile(new URL('../.github/workflows/crossings.yml', import.meta.url), 'utf8');
  const step = workflow.slice(workflow.indexOf('      - name: Load the previous table'), workflow.indexOf('      - name: Restore isolated'));
  const script = step.slice(step.indexOf("          node --input-type=module <<'JS'"))
    .split('\n').map(line => line.replace(/^          /, '')).join('\n').replaceAll('/tmp/previous-crossings', previous);
  async function preflight() {
    await fs.rm(output, {force: true});
    await exec('bash', ['-eu', '-c', script], {env: {...process.env, GITHUB_OUTPUT: output, CROSSING_CHECKPOINT_DIR: staging}});
    return fs.readFile(output, 'utf8');
  }
  assert.equal(await preflight(), 'full_rebuild=true\n', 'absent previous needs full acquisition');
  await fs.mkdir(previous);
  await fs.writeFile(join(previous, 'regions.json'), JSON.stringify({version: 3, since: '2026-10-01T00:00:00Z'}));
  await fs.writeFile(join(previous, 'crossings.tsv.gz'), zlib.gzipSync('1\t0\t0\troad\t\n'));
  assert.equal(await preflight(), 'full_rebuild=false\n', 'valid incremental data must skip checkpoint restore');
  assert.equal(await fs.readFile(join(staging, 'state.json'), 'utf8'), 'malformed unrelated checkpoint');
  await fs.writeFile(join(previous, 'crossings.tsv.gz'), 'invalid gzip');
  assert.equal(await preflight(), 'full_rebuild=true\n', 'unreadable previous falls back exactly like the builder');
  await fs.writeFile(join(previous, 'crossings.tsv.gz'), zlib.gzipSync(''));
  await fs.writeFile(join(previous, 'regions.json'), JSON.stringify({version: 2, since: '2026-10-01T00:00:00Z'}));
  assert.equal(await preflight(), 'full_rebuild=true\n');
  await fs.writeFile(join(previous, 'regions.json'), JSON.stringify({version: 3}));
  assert.equal(await preflight(), 'full_rebuild=true\n');
});

test('actual persistence shell saves failure progress only to staging and refuses an unexpected remote update', async t => {
  const root = await temporary(t), directory = join(root, 'staging');
  await leafFixture(directory);
  const workflow = await fs.readFile(new URL('../.github/workflows/crossings.yml', import.meta.url), 'utf8');
  const step = workflow.slice(workflow.indexOf('      - name: Preserve validated'), workflow.indexOf('      - name: Publish complete'));
  const script = step.slice(step.indexOf('        run: |\n') + '        run: |\n'.length).split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const remote = join(root, 'remote.git');
  await exec('git', ['init', '--bare', '-q', remote]);
  const env = {...process.env, OVERPASS_URL: api, CROSSING_CHECKPOINT_DIR: directory, PREVIOUS_SNAPSHOT_ID: parentSnapshot,
    PREVIOUS_CHECKPOINT_SHA: '', GITHUB_SERVER_URL: root, GITHUB_REPOSITORY: 'remote', GITHUB_WORKSPACE: process.cwd()};
  const firstDir = join(root, 'publish-first');
  await exec('bash', ['-eu', '-o', 'pipefail', '-c', script.replaceAll('/tmp/crossing-checkpoint-publish', firstDir)], {env});
  const {stdout: refs} = await exec('git', ['--git-dir', remote, 'show-ref']);
  assert.match(refs, /refs\/heads\/crossing-rebuild-work/);
  assert.doesNotMatch(refs, /refs\/heads\/crossing-data/);
  const old = refs.trim().split(' ')[0];
  await exec('git', ['-C', firstDir, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'Concurrent user update']);
  await exec('git', ['-C', firstDir, 'push', 'origin', 'HEAD:crossing-rebuild-work']);
  const {stdout: changed} = await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/crossing-rebuild-work']);
  await assert.rejects(exec('bash', ['-eu', '-o', 'pipefail', '-c', script.replaceAll('/tmp/crossing-checkpoint-publish', join(root, 'publish-second'))], {env: {...env, PREVIOUS_CHECKPOINT_SHA: old}}));
  const {stdout: after} = await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/crossing-rebuild-work']);
  assert.equal(after, changed, 'a stale lease cannot erase a concurrent user update');
});
