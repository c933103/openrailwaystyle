import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile, mkdir, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import polygonClipping from 'polygon-clipping';
import {EXTRACT_FILTERS, overpassFilters} from '../scripts/extract-filter.mjs';
import {areaKm2} from '../scripts/measure-osm-gaps.mjs';
import {gapTiles, polyFilter, MAX_VERTICES} from '../scripts/gap-tiles.mjs';
import {fetchTile, gapQuery, writeTile, acquireGapTiles, GAP_FILTER_HASH} from '../scripts/acquire-gap-tiles.mjs';
import {nextIndex, planWithGaps, withGaps} from '../scripts/extract-release.mjs';

// What osmium selects, per object type, straight from the expressions: the
// reference the Overpass form must agree with.
const keyMatches = (p, k) => p.length > 1 && p.startsWith('*') && p.endsWith('*') ? k.includes(p.slice(1, -1)) : p.startsWith('*') ? k.endsWith(p.slice(1)) : p.endsWith('*') ? k.startsWith(p.slice(0, -1)) : k === p;
const valueMatches = (p, v) => p.length > 1 && p.startsWith('*') && p.endsWith('*') ? v.includes(p.slice(1, -1)) : p.startsWith('*') ? v.endsWith(p.slice(1)) : p.endsWith('*') ? v.startsWith(p.slice(0, -1)) : p.split(',').includes(v);
const osmiumSelects = (type, key, value) => EXTRACT_FILTERS.some(({expression}) => {
  const [, types, body] = /^([nwr]+)\/(.*)$/.exec(expression);
  if (!types.includes(type[0])) return false;
  const at = body.indexOf('=');
  return (at < 0 ? body : body.slice(0, at)).split(',').some(p => keyMatches(p, key)) && (at < 0 || valueMatches(body.slice(at + 1), value));
});
// The Overpass filters, read back as JavaScript regexes. Overpass uses POSIX
// extended regexes; these use only ^ $ | ( ) and bracketed literals, which
// mean the same in both.
const qlSelects = (type, key, value) => overpassFilters().some(f => {
  if (f.type !== type) return false;
  let m = /^\[~"(.*)"~"(.*)"\]$/.exec(f.tag);
  if (m) return new RegExp(m[1]).test(key) && new RegExp(m[2]).test(value);
  m = /^\["([^"]+)"~"(.*)"\]$/.exec(f.tag);
  return key === m[1] && new RegExp(m[2]).test(value);
});

test('the Overpass form selects exactly what the osmium filter selects', () => {
  const keys = new Set(), values = new Set(['', 'x', 'yes', 'rail', '16.7', '16x7', '50', 'station', 'stations', 'archaeological_site', 'district', '22', '1', '11']);
  for (const {expression} of EXTRACT_FILTERS) {
    const body = expression.replace(/^[nwr]+\//, ''), at = body.indexOf('=');
    for (const k of (at < 0 ? body : body.slice(0, at)).split(',')) for (const form of [k.replaceAll('*', ''), k.replaceAll('*', 'x'), `a${k.replaceAll('*', '')}`, `${k.replaceAll('*', '')}b`]) keys.add(form);
    if (at >= 0) for (const v of body.slice(at + 1).split(',')) for (const form of [v.replaceAll('*', ''), v.replaceAll('*', 'x'), `a${v.replaceAll('*', '')}`, v.replaceAll('*', '').toUpperCase(), v.replaceAll('*', '').slice(1)]) values.add(form);
  }
  let checked = 0, selected = 0;
  for (const type of ['node', 'way', 'relation']) for (const key of keys) for (const value of values) {
    const expected = osmiumSelects(type, key, value);
    assert.equal(qlSelects(type, key, value), expected, `${type} ${key}=${value}`);
    checked++; if (expected) selected++;
  }
  assert.ok(checked > 10000 && selected > 1000, `${checked} checked, ${selected} selected`);
  assert.equal(overpassFilters().length, 23, 'one key filter per type and one per key tested by value');
  assert.ok(overpassFilters().every(f => !f.tag.includes('\\')), 'no backslash escapes');
});

const square = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const union = parts => parts.length ? polygonClipping.union(...parts.map(p => [p])) : [];

test('the tiles cover exactly the remainder, cut where a polygon is too long', () => {
  // A sea gap crossing tile edges, one with a hole (an island a region has),
  // and a ragged one with many vertices.
  const ragged = [[...Array.from({length: 900}, (_, i) => [-30 + 20 * i / 899, -40 + (i % 2) * 0.01]), [-10, -30], [-30, -30], [-30, -40]]];
  const remainder = [{polygon: square(-60, 10, -20, 40)}, {polygon: [square(100, -20, 120, 0)[0], square(105, -15, 110, -10)[0]]}, {polygon: ragged}];
  const tiles = gapTiles(remainder);
  const covered = union(tiles.map(t => t.polygon[0]));
  const gap = union(remainder.map(r => r.polygon[0]));
  assert.ok(Math.abs(areaKm2(covered) - areaKm2(gap)) / areaKm2(gap) < 1e-9, 'the outer rings, all covered');
  assert.ok(polygonClipping.difference(gap, covered).every(p => areaKm2([p]) < 1e-6), 'no remainder left out');
  assert.ok(tiles.every(t => t.polygon.reduce((n, [ring]) => n + ring.length - 1, 0) <= MAX_VERTICES || t.box[3] - t.box[1] <= 45 / 64), 'a long polygon is cut until it fits');
  assert.ok(tiles.some(t => t.box[3] - t.box[1] < 45), 'the ragged gap was cut');
  assert.ok(tiles.find(t => t.key === '-45_90_0_135').polygon.every(part => part.length === 1), 'holes are not cut out');
  assert.deepEqual(gapTiles([]), []);
  assert.deepEqual(gapTiles([{polygon: square(170, 0, 180, 5)}, {polygon: square(-180, 0, -170, 5)}]).map(t => t.key), ['0_-180_45_-135', '0_135_45_180'], 'both sides of the antimeridian');
});

test('a poly filter is lat lon, without the closing point', () => {
  assert.equal(polyFilter(square(1, 2, 3, 4)[0]), 'poly:"2 1 2 3 4 3 4 1"');
  const query = gapQuery([square(1, 2, 3, 4)]);
  assert.match(query, /^\[out:xml\]\[timeout:180\]\[maxsize:536870912\];\(/);
  assert.match(query, /\);\(\._;>>;\);out meta;$/);
  assert.equal(query.split('(poly:"2 1 2 3 4 3 4 1")').length - 1, 23);
});

const answer = (base = '2026-11-05T06:00:00Z', body = '') => `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6"><meta osm_base="${base}"/>${body}</osm>\n`;
const timeoutRemark = answer('2026-11-05T06:00:00Z', '<remark> runtime error: Query timed out in "query" at line 1 after 181 seconds. </remark>');
const tile = {key: '0_-45_45_0', box: [0, -45, 45, 0], polygon: [square(-40, 5, -5, 40)]};
const budget = (extra = {}) => ({requests: 0, bytes: 0, maxRequests: 400, maxBytes: 1024 ** 3, ...extra});
const fake = replies => { const calls = []; return {calls, fetcher: async (url, init) => { calls.push(init.body.get('data')); const r = replies(calls.length); return r instanceof Error ? Promise.reject(r) : r; }}; };

test('a tile splits only when the query itself is too large; an outage keeps its copy', async () => {
  const waits = [];
  const wait = async ms => { waits.push(ms); };
  // An executed-query timeout: the tile is asked for in its quarters.
  let f = fake(n => new Response(n === 1 ? timeoutRemark : answer()));
  let parts = await fetchTile(tile, {fetcher: f.fetcher, wait, budget: budget()});
  assert.equal(f.calls.length, 5);
  assert.equal(parts.length, 4);
  // No answer at all: asked again after 2, 5 and 10 minutes, then the tile fails. Never split.
  waits.length = 0;
  f = fake(() => new TypeError('fetch failed'));
  await assert.rejects(fetchTile(tile, {fetcher: f.fetcher, wait, budget: budget()}), /fetch failed/);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(waits.filter(ms => ms > 10_000), [120_000, 300_000, 600_000]);
  // Busy: the same, never split.
  f = fake(() => new Response('busy', {status: 503}));
  await assert.rejects(fetchTile(tile, {fetcher: f.fetcher, wait, budget: budget()}), /HTTP 503/);
  assert.equal(f.calls.length, 4);
  // A 504 with an executed-query timeout in its body does split.
  f = fake(n => new Response(n === 1 ? 'runtime error: Query ran out of memory' : answer(), {status: n === 1 ? 504 : 200}));
  parts = await fetchTile(tile, {fetcher: f.fetcher, wait, budget: budget()});
  assert.equal(parts.length, 4);
  // Any other remark, or a cut-off answer, fails the tile.
  f = fake(() => new Response(answer('2026-11-05T06:00:00Z', '<remark>something else</remark>')));
  await assert.rejects(fetchTile(tile, {fetcher: f.fetcher, wait, budget: budget()}), /remark/);
  f = fake(() => new Response('<?xml version="1.0"?><osm><meta osm_base="2026-11-05T06:00:00Z"/>'));
  await assert.rejects(fetchTile(tile, {fetcher: f.fetcher, wait, budget: budget()}), /incomplete/);
  // The budget: nothing more is asked.
  f = fake(() => new Response(answer()));
  await assert.rejects(fetchTile(tile, {fetcher: f.fetcher, wait, budget: budget({requests: 400})}), /budget/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(fetchTile(tile, {fetcher: f.fetcher, wait, budget: budget({bytes: 1024 ** 3})}), /budget/);
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium installed, a tile becomes a file and record that publish takes', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'gap-tiles-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const body = '<node id="2" version="1" timestamp="2026-10-01T00:00:00Z" lat="10" lon="-30"/><node id="1" version="3" timestamp="2026-10-01T00:00:00Z" lat="10" lon="-31"><tag k="railway" v="halt"/></node>';
  const answers = [answer('2026-11-05T06:00:00Z', body), answer('2026-11-05T05:59:00Z', '<node id="1" version="3" timestamp="2026-10-01T00:00:00Z" lat="10" lon="-31"><tag k="railway" v="halt"/></node>')];
  let n = 0;
  const {results} = await acquireGapTiles([tile, {...tile, key: 'empty'}], root, {fetcher: async () => new Response(n++ === 1 ? answer() : answers[0]), wait: async () => {}});
  assert.equal(results.length, 2);
  const manifest = JSON.parse(await readFile(join(root, `gap-${tile.key}`, 'extract.json'), 'utf8'));
  assert.deepEqual(manifest.counts, {nodes: 2, ways: 0, relations: 0});
  assert.equal(manifest.region, `gap/${tile.key}`);
  assert.equal(manifest.filter, GAP_FILTER_HASH);
  assert.equal(manifest.sourceTimestamp, '2026-11-05T06:00:00Z');
  assert.deepEqual(JSON.parse(await readFile(join(root, 'gap-empty', 'extract.json'), 'utf8')).counts, {nodes: 0, ways: 0, relations: 0}, 'an empty answer is a valid file');
  assert.deepEqual((await readdir(join(root, `gap-${tile.key}`))).sort(), ['extract.json', 'filtered.osm.pbf']);
  // Split parts sharing an object: kept once; the tile is as current as its oldest part.
  const split = await writeTile(tile, answers.map((text, i) => ({text, osmBase: i ? '2026-11-05T05:59:00Z' : '2026-11-05T06:00:00Z'})), join(root, 'split'));
  assert.deepEqual(split.counts, {nodes: 2, ways: 0, relations: 0});
  assert.equal(split.sourceTimestamp, '2026-11-05T05:59:00Z');
  // Older than the working copy: rejected, nothing left to publish.
  await assert.rejects(writeTile(tile, [{text: answers[0], osmBase: '2026-11-05T06:00:00Z'}], join(root, 'older'), {previous: {sourceTimestamp: '2026-11-06T00:00:00Z'}}), /older than the working copy/);
  assert.ok(!(await readdir(join(root, 'older'))).includes('filtered.osm.pbf'));
  // A failed tile records why.
  const failed = await acquireGapTiles([{...tile, key: 'down'}], root, {fetcher: async () => new Response('busy', {status: 429}), wait: async () => {}});
  assert.match(failed.results[0].failed, /HTTP 429/);
  assert.match(JSON.parse(await readFile(join(root, 'gap-down', 'failed.json'), 'utf8')).error, /HTTP 429/);
});

test('publish takes gap tiles as regions of their own, and keeps stored ones when a run has none', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gap-tiles-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const plan = {valid: true, sourceDate: '2026-11-03', regions: [{id: 'a', bytes: 1, polygon: [square(0, 0, 1, 1)]}]};
  const gaps = {tiles: [{key: 'k1', polygon: [square(5, 5, 6, 6)]}, {key: 'k2', polygon: [square(7, 7, 8, 8)]}]};
  const dir = join(root, 'gap-k1');
  await mkdir(dir, {recursive: true});
  await writeFile(join(dir, 'filtered.osm.pbf'), 'pbf');
  const {createHash} = await import('node:crypto');
  const manifest = {region: 'gap/k1', kind: 'gap', sourceDate: '2026-11-05', sourceTimestamp: '2026-11-05T06:00:00Z', url: 'u', pbfBytes: 0, sourceMd5: null,
    filteredBytes: 3, filteredSha256: createHash('sha256').update('pbf').digest('hex'), counts: {nodes: 0, ways: 0, relations: 0}, filter: GAP_FILTER_HASH};
  const {index, outcomes} = nextIndex(withGaps(plan, gaps), null, [{dir, manifest, failed: null}], '20261105T060000Z-1');
  assert.equal(index.regions['gap/k1'].kind, 'gap');
  assert.deepEqual(index.polygons['gap/k1'], gaps.tiles[0].polygon);
  assert.deepEqual(index.missing, ['a', 'gap/k2'], 'a gap tile never fetched is listed, never taken for complete');
  assert.deepEqual(index.olderFilter, []);
  assert.equal(outcomes.find(o => o.region === 'gap/k1').outcome, 'updated');
  // The osmium filter's hash is not current for a gap tile.
  const wrong = nextIndex(withGaps(plan, gaps), null, [{dir, manifest: {...manifest, filter: 'f'}, failed: null}], '20261105T060000Z-1');
  assert.match(wrong.outcomes.find(o => o.region === 'gap/k1').reason, /filter f is not the current overpass:/);
  // Without this run's tiles, the stored gap tiles stay planned.
  const previous = {regions: {a: {region: 'a'}, 'gap/k1': {region: 'gap/k1'}}};
  assert.deepEqual(planWithGaps(plan, null, previous).regions.map(r => r.id), ['a', 'gap/k1']);
  assert.deepEqual(planWithGaps(plan, gaps, previous).regions.map(r => r.id), ['a', 'gap/k1', 'gap/k2']);
});

test('publication imports on a fresh runner without npm dependencies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gap-publish-import-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await cp(new URL('../scripts/', import.meta.url), join(root, 'scripts'), {recursive: true});
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./scripts/extract-release.mjs')"], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

test('gap query completely resolves a selected parent with an unselected child relation', async () => {
  const nested = '<relation id="20"><member type="relation" ref="21"/><tag k="route" v="train"/></relation>';
  const descendants = '<relation id="21"><member type="way" ref="22"/></relation><way id="22"><nd ref="23"/></way><node id="23" lat="0" lon="0"/>';
  const parts = await fetchTile(tile, {budget: budget(), wait: async () => {}, fetcher: async (_url, init) => {
    const query = init.body.get('data');
    // This fixture models > versus >>: only complete recursion returns
    // the child relation and its descendants, which do not match the tags.
    return new Response(answer(undefined, nested + (query.includes('(._;>>;);') ? descendants : '')));
  }});
  for (const id of [20, 21, 22, 23]) assert.match(parts[0].text, new RegExp(`id="${id}"`));
});

test('byte cap cancels a streamed response immediately and does not retry', async () => {
  let reads = 0, cancelled = false, calls = 0;
  const b = budget({maxBytes: 7});
  const fetcher = async () => {
    calls++;
    return new Response(new ReadableStream({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(4)); },
      cancel() { cancelled = true; },
    }, {highWaterMark: 0}));
  };
  await assert.rejects(fetchTile(tile, {fetcher, wait: async () => {}, budget: b}), /byte budget/);
  assert.equal(reads, 2);
  assert.equal(b.bytes, 8, 'count the entire chunk that crossed the boundary');
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
  await assert.rejects(fetchTile(tile, {fetcher, wait: async () => {}, budget: b}), /budget/);
  assert.equal(calls, 1, 'no subsequent tile can request more');
});

test('bytes from failed body reads count against retries; UTF-8 is decoded across chunks', async () => {
  let calls = 0;
  const b = budget();
  const text = answer(undefined, '<note>日本</note>');
  const bytes = Buffer.from(text);
  const parts = await fetchTile(tile, {budget: b, wait: async () => {}, fetcher: async () => {
    calls++;
    let offset = 0;
    return new Response(new ReadableStream({pull(controller) {
      if (calls === 1) {
        if (offset++ === 0) controller.enqueue(new Uint8Array(5));
        else controller.error(new Error('connection reset'));
      } else if (offset < bytes.length) controller.enqueue(bytes.subarray(offset, ++offset));
      else controller.close();
    }}, {highWaterMark: 0}));
  }});
  assert.equal(calls, 2);
  assert.equal(b.bytes, 5 + bytes.length);
  assert.equal(parts[0].text, text);
});
