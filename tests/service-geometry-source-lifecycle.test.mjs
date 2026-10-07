import test from 'node:test';
import assert from 'node:assert/strict';
import {observeGeometry, reconcileGeometry, geometryLines, geometryStatus} from '../scripts/service-geometry.mjs';
import {addResult, commitStage, discardStage, drawnGeometry, geometrySummary, migrateServiceDownloads,
  readTable, retireServiceEurope, toTable, writeTable} from '../scripts/service-routes.mjs';
import {EUROPE_STAGE_NAMES, STAGES} from '../scripts/download-stages.mjs';

const OLD = '2026-10-05T00:00:00Z', NEW = '2026-10-06T00:00:00Z', LATEST = '2026-10-07T00:00:00Z';
const WAY_TIME = '2026-10-01T00:00:00Z';
const POINTS = [[139.70, 35.68], [139.71, 35.69], [139.72, 35.68], [139.73, 35.69], [139.74, 35.68]];
const NODES = [11, 12, 13, 14, 15];
const empty = () => ({routes: new Map(), ways: new Map()});
const restore = table => readTable(writeTable(table));
const iso = value => new Date(value).toISOString();
const relation = id => ({type: 'relation', id, tags: {type: 'route', route: 'subway',
  name: `Line ${id}`, ref: String(id), network: 'Lifecycle test'}, members: [{type: 'way', ref: 101, role: ''}]});
function way({coords = POINTS, nodes = NODES, version = 4, timestamp = WAY_TIME, absent = false} = {}) {
  return {type: 'way', id: 101, version, timestamp, nodes,
    ...(absent ? {} : {geometry: coords.map(point => point && {lon: point[0], lat: point[1]})})};
}
function response(options = {}, elements = [way(options)]) {
  return {osm3s: {timestamp_osm_base: options.snapshot ?? OLD}, elements: [...(options.relations || [1, 2]).map(relation), ...elements]};
}
function observation(options = {}) {
  return observeGeometry(way(options), response(options), options.source);
}
const result = (options = {}) => toTable(response(options), options.source);
const evidence = table => drawnGeometry(table.ways.get(101));
const visible = table => geometryLines(evidence(table));
function accepted(options = {}, stage = 'A') {
  const table = empty(); addResult(table, result(options), stage); commitStage(table, stage); return restore(table);
}
function permutations(values) {
  return values.length < 2 ? [values] : values.flatMap((value, i) =>
    permutations(values.filter((_, j) => i !== j)).map(rest => [value, ...rest]));
}
function assertAlgebra(candidates, verify) {
  const expected = candidates.reduce(reconcileGeometry, null);
  verify(expected);
  for (const [a, b, c] of permutations(candidates)) {
    const direct = [a, b, c].reduce(reconcileGeometry, null);
    assert.deepEqual(direct, expected, 'every permutation retains the same source frontier');
    assert.deepEqual(reconcileGeometry(reconcileGeometry(a, b), c), reconcileGeometry(a, reconcileGeometry(b, c)), 'associative');
    assert.deepEqual(reconcileGeometry(a, b), reconcileGeometry(b, a), 'commutative');
    assert.deepEqual(reconcileGeometry(direct, direct), direct, 'idempotent accumulated evidence');
    assert.deepEqual([a, b, c, a, b, c].reduce(reconcileGeometry, null), expected, 'repeats do not erase or add evidence');
  }
}

test('source lifecycle: complete and compatible incomplete observations obey the reducer algebra', () => {
  const full = observation();
  assertAlgebra([full, observation({coords: [null, ...POINTS.slice(1)]}),
    observation({coords: [...POINTS.slice(0, 4), null]})], merged => {
    assert.equal(geometryStatus(merged).status, 'complete');
    assert.deepEqual(geometryLines(merged), [POINTS]);
    assert.deepEqual(merged.nodes, NODES);
  });
});

test('source lifecycle: complementary partial observations merge only matching raw indices', () => {
  assertAlgebra([observation({coords: [POINTS[0], POINTS[1], null, null, null]}),
    observation({coords: [null, POINTS[1], POINTS[2], POINTS[3], null]}),
    observation({coords: [null, null, null, POINTS[3], POINTS[4]]})], merged => {
    assert.equal(geometryStatus(merged).status, 'complete');
    assert.deepEqual(geometryLines(merged), [POINTS]);
  });
});

test('source lifecycle: a disputed coordinate is sticky under all orders, groupings and duplicates', () => {
  const disagree = [...POINTS]; disagree[2] = [139.72, 35.70];
  assertAlgebra([observation(), observation({coords: disagree}), observation({coords: [null, POINTS[1], null, POINTS[3], null]})], merged => {
    assert.equal(geometryStatus(merged).status, 'conflict');
    assert.ok(geometryStatus(merged).reasons.includes('coordinate_conflict'));
    assert.deepEqual(geometryStatus(merged).missing, [2]);
    assert.deepEqual(geometryLines(merged), [POINTS.slice(0, 2), POINTS.slice(3)]);
  });
});

test('source lifecycle: incompatible ordered node lists at one snapshot quarantine the topology', () => {
  assertAlgebra([observation(), observation({nodes: [11, 12, 99, 14, 15]}),
    observation({coords: [POINTS[0], POINTS[1], null, POINTS[3], POINTS[4]]})], merged => {
    assert.equal(geometryStatus(merged).status, 'conflict');
    assert.ok(geometryStatus(merged).reasons.includes('topology_conflict'));
    assert.deepEqual(geometryLines(merged), []);
  });
});

test('source lifecycle: disagreeing revisions at one snapshot remain conflicted after a repeat', () => {
  assertAlgebra([observation({version: 4}), observation({version: 5}), observation({version: 5, coords: [null, ...POINTS.slice(1)]})], merged => {
    assert.equal(geometryStatus(merged).status, 'conflict');
    assert.ok(geometryStatus(merged).reasons.includes('topology_conflict'));
    assert.deepEqual(geometryLines(merged), []);
  });
});

test('source lifecycle: revision regression is not accepted just because its snapshot is newer', () => {
  assertAlgebra([observation({version: 6}), observation({version: 5, snapshot: NEW}),
    observation({version: 5, snapshot: NEW, coords: [null, ...POINTS.slice(1)]})], merged => {
    assert.equal(iso(geometryStatus(merged).snapshot), iso(NEW));
    assert.equal(geometryStatus(merged).status, 'conflict');
    assert.ok(geometryStatus(merged).reasons.includes('revision_regression'));
    assert.deepEqual(geometryLines(merged), [], 'do not silently restore the old higher-version path either');
  });
});

test('source lifecycle: authoritative later evidence clears an earlier coordinate conflict', () => {
  const disagree = [...POINTS]; disagree[2] = [139.72, 35.70];
  const next = observation({snapshot: NEW, coords: POINTS.map(([x, y]) => [x, y + 0.01])});
  for (const order of permutations([observation(), observation({coords: disagree}), next])) {
    const merged = order.reduce(reconcileGeometry, null);
    assert.equal(geometryStatus(merged).status, 'complete');
    assert.deepEqual(geometryLines(merged), geometryLines(next));
  }
});

test('source lifecycle: the revision watermark survives intervening snapshots and can be recovered', () => {
  const regressed = reconcileGeometry(observation({version: 7}), observation({version: 5, snapshot: NEW}));
  for (const stale of [observation({version: 4}), observation({version: 6, snapshot: LATEST})]) {
    const merged = reconcileGeometry(regressed, stale);
    assert.ok(geometryStatus(merged).reasons.includes('revision_regression'));
    assert.deepEqual(geometryLines(merged), []);
  }
  const recovered = reconcileGeometry(regressed, observation({version: 7, snapshot: LATEST}));
  assert.equal(geometryStatus(recovered).status, 'complete');
  assert.deepEqual(geometryLines(recovered), [POINTS]);
});

test('source lifecycle: snapshot freshness wins over acquisition time, length and arrival', () => {
  const old = observation({source: {acquired: LATEST}}), short = observation({snapshot: NEW,
    version: 5, nodes: [11, 12], coords: POINTS.slice(0, 2), source: {acquired: NEW}});
  for (const order of [[old, short], [short, old]]) {
    assert.deepEqual(geometryLines(order.reduce(reconcileGeometry, null)), [POINTS.slice(0, 2)]);
  }
});

test('source lifecycle: unchanged way revisions still permit newer node-only movement', () => {
  const moved = POINTS.map(([x, y]) => [x + 0.01, y + 0.01]);
  for (const order of permutations([observation(), observation({snapshot: NEW, coords: moved}), observation({coords: [null, ...POINTS.slice(1)]})])) {
    assert.deepEqual(geometryLines(order.reduce(reconcileGeometry, null)), [moved.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))])]);
  }
});

test('source lifecycle: same-version changed node topology across snapshots is a persistent contradiction', () => {
  assertAlgebra([observation(), observation({snapshot: NEW, nodes: [11, 12, 99, 14, 15]}),
    observation({snapshot: LATEST, nodes: [11, 12, 99, 14, 15]})], merged => {
    assert.equal(geometryStatus(merged).status, 'conflict');
    assert.ok(geometryStatus(merged).reasons.includes('revision_topology_conflict'));
    assert.deepEqual(geometryLines(merged), []);
  });
});

test('source lifecycle: changed version timestamps without a revision increment are diagnosed', () => {
  const merged = reconcileGeometry(observation(), observation({snapshot: NEW, timestamp: '2026-10-02T00:00:00Z'}));
  assert.equal(geometryStatus(merged).status, 'conflict');
  assert.ok(geometryStatus(merged).reasons.includes('revision_topology_conflict'));
  assert.deepEqual(geometryLines(merged), []);
});

test('source lifecycle: increasing version with a regressed element timestamp is not accepted', () => {
  const merged = reconcileGeometry(observation({version: 4, timestamp: '2026-10-02T00:00:00Z'}),
    observation({version: 5, snapshot: NEW, timestamp: WAY_TIME}));
  assert.equal(geometryStatus(merged).status, 'conflict');
  assert.ok(geometryStatus(merged).reasons.includes('revision_regression'));
  assert.deepEqual(geometryLines(merged), []);
});

test('source lifecycle: fractional dataset timestamps use chronological order rather than string order', () => {
  const moved = POINTS.map(([x, y]) => [x, y + 0.01]);
  const newer = observation({snapshot: '2026-10-05T00:00:00.100Z', coords: moved});
  const older = observation({snapshot: '2026-10-05T00:00:00.000Z'});
  for (const order of [[newer, older], [older, newer]]) {
    const merged = order.reduce(reconcileGeometry, null);
    assert.equal(iso(geometryStatus(merged).snapshot), '2026-10-05T00:00:00.100Z');
    assert.deepEqual(geometryLines(merged), geometryLines(newer));
  }
});

test('source lifecycle: fractional element timestamps are validated against the dataset time', () => {
  const future = observation({snapshot: '2026-10-05T00:00:00.000Z', timestamp: '2026-10-05T00:00:00.100Z'});
  assert.equal(geometryStatus(future).status, 'unknown');
  const current = observation({snapshot: '2026-10-05T00:00:00.100Z', timestamp: '2026-10-05T00:00:00.000Z'});
  assert.equal(geometryStatus(current).status, 'complete');
});

test('source lifecycle: fractional revision timestamp watermarks do not create false regressions', () => {
  const first = observation({timestamp: '2026-10-01T00:00:00.000Z'});
  const next = observation({snapshot: NEW, version: 5, timestamp: '2026-10-01T00:00:00.100Z'});
  for (const order of [[first, next], [next, first]]) {
    const merged = order.reduce(reconcileGeometry, null);
    assert.equal(geometryStatus(merged).status, 'complete');
    assert.equal(geometryStatus(merged).version, 5);
  }
  const regressed = reconcileGeometry(observation({timestamp: '2026-10-01T00:00:00.100Z'}),
    observation({snapshot: NEW, version: 5, timestamp: '2026-10-01T00:00:00.000Z'}));
  assert.ok(geometryStatus(regressed).reasons.includes('revision_regression'));
});

test('source lifecycle: current partial slots never hydrate from another snapshot', () => {
  const partial = [null, POINTS[1], POINTS[2], null, POINTS[4]];
  for (const order of permutations([observation(), observation({snapshot: NEW, coords: partial}), observation({coords: POINTS})])) {
    const merged = order.reduce(reconcileGeometry, null);
    assert.equal(geometryStatus(merged).status, 'partial');
    assert.deepEqual(geometryStatus(merged).missing, [0, 3]);
    assert.deepEqual(geometryLines(merged), [[POINTS[1], POINTS[2]]]);
  }
});

test('source lifecycle: absent current geometry is an authoritative zero-line frontier', () => {
  for (const options of [{absent: true}, {coords: []}, {coords: NODES.map(() => null)}]) {
    for (const order of [[result(), result({...options, snapshot: NEW})], [result({...options, snapshot: NEW}), result()]]) {
      let table = empty();
      for (const candidate of order) { addResult(table, candidate, 'A'); table = restore(table); }
      commitStage(table, 'A'); table = restore(table);
      assert.deepEqual(visible(table), []);
      assert.deepEqual(table.ways.get(101).routes.A, ['r1', 'r2']);
      assert.equal(iso(geometryStatus(evidence(table)).snapshot), iso(NEW));
      assert.deepEqual(geometrySummary(table).routeRelationsWithoutGeometry, [1, 2]);
      assert.deepEqual(geometrySummary(table).waysWithPartialGeometry, [101]);
    }
  }
});

test('source lifecycle: leading, trailing and internal missing slots preserve only adjacent fragments', () => {
  const fixtures = [
    {coords: [null, ...POINTS.slice(1)], missing: [0], lines: [POINTS.slice(1)]},
    {coords: [...POINTS.slice(0, 4), null], missing: [4], lines: [POINTS.slice(0, 4)]},
    {coords: [POINTS[0], POINTS[1], null, POINTS[3], POINTS[4]], missing: [2], lines: [POINTS.slice(0, 2), POINTS.slice(3)]},
    {coords: [POINTS[0], null, POINTS[2], null, POINTS[4]], missing: [1, 3], lines: []},
  ];
  for (const fixture of fixtures) {
    const candidate = observation(fixture);
    assert.deepEqual(geometryStatus(candidate).missing, fixture.missing);
    assert.deepEqual(geometryLines(candidate), fixture.lines);
  }
});

test('source lifecycle: invalid coordinates stay missing and never become a bridging point', () => {
  for (const invalid of [[181, 0], [0, 91], [NaN, 0], [0, Infinity], ['139.72', 35.68]]) {
    const candidate = observation({coords: [POINTS[0], POINTS[1], invalid, POINTS[3], POINTS[4]]});
    assert.deepEqual(geometryStatus(candidate).missing, [2]);
    assert.deepEqual(geometryLines(candidate), [POINTS.slice(0, 2), POINTS.slice(3)]);
  }
});

test('source lifecycle: malformed node/geometry alignment is quarantined instead of truncated or guessed', () => {
  for (const coords of [POINTS.slice(0, 2), [...POINTS, [139.75, 35.69]]]) {
    const candidate = observation({coords});
    assert.equal(geometryStatus(candidate).status, 'partial');
    assert.ok(geometryStatus(candidate).reasons.includes('unaligned_geometry'));
    assert.deepEqual(geometryStatus(candidate).missing, [0, 1, 2, 3, 4]);
    assert.deepEqual(geometryLines(candidate), []);
  }
});

test('source lifecycle: repeated nodes and closed topology retain their ordered raw positions', () => {
  const nodes = [11, 12, 13, 12, 11], coords = [POINTS[0], POINTS[1], POINTS[2], POINTS[1], POINTS[0]];
  const table = accepted({nodes, coords});
  assert.deepEqual(evidence(table).nodes, nodes);
  assert.deepEqual(visible(table), [coords]);
  const partial = observation({nodes, coords: [coords[0], coords[1], null, coords[3], coords[4]]});
  assert.deepEqual(geometryLines(partial), [coords.slice(0, 2), coords.slice(3)]);
  assert.deepEqual(geometryStatus(partial).missing, [2]);
});

test('source lifecycle: contradictory coordinates for one repeated node cannot certify a false path', () => {
  const candidate = observation({nodes: [11, 12, 11], coords: POINTS.slice(0, 3)});
  assert.equal(geometryStatus(candidate).status, 'conflict');
  assert.ok(geometryStatus(candidate).reasons.some(reason => reason.includes('conflict')));
  assert.deepEqual(geometryLines(candidate), [], 'one OSM node cannot occupy two positions in the same source state');
});

test('source lifecycle: complementary repeats cannot merge inconsistent positions for the same node', () => {
  const nodes = [11, 12, 13, 11, 14];
  assertAlgebra([observation({nodes, coords: [POINTS[0], POINTS[1], POINTS[2], null, null]}),
    observation({nodes, coords: [null, null, POINTS[2], POINTS[3], POINTS[4]]}),
    observation({nodes, absent: true})], merged => {
    assert.equal(geometryStatus(merged).status, 'conflict');
    assert.deepEqual(geometryLines(merged), [[POINTS[1], POINTS[2]]], 'only uncontested adjacent-node fragments remain');
  });
});

test('source lifecycle: raw provenance survives storage without retaining OSM user metadata', () => {
  const source = {endpoint: 'https://overpass.example.test/api/interpreter', acquired: NEW, stage: 'A', pass: 'pass-1', query: 'box-1'};
  const raw = {...way(), uid: 54321, user: 'private-editor-name', changeset: 987654, tags: {version: '999'}};
  const table = empty(); addResult(table, toTable(response({}, [raw]), source), 'A'); commitStage(table, 'A');
  const saved = evidence(restore(table)), encoded = writeTable(table);
  assert.deepEqual(saved.nodes, NODES);
  assert.equal(saved.version, 4);
  assert.equal(iso(saved.timestamp), iso(WAY_TIME));
  assert.equal(iso(saved.snapshot), iso(OLD));
  for (const [key, value] of Object.entries(source)) assert.equal(saved.sources[0][key], value);
  assert.equal(typeof saved.sources[0].observation, 'string');
  assert.ok(!encoded.includes('private-editor-name'));
  assert.ok(!encoded.includes('"uid"'));
  assert.ok(!encoded.includes('"changeset"'));
});

test('source lifecycle: repeated acquisition references are bounded without order-dependent selection', () => {
  const candidates = Array.from({length: 20}, (_, i) => observation({source: {query: `box-${i}`, stage: `stage-${i}`}}));
  const forward = candidates.reduce(reconcileGeometry, null);
  const backward = [...candidates].reverse().reduce(reconcileGeometry, null);
  assert.deepEqual(forward, backward);
  assert.ok(forward.sources.length > 0 && forward.sources.length <= 8);
  assert.equal(geometryStatus(forward).status, 'complete');
  assert.deepEqual(geometryLines(forward), [POINTS]);
});

test('source lifecycle: a single response resolves duplicate way entries independently of element order', () => {
  const disagree = [...POINTS]; disagree[2] = [139.72, 35.70];
  for (const elements of permutations([way(), way({coords: disagree}), way({coords: [null, ...POINTS.slice(1)]})])) {
    const candidate = toTable(response({}, elements)).ways[0];
    assert.deepEqual(candidate.routes, ['r1', 'r2']);
    assert.equal(geometryStatus(candidate.geometry).status, 'conflict');
    assert.deepEqual(candidate.lines, [POINTS.slice(0, 2), POINTS.slice(3)]);
  }
});

test('source lifecycle: pending insertion and commit order, including resumes, select one source frontier', () => {
  const candidates = [['A', {}], ['B', {snapshot: NEW, version: 5, nodes: [11, 12], coords: POINTS.slice(0, 2)}],
    ['C', {coords: [POINTS[0], POINTS[1], null, POINTS[3], POINTS[4]]}]];
  for (const inserted of permutations(candidates)) for (const committed of permutations(['A', 'B', 'C'])) {
    let table = empty();
    for (const [stage, options] of inserted) { addResult(table, result(options), stage); table = restore(table); }
    assert.deepEqual(visible(table), [POINTS.slice(0, 2)], 'pending-only drawing resolves all stages');
    for (const stage of committed) { commitStage(table, stage); table = restore(table); }
    assert.deepEqual(visible(table), [POINTS.slice(0, 2)], 'accepted drawing resolves every commit order');
    assert.equal(iso(geometryStatus(evidence(table)).snapshot), iso(NEW));
  }
});

test('source lifecycle: resumed pending conflicts survive duplicate responses and become accepted only on commit', () => {
  let table = accepted();
  const disagree = [...POINTS]; disagree[2] = [139.72, 35.70];
  addResult(table, result({snapshot: NEW}), 'B');
  addResult(table, result({snapshot: NEW, coords: disagree}), 'B');
  table = restore(table);
  addResult(table, result({snapshot: NEW}), 'B');
  assert.deepEqual(visible(table), [POINTS], 'accepted geometry remains stable during the pass');
  const summary = geometrySummary(table);
  assert.deepEqual(summary.waysWithPendingEvidence, [101]);
  assert.equal(summary.details[0].pending.status, 'conflict');
  assert.equal(iso(summary.details[0].snapshot), iso(OLD));
  commitStage(table, 'B'); table = restore(table);
  assert.equal(geometryStatus(evidence(table)).status, 'conflict');
  assert.deepEqual(visible(table), [POINTS.slice(0, 2), POINTS.slice(3)]);
});

test('source lifecycle: rejected pending evidence changes no accepted geometry, memberships or diagnostics', () => {
  const table = accepted(), before = writeTable(table), summary = geometrySummary(table);
  addResult(table, result({snapshot: NEW, absent: true, relations: [3]}), 'B');
  assert.deepEqual(visible(table), [POINTS]);
  assert.deepEqual(geometrySummary(table).waysWithPendingEvidence, [101]);
  discardStage(table, 'B');
  assert.equal(writeTable(table), before);
  assert.deepEqual(geometrySummary(table), summary);
});

test('source lifecycle: discarding the only pending pass fully retires its never-accepted ways', () => {
  const table = empty(); addResult(table, result({snapshot: NEW, absent: true}), 'B');
  discardStage(table, 'B');
  assert.equal(table.ways.size, 0);
  assert.equal(table.routes.size, 0);
});

test('source lifecycle: removing the newest stage does not resurrect old geometry held by another stage', () => {
  let table = accepted();
  addResult(table, result({snapshot: NEW, absent: true}), 'B'); commitStage(table, 'B');
  commitStage(table, 'B'); // Successful empty replacement removes this stage's membership.
  table = restore(table);
  assert.deepEqual(table.ways.get(101).routes, {A: ['r1', 'r2']});
  assert.equal(iso(geometryStatus(evidence(table)).snapshot), iso(NEW));
  assert.deepEqual(visible(table), []);
  addResult(table, result(), 'A'); commitStage(table, 'A');
  assert.deepEqual(visible(restore(table)), [], 'a later-arriving stale response cannot resurrect the way either');
  commitStage(table, 'A');
  assert.equal(table.ways.size, 0, 'the source watermark ends only when the way itself retires');
});

const layoutTwo = () => ({version: 1, downloadStages: 2,
  stages: Object.fromEntries(STAGES.map(stage => [stage.name, {completed: OLD, pending: [{part: 0, box: [0, 0, 1, 1]}], seen: [101]}])),
  runs: [{at: OLD, bytes: 1000}]});
function finishReplacement(state) {
  for (const stage of EUROPE_STAGE_NAMES) state.stages[stage].completed = state.legacyEurope.migrated;
  for (const stage of ['asia', 'world']) Object.assign(state.stages[stage], {
    started: state.legacyEurope.migrated, completed: state.legacyEurope.migrated,
  });
}

test('source lifecycle: Europe migration preserves the accepted/pending transaction boundary', () => {
  let table = accepted({}, 'europe-a');
  const state = layoutTwo(), india = structuredClone(state.stages.india), runs = structuredClone(state.runs);
  addResult(table, result({snapshot: NEW, absent: true, relations: [3]}), 'europe-g');
  migrateServiceDownloads(state, table); table = restore(table);
  assert.deepEqual(visible(table), [POINTS]);
  assert.equal(iso(geometryStatus(evidence(table)).snapshot), iso(OLD));
  assert.deepEqual(table.ways.get(101).routes['europe:europe-a'], ['r1', 'r2']);
  assert.deepEqual(table.ways.get(101).routes['europe:europe-g'], ['r3']);
  assert.deepEqual(table.ways.get(101).nextGeometry, {});
  assert.equal(iso(geometryStatus(table.ways.get(101).retiredGeometry['europe:europe-g']).snapshot), iso(NEW));
  assert.deepEqual(geometrySummary(table).waysWithPendingEvidence, [101]);
  assert.deepEqual(state.stages.india, india);
  assert.deepEqual(state.runs, runs);
  const before = structuredClone({state, table}); migrateServiceDownloads(state, table);
  assert.deepEqual({state, table}, before, 'migration is idempotent after storage/resume');
});

test('source lifecycle: Europe migration resolves all pending-only retired sources before adopting fallback', () => {
  for (const assignments of [[['europe-a', {}], ['europe-g', {snapshot: NEW, absent: true}]],
    [['europe-a', {snapshot: NEW, absent: true}], ['europe-g', {}]]]) {
    for (const order of [assignments, [...assignments].reverse()]) {
      const table = empty(), state = layoutTwo();
      for (const [stage, options] of order) addResult(table, result(options), stage);
      assert.deepEqual(visible(table), [], 'pending source selection initially chooses the newer unavailable geometry');
      migrateServiceDownloads(state, table);
      assert.equal(iso(geometryStatus(evidence(restore(table))).snapshot), iso(NEW));
      assert.deepEqual(visible(table), [], 'migration must not adopt an older first-stage path');
    }
  }
});

test('source lifecycle: legacy empty accepted geometry cannot hide certified interrupted Europe coverage', () => {
  let table = empty();
  const unverifiedEmpty = toTable({elements: [relation(1), relation(2), way({absent: true})]});
  addResult(table, unverifiedEmpty, 'europe-a'); commitStage(table, 'europe-a');
  addResult(table, result({snapshot: NEW}), 'europe-g');
  assert.deepEqual(visible(table), [POINTS]);
  assert.equal(iso(geometryStatus(evidence(table)).snapshot), iso(NEW));
  const state = layoutTwo(); migrateServiceDownloads(state, table); table = restore(table);
  assert.deepEqual(visible(table), [POINTS], 'retired pending coverage stays drawable over the empty legacy fallback');
  assert.equal(iso(geometryStatus(evidence(table)).snapshot), iso(NEW));
  assert.equal(iso(geometryStatus(table.ways.get(101).retiredGeometry['europe:europe-g']).snapshot), iso(NEW));
  const before = writeTable(table); migrateServiceDownloads(state, table);
  assert.equal(writeTable(table), before, 'resuming migration does not lose the fallback provenance');
});

test('source lifecycle: retiring Europe fallback keeps the accepted source watermark with surviving memberships', () => {
  let table = accepted({snapshot: NEW, absent: true}, 'europe-a');
  const state = layoutTwo(); migrateServiceDownloads(state, table);
  addResult(table, result(), 'europe-f'); commitStage(table, 'europe-f');
  finishReplacement(state); retireServiceEurope(state, table); table = restore(table);
  assert.equal(state.legacyEurope, undefined);
  assert.deepEqual(table.ways.get(101).routes, {'europe-f': ['r1', 'r2']});
  assert.equal(iso(geometryStatus(evidence(table)).snapshot), iso(NEW));
  assert.deepEqual(visible(table), []);
});

function legacyTable({lines = [POINTS], nextLines = {}} = {}) {
  return readTable([
    ...[1, 2].map(id => JSON.stringify({type: 'route', key: `r${id}`, stages: {A: {...relation(id).tags, key: `r${id}`, relation: id, label: `Line ${id}`}}, next: {}})),
    JSON.stringify({type: 'way', id: 101, routes: {A: ['r1', 'r2']}, next: {}, lines, nextLines}),
  ].join('\n') + '\n');
}

test('source lifecycle: legacy lines and interrupted nextLines migrate without fabricated provenance', () => {
  const table = restore(legacyTable({nextLines: {B: [POINTS.slice(0, 2)]}}));
  assert.equal(geometryStatus(evidence(table)).status, 'unknown');
  assert.equal(evidence(table).snapshot, null);
  assert.equal(geometryStatus(table.ways.get(101).nextGeometry.B).status, 'unknown');
  assert.equal(geometryStatus(table.ways.get(101).nextGeometry.B).version, null);
  assert.deepEqual(visible(table), [POINTS], 'the committed legacy fallback stays visible during its pending pass');
  assert.deepEqual(geometrySummary(table).waysWithUnknownProvenance, [101]);
});

test('source lifecycle: legacy empty arrays hydrate while retaining an unknown provenance label', () => {
  const table = legacyTable({lines: []});
  const unverified = toTable({elements: [relation(1), relation(2), way({version: undefined, timestamp: undefined})]});
  addResult(table, unverified, 'B');
  assert.deepEqual(visible(restore(table)), [POINTS]);
  assert.equal(geometryStatus(evidence(table)).status, 'unknown');
  commitStage(table, 'B');
  assert.deepEqual(visible(restore(table)), [POINTS]);
});

test('source lifecycle: conflicting legacy refresh retains a labeled accepted fallback until certified replacement', () => {
  let table = legacyTable();
  const changed = toTable({elements: [relation(1), relation(2), way({coords: POINTS.slice(0, 2)})]});
  addResult(table, changed, 'B'); commitStage(table, 'B'); table = restore(table);
  assert.deepEqual(visible(table), [POINTS]);
  assert.equal(geometryStatus(evidence(table)).status, 'conflict');
  assert.ok(geometryStatus(evidence(table)).reasons.includes('retained_legacy_fallback'));
  addResult(table, result({snapshot: NEW, absent: true}), 'C'); commitStage(table, 'C'); table = restore(table);
  assert.deepEqual(visible(table), []);
  assert.equal(table.ways.get(101).legacyFallback, undefined);
  assert.equal(geometryStatus(evidence(table)).status, 'partial');
});

test('source lifecycle: certified missing evidence replaces legacy fallback permanently', () => {
  let table = legacyTable();
  addResult(table, result({snapshot: NEW, absent: true}), 'B');
  assert.deepEqual(visible(table), [POINTS], 'pending work does not modify accepted legacy geometry');
  commitStage(table, 'B'); table = restore(table);
  assert.deepEqual(visible(table), []);
  const legacy = toTable({elements: [relation(1), relation(2), way()]});
  addResult(table, legacy, 'C'); commitStage(table, 'C');
  assert.deepEqual(visible(restore(table)), []);
  assert.equal(iso(geometryStatus(evidence(table)).snapshot), iso(NEW));
});

test('source lifecycle: disagreeing unverified geometry is diagnosed instead of selected by path length', () => {
  for (const order of [[POINTS, POINTS.slice(0, 2)], [POINTS.slice(0, 2), POINTS]]) {
    let table = empty();
    for (const coords of order) {
      addResult(table, toTable({elements: [relation(1), way({coords})]}), 'A');
      table = restore(table);
    }
    commitStage(table, 'A');
    assert.equal(geometryStatus(evidence(table)).status, 'conflict');
    assert.ok(geometryStatus(evidence(table)).reasons.includes('unverified_conflict'));
    assert.deepEqual(visible(table), []);
  }
});

test('source lifecycle: conflicting unverified refresh preserves accepted certified geometry and its warning', () => {
  const table = accepted(), coords = [...POINTS]; coords[2] = [139.72, 35.70];
  const unverified = toTable({elements: [relation(1), relation(2), way({coords})]}, {query: 'unverified-repeat'});
  addResult(table, unverified, 'B'); commitStage(table, 'B');
  assert.deepEqual(visible(restore(table)), [POINTS], 'unverified evidence cannot overrule the accepted certified path');
  const summary = geometrySummary(restore(table));
  assert.ok(summary.details.some(detail => detail.way === 101 && detail.reasons.some(reason => /unverified|unknown/.test(reason))),
    'the conflicting unknown refresh must stay diagnosable after commit/resume');
});

test('source lifecycle: incomplete metadata never fabricates a certified source from tags or response version', () => {
  for (const missing of ['version', 'timestamp', 'nodes']) {
    const raw = way(); delete raw[missing]; raw.tags = {version: '4'};
    const json = response({}, [raw]); json.version = 0.6;
    const candidate = toTable(json).ways[0].geometry;
    assert.equal(geometryStatus(candidate).status, 'unknown', missing);
    assert.equal(candidate.snapshot, null, missing);
  }
  const futureTimestamp = observation({timestamp: LATEST, snapshot: OLD});
  assert.equal(geometryStatus(futureTimestamp).status, 'unknown');
});

test('source lifecycle: diagnostics bound point-level payload while retaining complete missing counts', () => {
  const table = accepted({nodes: Array.from({length: 60}, (_, i) => 1000 + i), absent: true});
  const original = table.ways.get(101);
  for (let i = 1; i < 110; i++) table.ways.set(101 + i, {...structuredClone(original), id: 101 + i});
  const summary = geometrySummary(table);
  assert.equal(summary.waysWithoutGeometry.length, 110);
  assert.equal(summary.details.length, 100);
  for (const detail of summary.details) {
    assert.equal(detail.missingCount, 60);
    assert.equal(detail.missing.length, 20);
    assert.deepEqual(detail.relations, detail.way === 101 ? [1, 2] : [], 'cloned coordinates do not establish extra relation memberships');
  }
  assert.equal(geometryStatus(evidence(restore(table))).missing.length, 60, 'storage preserves the uncapped raw evidence');
});
