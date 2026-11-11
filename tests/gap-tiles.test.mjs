import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile, mkdir, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import polygonClipping from 'polygon-clipping';
import {EXTRACT_FILTERS, overpassFilters} from '../scripts/extract-filter.mjs';
import {gapTiles, polyFilter, MAX_VERTICES} from '../scripts/gap-tiles.mjs';
import {fetchTile, gapQuery, writeTile, acquireGapTiles, tileOrder, requestDispatcher, GAP_FILTER_HASH, REQUEST_TIMEOUT_MS, MAX_UNANSWERED_TILES, INSTANCES, overpassInstances} from '../scripts/acquire-gap-tiles.mjs';
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
// Planar area in degrees², exact for the clipped geometry. The spherical
// areaKm2 is not additive when a polygon is cut along a parallel (on the
// 2026-11-05 plan it differs by 0.02%), so it cannot check coverage.
const ringArea = r => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a) / 2; };
const planar = multi => multi.reduce((sum, [outer, ...holes]) => sum + ringArea(outer) - holes.reduce((h, ring) => h + ringArea(ring), 0), 0);

test('the tiles cover exactly the remainder, cut where a polygon is too long', () => {
  // A sea gap crossing tile edges, one with a hole (an island a region has),
  // and a ragged one with many vertices.
  const ragged = [[...Array.from({length: 900}, (_, i) => [-30 + 20 * i / 899, -40 + (i % 2) * 0.01]), [-10, -30], [-30, -30], [-30, -40]]];
  const remainder = [{polygon: square(-60, 10, -20, 40)}, {polygon: [square(100, -20, 120, 0)[0], square(105, -15, 110, -10)[0]]}, {polygon: ragged}];
  const tiles = gapTiles(remainder);
  const gap = polygonClipping.union(...remainder.map(r => [r.polygon]));
  const covered = polygonClipping.union(...tiles.map(t => t.polygon));
  assert.equal(planar(polygonClipping.difference(gap, covered)), 0, 'no remainder left out');
  assert.equal(planar(polygonClipping.difference(covered, gap)), 0, 'nothing outside the remainder: holes stay out');
  assert.ok(Math.abs(tiles.reduce((sum, t) => sum + planar(t.polygon), 0) - planar(gap)) < 1e-9, 'the tiles do not overlap');
  assert.ok(tiles.every(t => t.polygon.reduce((n, [ring]) => n + ring.length - 1, 0) <= MAX_VERTICES || t.box[3] - t.box[1] <= 45 / 64), 'a long polygon is cut until it fits');
  assert.ok(tiles.some(t => t.box[3] - t.box[1] < 45), 'the ragged gap was cut');
  assert.deepEqual(tiles.find(t => t.key === '-45_90_0_135').polygon.map(part => part.length), [2], 'the hole (an island a region covers) is kept');
  assert.deepEqual(gapTiles([]), []);
  assert.deepEqual(gapTiles([{polygon: square(170, 0, 180, 5)}, {polygon: square(-180, 0, -170, 5)}]).map(t => t.key), ['0_-180_45_-135', '0_135_45_180'], 'both sides of the antimeridian');
});

test('a poly filter is lat lon, without the closing point', () => {
  assert.equal(polyFilter(square(1, 2, 3, 4)[0]), 'poly:"2 1 2 3 4 3 4 1"');
  const query = gapQuery([square(1, 2, 3, 4)]);
  assert.match(query, /^\[out:xml\]\[timeout:180\]\[maxsize:536870912\];\(/);
  assert.match(query, /\(\.p0;\)->\.g;\(\.g;\.g >>;\);out meta;$/);
  assert.equal(query.split('(poly:"2 1 2 3 4 3 4 1")').length - 1, 23);
  // A hole is taken out of its own part once, never asked for with every filter.
  const holed = gapQuery([[square(0, 0, 10, 10)[0], square(2, 2, 3, 3)[0]], square(20, 0, 21, 1)]);
  assert.equal(holed.split('(poly:"2 2 2 3 3 3 3 2")').length - 1, 1);
  assert.match(holed, /->\.p0;nwr\.p0\(poly:"2 2 2 3 3 3 3 2"\)->\.h0_0;\(\.p0; - \.h0_0;\)->\.p0;/);
  assert.match(holed, /\(\.p0;\.p1;\)->\.g;\(\.g;\.g >>;\);out meta;$/);
});

const answer = (base = '2026-11-05T06:00:00Z', body = '') => `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6"><meta osm_base="${base}"/>${body}</osm>\n`;
const timeoutRemark = answer('2026-11-05T06:00:00Z', '<remark> runtime error: Query timed out in "query" at line 1 after 181 seconds. </remark>');
const tile = {key: '0_-45_45_0', box: [0, -45, 45, 0], polygon: [square(-40, 5, -5, 40)]};
const budget = (extra = {}) => ({requests: 0, bytes: 0, maxRequests: 400, maxBytes: 1024 ** 3, ...extra});
const fake = replies => { const calls = []; return {calls, fetcher: async (url, init) => { calls.push(init.body.get('data')); const r = replies(calls.length); return r instanceof Error ? Promise.reject(r) : r; }}; };

const fakeClock = (start = '2026-11-06T19:00:00Z', {earlyWakeAt = -1} = {}) => {
  let time = Date.parse(start), elapsed = 0, timers = 0;
  return {now: () => time, clock: () => elapsed, jump: (wall, body = 0) => {time += wall + body; elapsed += body;},
    wait: async ms => {const step = timers++ === earlyWakeAt ? ms / 2 : ms; time += step; elapsed += step;}};
};

test('the last failed tile retains Retry-After for the next tile', async () => {
  const clock = fakeClock(), b = budget(), sent = [];
  const fetcher = async () => {
    sent.push(clock.now());
    return sent.length <= 4 ? new Response('busy', {status: 503, headers: {'retry-after': '600'}}) : new Response(answer());
  };
  await assert.rejects(fetchTile(tile, {...clock, fetcher, budget: b}), /HTTP 503/);
  await fetchTile({...tile, key: 'next'}, {...clock, fetcher, budget: b});
  assert.equal(sent.length, 5);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i] - sent[i - 1] >= 600_000, `request ${i + 1} was early`);
});

test('query-limit subdivision carries the provider pause into its children', async () => {
  const clock = fakeClock(), b = budget(), sent = [];
  const fetcher = async () => {
    sent.push(clock.now());
    return sent.length === 1 ? new Response(timeoutRemark, {headers: {'retry-after': new Date(clock.now() + 180_000).toUTCString()}}) : new Response(answer());
  };
  const parts = await fetchTile(tile, {...clock, fetcher, budget: b});
  assert.equal(parts.length, 4);
  assert.ok(sent[1] - sent[0] >= 180_000);
  assert.ok(sent.slice(2).every((t, i) => t - sent[i + 1] >= 10_000));
});

test('an interrupted response body does not lose the received Retry-After', async () => {
  const clock = fakeClock(), b = budget(), sent = [];
  const fetcher = async () => {
    sent.push(clock.now());
    if (sent.length > 1) return new Response(answer());
    return new Response(new ReadableStream({start(controller) { controller.error(new Error('body reset')); }}), {status: 503, headers: {'retry-after': '600'}});
  };
  await fetchTile(tile, {...clock, fetcher, budget: b});
  assert.equal(sent.length, 2);
  assert.ok(sent[1] - sent[0] >= 600_000);
});

test('a provider pause beyond the local wait limit stops later requests instead of shortening it', async () => {
  const clock = fakeClock(), b = budget();
  let calls = 0;
  const fetcher = async () => { calls++; return new Response('busy', {status: 429, headers: {'retry-after': '3600'}}); };
  await assert.rejects(fetchTile(tile, {...clock, fetcher, budget: b}), /Retry-After/);
  await assert.rejects(fetchTile({...tile, key: 'next'}, {...clock, fetcher, budget: b}), /Retry-After/);
  assert.equal(calls, 1);
  assert.equal(b.requests, 1);
});

test('Retry-After accepts the exact wait limit and ignores invalid or expired dates', async () => {
  for (const header of ['900', 'invalid', 'Thu, 05 Nov 2026 19:00:00 GMT']) {
    const clock = fakeClock(), sent = [];
    const fetcher = async () => {
      sent.push(clock.now());
      return sent.length === 1 ? new Response('busy', {status: 503, headers: {'retry-after': header}}) : new Response(answer());
    };
    await fetchTile(tile, {...clock, fetcher, budget: budget()});
    assert.equal(sent.length, 2);
    assert.equal(sent[1] - sent[0], header === '900' ? 910_000 : 130_000, 'the existing retry and spacing schedule is preserved');
  }
});

test('long date and overflowing delay values retain every remaining tile without another request', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gap-retry-after-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const [i, header] of ['Fri, 06 Nov 2026 20:00:00 GMT', '9'.repeat(400)].entries()) {
    const clock = fakeClock(), index = {regions: {[`gap/${tile.key}`]: {sourceTimestamp: '2026-11-05T06:00:00Z', asset: 'old.osm.pbf'}}};
    const saved = JSON.stringify(index);
    let calls = 0;
    const out = join(root, String(i));
    const result = await acquireGapTiles([tile, {...tile, key: 'next'}], out, {
      ...clock, index, fetcher: async () => { calls++; return new Response('busy', {status: 429, headers: {'retry-after': header}}); },
      run: async () => { throw new Error('osmium must not run without an answer'); },
    });
    assert.equal(calls, 1);
    assert.equal(result.requests, 1);
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every(r => /Retry-After/.test(r.failed)));
    for (const key of [tile.key, 'next']) assert.deepEqual(await readdir(join(out, `gap-${key}`)), ['failed.json']);
    assert.equal(JSON.stringify(index), saved);
  }
});

test('a tile splits only when the query itself is too large; an outage keeps its copy', async () => {
  const waits = [];
  let elapsed = 0; const wait = async ms => { waits.push(ms); elapsed += ms; };
  // An executed-query timeout: the tile is asked for in its quarters.
  let f = fake(n => new Response(n === 1 ? timeoutRemark : answer()));
  let parts = await fetchTile(tile, {fetcher: f.fetcher, wait, clock:()=>elapsed, budget: budget()});
  assert.equal(f.calls.length, 5);
  assert.equal(parts.length, 4);
  // No answer at all: asked again after 2, 5 and 10 minutes, then the tile fails. Never split.
  waits.length = 0;
  f = fake(() => new TypeError('fetch failed'));
  await assert.rejects(fetchTile(tile, {fetcher: f.fetcher, wait, clock:()=>elapsed, budget: budget()}), /fetch failed/);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(waits.filter(ms => ms > 10_000), [120_000, 300_000, 600_000]);
  // Busy: the same, never split.
  f = fake(() => new Response('busy', {status: 503}));
  await assert.rejects(fetchTile(tile, {fetcher: f.fetcher, wait, clock:()=>elapsed, budget: budget()}), /HTTP 503/);
  assert.equal(f.calls.length, 4);
  // A 504 with an executed-query timeout in its body does split.
  f = fake(n => new Response(n === 1 ? 'runtime error: Query ran out of memory' : answer(), {status: n === 1 ? 504 : 200}));
  parts = await fetchTile(tile, {fetcher: f.fetcher, wait, clock:()=>elapsed, budget: budget()});
  assert.equal(parts.length, 4);
  // Any other remark, or a cut-off answer, fails the tile.
  f = fake(() => new Response(answer('2026-11-05T06:00:00Z', '<remark>something else</remark>')));
  await assert.rejects(fetchTile(tile, {fetcher: f.fetcher, wait, clock:()=>elapsed, budget: budget()}), /remark/);
  f = fake(() => new Response('<?xml version="1.0"?><osm><meta osm_base="2026-11-05T06:00:00Z"/>'));
  await assert.rejects(fetchTile(tile, {fetcher: f.fetcher, wait, clock:()=>elapsed, budget: budget()}), /incomplete/);
  // The budget: nothing more is asked.
  f = fake(() => new Response(answer()));
  await assert.rejects(fetchTile(tile, {fetcher: f.fetcher, wait, clock:()=>elapsed, budget: budget({requests: 400})}), /budget/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(fetchTile(tile, {fetcher: f.fetcher, wait, clock:()=>elapsed, budget: budget({bytes: 1024 ** 3})}), /budget/);
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium installed, a tile becomes a file and record that publish takes', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'gap-tiles-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const body = '<node id="2" version="1" timestamp="2026-10-01T00:00:00Z" lat="10" lon="-30"/><node id="1" version="3" timestamp="2026-10-01T00:00:00Z" lat="10" lon="-31"><tag k="railway" v="halt"/></node>';
  const answers = [answer('2026-11-05T06:00:00Z', body), answer('2026-11-05T05:59:00Z', '<node id="1" version="3" timestamp="2026-10-01T00:00:00Z" lat="10" lon="-31"><tag k="railway" v="halt"/></node>')];
  let n = 0;
  const {results} = await acquireGapTiles([tile, {...tile, key: 'empty'}], root, {fetcher: async () => new Response(n++ === 1 ? answer() : answers[0]), ...fakeClock()});
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
  const failed = await acquireGapTiles([{...tile, key: 'down'}], root, {fetcher: async () => new Response('busy', {status: 429}), ...fakeClock()});
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
  const parts = await fetchTile(tile, {budget: budget(), ...fakeClock(), fetcher: async (_url, init) => {
    const query = init.body.get('data');
    // This fixture models > versus >>: only complete recursion returns
    // the child relation and its descendants, which do not match the tags.
    return new Response(answer(undefined, nested + (query.includes('.g >>;') ? descendants : '')));
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
  await assert.rejects(fetchTile(tile, {fetcher, ...fakeClock(), budget: b}), /byte budget/);
  assert.equal(reads, 2);
  assert.equal(b.bytes, 8, 'count the entire chunk that crossed the boundary');
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
  await assert.rejects(fetchTile(tile, {fetcher, ...fakeClock(), budget: b}), /budget/);
  assert.equal(calls, 1, 'no subsequent tile can request more');
});

test('bytes from failed body reads count against retries; UTF-8 is decoded across chunks', async () => {
  let calls = 0;
  const b = budget();
  const text = answer(undefined, '<note>日本</note>');
  const bytes = Buffer.from(text);
  const parts = await fetchTile(tile, {budget: b, ...fakeClock(), fetcher: async () => {
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

for(const mode of ['pending','rejects','throws'])test(`gap byte-budget failure does not wait for cancellation that ${mode}`,async()=>{
 let release,timer,cancelled=0,reads=0,calls=0;
 const cancellation=new Promise(resolve=>{release=resolve;});
 const b=budget({maxBytes:7});
 const body=new ReadableStream({
  pull(controller){reads++;controller.enqueue(new Uint8Array(4));},
  cancel(){cancelled++;if(mode==='throws')throw Error('cleanup throw');if(mode==='rejects')return Promise.reject(Error('cleanup rejection'));return cancellation;},
 },{highWaterMark:0});
 const fetcher=async()=>{calls++;return new Response(body);};
 const result=fetchTile(tile,{fetcher,...fakeClock(),budget:b});
 try{
  await assert.rejects(Promise.race([result,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('gap checkpoint waited for cleanup')),1000);})]),error=>error.budget===true&&/byte budget/.test(error.message));
  assert.equal(cancelled,1);assert.equal(body.locked,false);assert.equal(reads,2);assert.equal(b.bytes,8);assert.equal(calls,1);
  await assert.rejects(fetchTile(tile,{fetcher,...fakeClock(),budget:b}),/budget/);assert.equal(calls,1);
 }finally{clearTimeout(timer);release();await result.catch(()=>{});}
});

for(const header of ['Tue, 31 Nov 2026 19:00:00 GMT','Foo, 06 Nov 2026 19:08:00 GMT']) {
 for(const path of ['next tile','HTTP error','body failure','query split']) test(`gap calendar ignores malformed date across ${path}: ${header}`,async()=>{
  const clock=fakeClock(),b=budget(),sent=[],queries=[];
  const fetcher=async(_url,init)=>{
   sent.push(clock.now());queries.push(init.body.get('data'));
   if(sent.length!==1)return new Response(answer());
   const headers={'retry-after':header};
   if(path==='body failure')return new Response(new ReadableStream({start(controller){controller.error(new Error('body reset'));}}),{headers});
   return new Response(path==='HTTP error'?'busy':path==='query split'?timeoutRemark:answer(),{status:path==='HTTP error'?503:200,headers});
  };
  const parts=await fetchTile(tile,{...clock,fetcher,budget:b});
  if(path==='next tile')await fetchTile({...tile,key:'next'},{...clock,fetcher,budget:b});
  assert.equal(sent.length,path==='query split'?5:2);assert.equal(sent[1]-sent[0],path==='HTTP error'||path==='body failure'?130000:10000);
  assert.equal(parts.length,path==='query split'?4:1);assert.equal(!!b.providerWaitExceeded,false);
  if(path==='HTTP error'||path==='body failure')assert.equal(queries[0],queries[1]);
 });
}
for(const header of ['Sun, 01 Jan 2090 12:08:00 GMT','Sunday, 01-Jan-90 12:08:00 GMT','Sun Jan  1 12:08:00 2090'])
 test(`gap calendar honors valid provider date through header capture and HTTP backoff: ${header}`,async()=>{
  const clock=fakeClock('2090-01-01T12:00:00Z'),sent=[];
  await fetchTile(tile,{...clock,budget:budget(),fetcher:async()=>{
   sent.push(clock.now());return sent.length===1?new Response('busy',{status:503,headers:{'retry-after':header}}):new Response(answer());
  }});
  assert.equal(sent.length,2);assert.equal(sent[1]-sent[0],490000);
 });

for(const path of ['HTTP seconds','HTTP date','body failure','next tile','query split'])for(const wallShift of [3600000,-3600000])test(`gap ${path} retains observed pause through ${wallShift}ms wall correction`,async()=>{
 const clock=fakeClock(),b=budget(),sent=[],queries=[];
 const fetcher=async(_url,init)=>{
  sent.push(clock.clock());queries.push(init.body.get('data'));if(sent.length!==1)return new Response(answer());
  const isHttp=path.startsWith('HTTP'),header=path==='HTTP date'?new Date(clock.now()+600000).toUTCString():'600';
  const bytes=Buffer.from(isHttp?'busy':path==='query split'?timeoutRemark:answer());let read=false;
  const body=new ReadableStream({pull(controller){if(read){controller.close();return;}read=true;clock.jump(wallShift,path==='HTTP seconds'?300000:0);if(path==='body failure')controller.error(Error('body reset'));else controller.enqueue(bytes);}}, {highWaterMark:0});
  return new Response(body,{status:isHttp?503:200,headers:{'retry-after':header}});
 };
 const parts=await fetchTile(tile,{...clock,fetcher,budget:b});
 if(path==='next tile')await fetchTile({...tile,key:'next'},{...clock,fetcher,budget:b});
 assert.equal(sent.length,path==='query split'?5:2);assert.equal(parts.length,path==='query split'?4:1);
 assert.equal(sent[1]-sent[0],path.startsWith('HTTP')?610000:600000);
 if(path.startsWith('HTTP')||path==='body failure')assert.equal(queries[0],queries[1]);
});
for(const path of ['HTTP error','body failure','spacing'])test(`gap rechecks an early ${path} wait without changing its retry-plus-spacing schedule`,async()=>{
 const clock=fakeClock(undefined,{earlyWakeAt:0}),b=budget(),sent=[];
 const fetcher=async()=>{sent.push(clock.clock());if(sent.length!==1)return new Response(answer());if(path==='body failure')throw Error('fetch failed');return new Response(path==='HTTP error'?'busy':answer(),{status:path==='HTTP error'?503:200,headers:path==='HTTP error'?{'retry-after':'600'}:{}});};
 await fetchTile(tile,{...clock,fetcher,budget:b});if(path==='spacing')await fetchTile({...tile,key:'next'},{...clock,fetcher,budget:b});
 assert.equal(sent.length,2);assert.equal(sent[1]-sent[0],path==='HTTP error'?610000:path==='body failure'?130000:10000);
});
test('gap body failure already consumes an observed pause while keeping normal retry spacing',async()=>{
 const clock=fakeClock(),b=budget(),sent=[];
 await fetchTile(tile,{...clock,budget:b,fetcher:async()=>{sent.push(clock.clock());if(sent.length>1)return new Response(answer());return new Response(new ReadableStream({pull(controller){clock.jump(0,300000);controller.error(Error('body reset'));}},{highWaterMark:0}),{headers:{'retry-after':'600'}});}});
 assert.equal(sent.length,2);assert.equal(sent[1]-sent[0],600000);
});

test('a tile split for size keeps its holes in the quarters', async () => {
  // A hole (an island a region covers) in the south-west quarter of the tile.
  const holed = {key: '0_-45_45_0', box: [0, -45, 45, 0], polygon: [[square(-40, 5, -5, 40)[0], square(-30, 10, -29, 11)[0]]]};
  const f = fake(n => new Response(n === 1 ? timeoutRemark : answer()));
  await fetchTile(holed, {fetcher: f.fetcher, budget: budget(), ...fakeClock()});
  // Clipping may reverse the ring, so the hole is matched by its corners.
  const cutsHole = query => /nwr\.p0\(poly:"(?=[^"]*10 -30)(?=[^"]*11 -29)[^"]*"\)->\.h0_0;\(\.p0; - \.h0_0;\)/.test(query);
  assert.equal(f.calls.length, 5);
  assert.equal(f.calls.filter(cutsHole).length, 2, 'the whole tile and the quarter holding the hole both take it out');
});

// Run limits: a run that cannot finish in its job's time still writes its
// outputs, and an unreachable server is not asked for every remaining tile.
const noOsmium = async () => { throw new Error('osmium must not run without an answer'); };
const failedNames = async out => Object.fromEntries(await Promise.all((await readdir(out)).map(async d => [d, JSON.parse(await readFile(join(out, d, 'failed.json'), 'utf8')).error])));

test('the time budget stops before a request that could not finish, and keeps every unreached tile', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gap-deadline-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const tiles = ['a', 'b', 'c'].map(key => ({...tile, key}));
  // Busy every time: each tile takes 4 requests and 17 minutes of waits.
  const clock = fakeClock(), sent = [];
  const fetcher = async () => { sent.push(clock.clock()); return new Response('busy', {status: 503}); };
  const budgetMs = 40 * 60_000;
  const {results, requests} = await acquireGapTiles(tiles, root, {...clock, fetcher, run: noOsmium, timeBudgetMs: budgetMs});
  assert.ok(sent.every(at => at + REQUEST_TIMEOUT_MS <= budgetMs), 'every request could run to its timeout inside the budget');
  // Tile a: 4 requests. Tile b: 3 sent; its last retry (10 min) would leave no time.
  assert.equal(requests, 7);
  assert.equal(sent.length, 7);
  assert.equal(results.length, 3);
  const errors = await failedNames(root);
  assert.match(errors['gap-a'], /HTTP 503/);
  assert.match(errors['gap-b'], /time budget.*HTTP 503/);
  assert.match(errors['gap-c'], /^not asked: the run's time budget/);
  assert.ok(clock.clock() <= budgetMs, 'the run ends inside its budget, without waiting out a retry it cannot use');
  // No budget: the old behaviour, every tile asked 4 times.
  const free = fakeClock(); let calls = 0;
  await acquireGapTiles(tiles, join(root, 'free'), {...free, fetcher: async () => { calls++; return new Response('busy', {status: 503}); }, run: noOsmium});
  assert.equal(calls, 12);
});

test('two tiles in a row without any answer stop the run; an answer in between does not', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gap-unanswered-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  assert.equal(MAX_UNANSWERED_TILES, 2);
  // One instance: the stop itself (the list's failover is tested below).
  const one = {instances: ['https://overpass-api.de/api/interpreter']};
  const tiles = ['a', 'b', 'c', 'd'].map(key => ({...tile, key}));
  const down = () => new TypeError('fetch failed', {cause: Object.assign(new Error('other side closed'), {code: 'UND_ERR_SOCKET'})});
  let f = fake(down);
  let result = await acquireGapTiles(tiles, join(root, 'down'), {...fakeClock(), ...one, fetcher: f.fetcher, run: noOsmium});
  assert.equal(f.calls.length, 8, 'tiles a and b are asked 4 times each, c and d never');
  const errors = await failedNames(join(root, 'down'));
  assert.match(errors['gap-a'], /fetch failed: fetch failed: UND_ERR_SOCKET: other side closed/, 'the reason is kept');
  assert.match(errors['gap-c'], /not asked: no Overpass instance answered 2 tiles in a row/);
  assert.match(errors['gap-d'], /not asked/);
  assert.equal(result.results.length, 4);
  // Tile b is answered (busy): the count starts again, so c and d are asked.
  f = fake(n => n > 4 && n <= 8 ? new Response('busy', {status: 503}) : down());
  result = await acquireGapTiles(tiles, join(root, 'busy'), {...fakeClock(), ...one, fetcher: f.fetcher, run: noOsmium});
  assert.equal(f.calls.length, 16);
  // A fetched tile in between starts the count again too.
  const fakeOsmium = async (_cmd, args) => { if (args[0] === 'cat') return {stdout: ''}; await writeFile(args[args.indexOf('-o') + 1], ''); return {stdout: ''}; };
  f = fake(n => n === 5 ? new Response(answer()) : down());
  result = await acquireGapTiles(tiles, join(root, 'fetched'), {...fakeClock(), ...one, fetcher: f.fetcher, run: fakeOsmium});
  assert.ok(!result.results[1].failed);
  assert.equal(f.calls.length, 13, 'a 4, b 1, c 4, d 4');
  // One answer among a tile's retries is an answer: the tile does not count.
  f = fake(n => n === 2 || n === 6 ? new Response('busy', {status: 503}) : down());
  await acquireGapTiles(tiles, join(root, 'mixed'), {...fakeClock(), ...one, fetcher: f.fetcher, run: noOsmium});
  assert.equal(f.calls.length, 16);
});

test('an instance that stops answering hands the next tiles to the next instance on the list, one at a time; the run stops when the list is used up', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gap-instances-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  assert.deepEqual(INSTANCES, ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']);
  const tiles = ['a', 'b', 'c', 'd', 'e'].map(key => ({...tile, key}));
  const down = () => new TypeError('fetch failed', {cause: Object.assign(new Error('Connect Timeout Error'), {code: 'UND_ERR_CONNECT_TIMEOUT'})});
  const fakeOsmium = async (_cmd, args) => { if (args[0] === 'cat') return {stdout: ''}; await writeFile(args[args.indexOf('-o') + 1], ''); return {stdout: ''}; };
  // The first instance never answers; the second answers every tile.
  const urls = [], lines = [];
  let inFlight = 0, most = 0;
  const fetcher = async url => { urls.push(url); inFlight++; most = Math.max(most, inFlight); try { await null; if (url === INSTANCES[0]) throw down(); return new Response(answer()); } finally { inFlight--; } };
  const result = await acquireGapTiles(tiles, join(root, 'failover'), {...fakeClock(), instances: [...INSTANCES], fetcher, run: fakeOsmium, log: line => lines.push(line)});
  assert.deepEqual(urls.map(url => url === INSTANCES[0] ? 1 : 2), [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2], 'a and b on the first (4 each), then c, d and e on the second');
  assert.equal(most, 1, 'never two requests at once');
  assert.deepEqual(result.results.map(r => Boolean(r.failed)), [true, true, false, false, false]);
  assert.equal(result.instance, INSTANCES[1]);
  assert.ok(lines.includes(`${INSTANCES[0]} did not answer 2 tiles in a row; asking ${INSTANCES[1]}`));
  const manifest = JSON.parse(await readFile(join(root, 'failover', 'gap-c', 'extract.json'), 'utf8'));
  assert.equal(manifest.url, INSTANCES[1], 'a tile records the instance that answered it');
  // Both down: two tiles on each, then the run stops.
  urls.length = 0;
  const none = await acquireGapTiles(tiles, join(root, 'down'), {...fakeClock(), instances: [...INSTANCES], fetcher: async url => { urls.push(url); throw down(); }, run: fakeOsmium});
  assert.equal(urls.length, 16);
  assert.match(none.results[4].failed, /not asked: no Overpass instance answered 2 tiles in a row/);
  // The list from the environment: OVERPASS_URLS, else OVERPASS_URL, else the default; HTTPS only.
  assert.deepEqual(overpassInstances({}), [...INSTANCES]);
  assert.deepEqual(overpassInstances({OVERPASS_URL: 'https://example.org/api/interpreter'}), ['https://example.org/api/interpreter']);
  assert.deepEqual(overpassInstances({OVERPASS_URLS: ' https://a.example/i , https://b.example/i ', OVERPASS_URL: 'https://c.example/i'}), ['https://a.example/i', 'https://b.example/i']);
  assert.throws(() => overpassInstances({OVERPASS_URLS: 'http://a.example/i'}), /not HTTPS/);
  assert.throws(() => overpassInstances({OVERPASS_URLS: ' , '}), /No Overpass instance/);
});

test('tiles without a working copy go first, then the oldest', async t => {
  const tiles = ['a', 'b', 'c', 'd', 'e'].map(key => ({key}));
  const index = {regions: {'gap/a': {sourceTimestamp: '2026-11-09T14:00:00Z'}, 'gap/b': {sourceTimestamp: '2026-11-05T06:00:00Z'},
    'gap/d': {sourceTimestamp: '2026-11-09T14:00:00Z'}, 'gap/e': {sourceTimestamp: 'not a date'}}};
  assert.deepEqual(tileOrder(tiles, index).map(t => t.key), ['c', 'e', 'b', 'a', 'd']);
  assert.deepEqual(tileOrder(tiles).map(t => t.key), ['a', 'b', 'c', 'd', 'e'], 'the first run keeps the planned order');
  const root = await mkdtemp(join(tmpdir(), 'gap-order-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const {results} = await acquireGapTiles(tiles.map(({key}) => ({...tile, key})), root, {...fakeClock(), index, run: noOsmium,
    fetcher: async () => new Response('bad', {status: 400})});
  assert.deepEqual(results.map(r => r.region), ['gap/c', 'gap/e', 'gap/b', 'gap/a', 'gap/d'], 'the run asks in that order');
});

test('each tile and each failed request is logged as it happens', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gap-log-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const lines = [];
  const f = fake(n => n === 1 ? new TypeError('fetch failed', {cause: Object.assign(new Error('connect ETIMEDOUT'), {code: 'ETIMEDOUT'})}) : new Response('busy', {status: 429}));
  await acquireGapTiles([tile], root, {...fakeClock(), fetcher: f.fetcher, run: noOsmium, log: line => lines.push(line)});
  assert.match(lines[0], /^0_-45_45_0: request 1 failed after \d+ s: fetch failed: fetch failed: ETIMEDOUT: connect ETIMEDOUT$/);
  assert.match(lines[1], /^0_-45_45_0: request 2 answered HTTP 429 after \d+ s$/);
  assert.match(lines.at(-1), /^gap\/0_-45_45_0: kept its copy: HTTP 429; 4 requests, \d+ s$/);
  assert.equal(lines.length, 5);
});

test('the workflow gives the gaps run a time budget inside its job limit', async t => {
  const workflow = await readFile(new URL('../.github/workflows/osm-extract.yml', import.meta.url), 'utf8');
  const job = workflow.slice(workflow.indexOf('\n  gaps:'), workflow.indexOf('\n  publish:'));
  const limit = Number(/timeout-minutes: (\d+)/.exec(job)[1]);
  const budgetMinutes = Number(/GAP_TIME_BUDGET_MINUTES: (\d+)/.exec(job)[1]);
  assert.ok(budgetMinutes > 0 && budgetMinutes <= limit - 10, `${budgetMinutes} min leaves set-up, writing and the upload under ${limit} min`);
  // A bad value fails loudly instead of running without a budget.
  const root = await mkdtemp(join(tmpdir(), 'gap-cli-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(join(root, 'gaps.json'), '{"tiles":[]}');
  const cli = env => spawnSync(process.execPath, [new URL('../scripts/acquire-gap-tiles.mjs', import.meta.url).pathname, join(root, 'gaps.json'), join(root, 'out')], {encoding: 'utf8', env: {...process.env, ...env}});
  assert.notEqual(cli({GAP_TIME_BUDGET_MINUTES: 'soon'}).status, 0);
  assert.notEqual(cli({GAP_TIME_BUDGET_MINUTES: '0'}).status, 0);
  const ok = cli({GAP_TIME_BUDGET_MINUTES: '170'});
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^0 gap tiles/);
});

test('a gaps-only run downloads no region, and still fetches and publishes the gap tiles', async () => {
  const workflow = await readFile(new URL('../.github/workflows/osm-extract.yml', import.meta.url), 'utf8');
  const jobs = ['plan', 'extract', 'gaps', 'publish'].map(name => workflow.indexOf(`\n  ${name}:\n`));
  assert.ok(jobs.every((at, i) => at > 0 && (i === 0 || at > jobs[i - 1])), 'the four jobs, in order');
  const job = name => { const i = ['plan', 'extract', 'gaps', 'publish'].indexOf(name); return workflow.slice(jobs[i], jobs[i + 1]); };
  assert.match(workflow, /\n      gaps_only:\n        description: .+\n        type: boolean\n        default: false\n/);
  assert.match(job('extract'), /\n    needs: plan\n    if: \$\{\{ !inputs\.gaps_only \}\}\n/);
  assert.doesNotMatch(job('gaps'), /gaps_only/, 'the gap tiles are fetched either way');
  // The publish job runs when the region jobs are skipped: it needs only the plan.
  assert.match(job('publish'), /\n    if: \$\{\{ !cancelled\(\) && needs\.plan\.result == 'success' \}\}\n/);
});

test('gap requests wait for headers as long as their own time limit, not Node\'s 300 s default', async t => {
  const {createServer} = await import('node:http');
  // A server that answers its headers after 3 s.
  const server = createServer((req, res) => setTimeout(() => res.end('late'), 3000)).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise(resolve => server.on('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  // The agent sets the headers wait: 1 s gives up, 5 s gets the answer.
  await assert.rejects(fetch(url, {dispatcher: requestDispatcher(1000)}), error => error.cause?.code === 'UND_ERR_HEADERS_TIMEOUT');
  assert.equal(await (await fetch(url, {dispatcher: requestDispatcher(5000)})).text(), 'late');
  // Every request of a run, split parts included, carries the run's agent.
  const dispatcher = requestDispatcher();
  assert.ok(dispatcher, 'this Node keeps its fetch agent where the gap acquirer looks');
  const seen = [];
  const fetcher = async (_url, init) => { seen.push(init.dispatcher); return seen.length === 1 ? new Response('runtime error: Query timed out in "query" at line 1 after 180 seconds.', {status: 504}) : new Response(answer()); };
  await fetchTile(tile, {...fakeClock(), fetcher, dispatcher, budget: {requests: 0, bytes: 0, maxRequests: 100, maxBytes: 1e9}});
  assert.ok(seen.length > 1, 'the tile was split');
  assert.ok(seen.every(d => d === dispatcher));
});
