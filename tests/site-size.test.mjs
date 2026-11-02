import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, truncate, symlink, readFile, rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {measureSite, siteSizeVerdict, WARN_BYTES, LIMIT_BYTES} from '../scripts/check-site-size.mjs';

const script = new URL('../scripts/check-site-size.mjs', import.meta.url).pathname;
const MiB = 1024 * 1024;

// A fixture site. Large files are sparse (truncate), so a 901 MiB site costs
// no disk.
async function site(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'site-size-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const [path, size] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), {recursive: true});
    await writeFile(join(root, path), '');
    await truncate(join(root, path), size);
  }
  return root;
}
async function run(t, root) {
  const summary = join(root, '..', `${root.split('/').pop()}-summary.md`);
  t.after(() => rm(summary, {force: true}));
  const result = await promisify(execFile)(process.execPath, [script, root], {env: {...process.env, GITHUB_STEP_SUMMARY: summary}})
    .catch(error => error);
  return {code: result.code ?? 0, stdout: String(result.stdout), summary: await readFile(summary, 'utf8').catch(() => '')};
}

test('the breakdown lists each data directory, then the rest of the site, and skips hidden entries', async t => {
  const root = await site(t, {
    'index.html': 1000, 'app.js': 2000,
    'data/power/a.geojson.gz': 3 * MiB, 'data/power/b.geojson.gz': MiB,
    'data/stations/s.json': 5 * MiB,
    '.git/objects/x': 50 * MiB, 'data/.cache/y': 50 * MiB, 'data/power/.partial': 50 * MiB,
  });
  await symlink('/', join(root, 'data', 'link'));
  const {total, rows} = await measureSite(root);
  assert.deepEqual(rows.map(row => [row.name, row.files]), [['data/stations', 1], ['data/power', 2], ['data/link', 1], ['rest of the site', 2]]);
  assert.equal(rows.find(row => row.name === 'data/link').bytes, 1, 'a link counts as itself, not its target');
  assert.equal(total, 9 * MiB + 3001);
});

test('the verdict passes, warns and fails at the documented levels', () => {
  assert.equal(siteSizeVerdict(WARN_BYTES), 'pass');
  assert.equal(siteSizeVerdict(WARN_BYTES + 1), 'warn');
  assert.equal(siteSizeVerdict(LIMIT_BYTES), 'warn');
  assert.equal(siteSizeVerdict(LIMIT_BYTES + 1), 'fail');
  assert.ok(LIMIT_BYTES < 1e9, 'the failure level stays under GitHub Pages\' 1 GB');
});

test('the command passes a small site and writes its table to the step summary', async t => {
  const result = await run(t, await site(t, {'index.html': 100, 'data/rail/r.pbf': 10 * MiB}));
  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /::(warning|error)::/);
  assert.match(result.summary, /^Site size: 10\.0 MiB/);
  assert.match(result.summary, /\| data\/rail \| 10\.0 \| 1 \|/);
});

test('the command warns above 750 MiB without failing', async t => {
  const result = await run(t, await site(t, {'data/big/a.bin': 760 * MiB}));
  assert.equal(result.code, 0);
  assert.match(result.stdout, /::warning::The site is 760\.0 MiB/);
});

test('the command fails above 900 MiB', async t => {
  const result = await run(t, await site(t, {'data/big/a.bin': 600 * MiB, 'data/other/b.bin': 301 * MiB}));
  assert.equal(result.code, 1);
  assert.match(result.stdout, /::error::The site is 901\.0 MiB/);
  assert.match(result.summary, /\| data\/big \| 600\.0 \| 1 \|\n\| data\/other \| 301\.0 \| 1 \|/);
});

test('the command fails on a missing site directory', async t => {
  const root = await site(t, {});
  assert.notEqual((await run(t, join(root, 'missing'))).code, 0);
});

test('site.yml checks the size of the assembled site before uploading it', () => {
  const workflow = readFileSync(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  const check = workflow.indexOf('node scripts/check-site-size.mjs styles');
  const upload = workflow.indexOf('name: railway-world-site\n          path: styles');
  assert.ok(check > 0 && upload > check, 'the check runs before the site artifact is saved');
});
