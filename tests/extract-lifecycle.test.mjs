import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildExtractLifecycle, checkPolar, isGaugeWay, isLifecycleWay, lifecycleFeatures, LIFECYCLE_TRACKS, MISSING_PARTS, POLAR_INDEXES} from '../scripts/build-extract-lifecycle.mjs';
import {encodeLoadingGauges} from '../styles/loading-gauge-list.mjs';
import {fileURLToPath} from 'node:url';
import {lifecycleRegression, stateCounts, writeLifecycleSnapshot} from '../scripts/lifecycle-files.mjs';
import {STATES, toGeoJSON} from '../scripts/lifecycle.mjs';
import {checkMarker} from '../scripts/data-source.mjs';

const report = (extra = {}) => ({schema: 1, index: '20261111T121854Z-42996345331', regions: 175, oldestTimestamp: '2026-11-03T21:24:23Z', newestTimestamp: '2026-11-11T10:58:20Z', missingNodeRefs: 0, missingRegions: [], ...extra});
const meta = {version: 2, timestamp: '2026-10-01T00:00:00Z'};
// A way as readElements gives it: with node ids, bounds and its edit metadata.
const way = (id, coords, tags) => {
  const geometry = coords.map(([lon, lat]) => ({lat, lon}));
  return {type: 'way', id, ...meta, nodes: coords.map((_, i) => id * 10 + i),
    bounds: {minlat: Math.min(...geometry.map(p => p.lat)), minlon: Math.min(...geometry.map(p => p.lon)), maxlat: Math.max(...geometry.map(p => p.lat)), maxlon: Math.max(...geometry.map(p => p.lon))},
    geometry, tags};
};
// The Korean regression line, more than a degree long.
const NAMBU = way(1, [[128.1, 35.1], [128.2, 36.3]], {railway: 'construction', construction: 'rail', name: '남부내륙선'});
const ELEMENTS = [
  NAMBU,
  way(2, [[2.3, 48.8], [2.31, 48.81]], {railway: 'abandoned', name: 'Petite Ceinture', 'name:en': 'Little Belt', maxspeed: '40'}),
  way(3, [[2.4, 48.9], [2.41, 48.91]], {'disused:railway': 'tram', bridge: 'yes'}),
  way(4, [[2.5, 48.7], [2.51, 48.71]], {'proposed:railway': 'subway', railway: 'proposed'}),
  way(5, [[2.6, 48.6], [2.61, 48.61]], {railway: 'rail', 'disused:railway': 'rail'}), // selected; active track, dropped by toGeoJSON
  way(6, [[2.7, 48.5], [2.71, 48.51]], {railway: 'construction', construction: 'highway'}), // selected; not a railway kind, dropped
  way(7, [[2.8, 48.4], [2.81, 48.41]], {'abandoned:railway': 'yard'}), // not a track value
  way(8, [[2.9, 48.3], [2.91, 48.31]], {railway: 'Abandoned'}), // case matters
  way(9, [[3.0, 48.2], [3.01, 48.21]], {railway: 'abandoned;rail'}), // not exactly a state
  way(10, [[3.1, 48.1], [3.11, 48.11]], {'historic:railway': 'rail'}), // not a state prefix
  // The loading-gauge list's ways.
  way(13, [[8.5, 47.3], [8.51, 47.31]], {railway: 'rail', loading_gauge: ' GC '}),
  way(14, [[8.6, 47.4], [8.61, 47.41]], {railway: 'subway', loading_gauge: 'DE:BOStrab', usage: 'main'}),
  way(15, [[8.7, 47.5], [8.71, 47.51]], {railway: 'tram', loading_gauge: 'G1'}), // not one of its railway values
  way(16, [[8.8, 47.6], [8.81, 47.61]], {railway: 'narrow_gauge', 'loading_gauge:note': 'x'}), // another key
  way(17, [[8.9, 47.7], [8.91, 47.71]], {railway: 'funicular', loading_gauge: '  '}), // blank: left out of the list, as the encoder leaves it
  way(18, [[9.0, 47.8], [9.01, 47.81]], {railway: 'light_rail', loading_gauge: ''}), // empty: [loading_gauge] matches it
  {type: 'node', id: 11, ...meta, lat: 1, lon: 1, tags: {railway: 'abandoned'}},
  {type: 'relation', id: 12, ...meta, members: [], tags: {railway: 'abandoned'}},
];
const SELECTED = [1, 2, 3, 4, 5, 6];
const GAUGES = [13, 14, 17, 18];
const pick = ({type, id, tags, geometry}) => ({type, id, tags, geometry});
// The answer to regionQuery over the world (`out tags geom`).
const OVERPASS = {elements: ELEMENTS.filter(e => SELECTED.includes(e.id)).map(pick)};

const fakeRead = (pool = ELEMENTS) => async (pbf, {keep, onElement}) => {
  const kept = pool.filter(e => keep({type: e.type, id: e.id, tags: e.tags}));
  for (const e of kept) await onElement(structuredClone(e));
  return {read: pool.length, kept: kept.length, withoutGeometry: 0};
};

test('the selection is regionQuery\'s: railway=<state> exactly, or <state>:railway=<track>, ways only', async () => {
  assert.deepEqual(LIFECYCLE_TRACKS, ['rail', 'narrow_gauge', 'light_rail', 'subway', 'tram', 'monorail', 'funicular']);
  const source = await readFile(new URL('../scripts/build-snapshot.mjs', import.meta.url), 'utf8');
  assert.match(source, new RegExp(`const tracks = '${LIFECYCLE_TRACKS.join('\\|')}';`), 'the Overpass query asks for the same track values');
  assert.deepEqual(ELEMENTS.filter(isLifecycleWay).map(e => e.id), SELECTED);
  for (const state of STATES) {
    assert.ok(isLifecycleWay({type: 'way', tags: {railway: state}}), state);
    for (const track of LIFECYCLE_TRACKS) assert.ok(isLifecycleWay({type: 'way', tags: {[`${state}:railway`]: track}}), `${state}:railway=${track}`);
  }
});

test('the same features as from the Overpass answer', async () => {
  const {features, counts} = await lifecycleFeatures('assembled.osm.pbf', {read: fakeRead()});
  assert.deepEqual(features, toGeoJSON(OVERPASS).features);
  assert.deepEqual(features.map(f => f.id), [1, 2, 3, 4]);
  assert.deepEqual(counts, {read: ELEMENTS.length, kept: SELECTED.length + GAUGES.length, waysWithoutGeometry: 0});
  // Way ids in order whatever order the ways are read in.
  const shuffled = await lifecycleFeatures('x', {read: fakeRead([...ELEMENTS].reverse())});
  assert.deepEqual(shuffled.features, features);
});

test('the snapshot in the Overpass layout, with source.json naming what is not made yet', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-lifecycle-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const out = join(dir, 'lifecycle');
  const manifest = await buildExtractLifecycle('x', report(), out, {read: fakeRead(), now: () => new Date('2026-11-17T00:00:00Z')});
  const data = toGeoJSON(OVERPASS);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(out, 'snapshot', 'lifecycle.geojson.gz')))), data);
  const written = JSON.parse(await readFile(join(out, 'snapshot', 'manifest.json'), 'utf8'));
  const {tiles, ...rest} = manifest;
  assert.deepEqual(written, rest);
  assert.deepEqual(Object.keys(written).slice(0, 5), ['coverage', 'built', 'source', 'licence', 'parts'], 'the Overpass manifest\'s fields first');
  assert.equal(written.coverage, 'world', 'what the site\'s data check reads');
  assert.deepEqual(written.parts, [{bbox: [-90, -180, 90, 180], timestamp: '2026-11-03T21:24:23Z', features: 4}]);
  assert.deepEqual([written.features, written.states, written.regression], [4, stateCounts(data.features), lifecycleRegression(data.features)]);
  assert.deepEqual([written.oldestSource, written.complete], ['2026-11-03T21:24:23Z', true]);
  const lines = (await readFile(join(out, 'snapshot', 'tiles.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, tiles);
  assert.ok(lines.every(([z]) => z >= 5 && z <= 10));
  assert.ok(lines.some(([z, x, y]) => z === 7 && x === 109 && y === 50), 'the Korean tile the site\'s data check asks for');
  const marker = await readFile(join(out, 'source.json'), 'utf8');
  assert.deepEqual(JSON.parse(marker), {schema: 1, dataset: 'lifecycle', source: 'extract', complete: false, missing: ['polar'], osmTimestamp: '2026-11-03T21:24:23Z'});
  assert.deepEqual(MISSING_PARTS, ['polar']);
  assert.equal(written.loadingGauges, 4, 'every selected way, as the Overpass CSV has a row for each');
  assert.match(checkMarker(marker, 'lifecycle'), /not complete/, 'the site keeps rail-data');
});

// The polar caps (build-polar.mjs: ETOPO and Overpass features beyond 85°,
// none in the extract filter) are taken unchanged from rail-data.
const COMMIT = 'a'.repeat(40);
async function polarDir(dir, files = {'north-index.json': '{"cap":"north"}', 'south-index.json': '{"cap":"south"}', 'north-relief.png': 'png bytes'}) {
  const polar = join(dir, 'rail-polar');
  await mkdir(polar, {recursive: true});
  for (const [name, text] of Object.entries(files)) await writeFile(join(polar, name), text);
  return polar;
}
test('with the polar caps from rail-data the build is complete, and they are copied unchanged with their commit', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-lifecycle-polar-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const polar = await polarDir(dir), out = join(dir, 'lifecycle');
  const manifest = await buildExtractLifecycle('x', report(), out, {read: fakeRead(), polar: {dir: polar, commit: COMMIT}});
  assert.deepEqual(manifest.polar, {from: 'rail-data', commit: COMMIT, files: 3});
  assert.deepEqual((await readdir(join(out, 'snapshot', 'polar'))).sort(), ['north-index.json', 'north-relief.png', 'south-index.json']);
  assert.equal(await readFile(join(out, 'snapshot', 'polar', 'north-relief.png'), 'utf8'), 'png bytes');
  assert.deepEqual(JSON.parse(await readFile(join(out, 'snapshot', 'manifest.json'), 'utf8')).polar, manifest.polar);
  const marker = await readFile(join(out, 'source.json'), 'utf8');
  assert.deepEqual(JSON.parse(marker), {schema: 1, dataset: 'lifecycle', source: 'extract', complete: true, osmTimestamp: '2026-11-03T21:24:23Z'});
  assert.equal(checkMarker(marker, 'lifecycle'), null, 'the site may take it once DATA_SOURCES selects it');
  // An assembly that does not cover the world stays not complete, caps or not.
  const partial = join(dir, 'partial');
  await buildExtractLifecycle('x', report({missingRegions: ['gap/0_0_45_45']}), partial, {read: fakeRead(), polar: {dir: polar, commit: COMMIT}});
  assert.equal(JSON.parse(await readFile(join(partial, 'source.json'), 'utf8')).complete, false);
});
test('polar caps without both indexes, with an unreadable index or without their commit are refused', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-lifecycle-polar-bad-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  assert.deepEqual(POLAR_INDEXES, ['north-index.json', 'south-index.json']);
  const half = await polarDir(join(dir, 'half'), {'north-index.json': '{}'});
  await assert.rejects(checkPolar(half, COMMIT), /lack south-index\.json/);
  await assert.rejects(buildExtractLifecycle('x', report(), join(dir, 'out'), {read: () => assert.fail('nothing read'), polar: {dir: half, commit: COMMIT}}), /lack south-index\.json/);
  const broken = await polarDir(join(dir, 'broken'), {'north-index.json': '{}', 'south-index.json': '{'});
  await assert.rejects(checkPolar(broken, COMMIT), SyntaxError);
  const good = await polarDir(join(dir, 'good'));
  await assert.rejects(checkPolar(good, 'main'), /need their rail-data commit/);
  await assert.rejects(checkPolar(good, undefined), /need their rail-data commit/);
  assert.equal(await checkPolar(good, COMMIT), 3);
});
test('the workflow step takes rail-data\'s polar caps with their commit, and nothing when the branch or the caps are absent', async t => {
  const workflow = await readFile(new URL('../.github/workflows/osm-assemble.yml', import.meta.url), 'utf8');
  const command = workflow.split('      - name: Take the polar caps from rail-data\n        run: |\n')[1].split('\n      - ')[0]
    .split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const git = (cwd, ...args) => { const r = spawnSync('git', args, {cwd, encoding: 'utf8'}); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const setup = async files => {
    const dir = await mkdtemp(join(tmpdir(), 'extract-lifecycle-take-'));
    t.after(() => rm(dir, {recursive: true, force: true}));
    const origin = join(dir, 'origin');
    await mkdir(origin);
    git(origin, 'init', '-q', '-b', 'main');
    git(origin, 'config', 'user.email', 'fixture@example.invalid'); git(origin, 'config', 'user.name', 'fixture');
    await writeFile(join(origin, 'README'), 'main');
    git(origin, 'add', '.'); git(origin, 'commit', '-q', '-m', 'main');
    let commit;
    if (files) {
      git(origin, 'checkout', '-q', '--orphan', 'rail-data');
      git(origin, 'rm', '-q', '-rf', '.');
      for (const [name, text] of Object.entries(files)) { await mkdir(join(origin, name, '..'), {recursive: true}); await writeFile(join(origin, name), text); }
      git(origin, 'add', '.'); git(origin, 'commit', '-q', '-m', 'rail-data');
      commit = git(origin, 'rev-parse', 'HEAD');
      git(origin, 'checkout', '-q', 'main');
    }
    const work = join(dir, 'work');
    git(dir, 'clone', '-q', origin, work);
    const env = join(dir, 'github-env');
    await writeFile(env, '');
    const result = spawnSync('bash', ['-e', '-c', command.replaceAll('/tmp/', `${dir}/tmp/`)], {cwd: work, encoding: 'utf8', env: {...process.env, GITHUB_ENV: env}});
    return {dir, commit, result, env: await readFile(env, 'utf8')};
  };
  const taken = await setup({'polar/north-index.json': '{}', 'polar/south-index.json': '{}', 'manifest.json': '{}'});
  assert.equal(taken.result.status, 0, taken.result.stderr);
  assert.equal(taken.env, `POLAR_COMMIT=${taken.commit}\n`);
  assert.deepEqual((await readdir(join(taken.dir, 'tmp', 'rail-polar', 'polar'))).sort(), ['north-index.json', 'south-index.json']);
  const noCaps = await setup({'manifest.json': '{}'});
  assert.equal(noCaps.result.status, 0, noCaps.result.stderr);
  assert.equal(noCaps.env, '', 'no caps: the build stays not complete');
  const noBranch = await setup();
  assert.equal(noBranch.result.status, 0, noBranch.result.stderr);
  assert.equal(noBranch.env, '');
});
test('the loading-gauge list: the Overpass build\'s selection and the same file it writes from the same ways', async t => {
  assert.deepEqual(ELEMENTS.filter(isGaugeWay).map(e => e.id), GAUGES);
  const source = await readFile(new URL('../scripts/build-loading-gauge-list.mjs', import.meta.url), 'utf8');
  assert.match(source, /way\[railway~"\^\(rail\|narrow_gauge\|light_rail\|subway\|monorail\|funicular\)\$"\]\[loading_gauge\];out;/, 'the same railway values and key');
  const {gauges} = await lifecycleFeatures('x', {read: fakeRead()});
  assert.deepEqual(gauges, [[13, 'GC'], [14, 'DE:BOStrab'], [17, ''], [18, '']]);
  // The real Overpass build, on its CSV answer for the same ways (::id, loading_gauge).
  const root = await mkdtemp(join(tmpdir(), 'gauge-overpass-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const csv = ELEMENTS.filter(isGaugeWay).map(e => `${e.id}\t${e.tags.loading_gauge}`).join('\n') + '\n';
  await writeFile(join(root, 'fake.mjs'), `globalThis.setTimeout=(f)=>{f();return 0;};globalThis.fetch=async()=>new Response(${JSON.stringify(csv)});`);
  const run = spawnSync(process.execPath, ['--import', './fake.mjs', fileURLToPath(new URL('../scripts/build-loading-gauge-list.mjs', import.meta.url))], {cwd: root, encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  const overpass = await readFile(join(root, 'snapshot', 'loading-gauge.json'), 'utf8');
  const dir = await mkdtemp(join(tmpdir(), 'extract-lifecycle-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await buildExtractLifecycle('x', report(), join(dir, 'l'), {read: fakeRead()});
  assert.equal(await readFile(join(dir, 'l', 'snapshot', 'loading-gauge.json'), 'utf8'), overpass);
  assert.equal(overpass, JSON.stringify(encodeLoadingGauges([[13, 'GC'], [14, 'DE:BOStrab']])));
});

test('the regression line is required; a bad report is refused; a rebuild leaves nothing stale', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-lifecycle-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await assert.rejects(buildExtractLifecycle('x', report(), join(dir, 'a'), {read: fakeRead(ELEMENTS.slice(1))}), /남부내륙선 missing/);
  const short = {...NAMBU, geometry: [{lat: 35.1, lon: 128.1}, {lat: 35.2, lon: 128.2}]};
  await assert.rejects(buildExtractLifecycle('x', report(), join(dir, 'a'), {read: fakeRead([short, ...ELEMENTS.slice(1)])}), /extent appears incomplete/);
  await assert.rejects(readdir(join(dir, 'a')), /ENOENT/, 'nothing written');
  await assert.rejects(buildExtractLifecycle('x', {...report(), schema: 2}, join(dir, 'b'), {read: () => assert.fail('nothing read')}), /Not an assembly report/);
  await assert.rejects(buildExtractLifecycle('x', report({missingNodeRefs: 3}), join(dir, 'b'), {read: () => assert.fail('nothing read')}), /missing 3 way nodes/);
  const partial = await buildExtractLifecycle('x', report({olderFilter: ['gap/0_0_45_45']}), join(dir, 'c'), {read: fakeRead()});
  assert.equal(partial.complete, false);
  await writeFile(join(dir, 'c', 'snapshot', 'stale.pmtiles'), 'old');
  await buildExtractLifecycle('x', report(), join(dir, 'c'), {read: fakeRead()});
  assert.deepEqual((await readdir(join(dir, 'c', 'snapshot'))).sort(), ['lifecycle.geojson.gz', 'loading-gauge.json', 'manifest.json', 'tiles.jsonl']);
});

test('the Overpass build writes through the same writer', async t => {
  const source = await readFile(new URL('../scripts/build-snapshot.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{lifecycleRegression, stateCounts, writeLifecycleSnapshot\} from '\.\/lifecycle-files\.mjs';/);
  assert.match(source, /await writeLifecycleSnapshot\('snapshot',data,manifest\)/);
  assert.doesNotMatch(source, /geojsonvt\(/, 'no second tiling of its own');
  const dir = await mkdtemp(join(tmpdir(), 'lifecycle-files-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const data = toGeoJSON(OVERPASS);
  const count = await writeLifecycleSnapshot(join(dir, 's'), data, {a: 1});
  assert.equal(await readFile(join(dir, 's', 'manifest.json'), 'utf8'), '{\n  "a": 1\n}\n');
  assert.equal((await readFile(join(dir, 's', 'tiles.jsonl'), 'utf8')).trim().split('\n').length, count);
});

test('the assembly workflow builds and packs it after the axle-load lookup, and publishes it only to its own branch, only on main', async () => {
  const workflow = await readFile(new URL('../.github/workflows/osm-assemble.yml', import.meta.url), 'utf8');
  const build = workflow.indexOf('scripts/build-extract-lifecycle.mjs assembled.osm.pbf assembled.osm.pbf.json lifecycle-extract');
  assert.ok(build > workflow.indexOf('- name: Publish axle-load-extract-data'));
  assert.ok(workflow.indexOf('(cd lifecycle-extract && python ../scripts/pack-snapshot.py)') > build);
  assert.match(workflow, /- name: Publish lifecycle-extract-data\n\s+if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /split -b 80M -d -a 3 "\$GITHUB_WORKSPACE\/lifecycle-extract\/snapshot\/lifecycle\.pmtiles" lifecycle\.pmtiles\.part-/);
  assert.match(workflow, /git add manifest\.json loading-gauge\.json source\.json lifecycle\.pmtiles\.part-\* lifecycle\.geojson\.gz\.part-\*/);
  assert.match(workflow, /git push --force origin HEAD:lifecycle-extract-data/);
  assert.doesNotMatch(workflow, /HEAD:(refs\/heads\/)?rail-data\b/, 'the Overpass branch is never written');
  // The polar caps: read from rail-data before the build, with their commit,
  // and published with the rest when found.
  const take = workflow.indexOf('- name: Take the polar caps from rail-data');
  assert.ok(take > 0 && take < build, 'taken before the build');
  assert.ok(workflow.includes('lifecycle-extract ${POLAR_COMMIT:+/tmp/rail-polar/polar "$POLAR_COMMIT"}'));
  assert.match(workflow, /git archive FETCH_HEAD polar \| tar -x -C \/tmp\/rail-polar\n\s+echo "POLAR_COMMIT=\$\(git rev-parse FETCH_HEAD\)" >> "\$GITHUB_ENV"/);
  assert.match(workflow, /cp -r "\$GITHUB_WORKSPACE\/lifecycle-extract\/snapshot\/polar" polar\n\s+git add polar/);
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium, from a real extract file: the same features', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-lifecycle-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const x = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tags = t => Object.entries(t || {}).map(([k, v]) => `<tag k="${x(k)}" v="${x(v)}"/>`).join('');
  const at = `version="${meta.version}" timestamp="${meta.timestamp}"`;
  const ways = ELEMENTS.filter(e => e.type === 'way');
  await writeFile(join(dir, 'in.osm'), '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">'
    + ways.flatMap(w => w.nodes.map((id, i) => `<node id="${id}" ${at} lat="${w.geometry[i].lat}" lon="${w.geometry[i].lon}"/>`)).join('')
    + `<node id="11" ${at} lat="1" lon="1">${tags({railway: 'abandoned'})}</node>`
    + ways.map(w => `<way id="${w.id}" ${at}>${w.nodes.map(n => `<nd ref="${n}"/>`).join('')}${tags(w.tags)}</way>`).join('')
    + `<relation id="12" ${at}>${tags({railway: 'abandoned'})}</relation></osm>`);
  assert.equal(spawnSync('osmium', ['sort', join(dir, 'in.osm'), '-o', join(dir, 'in.osm.pbf')]).status, 0);
  const real = await lifecycleFeatures(join(dir, 'in.osm.pbf')), fake = await lifecycleFeatures('x', {read: fakeRead()});
  assert.deepEqual(real.features, toGeoJSON(OVERPASS).features);
  assert.deepEqual(real.gauges, fake.gauges);
});
