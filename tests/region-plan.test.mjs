import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONTINENTS} from '../scripts/measure-osm-gaps.mjs';
import {planRegions, usableChildren, indexRegions, planReport, MAX_REGION_BYTES} from '../scripts/plan-osm-regions.mjs';

// A synthetic index; no provider is asked.
const box = (w, s, e, n) => ({type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]]});
const region = (id, geometry, parent) => ({type: 'Feature', properties: {id, ...(parent ? {parent} : {}), urls: {pbf: `https://example.test/${id}.osm.pbf`}}, geometry});
const GiB = 1024 ** 3;
// europe (too large) splits into three countries and an aggregate of two of
// them; country "c" leaves a 1° strip of europe uncovered; asia is too large
// and has no children; the other continents fit.
function fixture() {
  const features = [
    region('europe', box(0, 40, 30, 60)), region('asia', box(30, 0, 90, 60)),
    region('a', box(0, 40, 10, 60), 'europe'), region('b', box(10, 40, 20, 60), 'europe'), region('c', box(20, 40, 29, 60), 'europe'),
    region('ab-special', box(0, 40, 20, 60), 'europe'),
  ];
  for (const [i, id] of CONTINENTS.filter(id => !['europe', 'asia'].includes(id)).entries()) features.push(region(id, box(-180 + i * 10, -60, -171 + i * 10, -50)));
  const sizes = {europe: 30 * GiB, asia: 16 * GiB, a: 3 * GiB, b: 2 * GiB, c: 1 * GiB, 'ab-special': 5 * GiB};
  return {index: {features}, sizes};
}
const sizeOf = sizes => async region => sizes[region.id] ?? 100 * 1024 ** 2;

test('a region over the limit is split into its children; an aggregate of smaller siblings is not used', async () => {
  const {index, sizes} = fixture();
  const asked = [];
  const plan = await planRegions(index, async r => { asked.push(r.id); return sizeOf(sizes)(r); });
  const ids = plan.regions.map(r => r.id);
  assert.ok(ids.includes('a') && ids.includes('b') && ids.includes('c'));
  assert.ok(!ids.includes('europe') && !ids.includes('ab-special'));
  assert.ok(!asked.includes('ab-special'), 'the aggregate is not even asked for its size');
  assert.deepEqual(plan.splits.map(s => [s.id, s.children]), [['europe', ['c', 'a', 'b']]]);
});

test('a split that leaves part of its parent uncovered reports that gap, and the remainder includes it', async () => {
  const {index, sizes} = fixture();
  const plan = await planRegions(index, sizeOf(sizes));
  const split = plan.splits.find(s => s.id === 'europe');
  assert.deepEqual(split.gapExtent, [29, 40, 30, 60]);
  assert.ok(split.gapKm2 > 0);
  assert.ok(plan.remainder.some(r => r.extent[0] <= 29 && r.extent[2] >= 30 && r.extent[1] <= 40 && r.extent[3] >= 60));
  assert.ok(Math.abs(plan.worldKm2 - plan.coveredKm2 - plan.remainder.reduce((sum, r) => sum + r.areaKm2, 0)) < 1);
});

test('a region over the limit without children is kept and marked, never dropped', async () => {
  const {index, sizes} = fixture();
  const plan = await planRegions(index, sizeOf(sizes));
  assert.deepEqual(plan.regions.find(r => r.id === 'asia'), {id: 'asia', parent: null, url: 'https://example.test/asia.osm.pbf', bytes: 16 * GiB, oversized: true, depth: 0});
  assert.match(planReport(plan), /over the limit: asia/);
});

test('every region in the plan fits the limit unless marked, and the plan is deterministic', async () => {
  const {index, sizes} = fixture();
  const first = await planRegions(index, sizeOf(sizes)), second = await planRegions(index, sizeOf(sizes));
  assert.deepEqual(first, second);
  for (const r of first.regions) assert.ok(r.oversized || r.bytes <= MAX_REGION_BYTES, r.id);
  assert.deepEqual(first.regions.map(r => r.id), [...first.regions.map(r => r.id)].sort());
});

test('a missing continent or a missing size stops the plan', async () => {
  const {index, sizes} = fixture();
  await assert.rejects(planRegions({features: index.features.filter(f => f.properties.id !== 'africa')}, sizeOf(sizes)), /no region africa/);
  await assert.rejects(planRegions(index, async r => r.id === 'b' ? NaN : sizeOf(sizes)(r)), /No size for b/);
});

test('siblings that only overlap at buffered borders are all kept', () => {
  const regions = indexRegions({features: [region('p', box(0, 0, 20, 10)), region('x', box(0, 0, 10.5, 10), 'p'), region('y', box(9.5, 0, 20, 10), 'p'), region('tiny', box(10, 4, 10.4, 6), 'p')]});
  assert.deepEqual(usableChildren(regions, 'p').map(r => r.id).sort(), ['tiny', 'x', 'y']);
});

test('osm-gaps.yml also runs the planner, read-only', () => {
  const workflow = readFileSync(new URL('../.github/workflows/osm-gaps.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node --import \.\/scripts\/overpass-meter\.mjs scripts\/plan-osm-regions\.mjs osm-gaps/);
  assert.match(workflow, /permissions:\n  contents: read\n/);
});

test('two siblings with the same polygon are both kept rather than both dropped', () => {
  const regions = indexRegions({features: [region('p', box(0, 0, 20, 10)), region('same-1', box(0, 0, 10, 10), 'p'), region('same-2', box(0, 0, 10, 10), 'p')]});
  assert.deepEqual(usableChildren(regions, 'p').map(r => r.id), ['same-1', 'same-2']);
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
  const {index, sizes} = fixture();
  const plan = await planRegions(index, sizeOf(sizes), {urlOf: r => `https://example.test/${r.id}-dated.osm.pbf`});
  assert.equal(plan.regions.find(r => r.id === 'a').url, 'https://example.test/a-dated.osm.pbf');
});

test('osm-gaps.yml passes an optional source date to the planner through the environment', () => {
  const workflow = readFileSync(new URL('../.github/workflows/osm-gaps.yml', import.meta.url), 'utf8');
  assert.match(workflow, /source_date:/);
  assert.match(workflow, /SOURCE_DATE: \$\{\{ inputs\.source_date \}\}/);
  assert.match(workflow, /plan-osm-regions\.mjs osm-gaps "\$SOURCE_DATE"/);
});
