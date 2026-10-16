import test from 'node:test';
import assert from 'node:assert/strict';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {addResult, buildTiles, commitStage, joinLines, LAYER, readTable, toTable, writeTable} from '../scripts/service-routes.mjs';
import {serviceProvenanceFixture} from '../scripts/service-provenance-fixture.mjs';

function* permutations(values) {
  if (!values.length) { yield []; return; }
  for (let i = 0; i < values.length; i++) {
    for (const rest of permutations(values.filter((_, j) => i !== j))) yield [values[i], ...rest];
  }
}
const edges = lines => lines.flatMap(line => line.slice(1).map((point, i) => JSON.stringify([line[i], point]))).sort();
const freezeLines = lines => Object.freeze(lines.map(line => Object.freeze(line.map(point => Object.freeze(point)))));

test('service geometry order: every branch permutation keeps the same long label path', () => {
  const a = [0, 0], b = [1, 0], c = [2, 1], d = [2, -1];
  const lines = freezeLines([[a, b], [b, c], [b, d]]);
  const expected = [[a, b, d], [b, c]];
  for (const input of permutations(lines)) {
    assert.deepEqual(joinLines(input), expected, 'the branch is chosen by coordinates, never arrival order');
    assert.deepEqual(edges(joinLines(input)), edges(lines));
  }
});

test('service geometry order: full coordinate sequences break equal-endpoint and prefix ties', () => {
  const a = [0, 0], b = [1, 0], c = [2, 0], low = [1.5, -1], high = [1.5, 1];
  const lines = freezeLines([[a, b], [b, high, c], [b, low, c], [b, low]]);
  const expected = [[a, b, low], [b, low, c], [b, high, c]];
  for (const input of permutations(lines)) assert.deepEqual(joinLines(input), expected);
});

const graphs = {
  'multiple roots and disconnected chains': [
    [[-2, 0], [0, 0]], [[-1, 1], [0, 0]], [[0, 0], [2, 0]],
    [[2, 0], [3, 1]], [[2, 0], [3, -1]], [[10, 0], [11, 0]],
  ],
  'cycle with an exit': [
    [[0, 0], [1, 0]], [[1, 0], [0, 1]], [[0, 1], [0, 0]], [[1, 0], [2, 0]],
  ],
  'duplicates, reverse edges and repeated vertices': [
    [[0, 0], [1, 0]], [[0, 0], [1, 0]], [[1, 0], [0, 0]],
    [[1, 0], [1, 0], [2, 0]], [[3, 0], [2, 0]],
  ],
};
for (const [name, values] of Object.entries(graphs)) {
  test(`service geometry order: ${name} preserve all directed edges under permutation`, () => {
    const lines = freezeLines(values), expected = joinLines(lines), sourceEdges = edges(lines);
    for (const input of permutations(lines)) {
      const actual = joinLines(input);
      assert.deepEqual(actual, expected);
      assert.deepEqual(edges(actual), sourceEdges, 'no reversal, dropped duplicate, added chord or missing edge');
    }
    assert.deepEqual(lines, values, 'source coordinates and ordering stay untouched');
  });
}

test('service geometry order: cycles start canonically without reversing their direction', () => {
  const a = [0, 0], b = [1, 0], c = [0, 1];
  for (const input of permutations([[a, b], [b, c], [c, a]])) {
    assert.deepEqual(joinLines(input), [[a, b, c, a]]);
  }
  assert.deepEqual(joinLines([]), []);
  assert.deepEqual(joinLines([[[2, 0], [1, 0]]]), [[[2, 0], [1, 0]]]);
});

function branchTable() {
  const lines = [[[.011, .041], [.031, .041]], [[.031, .041], [.061, .061]], [[.031, .041], [.061, .021]]];
  const relation = (id, ref) => ({type: 'relation', id,
    tags: {type: 'route', route: 'subway', name: `Fixture ${ref}`, ref, network: 'Fixture Metro', colour: '#126a94'},
    members: lines.map((_, i) => ({type: 'way', ref: i + 1, role: ''}))});
  const table = {routes: new Map(), ways: new Map()};
  addResult(table, toTable({elements: [relation(10, 'A'), relation(20, 'A'), relation(30, 'B'),
    ...lines.map((line, i) => ({type: 'way', id: i + 1, tags: {railway: 'subway'},
      geometry: line.map(([lon, lat]) => ({lon, lat}))}))]}), 'fixture');
  commitStage(table, 'fixture');
  return table;
}

const decode = tiles => [...tiles].flatMap(([key, bytes]) => {
  const [z, x, y] = key.split('/').map(Number), layer = new VectorTile(new Pbf(bytes)).layers[LAYER];
  return Array.from({length: layer.length}, (_, i) => ({key, ...layer.feature(i).toGeoJSON(x, y, z)}));
}).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const sortedTiles = tiles => [...tiles].sort(([a], [b]) => a.localeCompare(b));

test('service geometry order: production MVTs keep the same paths, properties and offsets for every way order', () => {
  const table = branchTable(), source = writeTable(table), expected = buildTiles(table), features = decode(expected);
  assert.ok(features.length);
  assert.deepEqual([...new Set(features.map(f => f.key.split('/')[0]))].sort(), ['10', '11', '12', '7', '8', '9']);
  const native = features.filter(f => f.key.startsWith('12/'));
  assert.equal(native.length, 2, 'both services fit wholly in one native tile');
  for (const feature of native) {
    const p = feature.properties;
    assert.equal(feature.geometry.type, 'MultiLineString');
    assert.deepEqual(feature.geometry.coordinates.map(line => line.length), [3, 2], 'the fork keeps one stable long label path');
    assert.ok(feature.geometry.coordinates[0].at(-1)[1] < feature.geometry.coordinates[0][0][1], 'the lower branch is the canonical continuation');
    assert.equal(p.n, 2);
    assert.equal(p.name, `Fixture ${p.ref}`);
    assert.equal(p.colour, '#126a94');
    assert.equal(p.network, 'Fixture Metro');
    if (p.id === 'relation-10') {
      assert.equal(p.group_relation_ids, '[10,20]');
      assert.equal(p.segment_relation_ids, '[10,20]');
      assert.equal(p.i, 0); assert.equal(p.slot, -1);
    } else {
      assert.equal(p.id, 'relation-30');
      assert.equal(p.group_relation_ids, '[30]');
      assert.equal(p.segment_relation_ids, '[30]');
      assert.equal(p.i, 1); assert.equal(p.slot, 1);
    }
  }
  for (const ways of permutations([...table.ways])) {
    const reordered = {...table, ways: new Map(ways)}, actual = buildTiles(reordered);
    assert.deepEqual(decode(actual), features, 'MVT geometry and scalar properties round-trip identically');
    assert.deepEqual(sortedTiles(actual), sortedTiles(expected), 'encoded bytes also remain identical for this fixed property-group order');
    assert.equal(writeTable(reordered), source, 'rendering never changes source evidence');
    assert.deepEqual(sortedTiles(buildTiles(readTable(writeTable(reordered)))), sortedTiles(expected), 'NDJSON resume keeps the same tile geometry');
  }
});

test('service geometry order: canonical joining respects distinct segment provenance and shared-track slots', () => {
  const table = serviceProvenanceFixture(), source = writeTable(table), expected = decode(buildTiles(table));
  const reordered = {...table, ways: new Map([...table.ways].reverse())};
  assert.deepEqual(decode(buildTiles(reordered)), expected);
  assert.equal(writeTable(table), source);
  const features = expected.filter(f => f.properties.id === 'relation-10');
  assert.ok(features.every(f => f.properties.group_relation_ids === '[10,20,30]'));
  assert.deepEqual([...new Set(features.map(f => f.properties.segment_relation_ids))].sort(), ['[10,20,30]', '[10]', '[20]', '[30]'].sort());
  assert.ok(features.filter(f => f.properties.segment_relation_ids === '[10,20,30]').every(f => f.properties.n === (Number(f.key.split('/')[0]) < 10 ? 2 : 3)));
});
