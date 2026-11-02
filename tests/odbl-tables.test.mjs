import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {TABLES, RELEASE, releaseUrl, readTable, stage, changed} from '../scripts/odbl-tables.mjs';

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

test('the site links the tables in the release and does not deploy them', () => {
  const html = readFileSync(new URL('../styles/index.html', import.meta.url), 'utf8');
  for (const file of ['lifecycle.geojson.gz', 'crossings.tsv.gz']) assert.ok(html.includes(`href="${releaseUrl('c933103/openrailwaystyle', file)}"`), file);
  assert.ok(html.includes(`href="https://github.com/c933103/openrailwaystyle/releases/tag/${RELEASE}"`));
  // Small extracts (street running, escalators, aerialways) stay with the site.
  for (const {file} of TABLES) assert.ok(![...html.matchAll(/href="(data\/[^"]*)"/g)].some(m => m[1].endsWith(file)), file);
  const site = readFileSync(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(site, /> styles\/data\/lifecycle\.geojson\.gz/);
  const removal = site.indexOf('rm -f styles/data/level-crossings/crossings.tsv.gz styles/data/branch-lines/branch-lines.ndjson.gz styles/data/service-routes/service-routes.ndjson.gz');
  assert.ok(removal > site.indexOf('node scripts/rebuild-service-frequency.mjs'), 'removed after the service-frequency step reads the table');
  assert.ok(removal < site.indexOf('node scripts/check-site-size.mjs styles'), 'removed before the size check and upload');
});

test('odbl-tables.yml follows every workflow that publishes a table and uploads the manifest last', () => {
  const workflow = readFileSync(new URL('../.github/workflows/odbl-tables.yml', import.meta.url), 'utf8');
  for (const name of ['snapshot', 'crossings', 'branch-lines', 'service-routes']) {
    const title = readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8').match(/^name: (.+)$/m)[1];
    assert.ok(workflow.includes(`      - ${title}\n`), title);
  }
  assert.ok(workflow.indexOf('gh release upload odbl-tables "/tmp/odbl/$file" --clobber') < workflow.indexOf('gh release upload odbl-tables /tmp/odbl/odbl-tables.json --clobber'));
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
});
