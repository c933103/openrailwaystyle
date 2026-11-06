import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {acquireRegion, checkRegion, DISK_MARGIN, FILTER_HASH, MAX_SIDECAR} from '../scripts/acquire-region-extract.mjs';
import {extractMatrix, extractReport, regionKey, MAX_RUN_BYTES} from '../scripts/extract-run.mjs';

const URL_OF = (id, date = '261101') => `https://download.geofabrik.de/${id}-${date}.osm.pbf`;
const region = (id, bytes, extra = {}) => ({id, url: URL_OF(id), bytes, sourceDate: '2026-11-01', ...extra});

test('a region needs a dated Geofabrik URL of the plan date and a size', () => {
  assert.deepEqual(checkRegion(region('europe/germany', 10)), region('europe/germany', 10));
  assert.throws(() => checkRegion(region('germany', 10, {url: 'https://download.geofabrik.de/germany-latest.osm.pbf'})), /dated Geofabrik/);
  assert.throws(() => checkRegion(region('germany', 10, {url: 'http://download.geofabrik.de/germany-261101.osm.pbf'})), /dated Geofabrik/);
  assert.throws(() => checkRegion(region('germany', 10, {url: 'https://ftp5.gwdg.de/germany-261101.osm.pbf'})), /dated Geofabrik/);
  assert.throws(() => checkRegion(region('germany', 10, {url: URL_OF('germany', '261102')})), /plan date/);
  assert.throws(() => checkRegion(region('germany', 0)), /size/);
  assert.throws(() => checkRegion(region('../x', 10)), /region id/);
});

// A fake download server and a fake osmium: no provider is asked.
function fixture({body = Buffer.from('pbf-bytes'), headSize = body.length, getSize = body.length, md5 = createHash('md5').update(body).digest('hex'),
  status = 200, redirect = false, sidecar, counts = {nodes: 3, ways: 2, relations: 1}} = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({url, method: init.method || 'GET', redirect: init.redirect, agent: init.headers['User-Agent']});
    if (redirect) return new Response(null, {status: 302, headers: {location: 'https://mirror.example/x'}});
    if (status !== 200) return new Response('no', {status});
    if (url.endsWith('.md5')) return new Response(sidecar ?? `${md5}  file.osm.pbf\n`);
    if (init.method === 'HEAD') return new Response(null, {headers: {'content-length': String(headSize)}});
    return new Response(body, {headers: {'content-length': String(getSize)}});
  };
  const commands = [];
  const run = async (command, args) => {
    commands.push(args[0]);
    if (args[0] === 'fileinfo' && args[1] === '-g') return {stdout: fixture.timestamp + '\n'};
    if (args[0] === 'tags-filter') { writeFileSync(args[args.indexOf('-o') + 1], 'filtered'); return {stdout: ''}; }
    if (args[0] === 'fileinfo' && args[2] === '-j') return {stdout: JSON.stringify({data: {count: counts}})};
    return {stdout: ''};
  };
  return {fetcher, run, calls, commands, freeBytes: async () => 100 * 1024 ** 3};
}
fixture.timestamp = '2026-11-01T20:21:22Z';
const temp = () => mkdtempSync(join(tmpdir(), 'region-extract-'));

test('a region is downloaded once, checked, filtered, and only the filtered file and record remain', async () => {
  const dir = temp(), f = fixture();
  try {
    const manifest = await acquireRegion(region('europe/germany', 9), dir, f);
    assert.deepEqual(f.calls.map(c => `${c.method} ${c.url.split('/').pop()}`), ['HEAD germany-261101.osm.pbf', 'GET germany-261101.osm.pbf.md5', 'GET germany-261101.osm.pbf']);
    assert.ok(f.calls.every(c => c.redirect === 'manual' && /RailwayAtlas-extract/.test(c.agent)));
    assert.deepEqual(f.commands, ['fileinfo', 'tags-filter', 'check-refs', 'fileinfo']);
    assert.deepEqual(readdirSync(dir).sort(), ['extract.json', 'filtered.osm.pbf']);
    assert.equal(manifest.pbfBytes, 9);
    assert.equal(manifest.filteredBytes, 8);
    assert.deepEqual(manifest.counts, {nodes: 3, ways: 2, relations: 1});
    assert.equal(manifest.sourceTimestamp, fixture.timestamp);
    assert.equal(manifest.pbfSha256, createHash('sha256').update('pbf-bytes').digest('hex'));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'extract.json'), 'utf8')), manifest);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

for (const [name, options, pattern, requests] of [
  ['a size other than the planned one', {headSize: 10}, /not the planned 9/, 1],
  ['a redirect', {redirect: true}, /unexpected redirect/, 1],
  ['an HTTP error', {status: 503}, /HTTP 503/, 1],
  ['a bad checksum sidecar', {sidecar: 'not a checksum'}, /sidecar/, 2],
  ['a size changed after the HEAD', {getSize: 10}, /size changed/, 3],
  ['a body longer than planned', {body: Buffer.from('pbf-bytes-and-more'), headSize: 9, getSize: 9}, /more than the planned/, 3],
  ['an MD5 mismatch', {md5: '0'.repeat(32)}, /MD5/, 3],
]) {
  test(`${name} stops the region and leaves no download behind`, async () => {
    const dir = temp(), f = fixture(options);
    try {
      await assert.rejects(acquireRegion(region('europe/germany', 9), dir, f), pattern);
      assert.equal(f.calls.length, requests);
      assert.deepEqual(f.commands, []);
      assert.deepEqual(readdirSync(dir), []);
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });
}

test('a connection dropped during the download stops the region and leaves no partial file', async () => {
  const dir = temp(), f = fixture();
  try {
    const fetcher = async (url, init) => {
      if (init.method === 'HEAD' || url.endsWith('.md5')) return f.fetcher(url, init);
      const body = new ReadableStream({start(controller) { controller.enqueue(new TextEncoder().encode('pbf-')); controller.error(new TypeError('terminated')); }});
      return new Response(body, {headers: {'content-length': '9'}});
    };
    await assert.rejects(acquireRegion(region('europe/germany', 9), dir, {...f, fetcher}), /terminated/);
    assert.deepEqual(readdirSync(dir), []);
    assert.deepEqual(f.commands, []);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('the checksum sidecar limit counts received bytes, including a multibyte filename', async () => {
  const dir = temp(), digest = createHash('md5').update('pbf-bytes').digest('hex');
  const sidecar = `${digest}  ${'é'.repeat(2032)}`;
  assert.ok(sidecar.length < MAX_SIDECAR);
  assert.ok(Buffer.byteLength(sidecar) > MAX_SIDECAR);
  const f = fixture({sidecar});
  try {
    await assert.rejects(acquireRegion(region('europe/germany', 9), dir, f), /sidecar/);
    assert.equal(f.calls.length, 2, 'no PBF request follows an oversized checksum response');
    assert.deepEqual(f.commands, []);
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('an oversized checksum stream is cancelled at the byte limit without consuming its tail', async () => {
  const dir = temp(), f = fixture();
  let pulls = 0, cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      if (pulls === 20) return controller.close();
      pulls++;
      controller.enqueue(new Uint8Array(1024).fill(97));
    },
    cancel() { cancelled = true; },
  }, {highWaterMark: 0});
  const fetcher = async (url, init) => url.endsWith('.md5') ? new Response(body) : f.fetcher(url, init);
  try {
    await assert.rejects(acquireRegion(region('europe/germany', 9), dir, {...f, fetcher}), /sidecar/);
    assert.equal(pulls, 5, 'stop on the first chunk that exceeds 4,096 bytes');
    assert.equal(cancelled, true, 'release the unfinished response');
    assert.deepEqual(f.calls.map(c => c.method), ['HEAD']);
    assert.deepEqual(f.commands, []);
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('a checksum sidecar exactly at the byte limit still permits the validated download', async () => {
  const dir = temp(), digest = createHash('md5').update('pbf-bytes').digest('hex');
  const sidecar = `${digest}  ${'é'.repeat((MAX_SIDECAR - 34) / 2)}`;
  assert.equal(Buffer.byteLength(sidecar), MAX_SIDECAR);
  const f = fixture({sidecar});
  try {
    const result = await acquireRegion(region('europe/germany', 9), dir, f);
    assert.equal(result.sourceMd5, digest);
    assert.equal(f.calls.length, 3);
    assert.deepEqual(readdirSync(dir).sort(), ['extract.json', 'filtered.osm.pbf']);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('a dropped checksum stream retains the original error and cannot mark a working copy unchanged', async () => {
  const dir = temp(), f = fixture(), failure = new TypeError('sidecar connection terminated');
  const digest = createHash('md5').update('pbf-bytes').digest('hex');
  let pulls = 0;
  const body = new ReadableStream({pull(controller) {
    if (pulls++) controller.error(failure);
    else controller.enqueue(Buffer.from(`${digest}  file.osm.pbf\n`));
  }}, {highWaterMark: 0});
  const fetcher = async (url, init) => url.endsWith('.md5') ? new Response(body) : f.fetcher(url, init);
  try {
    await assert.rejects(acquireRegion(region('europe/germany', 9, {previous: previousOf()}), dir, {...f, fetcher}), error => error === failure);
    assert.deepEqual(f.calls.map(c => c.method), ['HEAD']);
    assert.deepEqual(f.commands, []);
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('a bodyless checksum response fails without requesting the PBF', async () => {
  const dir = temp(), f = fixture();
  const fetcher = async (url, init) => url.endsWith('.md5') ? new Response(null, {status: 204}) : f.fetcher(url, init);
  try {
    await assert.rejects(acquireRegion(region('europe/germany', 9), dir, {...f, fetcher}), /invalid .md5 sidecar/);
    assert.deepEqual(f.calls.map(c => c.method), ['HEAD']);
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('bounded checksum decoding preserves Response.text UTF-8 BOM handling', async () => {
  const dir = temp(), digest = createHash('md5').update('pbf-bytes').digest('hex');
  const f = fixture({sidecar: `\ufeff${digest}  file.osm.pbf\n`});
  try {
    const result = await acquireRegion(region('europe/germany', 9), dir, f);
    assert.equal(result.sourceMd5, digest);
    assert.equal(f.calls.length, 3);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('too little disk stops the region before the download', async () => {
  const dir = temp(), f = fixture();
  try {
    await assert.rejects(acquireRegion(region('europe/germany', 9), dir, {...f, freeBytes: async () => DISK_MARGIN + 8}), /bytes free/);
    assert.deepEqual(f.calls.map(c => c.method), ['HEAD']);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('a replication timestamp away from the planned date stops the region and deletes the download', async () => {
  for (const stamp of ['2026-10-30T20:00:00Z', '2026-11-03T00:00:01Z', '', 'not a time']) {
    const dir = temp(), f = fixture();
    const saved = fixture.timestamp;
    fixture.timestamp = stamp;
    try {
      await assert.rejects(acquireRegion(region('europe/germany', 9), dir, f), /replication timestamp/);
      assert.deepEqual(f.commands, ['fileinfo']);
      assert.deepEqual(readdirSync(dir), []);
    } finally { fixture.timestamp = saved; rmSync(dir, {recursive: true, force: true}); }
  }
  for (const stamp of ['2026-10-31T23:59:59Z', '2026-11-02T23:59:59Z']) {
    const dir = temp(), f = fixture();
    const saved = fixture.timestamp;
    fixture.timestamp = stamp;
    try { await acquireRegion(region('europe/germany', 9), dir, f); }
    finally { fixture.timestamp = saved; rmSync(dir, {recursive: true, force: true}); }
  }
});

test('a failed filter step deletes the raw download', async () => {
  const dir = temp(), f = fixture();
  try {
    const run = async (command, args) => { if (args[0] === 'check-refs') throw new Error('missing node'); return f.run(command, args); };
    await assert.rejects(acquireRegion(region('europe/germany', 9), dir, {...f, run}), /missing node/);
    assert.ok(!existsSync(join(dir, 'source.osm.pbf')));
    assert.ok(!existsSync(join(dir, 'extract.json')));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

// The region's working copy, as the matrix hands it to the job.
const previousOf = (body = Buffer.from('pbf-bytes'), extra = {}) => ({sourceMd5: createHash('md5').update(body).digest('hex'), pbfBytes: body.length,
  filter: FILTER_HASH, sourceTimestamp: '2026-10-25T20:00:00Z', counts: {nodes: 3, ways: 2, relations: 1}, ...extra});

test('a source file the working copy was made from is not downloaded again', async () => {
  const dir = temp(), f = fixture();
  try {
    const manifest = await acquireRegion(region('europe/germany', 9, {previous: previousOf()}), dir, f);
    assert.deepEqual(f.calls.map(c => c.method), ['HEAD', 'GET'], 'HEAD and the .md5 sidecar only');
    assert.ok(f.calls[1].url.endsWith('.md5'));
    assert.deepEqual(f.commands, []);
    assert.equal(manifest.unchanged, true);
    assert.equal(manifest.filter, FILTER_HASH);
    assert.deepEqual(readdirSync(dir), ['extract.json']);
  } finally { rmSync(dir, {recursive: true, force: true}); }
  // Another MD5, another size or another filter: downloaded.
  for (const previous of [previousOf(Buffer.from('pbf-bytez')), previousOf(undefined, {pbfBytes: 8}), previousOf(undefined, {filter: 'older filter'})]) {
    const other = temp(), g = fixture();
    try {
      const manifest = await acquireRegion(region('europe/germany', 9, {previous}), other, g);
      assert.equal(g.calls.length, 3);
      assert.equal(manifest.unchanged, undefined);
      assert.deepEqual(readdirSync(other).sort(), ['extract.json', 'filtered.osm.pbf']);
    } finally { rmSync(other, {recursive: true, force: true}); }
  }
});

test('a refreshed region older than its working copy, or with more than 5% fewer objects, is rejected', async () => {
  const check = async (previous, options = {}) => {
    const dir = temp(), f = fixture(options);
    try { return await acquireRegion(region('europe/germany', 9, {previous: previousOf(Buffer.from('other'), previous)}), dir, f); }
    finally {
      // A rejected region leaves nothing to publish.
      if (!existsSync(join(dir, 'extract.json'))) assert.deepEqual(readdirSync(dir), []);
      rmSync(dir, {recursive: true, force: true});
    }
  };
  await assert.rejects(check({sourceTimestamp: '2026-11-01T20:21:23Z'}), /older than the working copy/);
  assert.equal((await check({sourceTimestamp: fixture.timestamp})).sourceTimestamp, fixture.timestamp);
  const counts = total => ({counts: {nodes: total - 2, ways: 1, relations: 1}});
  await assert.rejects(check(counts(1000), {counts: {nodes: 947, ways: 1, relations: 1}}), /5\.1% fewer than the working copy's 1000/);
  assert.equal((await check(counts(1000), {counts: {nodes: 948, ways: 1, relations: 1}})).counts.nodes, 948, 'exactly 5% fewer is taken');
  // Made with another filter, the counts are not comparable.
  assert.ok(await check({...counts(1000), filter: 'older filter'}, {counts: {nodes: 1, ways: 1, relations: 1}}));
});

test('the command records why a region failed', () => {
  const dir = temp();
  try {
    writeFileSync(join(dir, 'region.json'), JSON.stringify(region('europe/germany', 0)));
    const out = spawnSync(process.execPath, ['scripts/acquire-region-extract.mjs', join(dir, 'region.json'), join(dir, 'out')], {encoding: 'utf8'});
    assert.notEqual(out.status, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'out', 'failed.json'), 'utf8')), {region: 'europe/germany', error: 'europe/germany: invalid planned size 0'});
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

const plan = (regions, extra = {}) => ({valid: true, problems: [], sourceDate: '2026-11-01', maxBytes: 8 * 1024 ** 3, regions, ...extra});

test('the matrix takes only a valid plan within the run limits, largest region first', () => {
  const entries = extractMatrix(plan([region('asia/japan', 5), region('us/california', 7), region('russia', 6)]));
  assert.deepEqual(entries.map(e => e.key), ['us--california', 'russia', 'asia--japan']);
  assert.deepEqual(Object.keys(entries[0]).sort(), ['bytes', 'id', 'key', 'sourceDate', 'url']);
  assert.throws(() => extractMatrix(plan([region('russia', 6)], {valid: false, problems: ['remainder land too large']})), /not valid: remainder land too large/);
  assert.throws(() => extractMatrix({...plan([region('russia', 6)]), valid: 'true'}), /not valid/);
  assert.throws(() => extractMatrix(plan([])), /no regions/);
  assert.throws(() => extractMatrix(plan([region('us', 9 * 1024 ** 3)])), /over the limit: us/);
  assert.throws(() => extractMatrix(plan([region('russia', 6, {oversized: true})])), /over the limit: russia/);
  assert.throws(() => extractMatrix(plan([region('a', 1), region('b', 1), region('c', 1)]), {maxJobs: 2}), /one run holds 2/);
  assert.throws(() => extractMatrix(plan([region('a', 6), region('b', 6)]), {maxRunBytes: 11}), /may download 11/);
  assert.throws(() => extractMatrix(plan([region('a', 6, {url: URL_OF('a', '261102')})])), /plan date/);
  assert.equal(MAX_RUN_BYTES, 100 * 1024 ** 3);
  // With the index, a region with a working copy carries what its job checks.
  const index = {regions: {russia: {asset: 'region-russia-20261025-abc.osm.pbf', sha256: 'abc', ...previousOf()}}};
  const withIndex = extractMatrix(plan([region('asia/japan', 5), region('russia', 6)]), {index});
  assert.deepEqual(withIndex[0].previous, previousOf());
  assert.equal(withIndex[1].previous, undefined);
  assert.equal(regionKey('us/new-york'), 'us--new-york');
});

test('the report lists every measured region and every region not measured', () => {
  const manifest = (id, pbf, filtered) => ({region: id, pbfBytes: pbf, filteredBytes: filtered, counts: {nodes: 10, ways: 2, relations: 1},
    downloadSeconds: 30, filterSeconds: 12, freeBytesBefore: 20 * 1024 ** 3, sourceTimestamp: '2026-11-01T20:21:22Z', filter: 'abc'});
  const {markdown, measured, missing} = extractReport(plan([region('a', 1), region('b', 1), region('c', 1)]),
    [manifest('a', 1024 ** 3, 10 * 1024 ** 2), manifest('c', 2 * 1024 ** 3, 30 * 1024 ** 2), manifest('stray', 1, 1)]);
  assert.equal(measured, 2);
  assert.deepEqual(missing, ['b']);
  assert.match(markdown, /Regions measured: 2 of 3; not measured: b/);
  assert.match(markdown, /Downloaded: 3\.00 GiB; filtered: 0\.039 GiB \(1\.30% of the download\)/);
  assert.match(markdown, /20 nodes, 4 ways, 2 relations/);
  assert.match(markdown, /\| c \| 2\.00 \| 30\.0 \| 1\.46% \|[^\n]*\n\| a \|/);
  assert.doesNotMatch(markdown, /stray/);
  // A region not downloaded because it had not changed is counted apart.
  const unchanged = extractReport(plan([region('a', 1), region('b', 1)]), [manifest('a', 1024 ** 3, 10 * 1024 ** 2), {region: 'b', unchanged: true, pbfBytes: 5}]);
  assert.deepEqual([unchanged.measured, unchanged.unchanged, unchanged.missing], [1, ['b'], []]);
  assert.match(unchanged.markdown, /Regions measured: 1 of 2; unchanged since the working copy, not downloaded: 1\n/);
});

// The real osmium steps on a synthetic file, served by the fake server.
const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium installed, the real steps keep railway data and drop the rest', {skip: osmium.status !== 0 && 'osmium is not installed'}, async () => {
  const dir = temp(), src = temp();
  try {
    writeFileSync(join(src, 'in.osm'), '<?xml version="1.0"?><osm version="0.6"><node id="1" version="1" lat="0" lon="0"/><node id="2" version="1" lat="0" lon="1"/>'
      + '<node id="3" version="1" lat="1" lon="0"/><node id="4" version="1" lat="1" lon="1"/>'
      + '<way id="10" version="1"><nd ref="1"/><nd ref="2"/><tag k="railway" v="rail"/></way>'
      + '<way id="11" version="1"><nd ref="3"/><nd ref="4"/><tag k="highway" v="primary"/></way></osm>');
    const made = spawnSync('osmium', ['cat', join(src, 'in.osm'), '-o', join(src, 'in.pbf'), '--output-header=osmosis_replication_timestamp=2026-11-01T20:21:22Z'], {encoding: 'utf8'});
    assert.equal(made.status, 0, made.stderr);
    const f = fixture({body: readFileSync(join(src, 'in.pbf'))});
    const manifest = await acquireRegion(region('europe/germany', readFileSync(join(src, 'in.pbf')).length), dir, {fetcher: f.fetcher, freeBytes: f.freeBytes});
    assert.deepEqual(manifest.counts, {nodes: 2, ways: 1, relations: 0});
    assert.equal(manifest.sourceTimestamp, '2026-11-01T20:21:22Z');
    assert.deepEqual(readdirSync(dir).sort(), ['extract.json', 'filtered.osm.pbf']);
  } finally { rmSync(dir, {recursive: true, force: true}); rmSync(src, {recursive: true, force: true}); }
});

for(const mode of ['pending','rejects','throws'])test(`oversized checksum fails promptly when stream cancellation ${mode}`,async()=>{
 const dir=temp(),f=fixture();let release,timer,cancelled=0,pulls=0;
 const cancellation=new Promise(resolve=>{release=resolve;});
 const body=new ReadableStream({
  pull(controller){pulls++;controller.enqueue(new Uint8Array(1024));},
  cancel(){cancelled++;if(mode==='throws')throw Error('cleanup throw');if(mode==='rejects')return Promise.reject(Error('cleanup rejection'));return cancellation;},
 },{highWaterMark:0});
 const fetcher=async(url,init)=>url.endsWith('.md5')?new Response(body):f.fetcher(url,init);
 const result=acquireRegion(region('europe/germany',9),dir,{...f,fetcher});
 try{
  await assert.rejects(Promise.race([result,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('sidecar waited for cleanup')),1000);})]),/\.md5 sidecar exceeds 4096 bytes/);
  assert.equal(cancelled,1);assert.equal(pulls,5);assert.equal(body.locked,false);
  assert.deepEqual(f.calls.map(c=>c.method),['HEAD']);assert.deepEqual(f.commands,[]);assert.deepEqual(readdirSync(dir),[]);
 }finally{clearTimeout(timer);release();await result.catch(()=>{});rmSync(dir,{recursive:true,force:true});}
});
