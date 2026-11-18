import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildExtractAxleLoad, extractAxleRows, finlandPolygon, inPolygons, isAxleWay, MINIMUM} from '../scripts/build-extract-axle-load.mjs';
import {AXLE_RAIL_FILTER, AXLE_RAILWAYS, axleLookup} from '../scripts/axle-load-lookup.mjs';
import {decodeLoadingGauges} from '../styles/loading-gauge-list.mjs';
import {checkMarker} from '../scripts/data-source.mjs';

const report = (extra = {}) => ({schema: 1, index: '20261111T121854Z-42996345331', regions: 175, oldestTimestamp: '2026-11-03T21:24:23Z', newestTimestamp: '2026-11-11T10:58:20Z', missingNodeRefs: 0, missingRegions: [], ...extra});
// A square "Finland" from 20 to 30 E, 60 to 70 N, with a hole from 24 to 26 E, 64 to 66 N.
const ring = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const FINLAND = [[ring(20, 60, 30, 70), ring(24, 64, 26, 66)]];
const INDEX = {polygons: {finland: FINLAND, sweden: [[ring(10, 55, 20, 70)]]}};
const meta = {version: 2, timestamp: '2026-10-01T00:00:00Z'};
const way = (id, coords, tags) => {
  const geometry = coords.map(([lon, lat]) => ({lat, lon}));
  return {type: 'way', id, ...meta, nodes: coords.map((_, i) => id * 10 + i), geometry, tags};
};
const ELEMENTS = [
  way(1, [[21, 61], [21.1, 61.1]], {railway: 'rail', 'railway:track_class': 'D4'}), // Finnish
  way(2, [[15, 61], [21, 61]], {railway: 'rail', 'railway:track_class': ' C2 ', axle_load: '22.5'}), // one node in Finland: Finnish
  way(3, [[25, 65], [25.1, 65.1]], {railway: 'rail', 'railway:track_class': 'B1'}), // in the hole: not Finnish
  way(4, [[21, 62], [21.1, 62.1]], {railway: 'narrow_gauge', axle_load: '16'}), // in Finland, no track class: en
  way(5, [[8, 50], [8.1, 50.1]], {railway: 'subway', maxaxleload: ' 20 t '}),
  way(6, [[8, 51], [8.1, 51.1]], {railway: 'tram', axle_load: '10'}), // not an axle railway
  way(7, [[8, 52], [8.1, 52.1]], {railway: 'rail;abandoned', axle_load: '10'}), // not exactly a value
  way(8, [[8, 53], [8.1, 53.1]], {railway: 'Rail', axle_load: '10'}), // case matters, as in the Overpass regex
  way(9, [[8, 54], [8.1, 54.1]], {railway: 'rail', 'axle_load:forward': '10'}), // another key
  way(10, [[8, 55], [8.1, 55.1]], {railway: 'funicular', axle_load: '  '}), // a blank value: the way, no value
  way(13, [[8, 56], [8.1, 56.1]], {railway: 'monorail', maxaxleload: ''}), // an empty value: [maxaxleload] matches it
  {type: 'node', id: 11, ...meta, lat: 61, lon: 21, tags: {railway: 'rail', axle_load: '10'}},
  {type: 'relation', id: 12, ...meta, members: [], tags: {railway: 'rail', axle_load: '10'}},
];
const SELECTED = [1, 2, 3, 4, 5, 10, 13];
const fakeRead = (pool = ELEMENTS) => async (pbf, {keep, onElement}) => {
  const kept = pool.filter(e => keep({type: e.type, id: e.id, tags: e.tags}));
  for (const e of kept) await onElement(structuredClone(e));
  return {read: pool.length, kept: kept.length, withoutGeometry: 0};
};

test('the selection is the Overpass build\'s: exact railway values, any of the three keys, ways only', () => {
  assert.equal(AXLE_RAIL_FILTER, '[railway~"^(rail|narrow_gauge|light_rail|subway|monorail|funicular)$"]');
  assert.deepEqual(AXLE_RAILWAYS, ['rail', 'narrow_gauge', 'light_rail', 'subway', 'monorail', 'funicular']);
  assert.deepEqual(ELEMENTS.filter(isAxleWay).map(e => e.id), SELECTED);
  for (const railway of AXLE_RAILWAYS) for (const key of ['axle_load', 'maxaxleload', 'railway:track_class'])
    assert.ok(isAxleWay({type: 'way', tags: {railway, [key]: 'x'}}), `${railway} ${key}`);
});

test('Finland: a node inside the polygon and outside its holes, for a way with a track class', async () => {
  assert.ok(inPolygons(FINLAND, 21, 61));
  assert.ok(!inPolygons(FINLAND, 25, 65), 'in the hole');
  assert.ok(!inPolygons(FINLAND, 31, 61));
  const {rows, finnish, counts} = await extractAxleRows('x', FINLAND, {read: fakeRead()});
  assert.deepEqual([...finnish].sort((a, b) => a - b), [1, 2]);
  assert.deepEqual(rows, [[1, '', '', 'D4'], [2, '22.5', '', 'C2'], [3, '', '', 'B1'], [4, '16', '', ''], [5, '', '20 t', ''], [10, '', '', ''], [13, '', '', '']]);
  assert.deepEqual(counts, {read: ELEMENTS.length, kept: SELECTED.length, waysWithoutGeometry: 0});
  assert.equal(finlandPolygon(INDEX), FINLAND);
  for (const index of [{}, {polygons: {}}, {polygons: {finland: []}}, {polygons: {finland: [[[[20, 60]]]]}}])
    assert.throws(() => finlandPolygon(index), /no finland polygon/);
});

// What the Overpass build's five queries answer for ELEMENTS, as CSV: the
// four parts, then the Finnish track-class ways (Finland's area here is
// FINLAND).
function overpassAnswers(elements) {
  const tracks = elements.filter(isAxleWay), csv = value => value === undefined ? '' : /[\t"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const part = rows => rows.map(e => `way\t${e.id}\t\t${csv(e.tags.axle_load)}\t${csv(e.tags.maxaxleload)}\t${csv(e.tags['railway:track_class'])}`).join('\n') + `\ncount\t0\t${rows.length}\t\t\t\n`;
  const cls = e => e.tags['railway:track_class'];
  return [part(tracks.filter(e => e.tags.axle_load !== undefined)), part(tracks.filter(e => e.tags.maxaxleload !== undefined)),
    part(tracks.filter(e => cls(e) === 'D4')), part(tracks.filter(e => cls(e) !== undefined && cls(e) !== 'D4')),
    (fi => fi.map(e => `way\t${e.id}\t`).join('\n') + `\ncount\t0\t${fi.length}\n`)(tracks.filter(e => cls(e) !== undefined && e.geometry.some(p => inPolygons(FINLAND, p.lon, p.lat))))];
}
const builder = fileURLToPath(new URL('../scripts/build-axle-load-list.mjs', import.meta.url));
async function overpassLookup(t, answers) {
  const root = await mkdtemp(join(tmpdir(), 'axle-overpass-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(join(root, 'fake.mjs'), `
    import {writeFileSync} from 'node:fs';
    const answers=${JSON.stringify(answers)},queries=[];
    globalThis.fetch=async(url,init)=>{queries.push(init.body.get('data'));writeFileSync('queries.json',JSON.stringify(queries));return new Response(answers[queries.length-1]);};`);
  const run = spawnSync(process.execPath, ['--import', './fake.mjs', builder], {cwd: root, encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  return {lookup: JSON.parse(await readFile(join(root, 'snapshot/axle-load.json'), 'utf8')), queries: JSON.parse(await readFile(join(root, 'queries.json'), 'utf8'))};
}

test('the same lookup as the Overpass build makes from the same ways', async t => {
  const {lookup: overpass, queries} = await overpassLookup(t, overpassAnswers(ELEMENTS));
  assert.equal(queries.length, 5);
  for (const query of queries) assert.ok(query.includes(`${AXLE_RAIL_FILTER}->.tracks`), query);
  const dir = await mkdtemp(join(tmpdir(), 'extract-axle-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const manifest = await buildExtractAxleLoad('x', report({missingRegions: ['gap/0_0_45_45']}), INDEX, join(dir, 'a'), {read: fakeRead()});
  const extract = JSON.parse(await readFile(join(dir, 'a', 'axle-load.json'), 'utf8'));
  const {updated, source, ...same} = extract;
  assert.deepEqual(same, (({updated, source, ...rest}) => rest)(overpass));
  assert.deepEqual([updated, source], ['2026-11-03T21:24:23Z', 'OpenStreetMap via the Geofabrik extracts; ODbL']);
  assert.deepEqual(Object.keys(extract), Object.keys(overpass), 'the same fields, in the same order');
  const decoded = decodeLoadingGauges(extract);
  assert.deepEqual(JSON.parse(decoded.get(2)), {axle_load: '22.5', track_class: 'C2', axle_system: 'fi'});
  assert.deepEqual(JSON.parse(decoded.get(4)), {axle_load: '16', axle_system: 'en'});
  assert.deepEqual(JSON.parse(decoded.get(10)), {axle_system: 'en'});
  assert.deepEqual(JSON.parse(decoded.get(13)), {axle_system: 'en'});
  assert.deepEqual([manifest.complete, manifest.ways, manifest.finnishWays], [false, 7, 2]);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'a', 'manifest.json'), 'utf8')), manifest);
  const marker = await readFile(join(dir, 'a', 'source.json'), 'utf8');
  assert.deepEqual(JSON.parse(marker), {schema: 1, dataset: 'axle-load', source: 'extract', complete: false, osmTimestamp: '2026-11-03T21:24:23Z'});
  assert.match(checkMarker(marker, 'axle-load'), /not complete/, 'the site keeps the Overpass branch');
});

test('axleLookup: one value per way, the Finnish set counted whole', () => {
  const lookup = axleLookup([[5, '22.5', '', 'D4'], [3, '', '20', '']], new Set([5]), {updated: 'u', source: 's'});
  assert.deepEqual(Object.keys(lookup), ['values', 'ids', 'updated', 'ways', 'finnishWays', 'source']);
  assert.deepEqual([...decodeLoadingGauges(lookup)].sort(), [[3, '{"maxaxleload":"20","axle_system":"en"}'], [5, '{"axle_load":"22.5","track_class":"D4","axle_system":"fi"}']]);
  assert.deepEqual([lookup.ways, lookup.finnishWays], [2, 1]);
});

test('from a world assembly: complete; too few ways or no finland polygon are refused; older tiles leave it incomplete', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-axle-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const many = Array.from({length: MINIMUM}, (_, i) => way(1000 + i, [[8, 50], [8.001, 50]], {railway: 'rail', axle_load: '22.5'}));
  const manifest = await buildExtractAxleLoad('x', report(), INDEX, join(dir, 'ok'), {read: fakeRead(many)});
  assert.deepEqual([manifest.ways, manifest.complete], [MINIMUM, true]);
  assert.equal(checkMarker(await readFile(join(dir, 'ok', 'source.json'), 'utf8'), 'axle-load'), null);

  await assert.rejects(buildExtractAxleLoad('x', report(), INDEX, join(dir, 'few'), {read: fakeRead(many.slice(1))}), new RegExp(`small worldwide axle-load extract: ${MINIMUM - 1}`));
  await assert.rejects(readdir(join(dir, 'few')), /ENOENT/, 'nothing written');
  await assert.rejects(buildExtractAxleLoad('x', report(), {polygons: {}}, join(dir, 'nofi'), {read: () => assert.fail('nothing read')}), /no finland polygon/);
  await assert.rejects(buildExtractAxleLoad('x', {...report(), schema: 2}, INDEX, join(dir, 'bad'), {read: () => assert.fail('nothing read')}), /Not an assembly report/);
  await assert.rejects(buildExtractAxleLoad('x', report({missingNodeRefs: 3}), INDEX, join(dir, 'bad'), {read: () => assert.fail('nothing read')}), /missing 3 way nodes/);
  const older = await buildExtractAxleLoad('x', report({olderFilter: ['gap/0_0_45_45']}), INDEX, join(dir, 'older'), {read: fakeRead(many)});
  assert.equal(older.complete, false);

  await writeFile(join(dir, 'ok', 'stale.json'), 'old');
  await buildExtractAxleLoad('x', report(), INDEX, join(dir, 'ok'), {read: fakeRead(many)});
  assert.deepEqual((await readdir(join(dir, 'ok'))).sort(), ['axle-load.json', 'manifest.json', 'source.json']);
});

test('the assembly workflow builds it after heritage, from the index it assembled, and publishes it only to its own branch, only on main', async () => {
  const workflow = await readFile(new URL('../.github/workflows/osm-assemble.yml', import.meta.url), 'utf8');
  const build = workflow.indexOf('scripts/build-extract-axle-load.mjs assembled.osm.pbf assembled.osm.pbf.json index.json axle-load-extract');
  assert.ok(build > workflow.indexOf('- name: Publish heritage-extract-data'));
  assert.ok(workflow.indexOf('node scripts/extract-release.mjs load index.json') < build);
  assert.match(workflow, /- name: Publish axle-load-extract-data\n\s+if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /git push --force origin HEAD:axle-load-extract-data/);
  assert.doesNotMatch(workflow, /HEAD:axle-data\b/, 'the Overpass branch is never written');
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium, from a real extract file: the same rows', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-axle-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const x = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tags = t => Object.entries(t || {}).map(([k, v]) => `<tag k="${x(k)}" v="${x(v)}"/>`).join('');
  const at = `version="${meta.version}" timestamp="${meta.timestamp}"`;
  const ways = ELEMENTS.filter(e => e.type === 'way');
  await writeFile(join(dir, 'in.osm'), '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">'
    + ways.flatMap(w => w.nodes.map((id, i) => `<node id="${id}" ${at} lat="${w.geometry[i].lat}" lon="${w.geometry[i].lon}"/>`)).join('')
    + `<node id="11" ${at} lat="61" lon="21">${tags(ELEMENTS.find(e => e.id === 11).tags)}</node>`
    + ways.map(w => `<way id="${w.id}" ${at}>${w.nodes.map(n => `<nd ref="${n}"/>`).join('')}${tags(w.tags)}</way>`).join('')
    + `<relation id="12" ${at}>${tags(ELEMENTS.find(e => e.id === 12).tags)}</relation></osm>`);
  assert.equal(spawnSync('osmium', ['sort', join(dir, 'in.osm'), '-o', join(dir, 'in.osm.pbf')]).status, 0);
  const real = await extractAxleRows(join(dir, 'in.osm.pbf'), FINLAND);
  const fake = await extractAxleRows('x', FINLAND, {read: fakeRead()});
  assert.deepEqual([real.rows, [...real.finnish]], [fake.rows, [...fake.finnish]]);
});
