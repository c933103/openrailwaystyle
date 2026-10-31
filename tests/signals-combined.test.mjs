import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {buildSignals} from '../scripts/build-signals.mjs';
import {signalQuery, combinedSignalQuery, electricWithDirectionQuery, signalChangesQuery} from '../scripts/signals-data.mjs';
import {validateElectricitySignalsSnapshot} from '../scripts/build-electricity-signals.mjs';

// Signals in the region [45,0,90,45]: an undirected main signal, an undirected
// French end-of-catenary sign and a directed German El 2.
const UNDIRECTED = {type: 'node', id: 1, lat: 48.8, lon: 2.3, tags: {railway: 'signal', 'railway:signal:main': 'FR:CARRE'}};
const ELECTRIC = {type: 'node', id: 2, lat: 48.9, lon: 2.4, tags: {railway: 'signal', 'railway:signal:electricity': 'FR:end_of_catenary'}};
const DIRECTED_ELECTRIC = {type: 'node', id: 3, lat: 50.1, lon: 8.6, tags: {railway: 'signal', 'railway:signal:direction': 'forward', 'railway:signal:electricity': 'DE-ESO:el2'}};
const HOME = '45,0,90,45';
const box = query => /\((-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+)\)/.exec(query)[1];

async function dirs() {
  const root = await mkdtemp(join(tmpdir(), 'signals-'));
  return {root, cacheRoot: pathToFileURL(join(root, 'cache') + '/'), output: pathToFileURL(join(root, 'signal-data') + '/'), powerOutput: join(root, 'power-data')};
}
function fakeOverpass(answer) {
  const queries = [];
  const fetcher = async (url, {body}) => {
    const query = new URLSearchParams(String(body)).get('data');
    queries.push(query);
    const result = answer(query);
    if (result.status) return {ok: false, status: result.status, text: async () => 'busy'};
    if (typeof result.raw === 'string') return {ok: true, text: async () => result.raw};
    return {ok: true, text: async () => JSON.stringify({osm3s: {timestamp_osm_base: '2026-10-31T00:00:00Z'}, ...result})};
  };
  return {queries, fetcher};
}
const quiet = {sleep: async () => {}, log() {}, warn() {}, now: () => Date.parse('2026-10-31T12:00:00Z')};

test('one combined request per region yields both the undirected supplement and the electrification snapshot', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const {queries, fetcher} = fakeOverpass(query => ({elements: box(query) === HOME ? [UNDIRECTED, ELECTRIC, DIRECTED_ELECTRIC] : []}));
  const result = await buildSignals({...d, ...quiet, fetcher});
  assert.equal(queries.length, 32, 'one request per world region');
  assert.ok(queries.every(q => q === combinedSignalQuery(box(q).split(',').map(Number))));
  const undirected = JSON.parse(gunzipSync(await readFile(new URL('railway-signals.geojson.gz', d.output))));
  assert.deepEqual(undirected.features.map(f => f.id), [1, 2], 'a directed signal stays with the provider');
  const electric = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals-manifest.json'), 'utf8'));
  assert.deepEqual(electric.features.map(f => f.id), ['node-2', 'node-3'], 'electrification signals with and without a direction');
  validateElectricitySignalsSnapshot(electric, manifest);
  assert.equal(manifest.coverage.length, 32);
  assert.equal(result.signals.signals, 2);
});

test('a region cached before the downloads were combined is reused; only its directed electrification signals are fetched', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const home = HOME.split(',').map(Number);
  await (await import('node:fs/promises')).mkdir(d.cacheRoot, {recursive: true});
  await writeFile(new URL(`signals-v1-${home.join('_')}.json`, d.cacheRoot), JSON.stringify({query: signalQuery(home), generated: '2026-10-25T00:00:00Z',
    response: {osm3s: {timestamp_osm_base: '2026-10-25T00:00:00Z'}, elements: [UNDIRECTED, ELECTRIC]}}));
  const {queries, fetcher} = fakeOverpass(query => ({elements: query === electricWithDirectionQuery(home, '2026-10-25T00:00:00Z') ? [DIRECTED_ELECTRIC] : []}));
  await buildSignals({...d, ...quiet, fetcher});
  assert.ok(queries.includes(electricWithDirectionQuery(home, '2026-10-25T00:00:00Z')), 'the remainder is asked as of the cached response\'s database time');
  assert.ok(!queries.includes(combinedSignalQuery(home)) && !queries.includes(signalQuery(home)), 'the cached direction response is not downloaded again');
  const electric = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8'));
  assert.deepEqual(electric.features.map(f => f.id), ['node-2', 'node-3']);
  // A second build needs no request for that region at all.
  const again = fakeOverpass(() => ({elements: []}));
  await buildSignals({...d, ...quiet, fetcher: again.fetcher});
  assert.ok(again.queries.every(q => !q.includes(`(${HOME})`)));
});

test('a cached region whose remainder request times out splits that request alone and keeps the cached response', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const home = HOME.split(',').map(Number);
  await (await import('node:fs/promises')).mkdir(d.cacheRoot, {recursive: true});
  await writeFile(new URL(`signals-v1-${home.join('_')}.json`, d.cacheRoot), JSON.stringify({query: signalQuery(home), generated: '2026-10-25T00:00:00Z',
    response: {osm3s: {timestamp_osm_base: '2026-10-25T00:00:00Z'}, elements: [UNDIRECTED, ELECTRIC]}}));
  const {queries, fetcher} = fakeOverpass(query => {
    if (query === electricWithDirectionQuery(home, '2026-10-25T00:00:00Z')) return {elements: [], remark: 'runtime error: Query ran out of memory in "query"'};
    return {elements: query === electricWithDirectionQuery([45, 0, 67.5, 22.5], '2026-10-25T00:00:00Z') ? [DIRECTED_ELECTRIC] : []};
  });
  await buildSignals({...d, ...quiet, fetcher});
  assert.ok(!queries.includes(signalQuery(home)) && !queries.includes(combinedSignalQuery(home)), 'the cached response is kept');
  for (const quarter of [[45, 0, 67.5, 22.5], [45, 22.5, 67.5, 45], [67.5, 0, 90, 22.5], [67.5, 22.5, 90, 45]]) assert.ok(queries.includes(electricWithDirectionQuery(quarter, '2026-10-25T00:00:00Z')));
  const electric = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals-manifest.json'), 'utf8'));
  assert.deepEqual(electric.features.map(f => f.id), ['node-2', 'node-3']);
  validateElectricitySignalsSnapshot(electric, manifest);
  const again = fakeOverpass(() => ({elements: []}));
  await buildSignals({...d, ...quiet, fetcher: again.fetcher});
  assert.ok(again.queries.every(q => !q.includes(`(${HOME})`) && !q.includes('(45,0,67.5,22.5)')), 'the split and its quarters are checkpointed');
});

test('a region that times out is split into quarters that still partition the world', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const {fetcher} = fakeOverpass(query => box(query) === HOME ? {elements: [], remark: 'runtime error: Query timed out in "query"'}
    : {elements: box(query) === '45,0,67.5,22.5' ? [ELECTRIC] : []});
  const result = await buildSignals({...d, ...quiet, fetcher});
  const manifest = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals-manifest.json'), 'utf8'));
  assert.equal(manifest.coverage.length, 35, 'one region replaced by its four quarters');
  validateElectricitySignalsSnapshot(JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8')), manifest);
  assert.equal(result.electricity.features, 1);
});

test('a malformed response is never checkpointed, and a malformed cached one is fetched again', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const broken = {...ELECTRIC, lat: undefined};
  const bad = fakeOverpass(query => ({elements: box(query) === HOME ? [UNDIRECTED, broken] : []}));
  await assert.rejects(buildSignals({...d, ...quiet, fetcher: bad.fetcher}), /Incomplete/);
  const good = fakeOverpass(query => ({elements: box(query) === HOME ? [UNDIRECTED, ELECTRIC] : []}));
  await buildSignals({...d, ...quiet, fetcher: good.fetcher});
  assert.ok(good.queries.some(q => q.includes(`(${HOME})`)), 'the region is requested again rather than read from a bad checkpoint');
  // A malformed response cached before the downloads were combined is not reused.
  const home = HOME.split(',').map(Number);
  await rm(d.cacheRoot, {recursive: true, force: true});
  await (await import('node:fs/promises')).mkdir(d.cacheRoot, {recursive: true});
  await writeFile(new URL(`signals-v1-${home.join('_')}.json`, d.cacheRoot), JSON.stringify({query: signalQuery(home), generated: '2026-10-25T00:00:00Z', response: {elements: [broken]}}));
  const again = fakeOverpass(query => ({elements: box(query) === HOME ? [UNDIRECTED, ELECTRIC] : []}));
  await buildSignals({...d, ...quiet, fetcher: again.fetcher});
  assert.ok(again.queries.includes(combinedSignalQuery(home)));
});

test('a region that keeps failing publishes neither snapshot', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const {fetcher} = fakeOverpass(query => box(query) === HOME ? {status: 502} : {elements: [ELECTRIC]});
  await assert.rejects(buildSignals({...d, ...quiet, fetcher}), /Overpass HTTP 502/);
  await assert.rejects(readdir(d.output));
  await assert.rejects(readdir(d.powerOutput));
});

const adiff = (base, actions) => `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="Overpass API">\n<meta osm_base="${base}"/>\n${actions}\n</osm>\n`;
const node = ({id, lat, lon, tags}) => `<node id="${id}" lat="${lat}" lon="${lon}" version="2">${Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('')}</node>`;

async function seed(d, generated, elements = [UNDIRECTED, ELECTRIC]) {
  const home = HOME.split(',').map(Number);
  await (await import('node:fs/promises')).mkdir(d.cacheRoot, {recursive: true});
  for (const {box} of (await import('../scripts/crossing-data.mjs')).startRegions())
    await writeFile(new URL(`signals-v2-${box.join('_')}.json`, d.cacheRoot), JSON.stringify({query: combinedSignalQuery(box), generated,
      response: {osm3s: {timestamp_osm_base: '2026-10-20T00:00:00Z'}, elements: box.join(',') === HOME ? elements : []}}));
  return home;
}

test('a stored region is updated with the changes since its database time, never downloaded again', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const home = await seed(d, '2026-10-20T01:00:00Z');
  const moved = {...UNDIRECTED, lat: 48.81, tags: {...UNDIRECTED.tags, ref: 'C12'}};
  const {queries, fetcher} = fakeOverpass(query => ({raw: adiff('2026-10-31T11:00:00Z', box(query) !== HOME ? '' : [
    `<action type="modify"><old>${node(UNDIRECTED)}</old><new>${node(moved)}</new></action>`,
    `<action type="delete"><old>${node(ELECTRIC)}</old><new><node id="2" visible="true"/></new></action>`,
    `<action type="create">${node(DIRECTED_ELECTRIC)}</action>`].join('\n'))}));
  await buildSignals({...d, ...quiet, fetcher});
  assert.equal(queries.length, 32, 'one change request per stored region');
  assert.ok(queries.includes(signalChangesQuery(home, '2026-10-20T00:00:00Z')));
  assert.ok(!queries.some(q => q.includes('[out:json]')), 'no full download');
  const undirected = JSON.parse(gunzipSync(await readFile(new URL('railway-signals.geojson.gz', d.output))));
  assert.deepEqual(undirected.features.map(f => [f.id, f.properties.ref]), [[1, 'C12']], 'the modified signal changed, the retagged one left');
  const electric = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8'));
  assert.deepEqual(electric.features.map(f => f.id), ['node-3'], 'the created signal was added and the removed one dropped');
  const stored = JSON.parse(await readFile(new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot), 'utf8'));
  assert.equal(stored.response.osm3s.timestamp_osm_base, '2026-10-31T11:00:00Z', 'the next update starts from the new database time');
  // Within a week of an update, a build makes no requests at all.
  const again = fakeOverpass(() => ({raw: ''}));
  await buildSignals({...d, ...quiet, fetcher: again.fetcher});
  assert.equal(again.queries.length, 0);
});

test('a change request that times out is split into quarters, all ending at the same database time', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const home = await seed(d, '2026-10-20T01:00:00Z');
  const first = '45,0,67.5,22.5';
  const {queries, fetcher} = fakeOverpass(query => {
    if (box(query) === HOME) return {raw: adiff('2026-10-31T11:00:00Z', '<remark> runtime error: Query timed out in "query" at line 1 after 181 seconds. </remark>')};
    // The database moves on while the quarters are asked one after another.
    const base = box(query) === first ? '2026-10-31T11:00:00Z' : '2026-10-31T11:07:00Z';
    return {raw: adiff(base, box(query) === '67.5,0,90,22.5' ? `<action type="create">${node(DIRECTED_ELECTRIC)}</action>` : '')};
  });
  await buildSignals({...d, ...quiet, fetcher});
  const {quarters} = await import('../scripts/crossing-data.mjs');
  const [head, ...rest] = quarters(home);
  assert.ok(queries.includes(signalChangesQuery(head, '2026-10-20T00:00:00Z')), 'the first quarter asks up to the current database time');
  for (const child of rest)
    assert.ok(queries.includes(signalChangesQuery(child, '2026-10-20T00:00:00Z', '2026-10-31T11:00:00Z')), `quarter ${child} ends where the first one did`);
  const electric = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8'));
  assert.deepEqual(electric.features.map(f => f.id), ['node-2', 'node-3']);
  const stored = JSON.parse(await readFile(new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot), 'utf8'));
  assert.equal(stored.response.osm3s.timestamp_osm_base, '2026-10-31T11:00:00Z', 'the region is stored as of that one time, where the next update starts');
});

test('a failed or incomplete change request leaves the stored region and publishes nothing', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const home = await seed(d, '2026-10-20T01:00:00Z');
  const before = await readFile(new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot), 'utf8');
  for (const answer of [{status: 502}, {raw: '<?xml version="1.0"?>\n<osm><meta osm_base="2026-10-31T11:00:00Z"/><action type="create">'}]) {
    const {fetcher} = fakeOverpass(query => box(query) === HOME ? answer : {raw: adiff('2026-10-31T11:00:00Z', '')});
    await assert.rejects(buildSignals({...d, ...quiet, fetcher}), /Overpass HTTP 502|Incomplete signal change response/);
    assert.equal(await readFile(new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot), 'utf8'), before);
    await assert.rejects(readdir(d.powerOutput));
  }
});

test('change responses: escaped text, ways ignored, refusals and truncation rejected', async () => {
  const {parseSignalChanges, signalChangesQuery} = await import('../scripts/signals-data.mjs');
  const changes = parseSignalChanges(adiff('2026-10-31T11:00:00Z', [
    '<action type="create"><node id="9" lat="35.6" lon="139.7"><tag k="railway" v="signal"/><tag k="name" v="&quot;A&quot; &amp; &#x4E2D;&#22830;"/></node></action>',
    '<action type="create"><way id="4"><nd ref="1"/></way></action>'].join('\n')));
  assert.deepEqual(changes, {timestamp: '2026-10-31T11:00:00Z', upserts: [{type: 'node', id: 9, lat: 35.6, lon: 139.7, tags: {railway: 'signal', name: '"A" & 中央'}}], deletes: []});
  assert.throws(() => parseSignalChanges(adiff('2026-10-31T11:00:00Z', '<remark> runtime error: something else </remark>')), /runtime error/);
  assert.throws(() => parseSignalChanges('<osm><meta osm_base="2026-10-31T11:00:00Z"/>'), /Incomplete/);
  assert.throws(() => parseSignalChanges('<osm></osm>'), /without a database timestamp/);
  assert.match(signalChangesQuery([45, 0, 90, 45], '2026-10-20T00:00:00Z'), /^\[out:xml\].*\[adiff:"2026-10-20T00:00:00Z"\];.*out meta;$/, 'XML: the server refuses diff modes in JSON');
  assert.throws(() => signalChangesQuery([45, 0, 90, 45], 'yesterday'), /Invalid signal change start/);
  assert.match(signalChangesQuery([45, 0, 90, 45], '2026-10-20T00:00:00Z', '2026-10-31T11:00:00Z'), /\[adiff:"2026-10-20T00:00:00Z","2026-10-31T11:00:00Z"\];/, 'an explicit end time');
  assert.throws(() => signalChangesQuery([45, 0, 90, 45], '2026-10-20T00:00:00Z', '2026-10-19T00:00:00Z'), /Invalid signal change end/);
});
