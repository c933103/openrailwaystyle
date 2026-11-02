import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONTINENTS, measureGaps, gapReport, normalize, areaKm2} from '../scripts/measure-osm-gaps.mjs';

// A synthetic region index: no provider is asked.
const box = (w, s, e, n) => ({type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]]});
const region = (id, geometry) => ({type: 'Feature', properties: {id}, geometry});
// Eight "continents" that tile the world except a 10° band at 0–10° N,
// with asia and europe overlapping by 5° of longitude, central-america
// inside africa, north-america covering part of one 10° cell of the band, and australia-oceania drawn across the antimeridian
// (170° to 190° E), which fills europe's western 10°.
function fixtureIndex(skip) {
  const geometries = {
    'africa': box(-180, -90, 0, 0), 'antarctica': box(0, -90, 170, 0),
    'south-america': box(170, -90, 180, 0), 'central-america': box(-180, -90, -170, -80),
    'europe': box(-170, 10, 5, 90), 'asia': box(0, 10, 170, 90),
    'australia-oceania': box(170, 10, 190, 90), 'north-america': box(100, 0, 110, 5),
  };
  return {features: CONTINENTS.filter(id => id !== skip).map(id => region(id, geometries[id]))};
}
const land = [
  {type: 'Feature', geometry: box(20, 2, 22, 4)},        // wholly in the gap
  {type: 'Feature', geometry: box(40, 8, 42, 12)},       // half in the gap
  {type: 'Feature', geometry: box(60, 20, 62, 22)},      // covered
  {type: 'Feature', geometry: {type: 'MultiPolygon', coordinates: [box(-100, 5, -99, 6).coordinates]}},
  {type: 'Feature', geometry: box(100, 3, 102, 7)},      // half covered by north-america, in a partly covered cell
  {type: 'Feature', geometry: box(-125, 2, -115, 4)},    // in the gap, across the -120° cell edge
];

test('the gap is the world minus the continents, folded across the antimeridian', () => {
  const result = measureGaps(fixtureIndex(), land);
  assert.equal(result.gaps.length, 1);
  assert.deepEqual(result.gaps[0].extent, [-180, 0, 180, 10]);
  const band = areaKm2([[[[-180, 0], [180, 0], [180, 10], [-180, 10], [-180, 0]]]]) - areaKm2([box(100, 0, 110, 5).coordinates]);
  assert.ok(Math.abs(result.gaps[0].areaKm2 - band) < 1, 'the band 0–10° N, less north-america, is the only gap');
  assert.ok(Math.abs(result.worldKm2 - result.coveredKm2 - band) < 1);
  assert.ok(Math.abs(result.worldKm2 - 4 * Math.PI * 6371.0088 ** 2) < 1, 'the world is the sphere');
});

test('land inside the gap is listed, land outside it is not, and a straddling island is cut', () => {
  const {land: pieces} = measureGaps(fixtureIndex(), land);
  assert.deepEqual(pieces.map(p => p.extent).sort((a, b) => a[0] - b[0]),
    [[-125, 2, -115, 4], [-100, 5, -99, 6], [20, 2, 22, 4], [40, 8, 42, 10], [100, 5, 102, 7]],
    'one piece across a cell edge; only the uncovered half of a partly covered island');
});

test('overlapping continents are reported with the shared area', () => {
  const {overlaps} = measureGaps(fixtureIndex(), []);
  assert.deepEqual(overlaps.map(o => [o.a, o.b, o.extent]), [
    ['asia', 'europe', [0, 10, 5, 90]],
    ['africa', 'central-america', [-180, -90, -170, -80]],
  ]);
});

test('a region past 180° is folded back into the world box', () => {
  const folded = normalize([[[[170, 10], [190, 10], [190, 20], [170, 20], [170, 10]]]]);
  assert.deepEqual(folded.map(p => p[0].map(([x]) => x)).map(xs => [Math.min(...xs), Math.max(...xs)]).sort((a, b) => a[0] - b[0]),
    [[-180, -170], [170, 180]]);
});

test('a missing continent fails the measurement instead of reporting it as a gap', () => {
  assert.throws(() => measureGaps(fixtureIndex('asia'), []), /no region asia/);
});

test('the report lists the totals, gaps, land and overlaps', () => {
  const report = gapReport(measureGaps(fixtureIndex(), land), {'Region index': 'fixture'});
  assert.match(report, /- Region index: fixture/);
  assert.match(report, /Gap polygons: 1; Natural Earth land in the gaps: 5 pieces/);
  assert.match(report, /\| 1 \| [\d,]+ \| -180, 0, 180, 10 \|/);
  assert.match(report, /\| asia \/ europe \| [\d,]+ \| 0, 10, 5, 90 \|/);
});

test('the measured continents are the ones the mainline reference downloads', () => {
  const python = readFileSync(new URL('../scripts/acquire-mainline-extract.py', import.meta.url), 'utf8');
  const listed = python.match(/REGIONS = \(([^)]*)\)/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(listed, CONTINENTS);
});

test('osm-gaps.yml is manual, read-only and publishes only its own measurement', () => {
  const workflow = readFileSync(new URL('../.github/workflows/osm-gaps.yml', import.meta.url), 'utf8');
  assert.match(workflow, /on:\n  workflow_dispatch:\n(?!.*schedule)/s);
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(workflow, /contents: write|git push|gh release/);
  assert.match(workflow, /node --import \.\/scripts\/overpass-meter\.mjs scripts\/measure-osm-gaps\.mjs osm-gaps/);
});
