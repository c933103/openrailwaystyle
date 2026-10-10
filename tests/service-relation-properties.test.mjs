import test from 'node:test';
import assert from 'node:assert/strict';
import {addResult, buildTiles, commitStage, discardStage, migrateServiceDownloads, readTable, routeView, toTable, wayRoutes, writeTable} from '../scripts/service-routes.mjs';
import {drawnRelation, legacyRelation, reconcileRelations, relationAllows, relationStatus} from '../scripts/service-relations.mjs';

const OLD = '2026-10-05T00:00:00Z', NEW = '2026-10-06T00:00:00Z';
const member = (ref, role = '') => ({type: 'way', ref, role});
const empty = () => ({routes: new Map(), ways: new Map()});
const restore = table => readTable(writeTable(table));
function response({snapshot = OLD, version = 1, timestamp = '2026-10-01T00:00:00Z', members = [member(101)], tags = {}, returned = [101], source = {}} = {}) {
  const json = {osm3s: {timestamp_osm_base: snapshot}, elements: [{type: 'relation', id: 1, version, timestamp,
    tags: {type: 'route', route: 'subway', ref: '1', name: 'Line 1', network: 'Property test', ...tags}, members},
  ...returned.map(id => ({type: 'way', id, version: 1, timestamp: '2026-10-01T00:00:00Z', nodes: [id * 10, id * 10 + 1],
    geometry: [{lon: 139.70, lat: 35.68 + id / 10000}, {lon: 139.74, lat: 35.68 + id / 10000}]}))]};
  return {json, source};
}
const result = options => {const {json, source} = response(options); return toTable(json, source);};
const observation = options => result(options).routes[0].membership;
const merge = (...items) => items.reduce(reconcileRelations, null);
const bytes = table => [...buildTiles(table)].map(([key, value]) => [key, Buffer.from(value).toString('base64')]);
const freeze = value => {if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);} return value;};
const random = seed => () => {seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296;};

// Randomness is fixed and entirely local: failures are reproducible without
// acquiring source data or changing the production download budgets.
test('relation properties: seeded mixed-source reducer obeys algebra without mutating inputs', () => {
  const rng = random(107202610), pool = [];
  const snapshots = [null, OLD, NEW, '2026-10-06T00:00:00.100Z'];
  const lists = [[member(101)], [member(102)], [member(101), member(102)], [member(102), member(101)], [], null,
    [{type: 'node', ref: 9, role: 'stop'}, member(101, 'forward'), member(101, 'backward')]];
  for (let i = 0; i < 40; i++) pool.push(freeze(observation({snapshot: snapshots[Math.floor(rng() * snapshots.length)],
    version: [null, 1, 2, 3][Math.floor(rng() * 4)], timestamp: [null, '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'][Math.floor(rng() * 3)],
    members: lists[Math.floor(rng() * lists.length)], tags: {name: rng() < 0.3 ? 'Different line' : 'Line 1'},
    returned: rng() < 0.5 ? [101] : [102], source: {query: `query-${i}`, acquired: rng() < 0.5 ? OLD : NEW}})));
  pool.push(freeze(legacyRelation(pool[0].view, [101])), freeze(legacyRelation(pool[1].view, [102])));
  for (let i = 0; i < 1500; i++) {
    const a = pool[Math.floor(rng() * pool.length)], b = pool[Math.floor(rng() * pool.length)], c = pool[Math.floor(rng() * pool.length)];
    assert.deepEqual(merge(a, b), merge(b, a), `commutative sample ${i}`);
    assert.deepEqual(merge(a, a), a, `idempotent sample ${i}`);
    assert.deepEqual(merge(merge(a, b), c), merge(a, merge(b, c)), `associative sample ${i}`);
    const accumulated = merge(a, b, c);
    assert.deepEqual(merge(accumulated, accumulated), accumulated, `idempotent frontier ${i}`);
    assert.deepEqual(merge(accumulated, a, b, c), accumulated, `duplicate replay ${i}`);
  }
});

test('relation properties: identical unknown declarations select deterministic raw provenance', () => {
  const inputs = [OLD, NEW, '2026-10-06T00:00:00.100Z'].map(snapshot => observation({snapshot, version: null}));
  for (const a of inputs) for (const b of inputs) for (const c of inputs) {
    assert.deepEqual(merge(a, b, c), merge(c, b, a));
    assert.equal(relationStatus(merge(a, b, c)).status, 'unknown');
  }
});

test('relation properties: raw tag object order cannot change evidence, persisted bytes or tile bytes', () => {
  const tags = {'name:fr': 'Ligne 1', 'name:de': 'Linie 1', 'name:ja': '線一', colour: '#aabbcc'};
  const a = result({tags}), b = result({tags: Object.fromEntries(Object.entries(tags).reverse())});
  assert.deepEqual(a, b);
  const tables = [[a, b], [b, a]].map(order => {let table = empty(); for (const item of order) {addResult(table, item, 'A'); table = restore(table);} commitStage(table, 'A'); return table;});
  assert.equal(writeTable(tables[0]), writeTable(tables[1]));
  assert.deepEqual(bytes(tables[0]), bytes(tables[1]));
});

test('relation properties: absent and malformed member slots cannot certify negative membership', () => {
  const base = observation();
  for (const malformed of [undefined, null, [null], [undefined], [false], [42], ['way'], [{}], [member('101')], [member(-1)], [member(101, 2)]]) {
    const {json, source} = response({snapshot: NEW, version: 2});
    json.elements[0].members = malformed;
    const candidate = toTable(json, source).routes[0].membership;
    assert.equal(candidate.snapshot, null);
    assert.equal(candidate.complete, false);
    assert.ok(relationStatus(candidate).reasons.includes('incomplete_member_declaration'));
    assert.equal(merge(base, candidate).snapshot, OLD);
    assert.deepEqual(merge(base, candidate).eligible, [101]);
    assert.ok(relationStatus(merge(base, candidate)).reasons.includes('ignored_unverified_relation'));
  }
});

test('relation properties: fractional source and revision clocks compare chronologically', () => {
  const early = observation({snapshot: '2026-10-05T00:00:00.000Z', timestamp: '2026-10-01T00:00:00.000Z'});
  const late = observation({snapshot: '2026-10-05T00:00:00.100Z', version: 2, timestamp: '2026-10-01T00:00:00.100Z', members: [member(102)], returned: [102]});
  for (const merged of [merge(early, late), merge(late, early)]) {
    assert.equal(merged.snapshot, '2026-10-05T00:00:00.100Z');
    assert.equal(relationStatus(merged).status, 'complete');
    assert.deepEqual(merged.eligible, [102]);
  }
  const future = observation({snapshot: '2026-10-05T00:00:00.000Z', timestamp: '2026-10-05T00:00:00.100Z'});
  assert.equal(future.snapshot, null);
  assert.equal(relationStatus(future).status, 'unknown');
  const regressed = observation({snapshot: NEW, version: 3, timestamp: '2026-10-01T00:00:00.000Z'});
  assert.ok(relationStatus(merge(late, regressed)).reasons.includes('relation_revision_regression'));
});

test('relation properties: repeated refs and all member roles retain exact sequence through NDJSON', () => {
  const members = [{type: 'node', ref: 101, role: 'stop'}, member(101, 'forward'), member(101, 'backward'),
    member(102, 'platform'), {type: 'relation', ref: 101, role: 'branch'}, member(103, '')];
  const table = empty(); addResult(table, result({members, returned: [101, 102]}), 'A'); commitStage(table, 'A');
  const evidence = drawnRelation(restore(table).routes.get('r1'));
  assert.deepEqual(evidence.members, members);
  assert.deepEqual(evidence.eligible, [101]);
  assert.deepEqual(relationStatus(evidence).unresolved, [103]);
  const reordered = observation({snapshot: NEW, members: [members[0], members[2], members[1], ...members.slice(3)], returned: [101, 102]});
  assert.equal(relationStatus(merge(evidence, reordered)).status, 'conflict');
});

test('relation properties: legacy accepted boundary remains exact through pending restore, discard and commit', () => {
  let table = empty();
  const legacy = result(); legacy.routes = legacy.routes.map(({membership, ...view}) => view);
  addResult(table, legacy, 'A'); commitStage(table, 'A'); table = restore(table);
  const before = writeTable(table), beforeTiles = bytes(table), latest = result({snapshot: NEW, version: 2, members: [member(102)], returned: [102], tags: {name: 'Current line'}});
  addResult(table, latest, 'B'); table = restore(table);
  assert.deepEqual(wayRoutes(table.ways.get(102), table.routes), []);
  assert.deepEqual(bytes(table), beforeTiles);
  assert.equal(routeView(table.routes.get('r1')).label, 'Line 1');
  discardStage(table, 'B'); assert.equal(writeTable(table), before);
  addResult(table, latest, 'B'); commitStage(table, 'B'); table = restore(table);
  assert.deepEqual(wayRoutes(table.ways.get(101), table.routes), []);
  assert.deepEqual(wayRoutes(table.ways.get(102), table.routes), ['r1']);
  assert.equal(routeView(table.routes.get('r1')).label, 'Current line');
});

test('relation properties: source references stay bounded and stable under replay and regrouping', () => {
  const inputs = Array.from({length: 30}, (_, i) => observation({source: {endpoint: `https://source-${i}.example`, acquired: NEW, query: `query-${i}`}}));
  const expected = merge(...inputs);
  assert.equal(expected.sources.length, 8);
  assert.deepEqual(merge(...inputs.toReversed()), expected);
  assert.deepEqual(merge(merge(...inputs.slice(0, 10)), merge(...inputs.slice(10))), expected);
  assert.deepEqual(merge(expected, ...inputs), expected);
  const unknown = inputs.map((_, i) => observation({version: null, source: {query: `unknown-${i}`}}));
  assert.equal(merge(expected, ...unknown).ignoredUnverified.length, 8);
  assert.deepEqual(merge(expected, ...unknown), merge(merge(...unknown.toReversed()), expected));
});

test('relation properties: cached status and eligibility follow new immutable evidence frontiers', () => {
  const first = observation(), route = {key: 'r1', stages: {}, next: {}, evidence: first};
  assert.equal(relationStatus(first).status, 'complete'); assert.equal(relationAllows(route, 101), true);
  const conflict = merge(first, observation({tags: {name: 'Conflict'}})); route.evidence = conflict;
  assert.equal(relationAllows(route, 101), false);
  const recovered = merge(conflict, observation({snapshot: NEW, version: 2, members: [member(102)], returned: [102]})); route.evidence = recovered;
  assert.equal(relationStatus(recovered).status, 'complete');
  assert.equal(relationAllows(route, 101), false); assert.equal(relationAllows(route, 102), true);
  assert.equal(relationAllows({...route, evidence: first}, 101), true, 'new evidence never mutates old cached eligibility');
});

test('relation properties: retiring legacy stages cannot promote interrupted pending declarations', () => {
  let table = empty();
  const legacy = result(); legacy.routes = legacy.routes.map(({membership, ...view}) => view);
  addResult(table, legacy, 'europe-a'); commitStage(table, 'europe-a'); table = restore(table);
  const expectedTiles = bytes(table);
  addResult(table, result({snapshot: NEW, version: 2, members: [member(102)], returned: [102], tags: {name: 'Interrupted line'}}), 'europe-a');
  const state = {downloadStages: 2, stages: {'europe-a': {completed: OLD}}};
  assert.deepEqual(bytes(table), expectedTiles);
  migrateServiceDownloads(state, table); table = restore(table);
  assert.deepEqual(bytes(table), expectedTiles, 'migration retains accepted legacy geometry and declaration');
  assert.equal(routeView(table.routes.get('r1')).label, 'Line 1');
  assert.deepEqual(wayRoutes(table.ways.get(102), table.routes), []);
});

test('relation properties: source-free legacy markers retain reducer grouping invariance', () => {
  const latest = observation({snapshot: NEW, version: 2}), earlier = observation();
  const legacy = legacyRelation(earlier.view, [101]);
  assert.deepEqual(merge(merge(latest, earlier), legacy), merge(latest, merge(earlier, legacy)));
  assert.deepEqual(merge(latest, legacy), merge(legacy, latest));
});

test('relation properties: cached pending frontiers change after discard and stage acceptance', () => {
  const table = empty(), first = result({members: [member(101), member(102)], returned: [101]}), second = result({members: [member(101), member(102)], returned: [102]});
  addResult(table, first, 'A'); addResult(table, second, 'B');
  const route = table.routes.get('r1');
  assert.equal(relationAllows(route, 101), true); assert.equal(relationAllows(route, 102), true);
  discardStage(table, 'B');
  assert.equal(table.routes.get('r1'), route, 'stage settlement mutates the same route wrapper');
  assert.equal(relationAllows(route, 101), true); assert.equal(relationAllows(route, 102), false);
  commitStage(table, 'A');
  assert.equal(relationAllows(route, 101), true); assert.equal(relationAllows(route, 102), false);
  addResult(table, second, 'B');
  assert.equal(relationAllows(table.routes.get('r1'), 102), false, 'accepted frontier suppresses pending membership');
  commitStage(table, 'B');
  assert.equal(relationAllows(table.routes.get('r1'), 101), true); assert.equal(relationAllows(table.routes.get('r1'), 102), true);
});
