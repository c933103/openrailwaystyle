import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdtemp, readFile, readdir, rm, writeFile, mkdir} from 'node:fs/promises';
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

async function run(t, files, replies, mode = 'delta') {
  const root = await mkdtemp(join(tmpdir(), 'lifecycle-updates-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  await mkdir(join(root, '.snapshot-cache'));
  for (const [name, data] of Object.entries(files)) await writeFile(join(root, '.snapshot-cache', name), data);
  await writeFile(join(root, 'fake.mjs'), `
    const replies = ${JSON.stringify(replies)}, log = [];
    globalThis.setTimeout = f => { f(); return 0; };
    globalThis.fetch = async (url, {body}) => {
      const query = body.get('data'); log.push(query);
      (await import('node:fs')).writeFileSync('requests.json', JSON.stringify(log));
      const [, reply] = Object.entries(replies).find(([box]) => query.includes('(' + box + ')')) || [, {text:'<osm><meta osm_base="${BASE}"/></osm>'}];
      if (reply.cut) return {ok:true, status:200, text:async () => { throw new TypeError('terminated'); }};
      return new Response(reply.text, {status:reply.status || 200});
    };`);
  const result = spawnSync(process.execPath, ['--import', './fake.mjs', builder], {cwd:root, env:{...process.env, SNAPSHOT_REGION:mode, GITHUB_RUN_ID:'1'}, encoding:'utf8'});
  let requests = [];
  try { requests = JSON.parse(await readFile(join(root, 'requests.json'), 'utf8')); } catch {}
  const read = async name => { try { return JSON.parse(await readFile(join(root, '.snapshot-cache', name), 'utf8')); } catch { return null; } };
  return {result, requests, read, names:await readdir(join(root, '.snapshot-cache'))};
}

const reopened = `<osm><meta osm_base="${BASE}"/>`
  + `<action type="modify"><old><way id="1"/></old><new><way id="1" version="3"><nd ref="1" lat="10" lon="100"/><nd ref="2" lat="10.2" lon="100.2"/><tag k="railway" v="rail"/><tag k="disused:railway" v="rail"/></way></new></action>`
  + `<action type="delete"><old><way id="100"/></old><new><way id="100" visible="false"/></new></action>`
  + `<action type="delete"><old><way id="101"/></old><new><way id="101" visible="true"/></new></action></osm>`;

test('each cached region takes only its changes, deleted and retagged ways included, and records its query', async t => {
  const {result, requests, read} = await run(t, {
    '0_90_45_135.json': region([way(1, {railway:'construction', construction:'rail'}), ...Array.from({length:40}, (_, i) => way(100 + i, {railway:'abandoned'}))]),
  }, {'0,90,45,135': {text:reopened}});
  assert.equal(result.status, 0, result.stderr);
  const asked = requests.filter(q => q.includes('(0,90,45,135)'));
  assert.equal(asked.length, 1, 'one change request, no full download');
  assert.match(asked[0], /^\[out:xml\]\[timeout:300\]\[maxsize:134217728\]\[adiff:"2026-10-01T00:00:00Z"\];\(way\[railway~/);
  const updated = await read('0_90_45_135.json');
  assert.equal(updated.osm3s.timestamp_osm_base, BASE, 'the next run starts from the new database time');
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
  const log = source.indexOf('await writeFile(DELTA_FILE,JSON.stringify(changeLog));'), region = source.indexOf("await writeFile(file,JSON.stringify({osm3s:{timestamp_osm_base:update.osmBase}");
  assert.ok(log > 0 && region > log);
});

// The region step (SNAPSHOT_REGION=0 is 0,90,45,135) after a full download.
const full = (elements, time = BASE) => ({text:JSON.stringify({osm3s:{timestamp_osm_base:time}, elements})});
const logged = log => Object.fromEntries(Object.entries(log.changes).map(([id, c]) => [id, [c.time, c.feature && c.feature.properties.name]]));

test('a region downloaded again in full logs its differences, so a stale neighbour cannot undo them', async t => {
  const {result, requests, read, names} = await run(t, {
    '0_90_45_135.json.previous': region([way(1, {railway:'proposed', name:'Old'}), way(2, {railway:'abandoned', name:'Gone'}), way(3, {railway:'proposed', name:'Same'})]),
  }, {'0,90,45,135': full([way(1, {railway:'proposed', name:'New'}), way(3, {railway:'proposed', name:'Same'})])}, '0');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(requests.length, 1);
  assert.deepEqual(logged(await read('delta.json')), {1: [BASE, 'New'], 2: [BASE, null]}, 'renamed and removed; the unchanged way not logged');
  assert.ok(!names.includes('0_90_45_135.json.previous'), 'removed once logged');
  assert.equal((await read('0_90_45_135.json')).osm3s.timestamp_osm_base, BASE);
});

test('a region split during its full download logs the differences of all its parts', async t => {
  const T1 = '2026-11-01T05:00:00Z', T2 = '2026-11-01T06:30:00Z';
  const at = (id, lat, lon, name) => ({type:'way', id, tags:{railway:'proposed', name}, geometry:[{lat, lon}, {lat, lon: lon + 0.1}]});
  const {result, read, names} = await run(t, {
    '0_90_45_135.json.previous': region([at(1, 10, 100, 'Old'), at(2, 30, 120, 'Gone')]),
  }, {
    '0,90,45,135': {text:JSON.stringify({osm3s:{timestamp_osm_base:BASE}, remark:'runtime error: Query timed out', elements:[]})},
    '0,90,22.5,112.5': full([at(1, 10, 100, 'New')], T2),
    '0,112.5,22.5,135': full([], T1),
    '22.5,90,45,112.5': full([], T2),
    '22.5,112.5,45,135': full([], T2),
  }, '0');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(names.includes('0_90_45_135.json.split'));
  assert.deepEqual(logged(await read('delta.json')), {1: [T1, 'New'], 2: [T1, null]}, 'at the oldest part\'s time');
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

test('a requested refresh keeps the region\'s data to log the differences', () => {
  const source = readFileSync(fileURLToPath(new URL('../scripts/refresh-snapshot-cache.mjs', import.meta.url)), 'utf8');
  assert.match(source, /rename\(`\$\{dir\}\/\$\{file\.name\}`, `\$\{dir\}\/\$\{file\.name\}\.previous`\)/);
  assert.doesNotMatch(source, /unlink/);
});
