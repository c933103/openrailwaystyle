import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, mkdtemp, rm, utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

const workflow = await readFile(new URL('../.github/workflows/snapshot.yml', import.meta.url), 'utf8');
const step = name => {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `Missing step: ${name}`);
  return workflow.slice(start, workflow.indexOf('\n      - ', start + 1));
};
const restore = step('Restore raw Overpass responses from the release');
const save = step('Store raw Overpass responses in the release');
const eligible = (merged, assembled) => {
  const condition = save.match(/^        if: (.+)$/m)?.[1];
  assert.ok(condition, 'durable preservation must explicitly survive failure');
  return vm.runInNewContext(condition, {always: () => true, steps: {
    restore_raw: {outputs: {merged}}, assemble: {outcome: assembled},
  }});
};

test('failed acquisition preserves durable work only after merging its prior release', () => {
  assert.match(restore, /id: restore_raw/);
  assert.match(step('Assemble complete worldwide archive'), /id: assemble/);
  assert.equal(eligible('true', 'skipped'), true);
  assert.equal(eligible('true', 'failure'), true);
  assert.equal(eligible('true', 'cancelled'), true);
  for (const merged of [undefined, '', 'false']) {
    for (const outcome of ['skipped', 'failure', 'cancelled']) assert.equal(eligible(merged, outcome), false);
    assert.equal(eligible(merged, 'success'), true, 'a complete first build can bootstrap its archive');
  }
  assert.match(workflow, /key: lifecycle-initial-20260922-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/,
    're-running a failed job cannot collide with its immutable prior Actions cache');
  for (const name of ['Publish validated snapshot branch', 'Redeploy the site with the new snapshot']) {
    assert.doesNotMatch(step(name), /always\(\)|failure\(\)|continue-on-error/);
  }
  assert.doesNotMatch(workflow, /^  (?:push|schedule|pull_request):/m, 'no new acquisition trigger');
});

async function fixture(t, {download = true, corrupt = false} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'atlas-snapshot-workflow-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const dir of ['bin', 'tmp', 'prior/.snapshot-cache', '.snapshot-cache', 'unpacked']) await mkdir(join(root, dir), {recursive: true});
  await writeFile(join(root, 'prior/.snapshot-cache/older.json'), 'prior-region');
  await writeFile(join(root, 'prior/.snapshot-cache/shared.json'), 'prior-shared');
  await utimes(join(root, 'prior/.snapshot-cache/shared.json'), 10, 10);
  await writeFile(join(root, '.snapshot-cache/shared.json'), 'newer-shared');
  await writeFile(join(root, '.snapshot-cache/partial.json.previous'), 'preserved-before-redownload');
  await writeFile(join(root, '.snapshot-cache/delta.json'), '{"changes":[37]}');
  await writeFile(join(root, '.snapshot-cache/budget-123.json'), '{"bytes":142935}');
  const archive = join(root, 'prior.tar.zst');
  assert.equal(spawnSync('tar', ['--zstd', '-cf', archive, '-C', join(root, 'prior'), '.snapshot-cache']).status, 0);
  if (corrupt) await writeFile(archive, 'not an archive');
  const output = join(root, 'output');
  await writeFile(output, '');
  await writeFile(join(root, 'bin/gh'), `#!/bin/bash\nset -eu\nprintf '%s\\n' "$*" >> "$FIXTURE_ROOT/gh-calls"\ncase "$1 $2" in\n  'release download') test "$FIXTURE_DOWNLOAD" = true; cp "$FIXTURE_ROOT/prior.tar.zst" "$FIXTURE_ROOT/tmp/overpass-cache.tar.zst" ;;\n  'release view') exit 0 ;;\n  'release upload') cp "$4" "$FIXTURE_ROOT/upload.tar.zst" ;;\n  *) echo 'Unexpected network command' >&2; exit 91 ;;\nesac\n`, {mode: 0o755});
  const run = block => {
    const command = block.split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n')
      .replaceAll('/tmp/', `${root}/tmp/`).replaceAll('--dir /tmp', `--dir ${root}/tmp`);
    return spawnSync('bash', ['-e', '-c', command], {cwd: root, env: {...process.env,
      PATH: `${root}/bin:${process.env.PATH}`, GITHUB_OUTPUT: output, GITHUB_SHA: 'fixture',
      FIXTURE_ROOT: root, FIXTURE_DOWNLOAD: String(download)}, encoding: 'utf8'});
  };
  return {root, run, output};
}

test('real restore and save shells retain newer, previous, delta and unrelated regions after failure', async t => {
  const {root, run, output} = await fixture(t);
  assert.equal(run(restore).status, 0);
  assert.equal(await readFile(output, 'utf8'), 'merged=true\n');
  assert.equal(run(save).status, 0);
  assert.equal(spawnSync('tar', ['--zstd', '-xf', join(root, 'upload.tar.zst'), '-C', join(root, 'unpacked')]).status, 0);
  for (const [file, value] of Object.entries({'older.json': 'prior-region', 'shared.json': 'newer-shared',
    'partial.json.previous': 'preserved-before-redownload', 'delta.json': '{"changes":[37]}'})) {
    assert.equal(await readFile(join(root, 'unpacked/.snapshot-cache', file), 'utf8'), value);
  }
  await assert.rejects(readFile(join(root, 'unpacked/.snapshot-cache/budget-123.json')), {code: 'ENOENT'});
  assert.match(await readFile(join(root, 'gh-calls'), 'utf8'), /release upload overpass-cache .* --clobber/);
});

for (const corrupt of [false, true]) test(`an ${corrupt ? 'invalid archive' : 'unavailable release'} cannot authorize failure-time overwrite`, async t => {
  const {root, run, output} = await fixture(t, {download: corrupt, corrupt});
  const result = run(restore);
  assert.equal(result.status === 0, !corrupt);
  assert.equal(await readFile(output, 'utf8'), '');
  assert.equal(eligible(undefined, 'skipped'), false);
  await assert.rejects(readFile(join(root, 'upload.tar.zst')), {code: 'ENOENT'});
});

test('archive construction failure stops before an upload', async t => {
  const {root, run} = await fixture(t);
  assert.equal(run(restore).status, 0);
  await writeFile(join(root, 'bin/tar'), '#!/bin/sh\nexit 77\n', {mode: 0o755});
  assert.equal(run(save).status, 77);
  assert.doesNotMatch(await readFile(join(root, 'gh-calls'), 'utf8'), /release upload/);
});

test('the complete-assembly bootstrap path remains usable without an earlier release', async t => {
  const {root, run} = await fixture(t, {download: false});
  assert.equal(run(restore).status, 0);
  assert.equal(eligible(undefined, 'success'), true);
  assert.equal(run(save).status, 0);
  assert.ok((await readFile(join(root, 'upload.tar.zst'))).length > 0);
});
