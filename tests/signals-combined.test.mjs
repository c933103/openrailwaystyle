import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {buildSignals} from '../scripts/build-signals.mjs';
import {quarters, startRegions} from '../scripts/crossing-data.mjs';
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
let quietElapsed=0;
const quiet = {clock:()=>quietElapsed,sleep: async ms => {quietElapsed+=ms;}, log() {}, warn() {}, now: () => Date.parse('2026-10-31T12:00:00Z')};

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

test('a change split is recorded with the region, so its next update asks the quarters directly', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const home = await seed(d, '2026-10-20T01:00:00Z');
  const {quarters} = await import('../scripts/crossing-data.mjs');
  const parts = quarters(home), file = new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot);
  const timedOut = adiff('2026-10-31T11:00:00Z', '<remark> runtime error: Query timed out in "query" at line 1 after 181 seconds. </remark>');
  const first = fakeOverpass(query => ({raw: box(query) === HOME ? timedOut : adiff('2026-10-31T11:00:00Z', '')}));
  await buildSignals({...d, ...quiet, fetcher: first.fetcher});
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).changeParts, parts);
  // A week later: the quarters only, the first fixing the end time.
  const later = {...quiet, now: () => Date.parse('2026-11-08T12:00:00Z')};
  const next = fakeOverpass(query => ({raw: box(query) === HOME ? timedOut : adiff('2026-11-08T11:00:00Z', '')}));
  await buildSignals({...d, ...later, fetcher: next.fetcher});
  const asked = next.queries.filter(q => parts.some(p => box(q) === p.join(',')) || box(q) === HOME);
  assert.deepEqual(asked, [signalChangesQuery(parts[0], '2026-10-31T11:00:00Z'),
    ...parts.slice(1).map(p => signalChangesQuery(p, '2026-10-31T11:00:00Z', '2026-11-08T11:00:00Z'))], 'never the whole region again');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).changeParts, parts, 'kept for the update after');
  // A record that no longer partitions the region is not trusted: the whole region is asked.
  const stored = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({...stored, changeParts: parts.slice(1)}));
  const third = fakeOverpass(() => ({raw: adiff('2026-11-15T11:00:00Z', '')}));
  await buildSignals({...d, ...quiet, now: () => Date.parse('2026-11-15T12:00:00Z'), fetcher: third.fetcher});
  assert.ok(third.queries.includes(signalChangesQuery(home, '2026-11-08T11:00:00Z')));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).changeParts, undefined, 'the whole region answered: no split recorded');
});

test('each recorded box keeps its own split allowance, whatever the depth of the others', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const home = await seed(d, '2026-10-20T01:00:00Z');
  const {quarters} = await import('../scripts/crossing-data.mjs');
  // A partition with one branch split five times and three depth-1 quarters.
  const parts = [];
  let deepest = home;
  for (let depth = 1; depth <= 5; depth++) {
    const [first, ...rest] = quarters(deepest);
    parts.push(...rest);
    if (depth === 5) parts.push(first); else deepest = first;
  }
  const file = new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot);
  await writeFile(file, JSON.stringify({...JSON.parse(await readFile(file, 'utf8')), changeParts: parts}));
  // A depth-1 quarter now times out: it still splits, into its own quarters.
  const big = quarters(home)[3].join(','), timedOut = adiff('2026-10-31T11:00:00Z', '<remark> runtime error: Query timed out in "query" at line 1 after 181 seconds. </remark>');
  const {queries, fetcher} = fakeOverpass(query => ({raw: box(query) === big ? timedOut : adiff('2026-10-31T11:00:00Z', '')}));
  await buildSignals({...d, ...quiet, fetcher});
  for (const child of quarters(quarters(home)[3])) assert.ok(queries.some(q => box(q) === child.join(',')), `asked ${child}`);
  const stored = JSON.parse(await readFile(file, 'utf8')).changeParts;
  assert.equal(stored.length, parts.length + 3, 'the new split is recorded with the old ones');
});

async function publishedFiles(d) {
  const files = {};
  for (const root of [d.output, pathToFileURL(d.powerOutput + '/')]) {
    for (const name of (await readdir(root, {recursive: true})).sort()) {
      try { files[new URL(name, root).href] = (await readFile(new URL(name, root))).toString('base64'); }
      catch (error) { if (error.code !== 'EISDIR') throw error; }
    }
  }
  return files;
}

for (const kind of ['combined', 'combined-stale', 'legacy', 'remainder']) {
  for (const remark of ['runtime error: Query timed out in "query"', 'runtime error: incomplete result']) {
    for (const repaired of [true, false]) {
      test(`${kind} checkpoint with ${remark} requires a complete replacement (${repaired ? 'available' : 'failed'})`, async t => {
        const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
        const home = await seed(d, '2026-10-31T00:00:00Z');
        await buildSignals({...d, ...quiet, fetcher: async () => { throw new Error('initial cache should be complete'); }});
        const previous = await publishedFiles(d);
        const combinedFile = new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot);
        const original = JSON.parse(await readFile(combinedFile, 'utf8'));
        const baseTime = original.response.osm3s.timestamp_osm_base;
        let file = combinedFile, query = combinedSignalQuery(home), saved = original;
        if (!kind.startsWith('combined')) {
          await rm(combinedFile);
          file = new URL(`signals-v1-${home.join('_')}.json`, d.cacheRoot);
          saved = {...original, query: signalQuery(home)};
          await writeFile(file, JSON.stringify(saved));
          if (kind === 'remainder') {
            file = new URL(`signals-electric-v1-${home.join('_')}.json`, d.cacheRoot);
            query = electricWithDirectionQuery(home, baseTime);
            saved = {...original, query, response: {...original.response, elements: []}};
          }
        }
        await writeFile(file, JSON.stringify({...saved, ...(kind === 'combined-stale' ? {generated: '2026-10-20T01:00:00Z'} : {}), response: {...saved.response, remark}}));
        const before = await readFile(file, 'utf8');
        const answer = fakeOverpass(request => {
          assert.equal(request, query, 'only the invalid region/projection is fetched; cached errors do not cause subdivision');
          if (!repaired) return {status: 403};
          return {elements: kind === 'remainder' ? [DIRECTED_ELECTRIC] : [UNDIRECTED, ELECTRIC, DIRECTED_ELECTRIC]};
        });
        if (!repaired) {
          await assert.rejects(buildSignals({...d, ...quiet, fetcher: answer.fetcher}), /Overpass HTTP 403/);
          assert.equal(answer.queries.length, 3, 'existing HTTP retry policy is unchanged');
          assert.deepEqual(await publishedFiles(d), previous, 'neither published snapshot is changed on repair failure');
          assert.equal(await readFile(file, 'utf8'), before, 'failure does not overwrite the source checkpoint');
          return;
        }
        await buildSignals({...d, ...quiet, fetcher: answer.fetcher});
        assert.deepEqual(answer.queries, [query]);
        const electric = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8'));
        assert.deepEqual(electric.features.map(f => f.id), ['node-2', 'node-3'], 'the omitted directed signal is recovered');
        const validCombined = JSON.parse(await readFile(combinedFile, 'utf8'));
        assert.equal(validCombined.response.remark, undefined, 'a partial response is never promoted into the combined cache');
        const again = fakeOverpass(() => { throw new Error('repaired cache should be reusable'); });
        await buildSignals({...d, ...quiet, fetcher: again.fetcher});
        assert.equal(again.queries.length, 0);
      });
    }
  }
}

const HOME_BOX = HOME.split(',').map(Number);
const HOME_QUARTERS = [[45, 0, 67.5, 22.5], [45, 22.5, 67.5, 45], [67.5, 0, 90, 22.5], [67.5, 22.5, 90, 45]];
const tooDeep = [];
let deepestChangeBox = HOME_BOX;
for (let depth = 0; depth < 6; depth++) {
  const [first, ...rest] = quarters(deepestChangeBox);
  tooDeep.push(...rest); deepestChangeBox = first;
}
tooDeep.push(deepestChangeBox);
const invalidChangePartitions = [
  ['duplicate quarter replacing a missing quarter', [HOME_QUARTERS[0], HOME_QUARTERS[0], HOME_QUARTERS[2], HOME_QUARTERS[3]]],
  ['overlap balanced by a gap', [...HOME_QUARTERS.slice(0, 2), [67.5, 0, 90, 30], [67.5, 7.5, 90, 22.5]]],
  ['non-quadtree strips', [[45, 0, 90, 22.5], [45, 22.5, 90, 45]]],
  ['coerced coordinate strings', HOME_QUARTERS.map(p => p.map(String))],
  ['subdivision beyond the existing depth budget', tooDeep],
];

for (const [name, parts] of invalidChangePartitions) {
  for (const repaired of [true, false]) {
    test(`signal change partition rejects ${name} (${repaired ? 'full-region repair' : 'failed repair'})`, async t => {
      const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
      const home = await seed(d, '2026-10-31T00:00:00Z');
      await buildSignals({...d, ...quiet, fetcher: async () => { throw new Error('initial cache should be complete'); }});
      const previous = await publishedFiles(d), file = new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot);
      const saved = JSON.parse(await readFile(file, 'utf8'));
      await writeFile(file, JSON.stringify({...saved, generated: '2026-10-20T01:00:00Z', changeParts: parts}));
      const before = await readFile(file, 'utf8'), expected = signalChangesQuery(home, '2026-10-20T00:00:00Z');
      const answer = fakeOverpass(query => {
        assert.equal(query, expected, 'invalid subdivision must fall back to the complete region changes, not re-download its data');
        return repaired ? {raw: adiff('2026-10-31T11:00:00Z', `<action type="create">${node(DIRECTED_ELECTRIC)}</action>`)} : {status: 502};
      });
      if (!repaired) {
        await assert.rejects(buildSignals({...d, ...quiet, fetcher: answer.fetcher}), /Overpass HTTP 502/);
        assert.deepEqual(answer.queries, [expected, expected, expected]);
        assert.equal(await readFile(file, 'utf8'), before);
        assert.deepEqual(await publishedFiles(d), previous);
        return;
      }
      await buildSignals({...d, ...quiet, fetcher: answer.fetcher});
      assert.deepEqual(answer.queries, [expected]);
      const electric = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8'));
      assert.deepEqual(electric.features.map(f => f.id), ['node-2', 'node-3']);
      const updated = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(updated.changeParts, undefined);
      assert.equal(updated.response.osm3s.timestamp_osm_base, '2026-10-31T11:00:00Z');
    });
  }
}

test('a same-area duplicate partition cannot silently lose a signal created in its missing quarter', async t => {
  const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
  const home = await seed(d, '2026-10-31T00:00:00Z'), file = new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({...saved, generated: '2026-10-20T01:00:00Z', changeParts: invalidChangePartitions[0][1]}));
  const added = {...DIRECTED_ELECTRIC, lat: 50, lon: 30};
  const answer = fakeOverpass(query => {
    const [s, w, n, e] = box(query).split(',').map(Number);
    return {raw: adiff('2026-10-31T11:00:00Z', added.lat >= s && added.lat <= n && added.lon >= w && added.lon <= e ? `<action type="create">${node(added)}</action>` : '')};
  });
  await buildSignals({...d, ...quiet, fetcher: answer.fetcher});
  const electric = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8'));
  assert.deepEqual(electric.features.map(f => f.id), ['node-2', 'node-3']);
  assert.deepEqual(answer.queries, [signalChangesQuery(HOME_BOX, '2026-10-20T00:00:00Z')]);
});

for (const kind of ['full', 'remainder', 'changes']) {
  for (const phase of ['headers', 'body']) {
    for (const recover of [true, false]) {
      test(`${kind} signal ${phase} transport deadline ${recover ? 'retries the same query' : 'preserves checkpoints and publications'}`, async t => {
        const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
        const home = await seed(d, '2026-10-31T00:00:00Z');
        await buildSignals({...d, ...quiet, fetcher: async () => { throw new Error('initial cache should be complete'); }});
        const previous = await publishedFiles(d), file = new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot);
        const saved = JSON.parse(await readFile(file, 'utf8'));
        let expected = combinedSignalQuery(home);
        if (kind === 'changes') {
          await writeFile(file, JSON.stringify({...saved, generated: '2026-10-20T01:00:00Z'}));
          expected = signalChangesQuery(home, '2026-10-20T00:00:00Z');
        } else {
          await rm(file);
          if (kind === 'remainder') {
            await writeFile(new URL(`signals-v1-${home.join('_')}.json`, d.cacheRoot), JSON.stringify({...saved, query: signalQuery(home)}));
            expected = electricWithDirectionQuery(home, '2026-10-20T00:00:00Z');
          }
        }
        const cacheFiles = async () => Object.fromEntries(await Promise.all((await readdir(d.cacheRoot)).sort().map(async name => [name, await readFile(new URL(name, d.cacheRoot), 'utf8')])));
        const before = await cacheFiles(), queries = [];
        const failure = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        const fetcher = async (url, {body}) => {
          const query = new URLSearchParams(String(body)).get('data'); queries.push(query);
          assert.equal(query, expected, 'only the original region/projection may be requested');
          if (!recover || queries.length === 1) {
            if (phase === 'headers') throw failure;
            return {ok: true, text: async () => { throw failure; }};
          }
          return {ok: true, text: async () => kind === 'changes'
            ? adiff('2026-10-31T11:00:00Z', `<action type="create">${node(DIRECTED_ELECTRIC)}</action>`)
            : JSON.stringify({osm3s: {timestamp_osm_base: '2026-10-31T11:00:00Z'}, elements: kind === 'remainder' ? [DIRECTED_ELECTRIC] : [UNDIRECTED, ELECTRIC, DIRECTED_ELECTRIC]})};
        };
        if (!recover) {
          await assert.rejects(buildSignals({...d, ...quiet, fetcher}), /operation was aborted due to timeout/);
          assert.deepEqual(queries, [expected, expected, expected]);
          assert.deepEqual(await cacheFiles(), before, 'a transport failure never leaves a durable spatial split');
          assert.deepEqual(await publishedFiles(d), previous);
          return;
        }
        await buildSignals({...d, ...quiet, fetcher});
        assert.deepEqual(queries, [expected, expected]);
        const electric = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8'));
        assert.deepEqual(electric.features.map(f => f.id), ['node-2', 'node-3']);
        assert.ok(Object.values(await cacheFiles()).every(text => !JSON.parse(text).split));
      });
    }
  }
}

for (const kind of ['full', 'remainder', 'changes']) {
  for (const status of [403, 503]) {
    for (const cleanup of ['resolves', 'rejects', 'throws', 'pending']) {
      test(`${kind} signal HTTP ${status} remains authoritative when body cleanup ${cleanup}`, async t => {
        const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
        const home = await seed(d, '2026-10-31T00:00:00Z');
        await buildSignals({...d, ...quiet, fetcher: async () => { throw new Error('initial cache should be complete'); }});
        const previous = await publishedFiles(d), file = new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot);
        const saved = JSON.parse(await readFile(file, 'utf8'));
        let expected = combinedSignalQuery(home);
        if (kind === 'changes') {
          await writeFile(file, JSON.stringify({...saved, generated: '2026-10-20T01:00:00Z'}));
          expected = signalChangesQuery(home, '2026-10-20T00:00:00Z');
        } else {
          await rm(file);
          if (kind === 'remainder') {
            await writeFile(new URL(`signals-v1-${home.join('_')}.json`, d.cacheRoot), JSON.stringify({...saved, query: signalQuery(home)}));
            expected = electricWithDirectionQuery(home, '2026-10-20T00:00:00Z');
          }
        }
        const cacheFiles = async () => Object.fromEntries(await Promise.all((await readdir(d.cacheRoot)).sort().map(async name => [name, await readFile(new URL(name, d.cacheRoot), 'utf8')])));
        const before = await cacheFiles(), queries = [];
        let reads = 0, cancels = 0;
        const fetcher = async (url, {body}) => {
          const query = new URLSearchParams(String(body)).get('data'); queries.push(query);
          assert.equal(query, expected);
          return {ok: false, status,
            body: {cancel() {
              cancels++;
              if (cleanup === 'throws') throw new Error('cleanup failed');
              if (cleanup === 'rejects') return Promise.reject(new Error('cleanup failed'));
              if (cleanup === 'pending') return new Promise(() => {});
              return Promise.resolve();
            }},
            text() {
              reads++;
              return cleanup === 'pending' ? new Promise(() => {}) : Promise.reject(new Error('error body read failed'));
            }};
        };
        let timer;
        try {
          await Promise.race([
            assert.rejects(buildSignals({...d, ...quiet, fetcher}), new RegExp(`Overpass HTTP ${status}`)),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('HTTP classification waited for an unused response body')), 1000); }),
          ]);
        } finally { clearTimeout(timer); }
        assert.deepEqual(queries, [expected, expected, expected], 'the existing three-attempt HTTP policy is unchanged');
        assert.equal(reads, 0, 'unused error bodies are never consumed');
        assert.equal(cancels, 3, 'each error response receives best-effort cleanup');
        assert.deepEqual(await cacheFiles(), before);
        assert.deepEqual(await publishedFiles(d), previous);
      });
    }
  }
}

for (const kind of ['full', 'remainder', 'changes']) {
  for (const format of ['seconds', 'date']) {
    for (const first of ['http', 'body']) {
      test(`${kind} signals honor ${format} Retry-After from a ${first} failure`, async t => {
        const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
        const home = await seed(d, '2026-10-31T00:00:00Z'), file = new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot);
        const saved = JSON.parse(await readFile(file, 'utf8'));
        let expected = combinedSignalQuery(home);
        if (kind === 'changes') {
          await writeFile(file, JSON.stringify({...saved, generated: '2026-10-20T01:00:00Z'}));
          expected = signalChangesQuery(home, '2026-10-20T00:00:00Z');
        } else {
          await rm(file);
          if (kind === 'remainder') {
            await writeFile(new URL(`signals-v1-${home.join('_')}.json`, d.cacheRoot), JSON.stringify({...saved, query: signalQuery(home)}));
            expected = electricWithDirectionQuery(home, '2026-10-20T00:00:00Z');
          }
        }
        const start = quiet.now(), times = [], pauses = [];
        let elapsed = 0;
        const header = format === 'seconds' ? '120' : new Date(start + 120000).toUTCString();
        const fetcher = async (url, {body}) => {
          assert.equal(new URLSearchParams(String(body)).get('data'), expected);
          times.push(elapsed);
          if (times.length === 1) return {ok: first === 'body', status: first === 'body' ? 200 : 503, headers: new Headers({'retry-after': header}),
            body: {cancel: () => Promise.resolve()}, text: async () => { elapsed += 40000; throw new Error('body failed after headers'); }};
          return {ok: true, text: async () => kind === 'changes'
            ? adiff('2026-10-31T11:00:00Z', `<action type="create">${node(DIRECTED_ELECTRIC)}</action>`)
            : JSON.stringify({osm3s: {timestamp_osm_base: '2026-10-31T11:00:00Z'}, elements: kind === 'remainder' ? [DIRECTED_ELECTRIC] : [UNDIRECTED, ELECTRIC, DIRECTED_ELECTRIC]})};
        };
        await buildSignals({...d, ...quiet, now: () => start + elapsed, clock: () => elapsed,
          sleep: async ms => { pauses.push(ms); elapsed += ms; }, fetcher});
        assert.deepEqual(times, [0, 120000], 'no next request before the header-time provider deadline');
        assert.deepEqual(pauses, [first === 'body' ? 80000 : 120000], 'time already spent reading the body is not waited twice');
        const electric = JSON.parse(await readFile(join(d.powerOutput, 'electricity-signals.geojson'), 'utf8'));
        assert.deepEqual(electric.features.map(f => f.id), ['node-2', 'node-3']);
      });
    }
  }
}

for (const wallJump of [false, true]) {
  test(`a successful signal response delays the next region through an early wake${wallJump ? ' and a wall-clock jump' : ''}`, async t => {
    const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
    const home = await seed(d, '2026-10-31T00:00:00Z'), regions = startRegions().map(r => r.box);
    const next = regions[regions.findIndex(b => b.join(',') === HOME) + 1];
    assert.ok(next);
    for (const region of [home, next]) await rm(new URL(`signals-v2-${region.join('_')}.json`, d.cacheRoot));
    const start = quiet.now(), times = [], pauses = [];
    let elapsed = 0, adjustment = 0;
    const fetcher = async (url, {body}) => {
      const query = new URLSearchParams(String(body)).get('data');
      assert.equal(query, combinedSignalQuery(times.length ? next : home)); times.push(elapsed);
      return {ok: true, headers: new Headers(times.length === 1 ? {'retry-after': new Date(start + 120000).toUTCString()} : {}),
        text: async () => JSON.stringify({osm3s: {timestamp_osm_base: '2026-10-31T11:00:00Z'}, elements: times.length === 1 ? [UNDIRECTED, ELECTRIC] : []})};
    };
    await buildSignals({...d, ...quiet, now: () => start + elapsed + adjustment, clock: () => elapsed, fetcher,
      sleep: async ms => { pauses.push(ms); elapsed += pauses.length === 1 ? ms / 2 : ms; if (wallJump) adjustment = 600000; }});
    assert.deepEqual(times, [0, 120000]);
    assert.deepEqual(pauses, [120000, 60000], 'early wake rechecks the monotonic provider deadline');
  });
}

const excessiveSignalPauses = ['301', '9'.repeat(400), new Date(quiet.now() + 360000).toUTCString()];
for (const [index, header] of excessiveSignalPauses.entries()) {
  for (const first of ['http', 'body']) {
    test(`excessive signal provider pause ${index} stops before another request after ${first} failure`, async t => {
      const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
      const home = await seed(d, '2026-10-31T00:00:00Z');
      await buildSignals({...d, ...quiet, fetcher: async () => { throw new Error('initial cache should be complete'); }});
      const previous = await publishedFiles(d), file = new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot);
      await rm(file);
      let requests = 0, sleeps = 0;
      const fetcher = async () => {
        requests++;
        return {ok: first === 'body', status: first === 'body' ? 200 : 503, headers: new Headers({'retry-after': header}), body: {cancel: () => Promise.resolve()},
          text: async () => { throw new Error('body read failed'); }};
      };
      await assert.rejects(buildSignals({...d, ...quiet, clock: () => 0, sleep: async () => { sleeps++; }, fetcher}), /Retry-After exceeds/);
      assert.equal(requests, 1); assert.equal(sleeps, 0);
      assert.deepEqual(await publishedFiles(d), previous);
      await assert.rejects(readFile(file), {code: 'ENOENT'});
    });
  }
  test(`excessive signal pause ${index} permits final success when no request remains`, async t => {
    const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
    const home = await seed(d, '2026-10-31T00:00:00Z');
    await rm(new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot));
    let requests = 0;
    await buildSignals({...d, ...quiet, clock: () => 0, sleep: async () => { throw new Error('no wait without another request'); },
      fetcher: async () => {
        requests++;
        return {ok: true, headers: new Headers({'retry-after': header}), text: async () => JSON.stringify({osm3s: {timestamp_osm_base: '2026-10-31T11:00:00Z'}, elements: [UNDIRECTED, ELECTRIC]})};
      }});
    assert.equal(requests, 1);
  });
}

const signalRetryDates = [
  ['invalid February day', 'Sun, 31 Feb 2027 12:00:00 GMT', false],
  ['invalid April day', 'Fri, 31 Apr 2027 12:00:00 GMT', false],
  ['invalid weekday token', 'Foo, 28 Feb 2027 12:02:00 GMT', false],
  ['weekday disagrees with date', 'Mon, 28 Feb 2027 12:02:00 GMT', false],
  ['obsolete invalid day', 'Sunday, 31-Feb-27 12:00:00 GMT', false],
  ['obsolete invalid weekday', 'Funday, 28-Feb-27 12:02:00 GMT', false],
  ['asctime invalid day', 'Sun Feb 31 12:00:00 2027', false],
  ['asctime invalid weekday', 'Foo Feb 28 12:02:00 2027', false],
  ['valid IMF date', 'Sun, 28 Feb 2027 12:02:00 GMT', true],
  ['valid obsolete date', 'Sunday, 28-Feb-27 12:02:00 GMT', true],
  ['valid asctime date', 'Sun Feb 28 12:02:00 2027', true],
];
for (const year of [2028, 2090, 2100]) {
  const start = Date.parse(`${year}-01-01T12:00:00Z`), end = new Date(start + 120000);
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const header = `${weekdays[end.getUTCDay()]}, 01-Jan-${String(year).slice(-2)} 12:02:00 GMT`;
  signalRetryDates.push([`valid obsolete year ${year}`, header, true, start]);
}
for (const [name, header, valid, initial] of signalRetryDates) {
  test(`signal provider pause validates ${name}`, async t => {
    const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
    const start = initial ?? Date.parse('2027-02-28T12:00:00Z'), home = await seed(d, new Date(start).toISOString());
    await rm(new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot));
    let elapsed = 0;
    const times = [];
    await buildSignals({...d, ...quiet, now: () => start + elapsed, clock: () => elapsed,
      sleep: async ms => { elapsed += ms; }, fetcher: async () => {
        times.push(elapsed);
        if (times.length === 1) return {ok: false, status: 503, headers: new Headers({'retry-after': header}), body: {cancel: () => Promise.resolve()}};
        return {ok: true, status: 200, text: async () => JSON.stringify({osm3s: {timestamp_osm_base: new Date(start).toISOString().replace('.000Z', 'Z')}, elements: [UNDIRECTED, ELECTRIC]})};
      }});
    assert.deepEqual(times, [0, valid ? 120000 : 30000], 'only a valid calendar date supplies a provider deadline');
  });
}

for (const kind of ['full', 'remainder']) {
  for (const body of ['timeout', 'memory', 'maxsize']) {
    test(`${kind} malformed JSON mentioning ${body} cannot create spatial checkpoints`, async t => {
      const d = await dirs(); t.after(() => rm(d.root, {recursive: true, force: true}));
      const home = await seed(d, '2026-10-31T00:00:00Z'), file = new URL(`signals-v2-${home.join('_')}.json`, d.cacheRoot);
      await buildSignals({...d, ...quiet, fetcher: async () => { throw new Error('complete cache needs no requests'); }});
      const previous = await publishedFiles(d), saved = JSON.parse(await readFile(file, 'utf8'));
      await rm(file);
      if (kind === 'remainder') await writeFile(new URL(`signals-v1-${home.join('_')}.json`, d.cacheRoot), JSON.stringify({...saved, query: signalQuery(home)}));
      const checkpointFiles = async () => Object.fromEntries(await Promise.all((await readdir(d.cacheRoot)).sort().map(async name => [name, await readFile(new URL(name, d.cacheRoot), 'utf8')])));
      const before = await checkpointFiles(), queries = [];
      await assert.rejects(buildSignals({...d, ...quiet, fetcher: async (url, {body: request}) => {
        queries.push(new URLSearchParams(String(request)).get('data'));
        return {ok: true, status: 200, text: async () => body};
      }}), SyntaxError);
      assert.equal(queries.length, 1, 'malformed JSON is not evidence that the spatial query exceeded a limit');
      assert.equal(queries[0], kind === 'full' ? combinedSignalQuery(home) : electricWithDirectionQuery(home, '2026-10-20T00:00:00Z'));
      assert.deepEqual(await checkpointFiles(), before, 'no permanent subdivision or corrupt response is stored');
      assert.deepEqual(await publishedFiles(d), previous, 'both prior publications remain intact');
    });
  }
}

for(const path of ['spacing','HTTP backoff','transport backoff'])
 test(`signals recheck early ${path} timers without provider headers`,async t=>{
  const d=await dirs();t.after(()=>rm(d.root,{recursive:true,force:true}));
  let elapsed=0,waits=0;
  const times=[],queries=[];
  await buildSignals({...d,...quiet,clock:()=>elapsed,
   sleep:async ms=>{elapsed+=++waits===1?ms/2:ms;},fetcher:async(url,{body})=>{
    times.push(elapsed);queries.push(body.get('data'));
    if(times.length===1&&path==='HTTP backoff')return new Response('busy',{status:503});
    if(times.length===1&&path==='transport backoff')throw new TypeError('fetch failed');
    return new Response(JSON.stringify({osm3s:{timestamp_osm_base:'2026-10-31T00:00:00Z'},elements:[UNDIRECTED,ELECTRIC,DIRECTED_ELECTRIC]}));
   }});
  assert.equal(times[1],path==='spacing'?10000:30000);
  assert.equal(times.length,path==='spacing'?32:33);
  if(path!=='spacing')assert.equal(queries[0],queries[1],'retry stays on the same region');
 });
