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
# VIEW_404=n / DOWNLOAD_404=n: answer "release not found" n times although
# the release exists (downloads of names matching DOWNLOAD_404_MATCH only);
# LISTED=1: the release list names it even when unread; DELETE_FAIL=n: the
# first n asset deletions answer HTTP 502.
flaky() { local f="$A/.$1"; local n=$(cat "$f" 2>/dev/null || echo 0); [ "$n" -lt "$2" ] && { echo $((n+1)) > "$f"; echo "\${3:-release not found}" >&2; exit 1; }; }
case "$1 $2" in
  "release list") if [ -f "$A/.created" ] || [ "$LISTED" = 1 ]; then echo '[{"tagName":"railway-ways-store"}]'; else echo '[]'; fi;;
  "release view") [ "$VIEW" = after-upload ] && [ -f "$A/.upload" ] && { echo "HTTP 502: cannot reconcile" >&2; exit 1; }
    [ "$VIEW" = broken ] && { echo "HTTP 502: bad gateway" >&2; exit 1; }
    flaky view "\${VIEW_404:-0}"
    [ -f "$A/.created" ] || { echo "release not found" >&2; exit 1; }
    printf '{"assets":['; first=1; for f in "$A"/*; do [ -e "$f" ] || continue; [ $first = 1 ] || printf ','; first=0; printf '{"name":"%s"}' "$(basename "$f")"; done; printf ']}';;
  "release create") touch "$A/.created";;
  "release upload")
    echo "$(basename "$4")" >> "$A/.uploads"
    case "$(basename "$4")" in \${UPLOAD_FAIL_MATCH:-*})
      [ "$UPLOAD_AFTER" = 1 ] && cp "$4" "$A/"
      [ "$UPLOAD_AFTER" = corrupt ] && echo different > "$A/$(basename "$4")"
      flaky upload "\${UPLOAD_FAIL:-0}" "\${UPLOAD_ERROR:-HTTP 500: Internal Server Error}";;
    esac
    case "$(basename "$4")" in $FAIL_UPLOAD) echo "upload failed" >&2; exit 1;; esac; cp "$4" "$A/";;
  "release download") case "$5" in \${DOWNLOAD_404_MATCH:-*}) flaky download "\${DOWNLOAD_404:-0}";; esac; cp "$A/$5" "$7/";;
  "release delete-asset") flaky delete "\${DELETE_FAIL:-0}" "HTTP 502: Server Error"; rm "$A/$4";;
  *) echo "unexpected gh $*" >&2; exit 2;;
esac
`);
  // tar --zstd, wherever zstd itself is not installed.
  await writeFile(join(root, 'bin', 'zstd'), '#!/bin/bash\nexec gzip "$@"\n');
  await chmod(join(root, 'bin', 'gh'), 0o755); await chmod(join(root, 'bin', 'zstd'), 0o755);
  const cli = (args, env = {}) => spawnSync(process.execPath, [resolve('scripts/railway-ways-release.mjs'), ...args],
    {encoding: 'utf8', env: {...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, RAILWAY_WAYS_RELEASE_RETRY_MS: '0', ...env}});
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
  // The datasets built from the store take it under their own variable.
  out = cli(['load', join(root, 'loaded'), 'RAILWAY_WAYS_STORE'], {GITHUB_ENV: join(root, 'env')});
  assert.equal(out.status, 0, out.stderr);
  assert.match(await readFile(join(root, 'env'), 'utf8'), /\nRAILWAY_WAYS_STORE=.*loaded\n$/);
  assert.notEqual(cli(['load', join(root, 'loaded'), 'X=1']).status, 0, 'a variable name only');
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

test('branch lines and service routes load the store, and download themselves when it cannot be loaded', async () => {
  for (const name of ['branch-lines.yml', 'service-routes.yml']) {
    const workflow = await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
    const load = workflow.indexOf('railway-ways-release.mjs load /tmp/railway-ways-store RAILWAY_WAYS_STORE');
    assert.ok(load > 0 && load < workflow.indexOf('node --import ./scripts/overpass-meter.mjs scripts/build-'), `${name}: the store is loaded before the build`);
    assert.match(workflow, /if ! node scripts\/railway-ways-release\.mjs load [^\n]+; then\n\s+echo "::warning::/, `${name}: a failed load warns and falls back`);
  }
  // A failed load names no store (the variable is written last).
  const source = await readFile(new URL('../scripts/railway-ways-release.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export function load'), source.indexOf('export function publish'));
  assert.ok(body.indexOf('GITHUB_ENV') > body.lastIndexOf("execFileSync('tar'"));
});

// Run 41644692570: GitHub answered 404 for the release while it existed.
test('a passing 404 for an existing release is asked again, and never taken for the first run', async t => {
  const {root, cli, store} = await release(t);
  assert.equal(cli(['publish', await store('a', 'japan', 1)], {GENERATION: '20261031T060000Z-1'}).status, 0);
  const reset = () => Promise.all(['.view', '.download'].map(name => rm(join(root, 'assets', name), {force: true})));
  // Two passing 404s on the lookup, then two on a download: loaded.
  let out = cli(['load', join(root, 'loaded')], {VIEW_404: '2'});
  assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /Loaded state-20261031T060000Z-1\.json/);
  assert.match(out.stderr, /release not found; asking again/);
  await reset(); await rm(join(root, 'loaded'), {recursive: true});
  out = cli(['load', join(root, 'loaded')], {DOWNLOAD_404: '2'});
  assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /Loaded/);
  // As in the run: the 404 came on a stage archive, after the state was read.
  await reset(); await rm(join(root, 'loaded'), {recursive: true});
  out = cli(['load', join(root, 'loaded')], {DOWNLOAD_404: '2', DOWNLOAD_404_MATCH: 'stage-*'});
  assert.equal(out.status, 0, out.stderr);
  assert.equal(await readFile(join(root, 'loaded', 'regions', 'japan', '1.json.gz'), 'utf8'), '1');
  // A 404 that lasts, for a release the list still names: the run stops,
  // and says nothing of a first run.
  await reset();
  out = cli(['load', join(root, 'loaded')], {VIEW_404: '9'});
  assert.notEqual(out.status, 0);
  assert.doesNotMatch(out.stdout, /first run/);
  assert.match(out.stderr, /is listed but cannot be read/);
  await reset();
  assert.notEqual(cli(['load', join(root, 'loaded')], {DOWNLOAD_404: '9'}).status, 0, 'a download that keeps failing stops the run');
});

test('the first run is only a release that is not listed', async t => {
  const {root, cli} = await release(t);
  assert.match(cli(['load', join(root, 'loaded')]).stdout, /first run/);
  const out = cli(['load', join(root, 'loaded')], {LISTED: '1'});
  assert.notEqual(out.status, 0, 'listed but not found is not a first run');
  assert.doesNotMatch(out.stdout, /first run/);
});

// Run 41808912606: GitHub answered HTTP 502 while an old generation was
// deleted, after the new state was up, and the run failed.
test('an old asset GitHub will not delete is left for the next publication, never failing the run', async t => {
  const {root, cli, store, assets} = await release(t);
  assert.equal(cli(['publish', await store('a', 'japan', 1)], {GENERATION: '20261031T060000Z-1'}).status, 0);
  assert.equal(cli(['publish', await store('b', 'japan', 2)], {GENERATION: '20261031T120000Z-2'}).status, 0);
  // Generation 1 is now obsolete; one refused deletion is asked again.
  let out = cli(['publish', await store('c', 'japan', 3)], {GENERATION: '20261031T180000Z-3', DELETE_FAIL: '1'});
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual((await assets()).filter(name => name.includes('20261031T060000Z-1')), [], 'every generation-1 asset deleted, the refused one on its second try');
  // Deletions that keep failing: published, warned, left.
  await rm(join(root, 'assets', '.delete'), {force: true});
  out = cli(['publish', await store('d', 'japan', 4)], {GENERATION: '20261031T200000Z-4', DELETE_FAIL: '9'});
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /::warning::Could not delete old asset state-20261031T120000Z-2\.json \(HTTP 502: Server Error\)/);
  assert.ok((await assets()).includes('state-20261031T200000Z-4.json'), 'the new generation is up');
  // The next publication removes what was left.
  await rm(join(root, 'assets', '.delete'), {force: true});
  assert.equal(cli(['publish', await store('e', 'japan', 5)], {GENERATION: '20261031T220000Z-5'}).status, 0);
  assert.deepEqual((await assets()).filter(name => name.startsWith('state-')), ['state-20261031T200000Z-4.json', 'state-20261031T220000Z-5.json']);
});

test('upload retries reconcile missing, committed, conflicting and uncertain outcomes', async t => {
  const {root, cli, store, assets} = await release(t);
  assert.equal(cli(['publish', await store('a', 'japan', 1)], {GENERATION:'20261031T060000Z-1'}).status, 0);
  const reset = async () => {for(const name of ['.upload','.uploads']) await rm(join(root,'assets',name),{force:true});};
  const uploads = async () => (await readFile(join(root,'assets','.uploads'),'utf8')).trim().split('\n');
  await reset();
  let out=cli(['publish',await store('b','japan',2)],{GENERATION:'20261106T060000Z-2',UPLOAD_FAIL:'1'});
  assert.equal(out.status,0,out.stderr);
  assert.match(out.stderr,/is absent after a transient error/);
  assert.equal((await uploads()).filter(n=>n.startsWith('stage-')).length,2,'absent archive retried once');
  for(const match of ['stage-*','state-*']) {
    await reset();
    const generation=match==='stage-*'?'20261106T070000Z-3':'20261106T080000Z-4';
    out=cli(['publish',await store(generation,'japan',3)],{GENERATION:generation,UPLOAD_FAIL:'1',UPLOAD_AFTER:'1',UPLOAD_FAIL_MATCH:match});
    assert.equal(out.status,0,out.stderr);
    assert.match(out.stdout,/Confirmed uploaded asset/);
    assert.equal((await uploads()).length,2,'a committed archive/state is not uploaded twice');
  }
  await reset();
  out=cli(['publish',await store('conflict','japan',4)],{GENERATION:'20261106T090000Z-5',UPLOAD_FAIL:'1',UPLOAD_AFTER:'corrupt',UPLOAD_FAIL_MATCH:'stage-*'});
  assert.notEqual(out.status,0);
  assert.match(out.stderr,/different bytes; not replacing/);
  assert.equal((await uploads()).length,1);
  assert.ok(!(await assets()).includes('state-20261106T090000Z-5.json'));
  for(const error of ['HTTP 403: Forbidden','HTTP 422: already exists']) {
    await reset();
    out=cli(['publish',await store(error.slice(5,8),'japan',5)],{GENERATION:'20261106T100000Z-6',UPLOAD_FAIL:'1',UPLOAD_ERROR:error});
    assert.notEqual(out.status,0);
    assert.equal((await uploads()).length,1,'permanent errors are not retried');
  }
  await reset();
  out=cli(['publish',await store('uncertain','japan',6)],{GENERATION:'20261106T103000Z-8',UPLOAD_FAIL:'1',VIEW:'after-upload'});
  assert.notEqual(out.status,0);
  assert.equal((await uploads()).length,1,'unreadable reconciliation stops without retrying upload');
  assert.ok(!(await assets()).includes('state-20261106T103000Z-8.json'));
  await reset();
  out=cli(['publish',await store('exhausted','japan',6)],{GENERATION:'20261106T110000Z-7',UPLOAD_FAIL:'9'});
  assert.notEqual(out.status,0);
  assert.equal((await uploads()).length,3,'bounded retry exhaustion');
  assert.ok(!(await assets()).includes('state-20261106T110000Z-7.json'));
});

test('failed railway-ways runs retain unpublished bytes without calling a provider again',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/railway-ways.yml',import.meta.url),'utf8');
 assert.match(workflow,/name: Preserve unpublished stage for recovery\n\s+if: failure\(\)\n\s+uses: actions\/upload-artifact@v4/);
 assert.match(workflow,/path: railway-ways-data\//);
 assert.match(workflow,/retention-days: 7/);
});
