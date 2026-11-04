import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdtemp, readFile, readdir, rm, writeFile, mkdir, cp, utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Runs the unchanged lifecycle builder's update step (SNAPSHOT_REGION=delta)
// in a temporary folder, with fetch and timers replaced before it loads.
// Synthetic responses in the documented augmented diff form; no provider data.
const builder = fileURLToPath(new URL('../scripts/build-snapshot.mjs', import.meta.url));
const BASE = '2026-11-01T06:00:00Z', SINCE = '2026-10-01T00:00:00Z';
const way = (id, tags) => ({type:'way', id, tags, geometry:[{lat:10, lon:100}, {lat:10.1, lon:100.1}]});
const region = elements => JSON.stringify({osm3s:{timestamp_osm_base:SINCE}, elements});

async function run(t, files, replies, mode = 'delta', previousRoot) {
  const root = previousRoot || await mkdtemp(join(tmpdir(), 'lifecycle-updates-'));
  if (!previousRoot) t.after(() => rm(root, {recursive:true, force:true}));
  await mkdir(join(root, '.snapshot-cache'), {recursive:true});
  for (const [name, data] of Object.entries(files)) await writeFile(join(root, '.snapshot-cache', name), data);
  await writeFile(join(root, 'fake.mjs'), `
    const replies = ${JSON.stringify(replies)}, log = [];
    globalThis.setTimeout = f => { f(); return 0; };
    globalThis.fetch = async (url, {body}) => {
      const query = body.get('data'); log.push(query);
      (await import('node:fs')).writeFileSync('requests.json', JSON.stringify(log));
      const [, reply] = Object.entries(replies).find(([box]) => query.includes('(' + box + ')')) || [, {text:'<osm><meta osm_base="${BASE}"/></osm>'}];
      if (reply.fail || reply.cut) {
        const cause = Object.assign(new Error(reply.secret || 'synthetic connection failure'), {name:reply.causeName || 'Error', code:reply.code});
        if (reply.cycle) cause.cause = cause;
        if (reply.getters) {
          let names = 0, codes = 0;
          Object.defineProperties(cause, {
            name:{get:() => names++ ? 'credential=do-not-log' : 'Error'},
            code:{get:() => codes++ ? 'TOKEN_DO_NOT_LOG' : 'ECONNRESET'},
          });
        }
        const error = new TypeError(reply.message || 'fetch failed', {cause});
        if (reply.cut) return {ok:true, status:200, text:async () => { throw error; }};
        throw error;
      }
      return new Response(reply.text, {status:reply.status || 200});
    };`);
  const result = spawnSync(process.execPath, ['--import', './fake.mjs', builder], {cwd:root, env:{...process.env, SNAPSHOT_REGION:mode, GITHUB_RUN_ID:'1'}, encoding:'utf8'});
  let requests = [];
  try { requests = JSON.parse(await readFile(join(root, 'requests.json'), 'utf8')); } catch {}
  const read = async name => { try { return JSON.parse(await readFile(join(root, '.snapshot-cache', name), 'utf8')); } catch { return null; } };
  return {root, result, requests, read, names:await readdir(join(root, '.snapshot-cache'))};
}

const reopened = `<osm><meta osm_base="${BASE}"/>`
  + `<action type="modify"><old><way id="1"/></old><new><way id="1" version="3"><nd ref="1" lat="10" lon="100"/><nd ref="2" lat="10.2" lon="100.2"/><tag k="railway" v="rail"/><tag k="disused:railway" v="rail"/></way></new></action>`
  + `<action type="delete"><old><way id="100"/></old><new><way id="100" visible="false"/></new></action>`
  + `<action type="delete"><old><way id="101"/></old><new><way id="101" visible="true"/></new></action></osm>`;

test('each cached region takes only its changes, deleted and retagged ways included, and records its query', async t => {
  const {result, requests, read} = await run(t, {
    '0_90_45_135.json': JSON.stringify({fetched:'2026-09-22T00:00:00Z', ...JSON.parse(region([way(1, {railway:'construction', construction:'rail'}), ...Array.from({length:40}, (_, i) => way(100 + i, {railway:'abandoned'}))]))}),
  }, {'0,90,45,135': {text:reopened}});
  assert.equal(result.status, 0, result.stderr);
  const asked = requests.filter(q => q.includes('(0,90,45,135)'));
  assert.equal(asked.length, 1, 'one change request, no full download');
  assert.match(asked[0], /^\[out:xml\]\[timeout:300\]\[maxsize:134217728\]\[adiff:"2026-10-01T00:00:00Z"\];\(way\[railway~/);
  const updated = await read('0_90_45_135.json');
  assert.equal(updated.osm3s.timestamp_osm_base, BASE, 'the next run starts from the new database time');
  assert.equal(updated.fetched, '2026-09-22T00:00:00Z', 'when it was last downloaded in full, kept for the refresh step');
  assert.match(updated.query, /^\[out:json\]\[timeout:90\]\[maxsize:134217728\];\(way\[railway~"\^\(proposed\|construction/);
  assert.deepEqual(updated.elements.find(e => e.id === 1).tags, {railway:'rail', 'disused:railway':'rail'}, 'reopened: the assembly no longer draws it');
  assert.ok(!updated.elements.some(e => e.id === 100 || e.id === 101), 'deleted, and no longer tagged as former');
  assert.equal(updated.elements.length, 39);
  assert.match(result.stdout, /REGIONS UPDATED \{"updated":1,"changed":3,"unanswered":0,"redownload":0/);
  // The changes are logged with their time, for ways other regions share.
  const log = await read('delta.json');
  assert.deepEqual(Object.fromEntries(Object.entries(log.changes).map(([id, c]) => [id, [c.time, c.feature && c.feature.properties.state]])),
    {1: [BASE, null], 100: [BASE, null], 101: [BASE, null]}, 'reopened, deleted and retagged: none drawn');
});

test('a region Overpass does not answer is kept; one whose changes cannot be used is downloaded in full', async t => {
  const {result, read} = await run(t, {
    '-90_-180.json': region([way(7, {railway:'proposed'})]),
    '0_-180_45_-135.json': region([way(5, {railway:'proposed'})]),
    '0_-135_45_-90.json': region([way(6, {railway:'proposed'})]),
  }, {
    '-90,-180,0,-90': {status:429, text:''},
    '0,-135,45,-90': {cut:true},
    '0,-180,45,-135': {text:`<osm><meta osm_base="${BASE}"/><remark> runtime error: Query timed out in "query" at line 1 after 301 seconds. </remark></osm>`},
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await read('-90_-180.json')).osm3s.timestamp_osm_base, SINCE, 'unchanged, asked again next run');
  assert.equal((await read('0_-135_45_-90.json')).osm3s.timestamp_osm_base, SINCE, 'an answer cut off midway: kept too');
  assert.equal(await read('0_-180_45_-135.json'), null, 'removed, so the region step downloads it in full');
  assert.equal((await read('0_-180_45_-135.json.previous')).elements[0].id, 5, 'its data kept to log the differences');
  assert.match(result.stdout, /"unanswered":2,"redownload":1/);
});

test('a split region is updated in its parts', async t => {
  const {result, requests, read} = await run(t, {
    '45_0_90_45.json.split': 'split',
    '45_0_67.5_22.5.json.split': 'split',
    '67.5_0_90_22.5.json': region([way(9, {railway:'proposed'})]),
  }, {});
  assert.equal(result.status, 0, result.stderr);
  assert.ok(requests.some(q => q.includes('(67.5,0,90,22.5)')));
  assert.ok(!requests.some(q => q.includes('(45,0,90,45)')), 'never the whole region');
  assert.equal((await read('67.5_0_90_22.5.json')).osm3s.timestamp_osm_base, BASE);
});

test('the download budget stops the update', async t => {
  const big = `<osm><meta osm_base="${BASE}"/><note>${'x'.repeat(1000)}</note></osm>`;
  const files = {'budget-1.json': JSON.stringify({bytes:499_999_999}), '0_90_45_135.json': region([way(9, {railway:'proposed'})])};
  const {result, read} = await run(t, files, {'0,90,45,135': {text:big}});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Download budget exceeded/);
  assert.equal((await read('0_90_45_135.json')).osm3s.timestamp_osm_base, SINCE);
});

test('a way shared with a region whose update failed takes the newer state, deletions included', async () => {
  const {recordChanges, applyDelta} = await import('../scripts/snapshot-delta.mjs');
  const {toGeoJSON} = await import('../scripts/lifecycle.mjs');
  const shared = way(5, {railway:'proposed', name:'Old'}), renamed = way(5, {railway:'proposed', name:'New'}), other = way(6, {railway:'abandoned'});
  // Region A updated at BASE: way 5 renamed, way 6 deleted. Region B failed and keeps both as of SINCE.
  const log = recordChanges(undefined, BASE, [shared, other], [renamed]);
  const features = new Map(), base = new Map();
  for (const [elements, time] of [[[renamed], BASE], [[shared, other], SINCE]]) // B is assembled last
    for (const f of toGeoJSON({elements}).features) { features.set(f.id, f); base.set(f.id, time); }
  applyDelta(features, base, log);
  assert.equal(features.get(5).properties.name, 'New', 'the stale copy does not win');
  assert.ok(!features.has(6), 'nor does a deleted way come back');
  // Once every region is newer than the change, it is pruned.
  const later = applyDelta(new Map(), new Map([[7, '2026-12-01T00:00:00Z']]), log);
  assert.deepEqual(later.delta.changes, {});
});

test('a way that only moved out of a region into another is not logged as removed', async () => {
  const {recordChanges, applyDelta} = await import('../scripts/snapshot-delta.mjs');
  const {toGeoJSON} = await import('../scripts/lifecycle.mjs');
  const at = (id, lat, lon) => ({type:'way', id, tags:{railway:'proposed'}, geometry:[{lat, lon}, {lat, lon: lon + 0.1}]});
  const A = [0, 90, 45, 135], B = [0, 45, 45, 90];
  // Way 8 moved from A (lon 100) to B (lon 80). B updated first and logged it there; then A, which lost it.
  let log = recordChanges(undefined, '2026-11-01T05:00:00Z', [], [at(8, 10, 80)], B);
  log = recordChanges(log, '2026-11-01T06:00:00Z', [at(8, 10, 100)], [], A);
  assert.equal(log.changes[8].feature.geometry.coordinates[0][0], 80, 'the moved copy stands');
  const features = new Map([[8, toGeoJSON({elements:[at(8, 10, 80)]}).features[0]]]);
  applyDelta(features, new Map([[8, '2026-11-01T05:00:00Z']]), log);
  assert.ok(features.has(8), 'still drawn');
  // A way gone for good (no copy logged elsewhere, or one still in the box) is logged as removed.
  assert.equal(recordChanges(undefined, '2026-11-01T06:00:00Z', [at(9, 10, 100)], [], A).changes[9].feature, null);
  const stillHere = recordChanges(undefined, '2026-11-01T05:00:00Z', [], [at(9, 10, 100)], B);
  assert.equal(recordChanges(stillHere, '2026-11-01T06:00:00Z', [at(9, 10, 100)], [], A).changes[9].feature, null);
});

test('a way deleted from OSM is logged as removed even where a moved copy was logged elsewhere', async () => {
  const {recordChanges} = await import('../scripts/snapshot-delta.mjs');
  const at = (id, lat, lon) => ({type:'way', id, tags:{railway:'proposed'}, geometry:[{lat, lon}, {lat, lon: lon + 0.1}]});
  const A = [0, 90, 45, 135], B = [0, 45, 45, 90];
  const log = recordChanges(undefined, '2026-11-01T05:00:00Z', [], [at(8, 10, 80)], B);
  assert.equal(recordChanges(log, '2026-11-01T06:00:00Z', [at(8, 10, 100)], [], A, ['8']).changes[8].feature, null);
});

test('the change log is saved before each region advances', () => {
  const source = readFileSync(builder, 'utf8');
  const log = source.indexOf('await writeFile(DELTA_FILE,JSON.stringify(changeLog));'), region = source.indexOf("await writeFile(file,JSON.stringify({...(json.fetched ? {fetched:json.fetched} : {}),osm3s:{timestamp_osm_base:update.osmBase}");
  assert.ok(log > 0 && region > log);
});

// The region step (SNAPSHOT_REGION=0 is 0,90,45,135) after a full download.
const full = (elements, time = BASE) => ({text:JSON.stringify({osm3s:{timestamp_osm_base:time}, elements})});
const logged = log => Object.fromEntries(Object.entries(log.changes).map(([id, c]) => [id, [c.time, c.feature && c.feature.properties.name]]));

// Restore a saved Actions cache and perform the workflow's exact local-only
// release merge. These are tiny synthetic files, never an upstream download.
async function restore(t, root, release = {}) {
  const next = await mkdtemp(join(tmpdir(), 'lifecycle-restored-'));
  t.after(() => rm(next, {recursive:true, force:true}));
  await cp(join(root, '.snapshot-cache'), join(next, '.snapshot-cache'), {recursive:true, preserveTimestamps:true});
  const releaseRoot = join(next, 'release-cache');
  await mkdir(releaseRoot);
  for (const [name, data] of Object.entries(release)) {
    const file = join(releaseRoot, name);
    await writeFile(file, data);
    await utimes(file, new Date('2000-01-01'), new Date('2000-01-01'));
  }
  const merged = spawnSync('cp', ['-a', '-u', releaseRoot + '/.', join(next, '.snapshot-cache') + '/'], {encoding:'utf8'});
  assert.equal(merged.status, 0, merged.stderr);
  return next;
}

test('incremental memory limit then full-fetch outage preserves the previous region through cache restoration', async t => {
  const key = '0_-135_45_-90.json', box = '0,-135,45,-90';
  const at = (id, name) => ({...way(id, {railway:'proposed', name}), geometry:[{lat:10, lon:-110}, {lat:10.1, lon:-110.1}]});
  const original = region([at(1, 'Old'), at(2, 'Removed')]);
  const limit = `<osm><meta osm_base="${BASE}"/><remark>runtime error: Query ran out of memory in "query" at line 1. It would need at least 130 MB of RAM to continue.</remark></osm>`;
  const first = await run(t, {[key]:original}, {[box]:{text:limit}});
  assert.equal(first.result.status, 0, first.result.stderr);
  assert.match(first.result.stdout, /"redownload":1/);
  assert.equal(await first.read(key), null);
  assert.equal(await readFile(join(first.root, '.snapshot-cache', key + '.previous'), 'utf8'), original);

  const failed = await run(t, {}, {[box]:{fail:true, code:'ECONNRESET'}}, '6', first.root);
  assert.notEqual(failed.result.status, 0);
  assert.equal(failed.requests.length, 3, 'exactly the existing bounded retries');
  assert.ok(failed.requests.every(q => q.includes('(' + box + ')')));
  assert.ok(!failed.names.includes(key + '.split'), 'outage does not split the region');
  assert.equal(await readFile(join(failed.root, '.snapshot-cache', key + '.previous'), 'utf8'), original);
  assert.equal(await failed.read(key), null, 'a failed replacement is not a complete cache entry');
  assert.doesNotMatch(failed.result.stdout, /REGION COMPLETE/);
  assert.deepEqual(await readdir(join(failed.root, 'snapshot')), [], 'no publishable output from the failed region');

  const next = await restore(t, failed.root);
  assert.equal(await readFile(join(next, '.snapshot-cache', key + '.previous'), 'utf8'), original);
  const recovered = await run(t, {}, {[box]:full([at(1, 'New')])}, '6', next);
  assert.equal(recovered.result.status, 0, recovered.result.stderr);
  assert.equal(recovered.requests.length, 1);
  assert.deepEqual(logged(await recovered.read('delta.json')), {1:[BASE, 'New'], 2:[BASE, null]});
  assert.ok(!recovered.names.includes(key + '.previous'), 'retired only after the replacement differences are logged');
  assert.equal((await recovered.read(key)).osm3s.timestamp_osm_base, BASE);
});

test('an older release cache must not erase a newer previous region after a failed replacement', async t => {
  const key = '0_-135_45_-90.json', box = '0,-135,45,-90';
  const previous = JSON.stringify({osm3s:{timestamp_osm_base:BASE}, elements:[way(1, {railway:'proposed', name:'Newer'})]});
  const saved = await run(t, {[key + '.previous']:previous}, {[box]:{fail:true}}, '6');
  assert.notEqual(saved.result.status, 0);
  const next = await restore(t, saved.root, {[key]:region([way(1, {railway:'proposed', name:'Older'})])});
  const checked = await run(t, {}, {[box]:{fail:true}}, 'delta', next);
  assert.equal(checked.result.status, 0, checked.result.stderr);
  assert.equal(await readFile(join(next, '.snapshot-cache', key + '.previous'), 'utf8'), previous,
    'a stale release entry cannot replace the retained newer source');
  const retried = await run(t, {}, {[box]:{fail:true}}, '6', next);
  assert.notEqual(retried.result.status, 0, 'missing current replacement still fails closed');
  assert.doesNotMatch(retried.result.stdout, /REGION COMPLETE/);
  assert.equal(await readFile(join(next, '.snapshot-cache', key + '.previous'), 'utf8'), previous);
  const later = '2026-11-02T06:00:00Z';
  const recovered = await run(t, {}, {[box]:full([way(1, {railway:'proposed', name:'Recovered'})], later)}, '6', next);
  assert.equal(recovered.result.status, 0, recovered.result.stderr);
  assert.deepEqual(logged(await recovered.read('delta.json')), {1:[later, 'Recovered']});
  assert.ok(!recovered.names.includes(key + '.previous'));
});

test('an older or undated full response cannot replace retained newer data', async t => {
  const key = '0_90_45_135.json', box = '0,90,45,135';
  const previous = JSON.stringify({osm3s:{timestamp_osm_base:BASE}, elements:[way(1, {railway:'proposed', name:'Newer'})]});
  for (const time of [SINCE, 'invalid', null, '2026-11-01T08:00:00+02:00', '2026-11-31T06:00:00Z']) {
    const {result, read, requests, root} = await run(t, {[key + '.previous']:previous}, {[box]:full([way(1, {railway:'proposed', name:'Rejected'})], time)}, '0');
    assert.notEqual(result.status, 0);
    assert.equal(requests.length, 3);
    assert.match(result.stderr, /Region replacement is older than preserved data or has no valid database time/);
    assert.equal(await read(key), null);
    assert.equal(await readFile(join(root, '.snapshot-cache', key + '.previous'), 'utf8'), previous);
    assert.doesNotMatch(result.stdout, /REGION COMPLETE/);
  }
});

test('network diagnostics retain bounded classifications and elapsed time without arbitrary error data', async t => {
  for (const mode of ['delta', '0']) {
    const key = '0_90_45_135.json', box = '0,90,45,135';
    const files = mode === 'delta' ? {[key]:region([way(1, {railway:'proposed'})])} : {};
    for (const [reply, expected] of [
      [{fail:true, code:'ECONNRESET', message:'credential=do-not-log', secret:'credential=do-not-log'}, [{name:'TypeError'}, {name:'Error', code:'ECONNRESET'}]],
      [{fail:true, causeName:'credential=do-not-log', code:'TOKEN_DO_NOT_LOG', secret:'https://user:secret@example.invalid/?token=hidden'}, [{name:'TypeError'}, {name:'UnknownError'}]],
      [{fail:true, code:'UND_ERR_CONNECT_TIMEOUT', cycle:true}, [{name:'TypeError'}, {name:'Error', code:'UND_ERR_CONNECT_TIMEOUT'}, {name:'Error', code:'UND_ERR_CONNECT_TIMEOUT'}]],
      [{cut:true, code:'UND_ERR_SOCKET', message:'credential=do-not-log', secret:'credential=do-not-log'}, [{name:'TypeError'}, {name:'Error', code:'UND_ERR_SOCKET'}]],
      [{fail:true, getters:true}, [{name:'TypeError'}, {name:'Error', code:'ECONNRESET'}]],
    ]) {
      const {result, requests, read} = await run(t, files, {[box]:reply}, mode);
      assert.equal(result.status === 0, mode === 'delta');
      const entries = result.stderr.split('\n').filter(line => line.startsWith('OVERPASS_FETCH_FAILURE '))
        .map(line => JSON.parse(line.slice('OVERPASS_FETCH_FAILURE '.length)));
      assert.equal(entries.length, mode === 'delta' ? 1 : 3);
      assert.equal(requests.length, entries.length);
      for (const entry of entries) {
        assert.deepEqual(Object.keys(entry), ['phase', 'stage', 'elapsedMs', 'causes']);
        assert.equal(entry.phase, mode === 'delta' ? 'changes' : 'full');
        assert.equal(entry.stage, reply.cut ? 'body' : 'fetch');
        assert.ok(Number.isSafeInteger(entry.elapsedMs) && entry.elapsedMs >= 0);
        assert.deepEqual(entry.causes, expected);
      }
      assert.doesNotMatch(result.stdout + result.stderr, /do-not-log|TOKEN_DO_NOT_LOG|user:secret|token=hidden/);
      if (mode === 'delta') assert.equal((await read(key)).osm3s.timestamp_osm_base, SINCE);
    }
  }
});

test('a region downloaded again in full logs its differences, so a stale neighbour cannot undo them', async t => {
  const {result, requests, read, names} = await run(t, {
    '0_90_45_135.json.previous': region([way(1, {railway:'proposed', name:'Old'}), way(2, {railway:'abandoned', name:'Gone'}), way(3, {railway:'proposed', name:'Same'})]),
  }, {'0,90,45,135': full([way(1, {railway:'proposed', name:'New'}), way(3, {railway:'proposed', name:'Same'})])}, '0');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(requests.length, 1);
  assert.deepEqual(logged(await read('delta.json')), {1: [BASE, 'New'], 2: [BASE, null]}, 'renamed and removed; the unchanged way not logged');
  assert.ok(!names.includes('0_90_45_135.json.previous'), 'removed once logged');
  assert.equal((await read('0_90_45_135.json')).osm3s.timestamp_osm_base, BASE);
  assert.ok(Date.now() - Date.parse((await read('0_90_45_135.json')).fetched) < 600_000, 'the download time recorded');
});

test('a region split during its full download logs each part at its own time', async t => {
  const T1 = '2026-11-01T05:00:00Z', T2 = '2026-11-01T06:30:00Z', T3 = '2026-11-01T07:00:00Z';
  const at = (id, lat, lon, name) => ({type:'way', id, tags:{railway:'proposed', name}, geometry:[{lat, lon}, {lat, lon: lon + 0.1}]});
  // Unchanged, with nodes in the south-west and north-east parts only.
  const diagonal = {type:'way', id:4, tags:{railway:'proposed', name:'Diagonal'}, geometry:[{lat:10, lon:100}, {lat:30, lon:120}]};
  const {result, read, names} = await run(t, {
    '0_90_45_135.json.previous': region([at(1, 10, 100, 'Old'), at(2, 30, 120, 'Gone'), at(3, 10, 101, 'Here'), diagonal]),
  }, {
    '0,90,45,135': {text:JSON.stringify({osm3s:{timestamp_osm_base:BASE}, remark:'runtime error: Query timed out', elements:[]})},
    '0,90,22.5,112.5': full([at(1, 10, 100, 'New'), diagonal], T2),
    // Way 3 moved into this part, whose data is older.
    '0,112.5,22.5,135': full([at(3, 10, 120, 'Moved')], T1),
    // Its bounding rectangle covers this part, with no node in it.
    '22.5,90,45,112.5': full([], T2),
    '22.5,112.5,45,135': full([diagonal], T3),
  }, '0');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(names.includes('0_90_45_135.json.split'));
  assert.deepEqual(logged(await read('delta.json')), {1: [T2, 'New'], 2: [T3, null], 3: [T1, 'Moved']},
    'the deletion at the time of the part that saw it; the moved way not removed by the part it left; the unchanged diagonal way not logged');
  assert.ok(!names.includes('0_90_45_135.json.previous'));
});

test('earlier data left by a stopped run is logged before the region is used or updated', async t => {
  const previous = region([way(4, {railway:'proposed', name:'Old'})]);
  const done = JSON.stringify({osm3s:{timestamp_osm_base:BASE}, elements:[way(4, {railway:'proposed', name:'New'})]});
  for (const mode of ['0', 'delta']) {
    const {result, read, names} = await run(t, {'0_90_45_135.json.previous': previous, '0_90_45_135.json': done}, {}, mode);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(logged(await read('delta.json')), {4: [BASE, 'New']}, mode);
    assert.ok(!names.includes('0_90_45_135.json.previous'), mode);
  }
});

test('a requested refresh takes the regions downloaded in full longest ago, however recently updated, and keeps their data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lifecycle-refresh-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  await mkdir(join(root, '.snapshot-cache'));
  const day = 86_400_000, iso = ms => new Date(Date.now() - ms).toISOString();
  // All three were just rewritten by change updates.
  const files = {'old.json': JSON.stringify({fetched:iso(10 * day), osm3s:{}, elements:[]}), 'recent.json': JSON.stringify({fetched:iso(2 * day), osm3s:{}, elements:[]}),
    'unrecorded.json': region([]), 'delta.json': '{}', 'budget-1.json': '{}', 'x.json.split': 'split'};
  for (const [name, data] of Object.entries(files)) await writeFile(join(root, '.snapshot-cache', name), data);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/refresh-snapshot-cache.mjs', import.meta.url))], {cwd:root, env:{...process.env, REFRESH_BYTES:'1000000'}, encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readdir(join(root, '.snapshot-cache'))).sort(),
    ['budget-1.json', 'delta.json', 'old.json.previous', 'recent.json', 'unrecorded.json.previous', 'x.json.split'], 'kept as .previous to log the differences');
  assert.ok(result.stdout.indexOf('unrecorded.json') < result.stdout.indexOf('old.json'), 'a response without a download time first');
});

test('a change logged late never replaces a newer entry', async () => {
  const {recordChanges} = await import('../scripts/snapshot-delta.mjs');
  const at = (id, name) => ({type:'way', id, tags:{railway:'proposed', name}, geometry:[{lat:10, lon:100}, {lat:10, lon:100.1}]});
  const box = [0, 90, 45, 135];
  // Region B logged way 5 renamed and way 6 deleted at 06:00; region A's earlier data, from 05:00, is logged afterwards.
  let log = recordChanges(undefined, '2026-11-01T06:00:00Z', [at(5, 'Old'), at(6, 'Gone')], [at(5, 'New')], box, ['6']);
  log = recordChanges(log, '2026-11-01T05:00:00Z', [at(5, 'Older'), at(7, 'X')], [at(5, 'Old'), at(6, 'Gone')], box);
  assert.equal(log.changes[5].feature.properties.name, 'New');
  assert.deepEqual([log.changes[6].time, log.changes[6].feature], ['2026-11-01T06:00:00Z', null], 'the deletion stands');
  assert.equal(log.changes[7].feature, null, 'what is not logged newer still is');
  // An equal or later time still replaces.
  assert.equal(recordChanges(log, '2026-11-01T06:00:00Z', [at(5, 'New')], [at(5, 'Newest')], box).changes[5].feature.properties.name, 'Newest');
});

test('a way seen unchanged later replaces an older logged removal, so a stale region cannot remove it', async () => {
  const {recordChanges, applyDelta} = await import('../scripts/snapshot-delta.mjs');
  const {toGeoJSON} = await import('../scripts/lifecycle.mjs');
  const box = [0, 90, 45, 135], kept = way(7, {railway:'proposed', name:'Kept'});
  // Region A saw way 7 lose its lifecycle tag at 05:00; region B, whose data is from before that, sees it as it was at 06:00.
  let log = recordChanges(undefined, '2026-11-01T05:00:00Z', [kept], [], box);
  assert.equal(log.changes[7].feature, null);
  log = recordChanges(log, '2026-11-01T06:00:00Z', [kept], [kept], box);
  assert.deepEqual([log.changes[7].time, log.changes[7].feature?.properties.name], ['2026-11-01T06:00:00Z', 'Kept']);
  // A third region, stale at 04:00, assembled last: the way stays.
  const features = new Map([[7, toGeoJSON({elements:[kept]}).features[0]]]), base = new Map([[7, '2026-11-01T04:00:00Z']]);
  applyDelta(features, base, log);
  assert.ok(features.has(7));
  // Unchanged and never logged: still nothing logged.
  assert.deepEqual(recordChanges(undefined, '2026-11-01T06:00:00Z', [kept], [kept], box).changes, {});
});

// A busy or unreachable server says nothing about a region's size: it is
// asked again next run, whole, and no split is recorded. Only an executed
// query limit, in a remark or an HTTP 5xx body, splits it.
test('an outage or a refusal leaves the region whole; only a query limit splits it', async t => {
  for (const [name, reply] of [['network failure', {fail:true}], ['rate limit', {status:429, text:'Too Many Requests'}],
    ['busy gateway', {status:504, text:'Gateway Timeout. All query workers are busy and the request queue is full.'}]]) {
    const {result, requests, names} = await run(t, {}, {'0,90,45,135': reply}, '0');
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, /Overpass stayed unavailable for region 0,90,45,135/, name);
    assert.equal(requests.filter(q => q.includes('(0,90,45,135)')).length, 3, `${name}: three attempts, then the next run`);
    assert.ok(!names.includes('0_90_45_135.json.split'), `${name}: no split recorded`);
    assert.equal(requests.length, 3, `${name}: no part asked`);
  }
  const limit = '<p><strong>Error</strong>: runtime error: Query timed out in "query" at line 1 after 90 seconds.</p>';
  const {result, names, requests} = await run(t, {}, {
    '0,90,45,135': {status:504, text:limit},
    '0,90,22.5,112.5': full([]), '0,112.5,22.5,135': full([]), '22.5,90,45,112.5': full([]), '22.5,112.5,45,135': full([]),
  }, '0');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(names.includes('0_90_45_135.json.split'), 'an executed-query limit in an HTTP 504 body splits');
  assert.equal(requests.filter(q => q.includes('(0,90,45,135)')).length, 1, 'split at once, not asked again');
});

test('split replacements obey retained parent times after restoration, for cached and downloaded leaves', async t => {
  const key = '0_90_45_135.json', previous = JSON.stringify({osm3s:{timestamp_osm_base:BASE}, elements:[way(1, {railway:'proposed', name:'Newer'})]});
  const boxes = ['0,90,22.5,112.5', '0,112.5,22.5,135', '22.5,90,45,112.5', '22.5,112.5,45,135'];
  const files = {[key + '.previous']:previous, [key]:region([]), [key + '.split']:'split',
    ...Object.fromEntries(boxes.map(box => [box.replaceAll(',', '_') + '.json', region([])]))};
  const checked = await run(t, files, {}, 'delta');
  assert.equal(checked.result.status, 0, checked.result.stderr);
  assert.equal(checked.requests.length, 0, 'stale descendants cannot advance through the delta path');
  for (const reply of [{fail:true}, full([], SINCE)]) {
    const failed = await run(t, {}, Object.fromEntries(boxes.map(box => [box, reply])), '0', checked.root);
    assert.notEqual(failed.result.status, 0);
    assert.equal(failed.requests.length, 3, 'only the first stale child is retried');
    assert.equal(await readFile(join(failed.root, '.snapshot-cache', key + '.previous'), 'utf8'), previous);
    assert.equal(await failed.read('delta.json'), null, 'no parent deletions logged from stale leaves');
    assert.doesNotMatch(failed.result.stdout, /REGION COMPLETE/);
  }
  const recovered = await run(t, {}, Object.fromEntries(boxes.map((box, i) => [box, full(i === 0 ? [way(1, {railway:'proposed', name:'Recovered'})] : [])])), '0', checked.root);
  assert.equal(recovered.result.status, 0, recovered.result.stderr);
  assert.equal(recovered.requests.length, 4);
  assert.ok(!recovered.names.includes(key + '.previous'));
  assert.deepEqual(logged(await recovered.read('delta.json')), {1:[BASE, 'Recovered']});
});

test('nested split replacements obey the newest retained ancestor or same-region baseline', async t => {
  const parent = '0_90_45_135.json', child = '0_90_22.5_112.5.json';
  const later = '2026-11-02T06:00:00Z';
  const parentData = JSON.stringify({osm3s:{timestamp_osm_base:BASE}, elements:[way(1, {railway:'proposed'})]});
  const childData = JSON.stringify({osm3s:{timestamp_osm_base:later}, elements:[way(1, {railway:'proposed'})]});
  const box = '0,90,11.25,101.25', grandchild = box.replaceAll(',', '_') + '.json';
  const failed = await run(t, {[parent + '.previous']:parentData, [parent + '.split']:'split',
    [child + '.previous']:childData, [child + '.split']:'split', [grandchild]:full([], BASE).text}, {[box]:full([], BASE)}, '0');
  assert.notEqual(failed.result.status, 0);
  assert.equal(failed.requests.length, 3);
  for (const [key, expected] of [[parent, parentData], [child, childData]])
    assert.equal(await readFile(join(failed.root, '.snapshot-cache', key + '.previous'), 'utf8'), expected);
  assert.equal(await failed.read('delta.json'), null);
  assert.doesNotMatch(failed.result.stdout, /REGION COMPLETE/);
});

test('a requested refresh never overwrites an already-pending previous region', async t => {
  const key = '0_90_45_135.json', previous = JSON.stringify({osm3s:{timestamp_osm_base:BASE}, elements:[way(1, {railway:'proposed', name:'Newer'})]});
  const stale = region([]);
  const setup = await run(t, {[key + '.previous']:previous, [key]:stale}, {}, 'delta');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/refresh-snapshot-cache.mjs', import.meta.url))],
    {cwd:setup.root, env:{...process.env, REFRESH_BYTES:'1000000'}, encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(setup.root, '.snapshot-cache', key + '.previous'), 'utf8'), previous);
  assert.equal(await readFile(join(setup.root, '.snapshot-cache', key), 'utf8'), stale);
});

test('malformed replacements cannot retire retained source data before conversion succeeds', async t => {
  const key = '0_90_45_135.json', previous = region([way(1, {railway:'proposed'})]);
  for (const extra of [{}, {elements:[null]}, {elements:[{...way(1, {railway:'proposed'}), geometry:{invalid:true}}]}, {elements:[], remark:'incomplete'}]) {
    const candidate = JSON.stringify({osm3s:{timestamp_osm_base:BASE}, ...extra});
    const failed = await run(t, {[key + '.previous']:previous, [key]:candidate}, {'0,90,45,135':{fail:true}}, '0');
    assert.notEqual(failed.result.status, 0);
    assert.equal(await readFile(join(failed.root, '.snapshot-cache', key + '.previous'), 'utf8'), previous);
    assert.equal(await failed.read('delta.json'), null);
    assert.doesNotMatch(failed.result.stdout, /REGION COMPLETE/);
  }
});

test('a delta response cannot move a valid region backward or use noncanonical database times', async t => {
  const key = '0_90_45_135.json', original = JSON.stringify({osm3s:{timestamp_osm_base:BASE}, elements:[way(1, {railway:'proposed'})]});
  for (const time of [SINCE, '2026-11-01T08:00:00+02:00']) {
    const checked = await run(t, {[key]:original}, {'0,90,45,135':{text:`<osm><meta osm_base="${time}"/></osm>`}});
    if (time === SINCE) {
      assert.notEqual(checked.result.status, 0);
      assert.equal(await readFile(join(checked.root, '.snapshot-cache', key), 'utf8'), original);
    } else {
      assert.equal(checked.result.status, 0, checked.result.stderr);
      assert.equal(await checked.read(key), null, 'the existing XML parser rejects the noncanonical time and schedules a full replacement');
      assert.equal(await readFile(join(checked.root, '.snapshot-cache', key + '.previous'), 'utf8'), original);
    }
    assert.equal(await checked.read('delta.json'), null);
  }
});
