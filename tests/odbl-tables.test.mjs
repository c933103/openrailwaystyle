import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile, chmod, mkdir, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {TABLES, RELEASE, releaseUrl, readTable, stage, changed, describe, publish, currentGeneration, latestManifest, pinSite, githubClient, validateManifest} from '../scripts/odbl-tables.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function dir(t) { const d = await mkdtemp(join(tmpdir(), 'odbl-')); t.after(() => rm(d, {recursive: true, force: true})); return d; }

// A fake git: branches map to {commit, files}.
function fakeGit(branches) {
  let head;
  return (args) => {
    const [command, ...rest] = args;
    if (command === 'ls-remote') { const branch = rest.at(-1); if (!branches[branch]) throw Object.assign(new Error('no branch'), {status: 2}); return ''; }
    if (command === 'fetch') { head = branches[rest.at(-1)]; return ''; }
    if (command === 'rev-parse') return `${head.commit}\n`;
    if (command === 'ls-tree') return Object.keys(head.files).join('\n') + '\n';
    if (command === 'show') return head.files[rest[0].replace('FETCH_HEAD:', '')];
    throw new Error(`unexpected git ${command}`);
  };
}

test('a table split into parts on its branch is joined in order', () => {
  const whole = Buffer.from(Array.from({length: 300}, (_, i) => i % 251));
  const git = fakeGit({'rail-data': {commit: 'c1', files: {'lifecycle.geojson.gz.part-001': whole.subarray(100), 'lifecycle.geojson.gz.part-000': whole.subarray(0, 100), 'manifest.json': Buffer.from('{}')}}});
  assert.deepEqual(readTable(TABLES[0], git), {bytes: whole, commit: 'c1'});
});

test('a missing branch is skipped, another git failure stops the run', () => {
  assert.equal(readTable(TABLES[1], fakeGit({})), null);
  assert.throws(() => readTable(TABLES[1], () => { throw Object.assign(new Error('network'), {status: 128}); }), /network/);
  assert.throws(() => readTable(TABLES[1], fakeGit({'crossing-data': {commit: 'c', files: {'index.json': Buffer.from('{}')}}})), /crossing-data has no crossings.tsv.gz/);
});

test('staging writes each table and a manifest, and only changed tables are uploaded', async t => {
  const out = await dir(t);
  const bytes = Object.fromEntries(TABLES.map(table => [table.file, gzipSync(table.file)]));
  const read = table => ({bytes: bytes[table.file], commit: `commit-${table.branch}`});
  const first = await stage(out, null, {read, now: () => new Date('2026-11-02T00:00:00Z')});
  assert.deepEqual(first.upload, TABLES.map(table => table.file));
  const manifest = JSON.parse(await readFile(join(out, 'odbl-tables.json'), 'utf8'));
  assert.equal(manifest.license, 'ODbL-1.0');
  assert.deepEqual(manifest.tables.map(e => [e.file, e.sha256, e.bytes, e.branch]), TABLES.map(table => [table.file, sha(bytes[table.file]), bytes[table.file].length, table.branch]));
  assert.deepEqual(await readFile(join(out, 'crossings.tsv.gz')), bytes['crossings.tsv.gz']);
  bytes['crossings.tsv.gz'] = gzipSync('changed');
  const second = await stage(await dir(t), manifest, {read});
  assert.deepEqual(second.upload, ['crossings.tsv.gz']);
});

test('a broken table is never staged, and a table whose branch is gone keeps its release entry', async t => {
  await assert.rejects(stage(await dir(t), null, {read: () => ({bytes: Buffer.from('not gzip'), commit: 'c'})}));
  const previous = {tables: [{file: 'crossings.tsv.gz', sha256: 'old', bytes: 1, branch: 'crossing-data', commit: 'c0'}]};
  const read = table => table.file === 'crossings.tsv.gz' ? null : {bytes: gzipSync(table.file), commit: 'c'};
  const {manifest, upload} = await stage(await dir(t), previous, {read});
  assert.ok(!upload.includes('crossings.tsv.gz'));
  assert.deepEqual(manifest.tables.find(e => e.file === 'crossings.tsv.gz'), previous.tables[0]);
  assert.deepEqual(changed([{file: 'a', sha256: '1'}], {tables: [{file: 'a', sha256: '1'}]}), []);
});

// The same production publisher/reader used by the workflow, against synthetic
// release bytes and metadata. No live failure experiment or provider requests.
function releaseFixture() {
  let id = 0;
  const assets = [], files = new Map(), calls = [];
  const fixture = {assets, files, calls, fail: null, afterUpload: null};
  fixture.add = (name, bytes, extra = {}) => {
    bytes = Buffer.from(bytes);
    const asset = {id: ++id, name, state: 'uploaded', size: bytes.length, digest: `sha256:${sha(bytes)}`, ...extra};
    assets.push(asset); files.set(name, bytes); return asset;
  };
  fixture.client = {
    list: async () => assets.map(asset => ({...asset})),
    download: async name => { calls.push(['download', name]); return files.get(name); },
    removeStarter: async assetId => {
      const asset = assets.find(a => a.id === assetId);
      assert.equal(asset.state, 'starter'); assert.equal(asset.size, 0);
      calls.push(['delete-starter', asset.name]);
      assets.splice(assets.indexOf(asset), 1); files.delete(asset.name);
    },
    upload: async path => {
      const name = path.split('/').at(-1), bytes = await readFile(path);
      calls.push(['upload', name]);
      assert.ok(!assets.some(asset => asset.name === name), 'no duplicate or clobber');
      const failure = fixture.fail?.(name);
      if (failure === 'before') throw new Error('upload failed');
      if (failure === 'starter') {
        fixture.add(name, '', {state: 'starter', digest: null});
        throw new Error('upload left starter');
      }
      const asset = fixture.add(name, bytes);
      if (failure === 'digest') asset.digest = `sha256:${'0'.repeat(64)}`;
      if (failure === 'response-lost') throw new Error('response lost');
      await fixture.afterUpload?.(name);
    },
  };
  return fixture;
}
const sampleRead = (version = 1, missing = '') => table => table.file === missing ? null :
  {bytes: gzipSync(`${table.file} v${version}`), commit: String(version).repeat(40)};
const options = version => ({read: sampleRead(version), now: () => new Date(`2026-11-0${version}T00:00:00Z`)});
const sourceHtml = () => readFileSync(new URL('../styles/index.html', import.meta.url), 'utf8');
const isManifest = name => name.endsWith('-odbl-tables.json');

test('publication uploads immutable tables then manifest, and no-op runs do not accumulate assets', async t => {
  const f = releaseFixture(), out = await dir(t);
  const first = await publish(out, f.client, options(1));
  assert.equal(f.assets.length, 5);
  assert.deepEqual(f.calls.filter(c => c[0] === 'upload').map(c => c[1]), [...first.manifest.tables.map(e => e.asset), first.pointer]);
  assert.equal((await publish(out, f.client, options(1))).pointer, first.pointer);
  assert.equal(f.assets.length, 5);
  assert.deepEqual(JSON.parse(await readFile(join(out, 'odbl-tables.json'))), first.manifest, 'no-op summary uses committed provenance');
  const old = new Map(f.files);
  const second = await publish(out, f.client, options(2));
  assert.notEqual(second.pointer, first.pointer);
  for (const [name, bytes] of old) assert.deepEqual(f.files.get(name), bytes, 'all previous download URLs retain their bytes');
  assert.equal(f.calls.some(c => c[0].startsWith('delete')), false);
});

test('failed table or manifest publication keeps the previous committed generation and recovers on rerun', async t => {
  for (const failManifest of [false, true]) {
    const f = releaseFixture(), out = await dir(t);
    const first = await publish(out, f.client, options(1));
    const previousBytes = new Map(f.files);
    f.fail = name => isManifest(name) === failManifest ? 'before' : null;
    await assert.rejects(publish(out, f.client, options(2)), /upload failed/);
    assert.equal((await currentGeneration(f.client)).pointer, first.pointer);
    for (const [name, bytes] of previousBytes) assert.deepEqual(f.files.get(name), bytes);
    f.fail = null;
    const second = await publish(out, f.client, options(2));
    assert.notEqual(second.pointer, first.pointer);
    assert.equal((await currentGeneration(f.client)).pointer, second.pointer);
  }
});

test('interrupted manifest upload is not a commit; retry removes only its zero-byte starter', async t => {
  const f = releaseFixture(), out = await dir(t);
  const first = await publish(out, f.client, options(1));
  f.fail = name => isManifest(name) ? 'starter' : null;
  await assert.rejects(publish(out, f.client, options(2)), /starter/);
  assert.equal((await currentGeneration(f.client)).pointer, first.pointer);
  const uploadedBefore = f.calls.filter(c => c[0] === 'upload').length;
  f.fail = null;
  const second = await publish(out, f.client, options(2));
  assert.notEqual(second.pointer, first.pointer);
  assert.equal(f.calls.filter(c => c[0] === 'upload').length, uploadedBefore + 1, 'reuse already verified tables');
  assert.deepEqual(f.calls.filter(c => c[0] === 'delete-starter'), [['delete-starter', second.pointer]]);
  assert.ok(f.files.has(first.pointer));
});

test('lost upload response reconciles verified bytes instead of replacing them', async t => {
  const f = releaseFixture(); f.fail = () => 'response-lost';
  const generation = await publish(await dir(t), f.client, options(1));
  assert.equal(f.assets.length, 5);
  assert.equal((await currentGeneration(f.client)).pointer, generation.pointer);
  assert.equal(f.calls.filter(c => c[0] === 'upload').length, 5);
});

test('an invalid upload digest never commits a new manifest or deletes previous data', async t => {
  const f = releaseFixture(), out = await dir(t);
  const first = await publish(out, f.client, options(1));
  f.fail = name => !isManifest(name) ? 'digest' : null;
  await assert.rejects(publish(out, f.client, options(2)), /not verified/);
  assert.equal((await currentGeneration(f.client)).pointer, first.pointer);
  assert.equal(f.assets.filter(a => isManifest(a.name)).length, 1);
  await assert.rejects(publish(out, f.client, options(2)), /not verified/);
  assert.equal(f.calls.some(c => c[0].startsWith('delete')), false);
});

test('initial publication requires all four tables; a missing branch later retains its verified table', async t => {
  const f = releaseFixture(), out = await dir(t);
  await assert.rejects(publish(out, f.client, {read: sampleRead(1, TABLES[0].file)}), /Incomplete/);
  assert.equal(f.assets.length, 0);
  const first = await publish(out, f.client, options(1));
  const second = await publish(out, f.client, {read: sampleRead(2, TABLES[0].file)});
  assert.deepEqual(second.manifest.tables[0], first.manifest.tables[0]);
  assert.notEqual(second.pointer, first.pointer);
});

test('a competing committed generation detected during upload stops this publisher', async t => {
  const f = releaseFixture(), out = await dir(t);
  await publish(out, f.client, options(1));
  let competing;
  f.afterUpload = async name => {
    if (isManifest(name)) return;
    f.afterUpload = null;
    competing = await publish(await dir(t), f.client, options(3));
  };
  await assert.rejects(publish(out, f.client, options(2)), /generation changed/);
  assert.equal((await currentGeneration(f.client)).pointer, competing.pointer);
});

test('the initial cutover pins source-bound immutable links for the actual repository', async t => {
  const f = releaseFixture(), out = await dir(t), path = join(out, 'index.html');
  const generation = await publish(out, f.client, options(1));
  await writeFile(path, sourceHtml());
  await pinSite(path, f.client, 'fork/atlas');
  const html = await readFile(path, 'utf8');
  for (const file of ['lifecycle.geojson.gz', 'crossings.tsv.gz'])
    assert.ok(html.includes(`href="${releaseUrl('fork/atlas', generation.manifest.tables.find(e => e.file === file).asset)}"`));
  assert.ok(html.includes(`href="${releaseUrl('fork/atlas', generation.pointer)}"`));
  assert.ok(html.includes('© OpenStreetMap contributors, ODbL'));
  const pinned = html;
  f.fail = name => isManifest(name) ? 'before' : null;
  await assert.rejects(publish(out, f.client, options(2)), /upload failed/);
  await pinSite(path, f.client, 'fork/atlas');
  assert.equal(await readFile(path, 'utf8'), pinned, 'failed replacement retains usable published URLs');
});

test('absent release, absent/partial generation, malformed newest manifest and unavailable bytes fail the cutover without modifying HTML', async t => {
  const out = await dir(t), path = join(out, 'index.html');
  for (const failure of ['release', 'empty', 'starter', 'corrupt', 'missing-table', 'download', 'oversize', 'wrong-hash-name']) {
    const f = releaseFixture();
    if (!['release', 'empty', 'starter'].includes(failure)) await publish(out, f.client, options(1));
    if (failure === 'release') f.client.list = () => { throw new Error('HTTP 404'); };
    if (failure === 'starter') f.add(`${'0'.repeat(64)}-odbl-tables.json`, '', {state: 'starter'});
    if (failure === 'corrupt') { const bytes = Buffer.from('{}'); f.add(`${sha(bytes)}-odbl-tables.json`, bytes); }
    if (failure === 'missing-table') f.assets.splice(0, 1);
    if (failure === 'download') f.client.download = () => { throw new Error('download failed'); };
    if (failure === 'oversize') latestManifest(f.assets).size = 65537;
    if (failure === 'wrong-hash-name') { const bytes = Buffer.from('{}'); f.add(`${'0'.repeat(64)}-odbl-tables.json`, bytes); }
    await writeFile(path, sourceHtml());
    await assert.rejects(pinSite(path, f.client, 'o/r'), undefined, failure);
    assert.equal(await readFile(path, 'utf8'), sourceHtml(), failure);
  }
});

test('missing digest, wrong size, duplicate asset, incomplete manifest, and duplicate links fail closed', async t => {
  const out = await dir(t), path = join(out, 'index.html');
  for (const failure of ['digest', 'size', 'duplicate-asset', 'incomplete', 'duplicate-link']) {
    const f = releaseFixture();
    const first = await publish(out, f.client, options(1));
    if (failure === 'digest') delete f.assets[0].digest;
    if (failure === 'size') f.assets[0].size++;
    if (failure === 'duplicate-asset') f.assets.push({...f.assets[0], id: 999});
    if (failure === 'incomplete') {
      const bytes = Buffer.from(JSON.stringify({...first.manifest, tables: first.manifest.tables.slice(1)}));
      f.add(`${sha(bytes)}-odbl-tables.json`, bytes);
    }
    const html = sourceHtml() + (failure === 'duplicate-link' ? '<a data-odbl-table="crossings.tsv.gz" href="duplicate">x</a>' : '');
    await writeFile(path, html);
    await assert.rejects(pinSite(path, f.client, 'o/r'), undefined, failure);
    assert.equal(await readFile(path, 'utf8'), html);
  }
});

test('manifest schema binds exactly the known files, branches, bytes, source commits and hash-named assets', () => {
  const manifest = {schema: 2, release: RELEASE, license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors',
    tables: TABLES.map(table => describe(table, sampleRead(1)(table)))};
  assert.equal(validateManifest(manifest), manifest);
  for (const override of [{file: 'unexpected'}, {branch: 'other'}, {bytes: 0}, {commit: 'not-a-sha'}, {sha256: 'bad'}, {asset: '../other'}]) {
    const broken = structuredClone(manifest); Object.assign(broken.tables[0], override);
    assert.throws(() => validateManifest(broken), /Invalid manifest/);
  }
});

test('GitHub client paginates assets and refuses draft or prerelease metadata', async () => {
  const calls = [];
  const run = args => {
    calls.push(args);
    if (args[1].endsWith('/tags/odbl-tables')) return JSON.stringify({id: 42, draft: false, prerelease: false});
    assert.deepEqual(args, ['api', 'repos/o/r/releases/42/assets?per_page=100', '--paginate', '--slurp']);
    return JSON.stringify([[{id: 1, name: 'old'}], [{id: 101, name: 'new'}]]);
  };
  assert.deepEqual(await githubClient('o/r', '/unused', run).list(), [{id: 1, name: 'old'}, {id: 101, name: 'new'}]);
  assert.equal(calls.length, 2);
  for (const flag of ['draft', 'prerelease'])
    assert.throws(() => githubClient('o/r', '/unused', () => JSON.stringify({id: 42, [flag]: true})).list(), /not public and stable/);
});

test('workflow gate precedes removal and Pages upload without weakening existing browser prerequisites', () => {
  const site = readFileSync(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(site, /> styles\/data\/lifecycle\.geojson\.gz/);
  const removal = site.indexOf('rm -f styles/data/level-crossings/crossings.tsv.gz styles/data/branch-lines/branch-lines.ndjson.gz\n');
  assert.ok(removal > 0 && removal < site.indexOf('node scripts/check-site-size.mjs styles'));
  const deploy = site.slice(site.indexOf('\n  deploy:'));
  const gate = deploy.indexOf('node scripts/odbl-tables.mjs pin styles/index.html');
  assert.ok(deploy.indexOf('actions/checkout@v4') < gate);
  assert.ok(deploy.indexOf('Verify Node 26 security baseline') < gate);
  const serviceRemoval = deploy.indexOf('rm -f styles/data/service-routes/service-routes.ndjson.gz');
  assert.ok(gate > 0 && gate < serviceRemoval && serviceRemoval < deploy.indexOf('actions/upload-pages-artifact'));
  assert.match(deploy, /needs: \[validate, browser-checks\]/);
  assert.doesNotMatch(deploy.slice(0, serviceRemoval), /continue-on-error/);
  assert.ok(!site.slice(0, site.indexOf('\n  deploy:')).includes('rm -f styles/data/service-routes/service-routes.ndjson.gz'));
});

test('publisher retains original triggers and serialization, with no mutable asset replacement', () => {
  const workflow = readFileSync(new URL('../.github/workflows/odbl-tables.yml', import.meta.url), 'utf8');
  for (const name of ['snapshot', 'crossings', 'branch-lines', 'service-routes']) {
    const title = readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8').match(/^name: (.+)$/m)[1];
    assert.ok(workflow.includes(`      - ${title}\n`), title);
  }
  assert.match(workflow, /group: odbl-tables\n  cancel-in-progress: false/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /node scripts\/odbl-tables\.mjs publish/);
  assert.doesNotMatch(workflow, /-X PATCH|replace\(\)|upload .*--clobber/);
  const html = sourceHtml();
  for (const file of ['lifecycle.geojson.gz', 'crossings.tsv.gz']) assert.ok(html.includes(`data-odbl-table="${file}"`));
  assert.ok(html.includes('data-odbl-manifest'));
});

// Exercise the real workflow gate command, not just its imported helpers.
test('the deploy shell cannot remove the last local table or reach upload after a failed CLI gate', async t => {
  const out = await dir(t), bin = join(out, 'bin'), html = join(out, 'index.html');
  const table = join(out, 'service-routes.ndjson.gz'), reached = join(out, 'upload-reached');
  await mkdir(bin);
  const f = releaseFixture();
  const generation = await publish(out, f.client, options(1));
  await writeFile(join(out, 'release.json'), JSON.stringify(f.assets));
  await writeFile(join(out, 'manifest.json'), f.files.get(generation.pointer));
  await writeFile(join(bin, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2), root = process.env.ODBL_FIXTURE;
fs.appendFileSync(root + '/calls.jsonl', JSON.stringify(args) + '\\n');
if (process.env.FAIL_RELEASE) process.exit(1);
if (args[0] === 'api' && args[1].endsWith('/tags/odbl-tables')) {
  console.log(JSON.stringify({id: 42, draft: false, prerelease: false}));
} else if (args[0] === 'api' && args[1].includes('/releases/42/assets?per_page=100')) {
  if (!args.includes('--paginate') || !args.includes('--slurp')) process.exit(2);
  console.log(JSON.stringify([JSON.parse(fs.readFileSync(root + '/release.json'))]));
} else if (args[0] === 'release' && args[1] === 'download') {
  fs.copyFileSync(root + '/manifest.json', args[args.indexOf('--output') + 1]);
} else process.exit(2);
`);
  await chmod(join(bin, 'gh'), 0o755);
  const script = new URL('../scripts/odbl-tables.mjs', import.meta.url).pathname;
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(script)} pin ${JSON.stringify(html)} ${JSON.stringify(out)}\nrm ${JSON.stringify(table)}\ntouch ${JSON.stringify(reached)}`;
  const env = {...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r', ODBL_FIXTURE: out};
  await writeFile(html, sourceHtml()); await writeFile(table, 'previous local table');
  assert.throws(() => execFileSync('bash', ['-eu', '-c', command], {env: {...env, FAIL_RELEASE: '1'}, stdio: 'pipe'}));
  assert.equal(await readFile(html, 'utf8'), sourceHtml());
  assert.equal(await readFile(table, 'utf8'), 'previous local table');
  await assert.rejects(access(reached));
  execFileSync('bash', ['-eu', '-c', command], {env, stdio: 'pipe'});
  await access(reached); await assert.rejects(access(table));
  assert.ok((await readFile(html, 'utf8')).includes(releaseUrl('o/r', generation.pointer)));
  const calls = (await readFile(join(out, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.every(args => args[0] === 'api' || (args[0] === 'release' && args[1] === 'download')), 'deploy gate is read-only');
});
