import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, utimes, writeFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {powerFacilityQuery} from '../scripts/power-facility-data.mjs';
import {selectionChangeQueries} from '../scripts/overpass-adiff.mjs';

// Runs the unchanged energy-supply builder in a temporary folder, with fetch
// and timers replaced before it loads. Synthetic responses in the documented
// augmented diff form; no provider data.
const builder = fileURLToPath(new URL('../scripts/build-power-facilities.mjs', import.meta.url));
const SINCE = '2026-10-20T00:00:00Z', BASE = '2026-11-01T05:00:00Z', DAY = 86400000;
const boxes = [];
for (let south = -90; south < 90; south += 90) for (let west = -180; west < 180; west += 90) boxes.push([south, west, south + 90, west + 90]);
const file = box => `power-facilities-v6-${box.join('_')}.json`;
const at = ([s, w], id, tags = {railway: 'water_tower'}) => ({type: 'node', id, lat: s + 10, lon: w + 10, tags});
// An earlier query: the current one with one more selector, so the current one selects less.
const older = box => powerFacilityQuery(box).replace(/\);out body geom qt;$/, `node["railway"="old_selector"](${box.join(',')}););out body geom qt;`);
const osm = (actions = '') => `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="Overpass API">\n<meta osm_base="${BASE}"/>\n${actions}\n</osm>\n`;

// Replies: the first rule whose substrings all appear in the request; else a
// refused full download.
async function run(t, files, rules, {old = true, existingOutput = {}, now = Date.now(), earlyWakeAt = -1} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'energy-supplies-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, '.snapshot-cache'));
  await mkdir(join(root, 'out'));
  for (const [name, content] of Object.entries(existingOutput)) await writeFile(join(root, 'out', name), content);
  for (const [name, data] of Object.entries(files)) {
    await writeFile(join(root, '.snapshot-cache', name), JSON.stringify(data));
    // Last written over a week ago, so its changes are due.
    if (old) await utimes(join(root, '.snapshot-cache', name), new Date(Date.now() - 8 * DAY), new Date(Date.now() - 8 * DAY));
  }
  await writeFile(join(root, 'fake.mjs'), `
    const fs = await import('node:fs'), rules = ${JSON.stringify(rules)}, log = [];
    let clock = ${now}, elapsed = 0, timer = 0; Date.now = () => clock;
    Object.defineProperty(globalThis, 'performance', {value: {now: () => elapsed}, configurable: true});
    globalThis.setTimeout = (f, ms) => { const step = timer++ === ${earlyWakeAt} ? (ms || 0) / 2 : ms || 0; clock += step; elapsed += step; f(); return 0; };
    const times = [], elapsedTimes = []; const used = new Map();
    globalThis.fetch = async (url, {body}) => {
      const query = body.get('data'); log.push(query); fs.writeFileSync('requests.json', JSON.stringify(log));
      times.push(clock); fs.writeFileSync('times.json', JSON.stringify(times));
      elapsedTimes.push(elapsed); fs.writeFileSync('elapsed-times.json', JSON.stringify(elapsedTimes));
      const rule = rules.find(r => r.has.every(part => query.includes(part)) && (used.get(r) || 0) < (r.times ?? Infinity));
      if (rule) used.set(rule, (used.get(rule) || 0) + 1);
      if (rule?.fetchError) throw new DOMException(rule.fetchError, 'TimeoutError');
      const headers = {...rule?.headers};
      if (rule?.dateDelay) headers['Retry-After'] = new Date(clock + rule.dateDelay).toUTCString();
      const response = new Response(rule ? rule.text : 'no full download', {status: rule ? rule.status : 500, headers});
      const originalText = response.text.bind(response);
      response.text = async () => { elapsed += rule?.bodyMs || 0; clock += (rule?.bodyMs || 0) + (rule?.wallShift || 0); if (rule?.bodyError) throw new TypeError(typeof rule.bodyError === 'string' ? rule.bodyError : 'fetch failed: interrupted body'); return originalText(); };
      return response;
    };`);
  const result = spawnSync(process.execPath, ['--import', './fake.mjs', builder], {cwd: root, env: {...process.env, POWER_OUTPUT: 'out', POWER_REFRESH: ''}, encoding: 'utf8'});
  let requests = [], times = [], elapsedTimes = [];
  try { requests = JSON.parse(await readFile(join(root, 'requests.json'), 'utf8')); } catch {}
  try { times = JSON.parse(await readFile(join(root, 'times.json'), 'utf8')); } catch {}
  try { elapsedTimes = JSON.parse(await readFile(join(root, 'elapsed-times.json'), 'utf8')); } catch {}
  const read = async name => JSON.parse(await readFile(join(root, '.snapshot-cache', name), 'utf8'));
  const published = async () => JSON.parse(await readFile(join(root, 'out', 'power-facilities.geojson'), 'utf8'));
  return {result, requests, times, elapsedTimes, read, published, outputBytes: name => readFile(join(root, 'out', name)), names: () => readdir(join(root, '.snapshot-cache'))};
}
const stored = (query, elements, time = SINCE) => ({query, response: {osm3s: {timestamp_osm_base: time}, elements}});
const current = Object.fromEntries(boxes.map((box, i) => [file(box), stored(powerFacilityQuery(box), [at(box, 100 + i)])]));
const ids = elements => JSON.stringify({osm3s: {timestamp_osm_base: BASE}, elements});

test('a week-old region takes one change request, and a failed one keeps its cached response', async t => {
  const {result, requests, read, published} = await run(t, current, [
    {has: ['[adiff:', '(-90,-180,0,-90)'], status: 200, text: osm('<action type="modify"><old/><new><node id="100" lat="-80" lon="-170" version="2"><tag k="railway" v="fuel"/></node></new></action>')},
    {has: ['[adiff:', '(-90,-90,0,0)'], status: 500, text: 'Internal error'},
    {has: ['[adiff:'], status: 200, text: osm()}]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(requests.length, 8, 'one change request per region');
  assert.ok(requests.every(q => q.startsWith('[out:xml]')), 'no full download');
  assert.equal((await read(file(boxes[0]))).response.elements[0].tags.railway, 'fuel');
  assert.equal((await read(file(boxes[0]))).response.osm3s.timestamp_osm_base, BASE);
  assert.equal((await read(file(boxes[1]))).response.osm3s.timestamp_osm_base, SINCE, 'kept; asked again next run');
  assert.equal((await published()).features.length, 8);
});

test('a region made by another query takes its changes and only the difference, not a full download', async t => {
  const files = {...current, [file(boxes[0])]: stored(older(boxes[0]), [at(boxes[0], 100), at(boxes[0], 200, {railway: 'old_selector'})])};
  // Not due by age: another query is updated at once.
  const {result, requests, read} = await run(t, files, [{has: ['[adiff:'], status: 200, text: osm()},
    {has: ['out ids;'], status: 200, text: ids([{type: 'node', id: 100}, {type: 'node', id: 300}])},
    {has: ['node(id:300)'], status: 200, text: ids([at(boxes[0], 300, {railway: 'fuel'})])}], {old: false});
  assert.equal(result.status, 0, result.stderr);
  const {ids: idsQuery, elements} = selectionChangeQueries(older(boxes[0]), powerFacilityQuery(boxes[0]), BASE);
  assert.deepEqual(requests.slice(1), [idsQuery, elements(['node/300'])], 'after the change request: the ids, then only the new element');
  assert.ok(requests[0].startsWith('[out:xml]') && requests[0].includes('old_selector'), 'the changes of the query that selected the stored elements');
  const region = await read(file(boxes[0]));
  assert.equal(region.query, powerFacilityQuery(boxes[0]));
  assert.deepEqual(region.response.elements.map(e => e.id).sort(), [100, 300], 'the element no longer selected dropped, the new one added');
  assert.equal(requests.length, 3, 'the other regions, updated this week, are not asked');
});

test('a region made by another query whose changes fail is downloaded in full', async t => {
  const files = {...current, [file(boxes[0])]: stored(older(boxes[0]), [at(boxes[0], 100)])};
  const {result, requests, read} = await run(t, files, [{has: ['[adiff:'], status: 500, text: 'Internal error'},
    {has: ['[out:json]'], status: 200, text: ids([at(boxes[0], 100), at(boxes[0], 400)])}], {old: false});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(requests.length, 2);
  assert.equal(requests[1], powerFacilityQuery(boxes[0]));
  assert.equal((await read(file(boxes[0]))).query, powerFacilityQuery(boxes[0]));
});

test('a region split under another query keeps its parts, which take the difference', async t => {
  const [s, w, n, e] = boxes[0], lat = (s + n) / 2, lon = (w + e) / 2;
  const children = [[s, w, lat, lon], [s, lon, lat, e], [lat, w, n, lon], [lat, lon, n, e]];
  const files = {...current, [file(boxes[0]) + '.split']: {query: older(boxes[0])}};
  delete files[file(boxes[0])];
  for (const [i, child] of children.entries()) files[file(child)] = stored(older(child), [at(child, 500 + i)]);
  // Each part still selects its one element.
  const {result, requests, read} = await run(t, files, [{has: ['[adiff:'], status: 200, text: osm()},
    ...children.map((child, i) => ({has: ['out ids;', `(${child.join(',')})`], status: 200, text: ids([{type: 'node', id: 500 + i}])}))], {old: false});
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!requests.includes(powerFacilityQuery(boxes[0])), 'the parent is never asked in full');
  assert.equal(requests.length, 8, 'each part: its changes and the ids of what the current query selects');
  for (const [i, child] of children.entries()) assert.equal((await read(file(child))).query, powerFacilityQuery(child), `part ${i} under the current query`);
  assert.equal((await read(file(boxes[0]) + '.split')).query, powerFacilityQuery(boxes[0]), 'the split recorded for the current query');
});


test('energy changes honor the received provider pause before the next region', async t => {
  const {result, requests, times, read} = await run(t, current, [
    {has: ['[adiff:', '(-90,-180,0,-90)'], status: 503, text: 'busy', headers: {'Retry-After': '600'}},
    {has: ['[adiff:'], status: 200, text: osm()}]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(requests.length, 8);
  assert.ok(times[1] - times[0] >= 600000, 'next region must not ignore a failed change response header');
  assert.equal((await read(file(boxes[0]))).response.osm3s.timestamp_osm_base, SINCE);
});

test('energy query-change fallback honors HTTP-date pause even when the response body breaks', async t => {
  const files = {...current, [file(boxes[0])]: stored(older(boxes[0]), [at(boxes[0], 100)])};
  const {result, requests, times} = await run(t, files, [
    {has: ['[adiff:'], status: 503, text: '', dateDelay: 600000, bodyError: true},
    {has: ['[out:json]'], status: 200, text: ids([at(boxes[0], 100)])}], {old: false});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(requests.length, 2);
  assert.ok(times[1] - times[0] >= 599000, 'capture headers before reading the body; HTTP dates have second precision');
});

test('energy full-download retry honors a pause received before an interrupted body', async t => {
  const files = {...current}; delete files[file(boxes[0])];
  const {result, requests, times} = await run(t, files, [
    {has: ['[out:json]'], times: 1, status: 503, text: '', headers: {'Retry-After': '600'}, bodyError: true},
    {has: ['[out:json]'], status: 200, text: ids([at(boxes[0], 100)])}], {old: false});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(requests.length, 2);
  assert.ok(times[1] - times[0] >= 600000);
});

for (const path of ['change', 'full']) test(`energy ${path} stops rather than shortening a provider pause above 15 minutes`, async t => {
  const files = {...current}; if (path === 'full') delete files[file(boxes[0])];
  const {result, requests, published, read} = await run(t, files, [
    {has: [], status: 503, text: 'busy', headers: {'Retry-After': '3600'}}], {old: path === 'change'});
  assert.notEqual(result.status, 0);
  assert.equal(requests.length, 1, 'no retry, fallback, subdivision or later region may bypass the server minimum');
  assert.match(result.stderr, /Retry-After.*budget exceeded/);
  await assert.rejects(published(), {code: 'ENOENT'});
  if (path === 'change') assert.deepEqual(await read(file(boxes[0])), current[file(boxes[0])]);
});

test('energy query-limit subdivisions respect the parent response pause without retrying the parent', async t => {
  const files = {...current}; delete files[file(boxes[0])];
  const {result, requests, times, names} = await run(t, files, [
    {has: ['(-90,-180,0,-90)'], status: 200, text: JSON.stringify({remark: 'runtime error: Query timed out', elements: []}), headers: {'Retry-After': '180'}},
    {has: ['[out:json]'], status: 200, text: ids([at(boxes[0], 100)])}], {old: false});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(requests.length, 5, 'one parent and its four children');
  assert.ok(times[1] - times[0] >= 180000);
  assert.ok((await names()).includes(file(boxes[0]) + '.split'));
});

test('energy retry boundaries preserve the normal schedule and accept a 15-minute pause', async t => {
  for (const [header, minimum] of [['900', 900000], ['invalid', 120000], ['Thu, 01 Jan 1970 00:00:00 GMT', 120000]]) {
    const files = {...current}; delete files[file(boxes[0])];
    const {result, requests, times} = await run(t, files, [
      {has: [], times: 1, status: 503, text: 'busy', headers: {'Retry-After': header}},
      {has: [], status: 200, text: ids([at(boxes[0], 100)])}], {old: false});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests.length, 2);
    assert.equal(times[1] - times[0], minimum);
  }
  const files = {...current}; delete files[file(boxes[0])];
  const {result, requests, times} = await run(t, files, [{has: [], status: 503, text: 'busy'}], {old: false});
  assert.notEqual(result.status, 0);
  assert.equal(requests.length, 4);
  assert.deepEqual(times.slice(1).map((time, index) => time - times[index]), [120000, 300000, 600000]);
});

test('energy long HTTP-date and overflowing numeric pauses stop even when the body is interrupted', async t => {
  for (const pause of [{dateDelay: 3600000}, {headers: {'Retry-After': '9'.repeat(400)}}]) {
    const {result, requests, read} = await run(t, current, [{has: [], status: 503, text: '', bodyError: true, ...pause}]);
    assert.notEqual(result.status, 0);
    assert.equal(requests.length, 1);
    assert.match(result.stderr, /Retry-After.*budget exceeded/);
    assert.deepEqual(await read(file(boxes[0])), current[file(boxes[0])]);
  }
});


for (const path of ['full', 'change']) test(`a valid energy ${path} response with a long pause retains its completed cache but never replaces the publication`, async t => {
  const files = {...current}; if (path === 'full') delete files[file(boxes[0])];
  const existingOutput = {'power-facilities.geojson': '{"type":"FeatureCollection","features":[]}', 'power-facilities.geojson.gz': 'existing compressed bytes', 'manifest.json': '{"previous":true}'};
  const {result, requests, read, outputBytes} = await run(t, files, [
    {has: [], status: 200, text: path === 'full' ? ids([at(boxes[0], 100)]) : osm(), headers: {'Retry-After': '3600'}}], {old: path === 'change', existingOutput});
  assert.notEqual(result.status, 0, 'a completed response still must stop the run for an over-cap provider pause');
  assert.equal(requests.length, 1);
  assert.match(result.stderr, /Retry-After.*budget exceeded/);
  assert.equal((await read(file(boxes[0]))).response.osm3s.timestamp_osm_base, BASE, 'valid completed work remains reusable');
  for (const [name, bytes] of Object.entries(existingOutput)) assert.equal((await outputBytes(name)).toString(), bytes, name);
});


for (const failure of [{fetchError: 'request timed out'}, {bodyError: 'body timed out'}]) test(`energy transport timeout ${Object.keys(failure)[0]} retries the same query without spatial fan-out`, async t => {
  const files = {...current}; delete files[file(boxes[0])];
  const {result, requests, times, names} = await run(t, files, [
    {has: [], times: 1, status: 200, text: '', ...failure},
    {has: [], status: 200, text: ids([at(boxes[0], 100)])}], {old: false});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(requests.length, 2);
  assert.equal(requests[1], requests[0], 'a transport timeout says nothing about the query area');
  assert.equal(times[1] - times[0], 120000, 'retain the busy/transport backoff');
  assert.ok(!(await names()).some(name => name.endsWith('.split')), 'no query-limit checkpoint for a transport failure');
});


for (const failure of [{fetchError: 'request timed out'}, {bodyError: 'body timed out'}, {bodyError: 'stream memory allocation failed'}]) test(`persistent energy transport failure ${JSON.stringify(failure)} keeps four attempts and no split checkpoint`, async t => {
  const files = {...current}; delete files[file(boxes[0])];
  const {result, requests, times, names, published} = await run(t, files, [{has: [], status: 200, text: '', ...failure}], {old: false});
  assert.notEqual(result.status, 0);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(query => query === requests[0]));
  assert.deepEqual(times.slice(1).map((time, index) => time - times[index]), [120000, 300000, 600000]);
  assert.ok(!(await names()).some(name => name.endsWith('.split')));
  await assert.rejects(published(), {code: 'ENOENT'});
});

for(const value of ["Wed, 31 Feb 2027 00:10:00 GMT", "Mon, 07 Nov 2026 00:10:00 GMT", "Foo, 07 Nov 2026 00:10:00 GMT", "Sat, 07 Nov 2026 24:00:00 GMT", "2027-01-01T00:00:00Z", "Sat, 07 Nov 2026 00:10:00 +0000"])for(const path of ['full','changes'])test(`energy rejects malformed calendar pause ${value} (${path})`,async t=>{
 const files={...current};
 if(path==='full')delete files[file(boxes[0])];else files[file(boxes[0])]=stored(older(boxes[0]),[at(boxes[0],100)]);
 const r=await run(t,files,[{has:[],times:1,status:503,text:'busy',headers:{'Retry-After':value}},
  {has:['[out:json]'],status:200,text:ids([at(boxes[0],100)])}],{old:false,now:Date.parse('2026-11-07T00:00:00Z')});
 assert.equal(r.result.status,0,r.result.stderr);assert.equal(r.requests.length,2);assert.equal(r.times[1]-r.times[0],path==='full'?120000:10000);
 assert.equal((await r.published()).features.length,8);
});
for(const value of ['Sat, 07 Nov 2026 00:10:00 GMT','Saturday, 07-Nov-26 00:10:00 GMT','Sat Nov  7 00:10:00 2026'])test(`energy retains valid calendar pause ${value}`,async t=>{
 const timezone=process.env.TZ;process.env.TZ='Asia/Tokyo';t.after(()=>{if(timezone===undefined)delete process.env.TZ;else process.env.TZ=timezone;});
 const files={...current,[file(boxes[0])]:stored(older(boxes[0]),[at(boxes[0],100)])};
 const r=await run(t,files,[{has:['[adiff:'],status:503,text:'busy',headers:{'Retry-After':value}},
  {has:['[out:json]'],status:200,text:ids([at(boxes[0],100)])}],{old:false,now:Date.parse('2026-11-07T00:00:00Z')});
 assert.equal(r.result.status,0,r.result.stderr);assert.equal(r.requests.length,2);assert.equal(r.times[1]-r.times[0],600000);
});

for(const path of ['full','fallback','change','split','success'])for(const wallShift of [3600000,-3600000])test(`energy ${path} retains elapsed provider deadline across ${wallShift}ms wall correction`,async t=>{
 const files={...current},box=boxes[0];let rules,old=false;
 const pause=path==='full'||path==='fallback'?{dateDelay:600000}:{headers:{'Retry-After':'600'}};
 if(path==='fallback')files[file(box)]=stored(older(box),[at(box,100)]);
 else if(path!=='change')delete files[file(box)];
 if(path==='success')delete files[file(boxes[1])];
 if(path==='change'){old=true;rules=[{has:['(-90,-180,0,-90)'],status:200,text:'',bodyError:true,wallShift,...pause},{has:[],status:200,text:osm()}];}
 else if(path==='split')rules=[{has:['(-90,-180,0,-90)'],status:200,text:JSON.stringify({remark:'runtime error: Query timed out',elements:[]}),wallShift,...pause},{has:[],status:200,text:ids([at(box,100)])}];
 else rules=[{has:[],times:1,status:200,text:ids([at(box,100)]),bodyError:path!=='success',wallShift,...pause},{has:[],status:200,text:ids([at(box,100)])}];
 const r=await run(t,files,rules,{old,now:Date.parse('2026-11-07T00:00:00Z')});
 assert.equal(r.result.status,0,r.result.stderr);assert.equal(r.requests.length,path==='change'?8:path==='split'?5:2);
 assert.equal(r.elapsedTimes[1]-r.elapsedTimes[0],600000);assert.ok((await r.published()).features.length>0);
 if(path==='full')assert.equal(r.requests[0],r.requests[1]);
});
for(const bodyMs of [300000,700000])test(`energy full retry consumes ${bodyMs}ms body time without rebasing the header`,async t=>{
 const files={...current};delete files[file(boxes[0])];
 const r=await run(t,files,[{has:[],times:1,status:200,text:'',bodyError:true,bodyMs,dateDelay:600000},{has:[],status:200,text:ids([at(boxes[0],100)])}],{old:false,now:Date.parse('2026-11-07T00:00:00Z')});
 assert.equal(r.result.status,0,r.result.stderr);assert.equal(r.requests.length,2);assert.equal(r.elapsedTimes[1]-r.elapsedTimes[0],Math.max(600000,bodyMs+120000));
});
for(const mode of ['retry','spacing'])test(`energy rechecks early ${mode} timer wake`,async t=>{
 const files={...current};delete files[file(boxes[0])];if(mode==='spacing')delete files[file(boxes[1])];
 const r=await run(t,files,[{has:[],times:1,status:mode==='retry'?503:200,text:mode==='retry'?'busy':ids([at(boxes[0],100)])},{has:[],status:200,text:ids([at(boxes[0],100)])}],{old:false,earlyWakeAt:1});
 assert.equal(r.result.status,0,r.result.stderr);assert.equal(r.requests.length,2);assert.equal(r.elapsedTimes[1]-r.elapsedTimes[0],mode==='retry'?120000:10000);
});
