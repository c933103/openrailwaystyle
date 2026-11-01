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
async function run(t, files, rules, {old = true} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'energy-supplies-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, '.snapshot-cache'));
  for (const [name, data] of Object.entries(files)) {
    await writeFile(join(root, '.snapshot-cache', name), JSON.stringify(data));
    // Last written over a week ago, so its changes are due.
    if (old) await utimes(join(root, '.snapshot-cache', name), new Date(Date.now() - 8 * DAY), new Date(Date.now() - 8 * DAY));
  }
  await writeFile(join(root, 'fake.mjs'), `
    const fs = await import('node:fs'), rules = ${JSON.stringify(rules)}, log = [];
    globalThis.setTimeout = f => { f(); return 0; };
    globalThis.fetch = async (url, {body}) => {
      const query = body.get('data'); log.push(query); fs.writeFileSync('requests.json', JSON.stringify(log));
      const rule = rules.find(r => r.has.every(part => query.includes(part)));
      return new Response(rule ? rule.text : 'no full download', {status: rule ? rule.status : 500});
    };`);
  const result = spawnSync(process.execPath, ['--import', './fake.mjs', builder], {cwd: root, env: {...process.env, POWER_OUTPUT: 'out', POWER_REFRESH: ''}, encoding: 'utf8'});
  let requests = [];
  try { requests = JSON.parse(await readFile(join(root, 'requests.json'), 'utf8')); } catch {}
  const read = async name => JSON.parse(await readFile(join(root, '.snapshot-cache', name), 'utf8'));
  const published = async () => JSON.parse(await readFile(join(root, 'out', 'power-facilities.geojson'), 'utf8'));
  return {result, requests, read, published, names: () => readdir(join(root, '.snapshot-cache'))};
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
