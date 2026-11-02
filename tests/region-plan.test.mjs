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
