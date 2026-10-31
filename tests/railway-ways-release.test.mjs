import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync, execFileSync} from 'node:child_process';
import {usableState, obsoleteAssets} from '../scripts/railway-ways-release.mjs';

test('the newest state whose archives are all present is used; older generations go once a newer one is up', () => {
  const states = {
    'state-20261031T060000Z-1.json': {archives: {japan: 'stage-japan-20261031T060000Z-1.tar.zst'}},
    'state-20261031T120000Z-2.json': {archives: {japan: 'stage-japan-20261031T060000Z-1.tar.zst', china: 'stage-china-20261031T120000Z-2.tar.zst'}},
    'state-20261031T180000Z-3.json': {archives: {japan: 'stage-japan-20261031T180000Z-3.tar.zst', china: 'stage-china-20261031T120000Z-2.tar.zst'}},
  };
  const read = name => states[name];
  const names = [...Object.keys(states), 'stage-japan-20261031T060000Z-1.tar.zst', 'stage-china-20261031T120000Z-2.tar.zst', 'stage-japan-20261031T180000Z-3.tar.zst'];
  assert.equal(usableState(names, read).name, 'state-20261031T180000Z-3.json');
  // The newest state's archive never arrived: the previous generation is used.
  assert.equal(usableState(names.filter(n => n !== 'stage-japan-20261031T180000Z-3.tar.zst'), read).name, 'state-20261031T120000Z-2.json');
  assert.equal(usableState(['stage-japan-x.tar.zst'], read), null);
  assert.deepEqual(obsoleteAssets(names, ['state-20261031T180000Z-3.json', 'state-20261031T120000Z-2.json'], read).sort(),
    ['state-20261031T060000Z-1.json'], 'Japan\'s first archive is still named by the kept previous state');
  assert.deepEqual(obsoleteAssets(names, ['state-20261031T180000Z-3.json'], read).sort(),
    ['stage-japan-20261031T060000Z-1.tar.zst', 'state-20261031T060000Z-1.json', 'state-20261031T120000Z-2.json']);
});

// A stand-in for gh keeping the release's assets in a folder; FAIL_UPLOAD
// makes uploads of matching names fail, VIEW=broken the release lookup.
async function release(t) {
  const root = await mkdtemp(join(tmpdir(), 'railway-ways-release-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'bin')); await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'bin', 'gh'), `#!/bin/bash
A="${join(root, 'assets')}"
case "$1 $2" in
  "release view") [ "$VIEW" = broken ] && { echo "HTTP 502: bad gateway" >&2; exit 1; }
    [ -f "$A/.created" ] || { echo "release not found" >&2; exit 1; }
    printf '{"assets":['; first=1; for f in "$A"/*; do [ -e "$f" ] || continue; [ $first = 1 ] || printf ','; first=0; printf '{"name":"%s"}' "$(basename "$f")"; done; printf ']}';;
  "release create") touch "$A/.created";;
  "release upload") case "$(basename "$4")" in $FAIL_UPLOAD) echo "upload failed" >&2; exit 1;; esac; cp "$4" "$A/";;
  "release download") cp "$A/$5" "$7/";;
  "release delete-asset") rm "$A/$4";;
  *) echo "unexpected gh $*" >&2; exit 2;;
esac
`);
  // tar --zstd, wherever zstd itself is not installed.
  await writeFile(join(root, 'bin', 'zstd'), '#!/bin/bash\nexec gzip "$@"\n');
  await chmod(join(root, 'bin', 'gh'), 0o755); await chmod(join(root, 'bin', 'zstd'), 0o755);
  const cli = (args, env = {}) => spawnSync(process.execPath, [resolve('scripts/railway-ways-release.mjs'), ...args],
    {encoding: 'utf8', env: {...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, ...env}});
  const store = async (dir, stage, id, archives = {}) => {
    await mkdir(join(root, dir, 'regions', stage), {recursive: true});
    await writeFile(join(root, dir, 'regions', stage, `${id}.json.gz`), String(id));
    await writeFile(join(root, dir, 'state.json'), JSON.stringify({version: 1, stages: {[stage]: {completed: 'x'}}, archives}));
    await writeFile(join(root, dir, 'manifest.json'), JSON.stringify({run: {stage}}));
    return join(root, dir);
  };
  return {root, cli, store, assets: async () => (await readdir(join(root, 'assets'))).filter(n => !n.startsWith('.')).sort()};
}

test('publishing and loading generations; a half-finished publication leaves the previous one in use', async t => {
  const {root, cli, store, assets} = await release(t);
  // No release yet: the first run.
  let out = cli(['load', join(root, 'loaded')], {GITHUB_ENV: join(root, 'env')});
  assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /first run/);
  // An unreachable release stops the run.
  assert.notEqual(cli(['load', join(root, 'loaded')], {VIEW: 'broken'}).status, 0);
  // Japan, then China.
  assert.equal(cli(['publish', await store('a', 'japan', 1)], {GENERATION: '20261031T060000Z-1'}).status, 0);
  assert.equal(cli(['publish', await store('b', 'china', 2, {japan: 'stage-japan-20261031T060000Z-1.tar.zst'})], {GENERATION: '20261031T120000Z-2'}).status, 0);
  assert.deepEqual(await assets(), ['stage-china-20261031T120000Z-2.tar.zst', 'stage-japan-20261031T060000Z-1.tar.zst', 'state-20261031T060000Z-1.json', 'state-20261031T120000Z-2.json']);
  out = cli(['load', join(root, 'loaded')], {GITHUB_ENV: join(root, 'env')});
  assert.equal(out.status, 0, out.stderr);
  assert.equal(await readFile(join(root, 'loaded', 'regions', 'japan', '1.json.gz'), 'utf8'), '1');
  assert.equal(await readFile(join(root, 'loaded', 'regions', 'china', '2.json.gz'), 'utf8'), '2');
  assert.match(await readFile(join(root, 'env'), 'utf8'), /^PREVIOUS_DATA=.*loaded\n$/);
  // Japan again, but the state upload fails after its archive is up.
  const failed = cli(['publish', await store('c', 'japan', 3, JSON.parse(await readFile(join(root, 'loaded', 'state.json'), 'utf8')).archives)],
    {GENERATION: '20261031T180000Z-3', FAIL_UPLOAD: 'state-*'});
  assert.notEqual(failed.status, 0);
  await rm(join(root, 'loaded'), {recursive: true});
  assert.equal(cli(['load', join(root, 'loaded')]).status, 0);
  assert.equal(await readFile(join(root, 'loaded', 'regions', 'japan', '1.json.gz'), 'utf8'), '1', 'the previous generation, whole');
  // The next complete publication removes generations no longer needed.
  assert.equal(cli(['publish', await store('d', 'japan', 4, {japan: 'stage-japan-20261031T060000Z-1.tar.zst', china: 'stage-china-20261031T120000Z-2.tar.zst'})], {GENERATION: '20261031T200000Z-4'}).status, 0);
  assert.deepEqual(await assets(), ['stage-china-20261031T120000Z-2.tar.zst', 'stage-japan-20261031T060000Z-1.tar.zst', 'stage-japan-20261031T200000Z-4.tar.zst',
    'state-20261031T120000Z-2.json', 'state-20261031T200000Z-4.json'], 'the newest and the previous usable generation stay; the orphaned archive goes');
  // A state naming an archive that is not there is never used.
  execFileSync('rm', [join(root, 'assets', 'stage-japan-20261031T200000Z-4.tar.zst')]);
  await rm(join(root, 'loaded'), {recursive: true});
  out = cli(['load', join(root, 'loaded')]);
  assert.match(out.stdout, /Loaded state-20261031T120000Z-2\.json/);
});
