import test from 'node:test';
import assert from 'node:assert/strict';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {addResult, buildTiles, commitStage, discardStage, geometrySummary, readTable, toTable, writeTable, LAYER} from '../scripts/service-routes.mjs';

const lines = [[[139.70, 35.68], [139.71, 35.69]]];
const relation = (id, members = [{type: 'way', ref: 101, role: ''}]) => ({type: 'relation', id,
  tags: {type: 'route', route: 'subway', ref: String(id), name: `Line ${id}`, network: 'Metro'}, members});
const track = coordinates => ({type: 'way', id: 101, nodes: [1, 2],
  ...(coordinates === undefined ? {} : {geometry: coordinates.map(p => p && {lon: p[0], lat: p[1]})})});
const observation = (id, coordinates) => toTable({elements: [relation(id), track(coordinates)]});
const empty = () => ({routes: new Map(), ways: new Map()});
const stored = table => readTable(writeTable(table));
const tileRoutes = table => {
  const found = new Set();
  for (const [key, bytes] of buildTiles(table)) {
    if (!key.startsWith('12/')) continue;
    const layer = new VectorTile(new Pbf(bytes)).layers[LAYER];
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      found.add(`${feature.properties.id},n=${feature.properties.n}`);
    }
  }
  return [...found].sort();
};
const sharedRoutes = ['relation-1,n=2', 'relation-2,n=2'];

test('service geometry: explicitly returned track memberships survive absent and unusable coordinates', () => {
  for (const coordinates of [undefined, [], [null], [[139.70, 35.68]], [null, [139.70, 35.68], null]]) {
    const result = observation(1, coordinates);
    assert.equal(result.ways.length, 1);
    assert.deepEqual(result.ways[0].routes, ['r1']);
    const table = empty(); addResult(table, result, 'A'); commitStage(table, 'A');
    assert.equal(stored(table).ways.size, 1, 'the gap survives the published table');
    assert.equal(buildTiles(stored(table)).size, 0, 'no usable track geometry means no invented line');
  }
});

for (const reverse of [false, true]) test(`service geometry: another response hydrates missing membership (${reverse ? 'valid first' : 'missing first'})`, () => {
  const table = empty(), observations = [observation(1), observation(2, lines[0])];
  if (reverse) observations.reverse();
  for (const result of observations) addResult(table, result, 'A');
  assert.deepEqual(tileRoutes(stored(table)), sharedRoutes, 'in-progress publication retains both services');
  commitStage(table, 'A');
  assert.deepEqual(table.ways.get(101).routes.A, ['r1', 'r2']);
  assert.deepEqual(table.ways.get(101).lines, lines);
  assert.deepEqual(tileRoutes(stored(table)), sharedRoutes);
});

for (const reverse of [false, true]) test(`service geometry: committed memberships hydrate across stages (${reverse ? 'valid first' : 'missing first'})`, () => {
  const table = empty(), observations = [['A', observation(1)], ['B', observation(2, lines[0])]];
  if (reverse) observations.reverse();
  for (const [stage, result] of observations) { addResult(table, result, stage); commitStage(table, stage); }
  assert.deepEqual(table.ways.get(101).routes, reverse ? {B: ['r2'], A: ['r1']} : {A: ['r1'], B: ['r2']});
  assert.deepEqual(table.ways.get(101).lines, lines);
  assert.deepEqual(tileRoutes(stored(table)), sharedRoutes);
});

test('service geometry: a geometry-less refresh retains membership and known committed coordinates', () => {
  const table = empty(); addResult(table, observation(1, lines[0]), 'A'); commitStage(table, 'A');
  addResult(table, observation(1), 'A'); commitStage(table, 'A');
  assert.deepEqual(table.ways.get(101).routes.A, ['r1']);
  assert.deepEqual(table.ways.get(101).lines, lines);
  assert.deepEqual(tileRoutes(stored(table)), ['relation-1,n=1']);
});

test('service geometry: discard removes pending memberships without touching committed evidence', () => {
  const table = empty(); addResult(table, observation(2, lines[0]), 'B'); commitStage(table, 'B');
  const before = writeTable(table);
  addResult(table, observation(1), 'A');
  assert.deepEqual(tileRoutes(table), sharedRoutes);
  discardStage(table, 'A');
  assert.equal(writeTable(table), before);
  const missingOnly = empty(); addResult(missingOnly, observation(1), 'A'); discardStage(missingOnly, 'A');
  assert.equal(missingOnly.routes.size, 0); assert.equal(missingOnly.ways.size, 0);
});

test('service geometry: unreturned members and platform/stop roles are not promoted to track membership', () => {
  for (const role of ['', 'platform', 'stop', 'stop_entry_only']) {
    const table = empty();
    const elements = [relation(1, [{type: 'way', ref: 101, role}])];
    if (role) elements.push(track(undefined)); // Still excluded even if explicitly returned.
    addResult(table, toTable({elements}), 'A');
    addResult(table, observation(2, lines[0]), 'A'); commitStage(table, 'A');
    assert.deepEqual(table.ways.get(101).routes.A, ['r2']);
    assert.deepEqual(tileRoutes(table), ['relation-2,n=1']);
  }
});

test('service geometry: existing snapshot layout hydrates without a migration or coordinate fallback', () => {
  const legacy = empty(); addResult(legacy, observation(2, lines[0]), 'B'); commitStage(legacy, 'B');
  const table = stored(legacy); addResult(table, observation(1), 'A'); commitStage(table, 'A');
  assert.deepEqual(tileRoutes(stored(table)), sharedRoutes);
  assert.deepEqual(table.ways.get(101).lines, lines);
});

test('service geometry: a later complete shortened way still replaces older coordinates', () => {
  const table = empty(), longer = [[139.70,35.68],[139.71,35.70],[139.72,35.68]];
  addResult(table, observation(1, longer), 'A'); commitStage(table, 'A');
  addResult(table, observation(1, lines[0]), 'A'); commitStage(table, 'A');
  assert.deepEqual(table.ways.get(101).lines, lines, 'no prefer-longest geometry heuristic');
});

test('service geometry: hydration retains null-separated fragments without joining the gap', () => {
  const table = empty(), other = [[139.73,35.68],[139.74,35.69]];
  addResult(table, observation(1), 'A');
  addResult(table, observation(2, [...lines[0], null, ...other]), 'A'); commitStage(table, 'A');
  assert.deepEqual(table.ways.get(101).lines, [lines[0], other]);
  assert.deepEqual(tileRoutes(table), sharedRoutes);
});


test('service geometry: diagnostics distinguish missing, partial and recovered stored geometry', () => {
  const table = empty();
  const first = relation(1, [{type: 'way', ref: 101, role: ''}, {type: 'way', ref: 102, role: ''}]);
  const missingWay = {...track(undefined), id: 102};
  addResult(table, toTable({elements: [first, track(lines[0]), missingWay, relation(3, [])]}), 'A');
  addResult(table, toTable({elements: [relation(2, [{type: 'way', ref: 102, role: ''}]), missingWay]}), 'A');
  commitStage(table, 'A');
  assert.deepEqual(geometrySummary(stored(table)), {waysWithoutGeometry: [102],
    routeRelationsWithoutGeometry: [2, 3], routeRelationsWithPartialGeometry: [1]});
  addResult(table, toTable({elements: [relation(2, [{type: 'way', ref: 102, role: ''}]), {...track(lines[0]), id: 102}]}), 'B');
  assert.deepEqual(geometrySummary(stored(table)), {waysWithoutGeometry: [],
    routeRelationsWithoutGeometry: [3], routeRelationsWithPartialGeometry: []});
  discardStage(table, 'B');
  assert.deepEqual(geometrySummary(table).waysWithoutGeometry, [102]);
});

test('service geometry: empty legacy arrays do not hide a later usable observation', () => {
  const table = empty(); addResult(table, observation(1), 'A'); commitStage(table, 'A');
  table.ways.get(101).lines = [];
  table.ways.get(101).nextLines.legacy = [];
  addResult(table, observation(2, lines[0]), 'B');
  assert.deepEqual(tileRoutes(stored(table)), sharedRoutes);
  assert.deepEqual(geometrySummary(table).waysWithoutGeometry, []);
});

test('service geometry: the headway rebuild publishes the same gaps and recovers shared routes', async () => {
  const {mkdtemp, readFile, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {spawnSync} = await import('node:child_process');
  const {gzipSync, gunzipSync} = await import('node:zlib');
  const directory = await mkdtemp(join(tmpdir(), 'atlas-osm-memberships-'));
  try {
    const table = empty(); addResult(table, observation(1), 'A'); commitStage(table, 'A');
    addResult(table, observation(2, lines[0]), 'B'); commitStage(table, 'B');
    addResult(table, toTable({elements: [relation(3, [{type: 'way', ref: 102, role: ''}]), {...track(undefined), id: 102}]}), 'C');
    commitStage(table, 'C');
    await writeFile(join(directory, 'service-routes.ndjson.gz'), gzipSync(writeTable(table)));
    const run = spawnSync(process.execPath, ['scripts/rebuild-service-frequency.mjs', directory, join(directory, 'credits.html'), '--fixtures'], {encoding: 'utf8'});
    assert.equal(run.status, 0, run.stderr);
    const manifest = JSON.parse(await readFile(join(directory, 'frequency-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.geometry, geometrySummary(table));
    assert.deepEqual(manifest.geometry.waysWithoutGeometry, [102]);
    const index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'));
    const found = new Set();
    for (const key of index.tiles.filter(key => key.startsWith('12/'))) {
      const layer = new VectorTile(new Pbf(gunzipSync(await readFile(join(directory, `${key}.pbf.gz`))))).layers[LAYER];
      for (let i = 0; i < layer.length; i++) { const f = layer.feature(i); found.add(`${f.properties.id},n=${f.properties.n}`); }
    }
    assert.deepEqual([...found].sort(), sharedRoutes, 'headways preserve recovered OSM geometry and no line is invented for the remaining gap');
  } finally { await rm(directory, {recursive: true, force: true}); }
});
