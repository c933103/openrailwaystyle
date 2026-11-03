import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONTINENTS} from '../scripts/measure-osm-gaps.mjs';
import {planRegions, usableChildren, indexRegions, planReport, MAX_REGION_BYTES, MIN_FILL_CELLS} from '../scripts/plan-osm-regions.mjs';
import {landRaster, landCells, cellsKm2} from '../scripts/land-raster.mjs';

// A synthetic index and synthetic land; no provider is asked.
const box = (w, s, e, n) => ({type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]]});
const region = (id, geometry, parent) => ({type: 'Feature', properties: {id, ...(parent ? {parent} : {}), urls: {pbf: `https://example.test/${id}.osm.pbf`}}, geometry});
const polygonOf = geometry => [geometry.coordinates];
const landOf = (...boxes) => landRaster(boxes.map(geometry => ({type: 'Feature', geometry})));
const GiB = 1024 ** 3;
const others = () => CONTINENTS.filter(id => !['europe', 'asia'].includes(id)).map((id, i) => region(id, box(-180 + i * 10, -60, -171 + i * 10, -50)));
const otherLand = (skip = []) => CONTINENTS.filter(id => !['europe', 'asia'].includes(id)).map((id, i) => skip.includes(id) ? null : box(-180 + i * 10, -60, -171 + i * 10, -50)).filter(Boolean);
// europe (too large) splits into three countries and an aggregate of two of
// them; country "c" leaves a 1° strip of europe's land uncovered; asia is too
// large and has no children; the other continents fit.
function fixture() {
  const features = [
    region('europe', box(0, 40, 30, 60)), region('asia', box(30, 0, 90, 60)),
    region('a', box(0, 40, 10, 60), 'europe'), region('b', box(10, 40, 20, 60), 'europe'), region('c', box(20, 40, 29, 60), 'europe'),
    region('ab-special', box(0, 40, 20, 60), 'europe'), ...others(),
  ];
  const sizes = {europe: 30 * GiB, asia: 16 * GiB, a: 3 * GiB, b: 2 * GiB, c: 1 * GiB, 'ab-special': 5 * GiB};
  return {index: {features}, sizes, land: landOf(box(0, 40, 30, 60), box(30, 0, 90, 60), ...otherLand())};
}
const sizeOf = sizes => async region => sizes[region.id] ?? 100 * 1024 ** 2;

test('a region over the limit is split into its children; an aggregate of its siblings is not used, nor asked', async () => {
  const {index, sizes, land} = fixture();
  const asked = [];
  const plan = await planRegions(index, async r => { asked.push(r.id); return sizeOf(sizes)(r); }, {land});
  const ids = plan.regions.map(r => r.id);
  assert.ok(ids.includes('a') && ids.includes('b') && ids.includes('c'));
  assert.ok(!ids.includes('europe') && !ids.includes('ab-special'));
  assert.ok(!asked.includes('ab-special'), 'the aggregate is not even asked for its size');
  assert.deepEqual(plan.splits.map(s => [s.id, s.children]), [['europe', ['c', 'a', 'b']]]);
});

test('land a split leaves uncovered is reported, in the split and in the remainder, and makes the plan invalid', async () => {
  const {index, sizes, land} = fixture();
  const plan = await planRegions(index, sizeOf(sizes), {land});
  const split = plan.splits.find(s => s.id === 'europe');
  assert.deepEqual(split.gapExtent, [29, 40, 30, 60]);
  assert.ok(split.gapKm2 > 0 && Math.abs(split.gapLandKm2 - split.gapKm2) < split.gapKm2 * 0.02, 'the strip is all land');
  assert.ok(plan.remainder.some(r => r.extent[0] <= 29 && r.extent[2] >= 30 && r.extent[1] <= 40 && r.extent[3] >= 60));
  assert.ok(Math.abs(plan.worldKm2 - plan.coveredKm2 - plan.remainder.reduce((sum, r) => sum + r.areaKm2, 0)) < 1);
  assert.ok(Math.abs(plan.remainderLand.km2 - split.gapLandKm2) < 1);
  assert.deepEqual(plan.remainderLand.tiles.map(t => t.extent), [[20, 40, 30, 50], [20, 50, 30, 60]]);
  assert.equal(plan.valid, false);
  assert.ok(plan.problems.some(p => /^remainder land \d+ km² is over 50000 km²$/.test(p)));
  assert.match(planReport(plan), /^\*\*Not usable:\*\* .*remainder land/m);
  const relaxed = await planRegions(index, sizeOf(sizes), {land, maxRemainderLandKm2: Infinity});
  assert.ok(!relaxed.problems.some(p => /remainder land/.test(p)));
});

test('a region over the limit without children is kept and marked, never dropped, and the plan is invalid', async () => {
  const {index, sizes, land} = fixture();
  const plan = await planRegions(index, sizeOf(sizes), {land});
  const asia = plan.regions.find(r => r.id === 'asia');
  assert.deepEqual({...asia, landKm2: undefined}, {id: 'asia', parent: null, url: 'https://example.test/asia.osm.pbf', bytes: 16 * GiB, oversized: true, depth: 0, via: 'descent', landKm2: undefined});
  assert.ok(asia.landKm2 > 0);
  assert.ok(plan.problems.includes('asia is over the limit and cannot be split'));
  assert.match(planReport(plan), /over the limit: asia/);
});

test('every region in the plan fits the limit unless marked, and the plan is deterministic', async () => {
  const {index, sizes, land} = fixture();
  const first = await planRegions(index, sizeOf(sizes), {land}), second = await planRegions(index, sizeOf(sizes), {land});
  assert.deepEqual(first, second);
  for (const r of first.regions) assert.ok(r.oversized || r.bytes <= MAX_REGION_BYTES, r.id);
  assert.deepEqual(first.regions.map(r => r.id), [...first.regions.map(r => r.id)].sort());
});

test('a missing continent, a missing size or a missing land raster stops the plan', async () => {
  const {index, sizes, land} = fixture();
  await assert.rejects(planRegions({features: index.features.filter(f => f.properties.id !== 'africa')}, sizeOf(sizes), {land}), /no region africa/);
  await assert.rejects(planRegions(index, async r => r.id === 'b' ? NaN : sizeOf(sizes)(r), {land}), /No size for b/);
  await assert.rejects(planRegions(index, sizeOf(sizes)), /needs a land raster/);
});

test('siblings that only overlap at buffered borders are all kept', () => {
  const land = landOf(box(0, 0, 20, 10));
  const regions = indexRegions({features: [region('p', box(0, 0, 20, 10)), region('x', box(0, 0, 10.5, 10), 'p'), region('y', box(9.5, 0, 20, 10), 'p'), region('tiny', box(10, 4, 10.4, 6), 'p')]});
  assert.deepEqual(usableChildren(regions, 'p', land).map(r => r.id).sort(), ['x', 'y']);
  // "tiny" lies wholly inside x and y; a sliver with no land cell is kept.
  const sliver = indexRegions({features: [region('p', box(0, 0, 20, 10)), region('x', box(0, 0, 20, 10), 'p'), region('sea', box(30, 0, 31, 1), 'p')]});
  assert.deepEqual(usableChildren(sliver, 'p', land).map(r => r.id).sort(), ['sea', 'x']);
});

test('osm-gaps.yml also runs the planner, read-only, and keeps its report when the plan is not usable', () => {
  const workflow = readFileSync(new URL('../.github/workflows/osm-gaps.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node --import \.\/scripts\/overpass-meter\.mjs scripts\/plan-osm-regions\.mjs osm-gaps/);
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.match(workflow, /- uses: actions\/upload-artifact@v4\n        if: always\(\)/);
});

test('of two siblings with the same polygon exactly one is kept', () => {
  const land = landOf(box(0, 0, 20, 10));
  const regions = indexRegions({features: [region('p', box(0, 0, 20, 10)), region('same-1', box(0, 0, 10, 10), 'p'), region('same-2', box(0, 0, 10, 10), 'p')]});
  assert.deepEqual(usableChildren(regions, 'p', land).map(r => r.id), ['same-2']);
});

test('an aggregate with a wide sea buffer is recognised by its land, which its siblings cover', () => {
  // Land is 0–20° E; the group's polygon reaches far out to sea, so its area
  // is mostly not covered by the two countries.
  const land = landOf(box(0, 0, 20, 10));
  const regions = indexRegions({features: [region('p', box(-40, -30, 20, 10)),
    region('one', box(0, 0, 10, 10), 'p'), region('two', box(10, 0, 20, 10), 'p'), region('group', box(-40, -30, 20, 10), 'p')]});
  assert.ok(regions.get('group').areaKm2 * 0.5 > regions.get('one').areaKm2 + regions.get('two').areaKm2, 'by area the group is far from covered');
  assert.deepEqual(usableChildren(regions, 'p', land).map(r => r.id).sort(), ['one', 'two']);
});

test('the largest aggregate and its sub-groups drop, the states stay, and a group reaching beyond them stays', async () => {
  // As Geofabrik lists them: us, us-west and us-east beside the states, all
  // under north-america; "gulf" also covers land no state covers.
  const land = landOf(box(-125, 25, -65, 50), box(-60, 10, -55, 15), ...otherLand(['north-america']), box(0, 40, 30, 60), box(30, 0, 90, 60));
  const features = [
    region('north-america', box(-170, 5, -50, 75)), region('europe', box(0, 40, 30, 60)), region('asia', box(30, 0, 90, 60)),
    ...others().filter(f => f.properties.id !== 'north-america'),
    region('us', box(-170, 5, -60, 60), 'north-america'), region('us-west', box(-130, 20, -95, 55), 'north-america'), region('us-east', box(-95, 20, -60, 55), 'north-america'),
    region('us/w1', box(-125, 25, -110, 50), 'north-america'), region('us/w2', box(-110, 25, -95, 50), 'north-america'),
    region('us/e1', box(-95, 25, -80, 50), 'north-america'), region('us/e2', box(-80, 25, -65, 50), 'north-america'),
    region('gulf', box(-80, 10, -55, 30), 'north-america'),
  ];
  const sizes = {'north-america': 18 * GiB, us: 11 * GiB, 'us-west': 3 * GiB, 'us-east': 4 * GiB};
  const plan = await planRegions({features}, sizeOf(sizes), {land});
  assert.deepEqual(plan.splits.find(s => s.id === 'north-america').children.sort(), ['gulf', 'us/e1', 'us/e2', 'us/w1', 'us/w2']);
  assert.equal(plan.regions.filter(r => r.oversized).length, 0);
  assert.equal(plan.remainderLand.km2, 0);
  assert.ok(plan.valid, plan.problems.join('; '));
});

test('land a split loses is filled from a region outside the parent, descended when over the limit', async () => {
  // "ru" is listed under no continent, as Geofabrik lists russia. It is over
  // the limit and splits into ru-w and ru-e; ru-e lies mostly inside asia.
  const land = landOf(box(0, 40, 30, 60), box(30, 0, 90, 60), ...otherLand());
  const features = [
    region('europe', box(0, 40, 30, 60)), region('asia', box(30, 0, 90, 60)), ...others(),
    region('a', box(0, 40, 15, 60), 'europe'), region('b', box(15, 40, 25, 60), 'europe'),
    region('ru', box(25, 40, 60, 60)), region('ru-w', box(25, 40, 40, 60), 'ru'), region('ru-e', box(40, 40, 60, 60), 'ru'),
  ];
  const sizes = {europe: 30 * GiB, ru: 9 * GiB};
  const asked = [];
  const plan = await planRegions({features}, async r => { asked.push(r.id); return sizeOf(sizes)(r); }, {land});
  assert.deepEqual(plan.fills.map(f => f.id), ['ru']);
  assert.ok(plan.fills[0].landKm2 > 0);
  assert.deepEqual(plan.regions.filter(r => r.via === 'gap-fill').map(r => r.id), ['ru-e', 'ru-w']);
  assert.ok(plan.splits.some(s => s.id === 'ru'));
  assert.equal(plan.remainderLand.km2, 0);
  assert.ok(plan.valid, plan.problems.join('; '));
  // ru-e duplicates asia's land: reported, not an error.
  assert.deepEqual(plan.overlaps.map(o => o.id).sort(), ['asia', 'ru-e', 'ru-w']);
  assert.match(planReport(plan), /Gap fills: ru \(/);
  assert.ok(!asked.includes('a-group'));
});

test('a candidate adding under the minimum land, or mostly covered already, is not used', async () => {
  // "islet" adds too little land; "big-dup" would add a 1.5° patch, but its
  // own land is otherwise all europe's and asia's.
  const land = landOf(box(0, 40, 30, 60), box(30, 0, 90, 60), ...otherLand(), box(100, -10, 100.5, -9.5), box(-10, -20, -8.5, -18.5));
  const features = [
    region('europe', box(0, 40, 30, 60)), region('asia', box(30, 0, 90, 60)), ...others(),
    region('islet', box(100, -10, 100.5, -9.5)), region('big-dup', box(-10, -20, 90, 60)),
  ];
  const plan = await planRegions({features}, sizeOf({}), {land});
  const regions = indexRegions({features});
  assert.ok(MIN_FILL_CELLS > landCells(regions.get('islet').polygon, land).length);
  assert.ok(MIN_FILL_CELLS <= landCells(polygonOf(box(-10, -20, -8.5, -18.5)), land).length, 'the patch alone would qualify');
  assert.deepEqual(plan.fills, []);
  assert.ok(plan.remainderLand.km2 > 20000 && plan.remainderLand.km2 < 35000, String(plan.remainderLand.km2));
  assert.ok(plan.valid, plan.problems.join('; '));
});

test('the land raster: cell areas, holes and a region across the antimeridian', () => {
  const land = landOf(box(-180, -90, 180, 90));
  const square = landCells([[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]], land);
  assert.equal(square.length, 100);
  assert.ok(Math.abs(cellsKm2(square) - 12364) < 15, 'about 1° by 1° at the equator');
  const holed = landCells([[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]]]], land);
  assert.equal(holed.length, 400 - 100);
  const wrapped = indexRegions({features: [region('fiji', box(177, -19, 182, -16))]}).get('fiji');
  assert.equal(landCells(wrapped.polygon, land).length, 50 * 30);
});

import {headSize, datedUrl, defaultSourceDate} from '../scripts/plan-osm-regions.mjs';
// A fake server: a map of URL to [status, headers].
const fakeFetch = (routes, asked = []) => async (url, init) => {
  asked.push([url, init.method, init.redirect]);
  const [status, headers] = routes[url] ?? [404, {}];
  return new Response(null, {status, headers});
};

test('the plan asks the dated file directly, with one HEAD request', async () => {
  const asked = [];
  const url = 'https://download.geofabrik.de/europe/a-261101.osm.pbf';
  const bytes = await headSize(url, {fetcher: fakeFetch({[url]: [200, {'content-length': '12345'}]}, asked)});
  assert.equal(bytes, 12345);
  assert.deepEqual(asked, [[url, 'HEAD', 'manual']]);
});

test('any redirect, another host, plain HTTP, an error status or a missing size stops the plan', async () => {
  const start = 'https://download.geofabrik.de/europe-261101.osm.pbf';
  // Geofabrik sends the largest -latest files to outside mirrors.
  const mirror = [];
  await assert.rejects(headSize(start, {fetcher: fakeFetch({[start]: [302, {location: 'https://ftp5.gwdg.de/pub/misc/openstreetmap/download.geofabrik.de/europe-latest.osm.pbf'}]}, mirror)}),
    /unexpected redirect \(HTTP 302\) to https:\/\/ftp5\.gwdg\.de/);
  assert.equal(mirror.length, 1, 'the redirect is not followed');
  await assert.rejects(headSize(start, {fetcher: fakeFetch({[start]: [301, {location: '/europe-261101.osm.pbf'}]})}), /unexpected redirect \(HTTP 301\)/);
  await assert.rejects(headSize(start, {fetcher: fakeFetch({[start]: [302, {}]})}), /to no location/);
  await assert.rejects(headSize(start, {fetcher: fakeFetch({[start]: [200, {}]})}), /no Content-Length/);
  await assert.rejects(headSize(start, {fetcher: fakeFetch({})}), /HTTP 404/);
  const none = [];
  await assert.rejects(headSize('https://evil.example/x.osm.pbf', {fetcher: fakeFetch({}, none)}), /Refusing/);
  await assert.rejects(headSize('http://download.geofabrik.de/x.osm.pbf', {fetcher: fakeFetch({}, none)}), /Refusing http:/);
  assert.equal(none.length, 0, 'a refused URL is never asked');
});

test('a -latest URL becomes the dated file; a bad, future or foreign input stops the plan', () => {
  const now = new Date('2026-11-03T01:00:00Z');
  assert.equal(datedUrl('https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf', '2026-11-01', {now}),
    'https://download.geofabrik.de/europe/germany/bayern-261101.osm.pbf');
  assert.equal(defaultSourceDate(now), '2026-11-01', 'two days ago, as mainline-reference.yml');
  assert.equal(defaultSourceDate(new Date('2026-03-01T23:59:00Z')), '2026-02-27');
  for (const bad of ['2026-02-30', '26-11-01', '2026-11-1', '']) assert.throws(() => datedUrl('https://download.geofabrik.de/a-latest.osm.pbf', bad, {now}), /Invalid source date/);
  assert.throws(() => datedUrl('https://download.geofabrik.de/a-latest.osm.pbf', '2026-11-04', {now}), /Future source date/);
  assert.throws(() => datedUrl('https://mirror.example/a-latest.osm.pbf', '2026-11-01', {now}), /Not a Geofabrik -latest PBF/);
  assert.throws(() => datedUrl('https://download.geofabrik.de/a-261101.osm.pbf', '2026-11-01', {now}), /Not a Geofabrik -latest PBF/);
});

test('the plan records the URL it was sized from', async () => {
  const {index, sizes, land} = fixture();
  const plan = await planRegions(index, sizeOf(sizes), {land, urlOf: r => `https://example.test/${r.id}-dated.osm.pbf`});
  assert.equal(plan.regions.find(r => r.id === 'a').url, 'https://example.test/a-dated.osm.pbf');
});

test('osm-gaps.yml passes an optional source date to the planner through the environment', () => {
  const workflow = readFileSync(new URL('../.github/workflows/osm-gaps.yml', import.meta.url), 'utf8');
  assert.match(workflow, /source_date:/);
  assert.match(workflow, /SOURCE_DATE: \$\{\{ inputs\.source_date \}\}/);
  assert.match(workflow, /plan-osm-regions\.mjs osm-gaps "\$SOURCE_DATE"/);
});
