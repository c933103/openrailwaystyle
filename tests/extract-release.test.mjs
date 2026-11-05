import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {FILTER_HASH} from '../scripts/acquire-region-extract.mjs';
import {assetName, nextIndex, obsoleteAssets, usableIndex} from '../scripts/extract-release.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const DATE = '2026-11-01';
const plan = ids => ({valid: true, sourceDate: DATE, regions: ids.map(id => ({id, bytes: 1}))});
// A region's output as the extract job leaves it: the record and the file.
async function output(root, id, {content = `${id} data`, stamp = '2026-11-01T20:00:00Z', total = 100, extra = {}} = {}) {
  const dir = join(root, 'out', `extract-${id.replaceAll('/', '--')}`);
  await mkdir(dir, {recursive: true});
  await writeFile(join(dir, 'filtered.osm.pbf'), content);
  const manifest = {schema: 1, region: id, sourceDate: DATE, url: `https://download.geofabrik.de/${id}-261101.osm.pbf`, sourceTimestamp: stamp,
    pbfBytes: 1000, sourceMd5: `md5-${content}`, filteredBytes: Buffer.byteLength(content), filteredSha256: sha(content),
    counts: {nodes: total - 2, ways: 1, relations: 1}, filter: FILTER_HASH, ...extra};
  await writeFile(join(dir, 'extract.json'), JSON.stringify(manifest));
  return {dir, manifest, failed: null};
}
const entry = (id, extra = {}) => ({asset: assetName(id, '2026-10-25', sha(`${id} old`)), region: id, sha256: sha(`${id} old`), bytes: 7,
  sourceDate: '2026-10-25', checkedDate: '2026-10-25', sourceTimestamp: '2026-10-25T20:00:00Z', url: 'u', sourceMd5: `md5-${id}`, pbfBytes: 1000,
  counts: {nodes: 98, ways: 1, relations: 1}, filter: FILTER_HASH, ...extra});

test('regions refresh independently: checked ones take their new file, every other one keeps its working copy', async t => {
  const root = await mkdtemp(join(tmpdir(), 'extract-release-')); t.after(() => rm(root, {recursive: true, force: true}));
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const previous = {regions: Object.fromEntries(ids.map(id => [id, entry(id)]))};
  const changedFile = await output(root, 'c');
  await writeFile(join(changedFile.dir, 'filtered.osm.pbf'), 'tampered');
  const outputs = [
    await output(root, 'a'),
    await output(root, 'b', {content: 'b new'}),
    changedFile,
    {dir: join(root, 'x'), manifest: null, failed: {region: 'd', error: 'd: MD5 does not match the sidecar'}},
    // e: not measured at all (its job never ran).
  ];
  const {index, uploads, outcomes} = nextIndex(plan(ids), previous, outputs, '20261105T030000Z-1');
  assert.deepEqual(uploads.map(u => u.asset), [assetName('a', DATE, sha('a data')), assetName('b', DATE, sha('b new'))]);
  assert.equal(index.regions.a.asset, assetName('a', DATE, sha('a data')));
  assert.equal(index.regions.a.sourceTimestamp, '2026-11-01T20:00:00Z');
  for (const id of ['c', 'd', 'e']) assert.deepEqual(index.regions[id], previous.regions[id], `${id} keeps its working copy`);
  assert.deepEqual(outcomes.map(o => `${o.region} ${o.outcome} ${o.reason || ''}`.trim()), [
    'a updated', 'b updated', 'c kept filtered size does not match its record', 'd kept d: MD5 does not match the sidecar', 'e kept not measured']);
  assert.deepEqual([index.oldestTimestamp, index.newestTimestamp, index.missing, index.filter], ['2026-10-25T20:00:00Z', '2026-11-01T20:00:00Z', [], FILTER_HASH]);
  assert.match(assetName('us/new-york', DATE, sha('x')), /^region-us--new-york-20261101-[0-9a-f]{12}\.osm\.pbf$/);
});

test('a refreshed file is checked again by the writer: same bytes, current filter, not older than the working copy', async t => {
  const root = await mkdtemp(join(tmpdir(), 'extract-release-')); t.after(() => rm(root, {recursive: true, force: true}));
  const previous = {regions: {a: entry('a', {sourceTimestamp: '2026-11-02T00:00:00Z'}), b: entry('b'), c: entry('c')}};
  const sameSize = await output(root, 'c', {content: 'c data'});
  await writeFile(join(sameSize.dir, 'filtered.osm.pbf'), 'c dat4');
  const {index, uploads, outcomes} = nextIndex(plan(['a', 'b', 'c']), previous, [
    await output(root, 'a'), await output(root, 'b', {extra: {filter: 'older filter'}}), sameSize], '20261105T030000Z-1');
  assert.deepEqual(uploads, []);
  assert.deepEqual(index.regions, previous.regions);
  assert.deepEqual(outcomes.map(o => o.reason), [
    "data from 2026-11-01T20:00:00Z is older than the working copy's 2026-11-02T00:00:00Z",
    `filter older filter is not the current ${FILTER_HASH}`,
    'filtered SHA-256 does not match its record']);
});

test('unchanged regions keep their file; a first run fills only what was measured', async t => {
  const root = await mkdtemp(join(tmpdir(), 'extract-release-')); t.after(() => rm(root, {recursive: true, force: true}));
  const unchanged = id => ({dir: join(root, id), manifest: {region: id, unchanged: true, sourceMd5: `md5-${id}`, pbfBytes: 1000, filter: FILTER_HASH}, failed: null});
  let result = nextIndex(plan(['a', 'b']), {regions: {a: entry('a'), b: entry('b', {sourceMd5: 'another'})}}, [unchanged('a'), unchanged('b')], '20261105T030000Z-1');
  assert.deepEqual(result.index.regions.a, {...entry('a'), checkedDate: DATE});
  assert.deepEqual(result.index.regions.b, entry('b', {sourceMd5: 'another'}));
  assert.deepEqual(result.outcomes.map(o => o.outcome), ['unchanged', 'kept']);
  result = nextIndex(plan(['a', 'b']), null, [await output(root, 'a')], '20261105T030000Z-1');
  assert.deepEqual(Object.keys(result.index.regions), ['a']);
  assert.deepEqual(result.index.missing, ['b']);
  assert.deepEqual(result.outcomes.map(o => o.outcome), ['updated', 'missing']);
  const stray = await output(root, 'z');
  assert.throws(() => nextIndex(plan(['a']), null, [stray], '20261105T030000Z-1'), /plan does not hold/);
  assert.throws(() => nextIndex({...plan(['a']), valid: false}, null, [], '20261105T030000Z-1'), /not valid/);
  assert.throws(() => nextIndex(plan(['a']), null, [], 'now'), /Invalid generation/);
});

test('the index carries the polygon of each region from the plan, or from the previous index for a region no longer planned', async t => {
  const root = await mkdtemp(join(tmpdir(), 'extract-release-')); t.after(() => rm(root, {recursive: true, force: true}));
  const polygonOf = n => [[[[n, 0], [n + 1, 0], [n + 1, 1], [n, 0]]]];
  const withPolygons = {...plan(['a', 'b']), regions: [{id: 'a', bytes: 1, polygon: polygonOf(1)}, {id: 'b', bytes: 1, polygon: polygonOf(2)}]};
  const previous = {regions: {a: entry('a'), old: entry('old')}, polygons: {a: polygonOf(9), old: polygonOf(3)}};
  const {index} = nextIndex(withPolygons, previous, [await output(root, 'a')], '20261105T030000Z-1');
  assert.deepEqual(index.polygons, {a: polygonOf(1), old: polygonOf(3)}, 'b has no file yet; old is kept with its polygon');
});

test('a region the plan no longer holds stays until every planned region has a file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'extract-release-')); t.after(() => rm(root, {recursive: true, force: true}));
  const previous = {regions: {us: entry('us'), 'us/a': entry('us/a')}};
  let result = nextIndex(plan(['us/a', 'us/b']), previous, [], '20261105T030000Z-1');
  assert.ok(result.index.regions.us, 'us/b has no file yet');
  result = nextIndex(plan(['us/a', 'us/b']), previous, [await output(root, 'us/b')], '20261105T030000Z-1');
  assert.equal(result.index.regions.us, undefined);
  assert.deepEqual(result.outcomes.find(o => o.region === 'us'), {region: 'us', outcome: 'dropped', reason: 'no longer planned'});
});

test('the newest index with all its files is used; obsolete assets are those no kept index names', () => {
  const indexes = {
    'index-20261101T000000Z-1.json': {regions: {a: {asset: 'region-a-1.osm.pbf'}, b: {asset: 'region-b-1.osm.pbf'}}},
    'index-20261102T000000Z-2.json': {regions: {a: {asset: 'region-a-2.osm.pbf'}, b: {asset: 'region-b-1.osm.pbf'}}},
    'index-20261103T000000Z-3.json': {regions: {a: {asset: 'region-a-3.osm.pbf'}, b: {asset: 'region-b-1.osm.pbf'}}},
  };
  const read = name => indexes[name];
  const names = [...Object.keys(indexes), 'region-a-1.osm.pbf', 'region-a-2.osm.pbf', 'region-a-3.osm.pbf', 'region-b-1.osm.pbf', 'other.txt'];
  assert.equal(usableIndex(names, read).name, 'index-20261103T000000Z-3.json');
  assert.equal(usableIndex(names.filter(n => n !== 'region-a-3.osm.pbf'), read).name, 'index-20261102T000000Z-2.json');
  assert.equal(usableIndex(['region-a-1.osm.pbf'], read), null);
  assert.deepEqual(obsoleteAssets(names, ['index-20261103T000000Z-3.json', 'index-20261102T000000Z-2.json'], read).sort(),
    ['index-20261101T000000Z-1.json', 'region-a-1.osm.pbf']);
});

// A stand-in for gh keeping the release's assets in a folder.
async function release(t) {
  const root = await mkdtemp(join(tmpdir(), 'extract-release-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'bin')); await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'bin', 'gh'), `#!/bin/bash
A="${join(root, 'assets')}"
echo "$1 $2 $(basename "\${4:-}")" >> "$A/.log"
case "$1 $2" in
  "release list") if [ -f "$A/.created" ]; then echo '[{"tagName":"osm-extract"}]'; else echo '[]'; fi;;
  "release view") [ "$VIEW" = broken ] && { echo "HTTP 502: bad gateway" >&2; exit 1; }
    [ -f "$A/.created" ] || { echo "release not found" >&2; exit 1; }
    printf '{"assets":['; first=1; for f in "$A"/*; do [ -e "$f" ] || continue; [ $first = 1 ] || printf ','; first=0; printf '{"name":"%s"}' "$(basename "$f")"; done; printf ']}';;
  "release create") touch "$A/.created";;
  "release upload") case "$(basename "$4")" in $FAIL_UPLOAD) echo "upload failed" >&2; exit 1;; esac; cp "$4" "$A/";;
  "release download") cp "$A/$5" "$7/";;
  "release delete-asset") [ -n "$FAIL_DELETE" ] && { echo "HTTP 502: Server Error" >&2; exit 1; }; rm "$A/$4";;
  *) echo "unexpected gh $*" >&2; exit 2;;
esac
`);
  await chmod(join(root, 'bin', 'gh'), 0o755);
  const cli = (args, env = {}) => spawnSync(process.execPath, [resolve('scripts/extract-release.mjs'), ...args],
    {encoding: 'utf8', env: {...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, RAILWAY_WAYS_RELEASE_RETRY_MS: '0', ...env}});
  const outputs = async (name, regions) => {
    const dir = join(root, name);
    for (const [id, content] of Object.entries(regions)) {
      const sub = join(dir, `extract-${id}`);
      await mkdir(sub, {recursive: true});
      if (content === null) { await writeFile(join(sub, 'failed.json'), JSON.stringify({region: id, error: 'HTTP 503'})); continue; }
      const made = await output(join(root, 'tmp', name), id, {content});
      await writeFile(join(sub, 'extract.json'), JSON.stringify(made.manifest));
      await writeFile(join(sub, 'filtered.osm.pbf'), content);
    }
    return dir;
  };
  await writeFile(join(root, 'plan.json'), JSON.stringify(plan(['a', 'b', 'c'])));
  const assets = async () => (await readdir(join(root, 'assets'))).filter(n => !n.startsWith('.')).sort();
  const log = async () => (await readFile(join(root, 'assets', '.log'), 'utf8')).trim().split('\n');
  return {root, cli, outputs, assets, log, planFile: join(root, 'plan.json')};
}

test('publishing: files before the index, old assets deleted after it; a failed index upload leaves the previous index in use', async t => {
  const {root, cli, outputs, assets, log, planFile} = await release(t);
  // The first run: no release, and the list agrees.
  let out = cli(['load', join(root, 'index.json')]);
  assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /first run/);
  assert.notEqual(cli(['load', join(root, 'index.json')], {VIEW: 'broken'}).status, 0, 'an unreachable store stops the run');
  out = cli(['publish', planFile, await outputs('run1', {a: 'a1', b: 'b1', c: null})], {GENERATION: '20261101T000000Z-1'});
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Updated 2, unchanged 0, kept from before 0, without any file 1/);
  assert.match(out.stdout, /\| c \| missing \| HTTP 503 \|/);
  assert.deepEqual(await assets(), ['index-20261101T000000Z-1.json', assetName('a', DATE, sha('a1')), assetName('b', DATE, sha('b1'))].sort());
  // Two of three regions refresh; c is measured now.
  out = cli(['publish', planFile, await outputs('run2', {a: 'a2', c: 'c2'})], {GENERATION: '20261102T000000Z-2'});
  assert.equal(out.status, 0, out.stderr);
  // A third run: only a refreshes; the first index and a1 go, after the new index is up.
  out = cli(['publish', planFile, await outputs('run3', {a: 'a3'})], {GENERATION: '20261103T000000Z-3'});
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(await assets(), ['index-20261102T000000Z-2.json', 'index-20261103T000000Z-3.json',
    assetName('a', DATE, sha('a2')), assetName('a', DATE, sha('a3')), assetName('b', DATE, sha('b1')), assetName('c', DATE, sha('c2'))].sort());
  const lines = await log();
  const indexUp = lines.indexOf('release upload index-20261103T000000Z-3.json');
  assert.ok(lines.indexOf(`release upload ${assetName('a', DATE, sha('a3'))}`) < indexUp);
  assert.ok(lines.findIndex(l => l.startsWith('release delete-asset')) > lines.indexOf('release upload index-20261102T000000Z-2.json'));
  assert.ok(lines.slice(0, indexUp).every(l => !l.includes(`delete-asset ${assetName('a', DATE, sha('a1'))}`)));
  out = cli(['load', join(root, 'index.json')]);
  assert.match(out.stdout, /Loaded index-20261103T000000Z-3.json: 3 regions/);
  const loaded = JSON.parse(await readFile(join(root, 'index.json'), 'utf8'));
  assert.deepEqual(Object.values(loaded.regions).map(e => e.asset).sort(), [assetName('a', DATE, sha('a3')), assetName('b', DATE, sha('b1')), assetName('c', DATE, sha('c2'))].sort());
  // The index upload fails: its files are up, nothing is deleted, and the previous index stays in use.
  const before = await assets();
  out = cli(['publish', planFile, await outputs('run4', {b: 'b4'})], {GENERATION: '20261104T000000Z-4', FAIL_UPLOAD: 'index-*'});
  assert.notEqual(out.status, 0);
  assert.deepEqual(await assets(), [...before, assetName('b', DATE, sha('b4'))].sort());
  assert.match(cli(['load', join(root, 'index.json')]).stdout, /Loaded index-20261103T000000Z-3.json/);
  // The next run finds that file already up and uses it.
  out = cli(['publish', planFile, await outputs('run5', {b: 'b4'})], {GENERATION: '20261105T000000Z-5'});
  assert.equal(out.status, 0, out.stderr);
  assert.equal((await log()).filter(l => l === `release upload ${assetName('b', DATE, sha('b4'))}`).length, 1);
  assert.match(cli(['load', join(root, 'index.json')]).stdout, /Loaded index-20261105T000000Z-5.json/);
});

test('a missing region file makes its index unusable; a failed delete only warns', async t => {
  const {root, cli, outputs, assets, planFile} = await release(t);
  assert.equal(cli(['publish', planFile, await outputs('run1', {a: 'a1', b: 'b1', c: 'c1'})], {GENERATION: '20261101T000000Z-1'}).status, 0);
  assert.equal(cli(['publish', planFile, await outputs('run2', {a: 'a2'})], {GENERATION: '20261102T000000Z-2'}).status, 0);
  await rm(join(root, 'assets', assetName('a', DATE, sha('a2'))));
  assert.match(cli(['load', join(root, 'index.json')]).stdout, /Loaded index-20261101T000000Z-1.json/);
  // No usable index at all: stops, never an empty store.
  await rm(join(root, 'assets', assetName('a', DATE, sha('a1'))));
  assert.match(cli(['load', join(root, 'index.json')]).stderr, /No stored index has all its region files/);
  assert.match(cli(['publish', planFile, await outputs('run3', {b: 'b3'})], {GENERATION: '20261103T000000Z-3'}).stderr, /not starting from an empty store/);
  // Restored; a delete that keeps failing leaves the asset for the next run.
  await writeFile(join(root, 'assets', assetName('a', DATE, sha('a2'))), 'a2');
  const out = cli(['publish', planFile, await outputs('run4', {b: 'b4'})], {GENERATION: '20261104T000000Z-4', FAIL_DELETE: '1'});
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /::warning::Could not delete old asset index-20261101T000000Z-1.json \(HTTP 502: Server Error\)/);
  assert.ok((await assets()).includes('index-20261101T000000Z-1.json'));
  assert.equal(cli(['publish', planFile, await outputs('run5', {c: 'c5'})], {GENERATION: '20261105T000000Z-5'}).status, 0);
  assert.ok(!(await assets()).includes('index-20261101T000000Z-1.json'));
});
