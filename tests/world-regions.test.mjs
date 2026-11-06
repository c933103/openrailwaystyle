import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WORLD_QUADRANTS, quarters, worldRegions, regionDepth, tilesWorld, validRegion} from '../scripts/world-regions.mjs';
import {startRegions, quarters as crossingQuarters} from '../scripts/crossing-data.mjs';
import {quarters as branchQuarters} from '../scripts/branch-lines.mjs';
import {STAGED_REGIONS} from '../scripts/staged-overpass.mjs';
import {heritageRegions, heritageDepth} from '../scripts/heritage-data.mjs';
import {stationBaseRegions, stationWorldCoverage} from '../scripts/station-acquisition.mjs';

test('the world tree: eight quadrants, quartered south-west, south-east, north-west, north-east', () => {
  assert.equal(WORLD_QUADRANTS.length, 8);
  assert.ok(tilesWorld(WORLD_QUADRANTS.map(box => [...box])));
  assert.deepEqual(quarters([0, 0, 90, 90]), [[0, 0, 45, 45], [0, 45, 45, 90], [45, 0, 90, 45], [45, 45, 90, 90]]);
  for (const size of [90, 45, 22.5]) {
    const regions = worldRegions(size);
    assert.equal(regions.length, 8 * (90 / size) ** 2);
    assert.ok(tilesWorld(regions), `${size}°`);
    assert.ok(regions.every(([s, w, n, e]) => n - s === size && e - w === size));
  }
  assert.deepEqual(worldRegions(), WORLD_QUADRANTS.map(box => [...box]));
  assert.throws(() => worldRegions(60), /Invalid region size 60/);
  assert.throws(() => worldRegions(180), /Invalid region size 180/);
});

test('a dataset can start coarser in one quadrant and finer in another, and still tiles the world', () => {
  const mixed = worldRegions(([south, west]) => south < 0 ? 90 : west >= 90 ? 22.5 : 45);
  assert.ok(tilesWorld(mixed));
  assert.equal(mixed.length, 4 + 3 * 4 + 16);
  // Sorted south to north, then west to east.
  for (let i = 1; i < mixed.length; i++) assert.ok(mixed[i - 1][0] < mixed[i][0] || mixed[i - 1][0] === mixed[i][0] && mixed[i - 1][1] < mixed[i][1]);
});

test('every quadrant-based dataset starts from the shared tree, unchanged', () => {
  assert.deepEqual(startRegions().map(region => region.box), worldRegions(45), 'crossings and signals');
  assert.deepEqual(stationBaseRegions(), worldRegions(45), 'stations');
  assert.deepEqual(heritageRegions(), worldRegions(45), 'historic areas');
  assert.deepEqual(STAGED_REGIONS.map(box => [...box]), worldRegions(90), 'power methods and electricity signals');
  assert.equal(STAGED_REGIONS, WORLD_QUADRANTS);
  assert.equal(crossingQuarters, quarters);
  assert.equal(branchQuarters, quarters);
  // The lifecycle snapshot: whole quadrants south, 45° quarters north, as before.
  const snapshot = readFileSync(new URL('../scripts/build-snapshot.mjs', import.meta.url), 'utf8');
  assert.match(snapshot, /const boxes = worldRegions\(\(\[south\]\) => south < 0 \? 90 : 45\);/);
  assert.deepEqual(worldRegions(([south]) => south < 0 ? 90 : 45), [
    ...[-180, -90, 0, 90].map(w => [-90, w, 0, w + 90]),
    ...[0, 45].flatMap(s => [-180, -135, -90, -45, 0, 45, 90, 135].map(w => [s, w, s + 45, w + 45]))]);
  const facilities = readFileSync(new URL('../scripts/build-power-facilities.mjs', import.meta.url), 'utf8');
  assert.match(facilities, /const regions=worldRegions\(90\);/);
  // No dataset builds its own grid or quarters any more.
  for (const file of ['build-snapshot.mjs', 'build-power-facilities.mjs', 'build-heritage.mjs', 'crossing-data.mjs', 'heritage-data.mjs', 'station-acquisition.mjs', 'staged-overpass.mjs', 'branch-lines.mjs'])
    assert.doesNotMatch(readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8'), /lat ?= ?\(s ?\+ ?n\) ?\/ ?2|[sw] ?\+= ?(45|90)\b/, file);
});

test('coverage and depth checks are shared', () => {
  const split = [...worldRegions(45).slice(1), ...quarters([-90, -180, -45, -135])];
  assert.ok(tilesWorld(split));
  assert.ok(stationWorldCoverage(split.map(box => ({box}))));
  assert.deepEqual(heritageRegions(split.map(bbox => ({bbox}))), split, 'a recorded split tiling is kept');
  assert.deepEqual(heritageRegions(split.slice(1).map(bbox => ({bbox}))), worldRegions(45), 'a gap: the grid instead');
  assert.equal(tilesWorld([...split, [-90, -180, -45, -135]]), false, 'an overlap');
  assert.equal(tilesWorld([]), false);
  assert.equal(validRegion([0, 0, 0, 1]), false);
  assert.equal(regionDepth([0, 0, 11.25, 11.25]), 2);
  assert.equal(regionDepth([0, 0, 90, 90], 90), 0);
  assert.equal(heritageDepth([0, 0, 22.5, 22.5]), 1);
});
