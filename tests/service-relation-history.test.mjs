import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {gzipSync, gunzipSync} from 'node:zlib';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {addResult, buildTiles, commitStage, discardStage, geometrySummary, migrateServiceDownloads, retireServiceEurope, readTable, routeView, stageChange, toTable, writeTable, LAYER} from '../scripts/service-routes.mjs';
import {drawnRelation, observeRelation, reconcileRelations, relationStatus} from '../scripts/service-relations.mjs';
import {stageGeometryHealth} from '../scripts/service-geometry-health.mjs';
import {EUROPE_STAGE_NAMES} from '../scripts/download-stages.mjs';
const OLD = '2026-10-06T00:00:00Z', NEW = '2026-10-07T00:00:00Z';
const empty = () => ({routes: new Map(), ways: new Map()});
const restore = table => readTable(writeTable(table));
const relation = (id, refs, {version = 1, name = `Line ${id}`, role = '', tags = {}, members, timestamp = `2026-10-0${version}T00:00:00Z`} = {}) => ({type: 'relation', id, version, timestamp,
  tags: {type: 'route', route: 'subway', ref: String(id), name, network: 'N', ...tags}, members: members ?? refs.map(ref => ({type: 'way', ref, role}))});
const way = id => ({type: 'way', id, version: 1, timestamp: '2026-10-01T00:00:00Z', tags: {railway: 'subway'}, nodes: [id * 10, id * 10 + 1],
  geometry: [{lon: 139.70, lat: id === 101 ? 35.68 : 35.72}, {lon: 139.74, lat: id === 101 ? 35.68 : 35.72}]});
const response = ({base = OLD, refs = [101], returned = [101], ...options} = {}) => ({osm3s: {timestamp_osm_base: base}, elements: [relation(1, refs, options), relation(2, [101]), ...returned.map(way)]});
const result = options => toTable(response(options));
const old = result(), fresh = result({base: NEW, version: 2, name: 'Current Line 1', refs: [102], returned: [101, 102]});
const accepted = (observations, stage = 'A') => {const table = empty(); for (const observation of observations) addResult(table, observation, stage); commitStage(table, stage); return restore(table);};
const visible = table => visibleTiles(buildTiles(table));
function visibleTiles(tiles) {
  const out = [];
  for (const [key, bytes] of tiles) {
    if (!key.startsWith('12/')) continue;
    const [z, x, y] = key.split('/').map(Number), layer = new VectorTile(new Pbf(bytes)).layers[LAYER];
    for (let i = 0; i < layer.length; i++) {const feature = layer.feature(i); out.push({key, ...Object.fromEntries(Object.entries(feature.properties).filter(([key]) => ['id', 'name', 'n', 'ref', 'colour', 'kind', 'network', 'operator', 'i', 'slot'].includes(key))), coordinates: feature.toGeoJSON(x, y, z).geometry.coordinates});}
  }
  return out.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
const expected = visible(accepted([fresh]));
for (const reverse of [false, true]) test(`relation history: newest reroute and tags win within a pass, order ${reverse}`, () => {
  const table = accepted(reverse ? [fresh, old] : [old, fresh]);
  assert.deepEqual(visible(table), expected);
  assert.equal(routeView(table.routes.get('r1')).label, 'Current Line 1');
  assert.deepEqual([...new Set(expected.map(f => `${f.id},n=${f.n}`))].sort(), ['relation-1,n=1', 'relation-2,n=1']);
});
for (const observationOrder of [['A', 'B'], ['B', 'A']]) for (const commitOrder of [['A', 'B'], ['B', 'A']]) test(`relation history: stage observations ${observationOrder} and commits ${commitOrder}`, () => {
  let table = empty();
  for (const stage of observationOrder) {addResult(table, stage === 'A' ? old : fresh, stage); table = restore(table);}
  for (const stage of commitOrder) {commitStage(table, stage); table = restore(table);}
  assert.deepEqual(visible(table), expected);
});
test('relation history: interleaved committed stages cannot restore superseded memberships', () => {
  for (const observations of [[['A', old], ['B', fresh]], [['B', fresh], ['A', old]]]) {
    const table = empty(); for (const [stage, observation] of observations) {addResult(table, observation, stage); commitStage(table, stage);}
    assert.deepEqual(visible(restore(table)), expected);
  }
});
test('relation history: pending work preserves accepted labels/memberships and discard bytes', () => {
  const table = accepted([old]), before = writeTable(table), beforeVisible = visible(table);
  addResult(table, fresh, 'B');
  assert.deepEqual(visible(table), beforeVisible);
  assert.deepEqual(geometrySummary(table).relations.relationsWithPendingEvidence, [1, 2]);
  discardStage(table, 'B'); assert.equal(writeTable(table), before);
  addResult(table, fresh, 'A'); commitStage(table, 'A'); assert.deepEqual(visible(restore(table)), expected);
});
test('relation history: interrupted same-stage resumes resolve all observations', () => {
  let table = empty(); addResult(table, old, 'A'); table = restore(table); addResult(table, fresh, 'A'); table = restore(table); commitStage(table, 'A');
  assert.deepEqual(visible(restore(table)), expected);
});
test('relation history: zero ID loss does not conceal the reroute or label change', () => {
  const table = accepted([old]); addResult(table, old, 'A'); addResult(table, fresh, 'A'); assert.equal(stageChange(table, 'A').stale, 0); commitStage(table, 'A');
  assert.deepEqual(visible(table), expected);
});
for (const [label, options] of [['empty', {refs: []}], ['platform', {role: 'platform'}], ['stop', {role: 'stop'}], ['unlabeled', {tags: {name: '', ref: ''}}]]) test(`relation history: newest ${label} declaration removes old drawable membership`, () => {
  const current = result({base: NEW, version: 2, ...options}), table = accepted([old, current]);
  assert.deepEqual(visible(table), visible(accepted([current])));
  assert.ok(visible(table).every(feature => feature.id === 'relation-2'));
});
test('relation history: a shorter relation replaces a longer one without longest-list heuristics', () => {
  const long = result({refs: [101, 102], returned: [101, 102]}), short = result({base: NEW, version: 2, refs: [102], returned: [101, 102]});
  for (const order of [[long, short], [short, long]]) assert.deepEqual(visible(accepted(order)), visible(accepted([short])));
});
for (const [label, options] of [['version', {version: 2}], ['tags', {name: 'Different'}], ['members', {refs: [102], returned: [101, 102]}], ['order', {members: [{type: 'node', ref: 1, role: 'stop'}, {type: 'way', ref: 101, role: ''}]}]]) test(`relation history: contradictory same-snapshot ${label} is quarantined`, () => {
  for (const order of [[old, result(options)], [result(options), old]]) {
    const table = accepted(order); assert.deepEqual(geometrySummary(table).relations.relationsWithConflicts, [1]);
    assert.ok(visible(table).every(feature => feature.id === 'relation-2'));
    assert.equal(stageGeometryHealth(table, 'A').status, 'incomplete');
  }
});
test('relation history: duplicate declarations inside a response cannot overwrite conflicts', () => {
  const json = response(); json.elements.push(relation(1, [102]));
  for (const elements of [json.elements, [...json.elements].reverse()]) assert.deepEqual(geometrySummary(accepted([toTable({...json, elements})])).relations.relationsWithConflicts, [1]);
});
test('relation history: source time outranks acquisition order and same-revision edits remain conflicts', () => {
  const a = toTable(response(), {acquired: NEW}), b = toTable(response({base: NEW, version: 2, refs: [102], returned: [101, 102]}), {acquired: OLD});
  assert.deepEqual(visible(accepted([a, b])), visible(accepted([b])));
  const table = accepted([old, result({base: NEW, refs: [102], returned: [101, 102]})]);
  assert.deepEqual(geometrySummary(table).relations.relationsWithConflicts, [1]);
});
test('relation history: a newer source revision regression cannot roll back accepted routes', () => {
  const newer = result({base: NEW, version: 1}), older = result({version: 2});
  assert.deepEqual(geometrySummary(accepted([newer, older])).relations.relationsWithConflicts, [1]);
});
test('relation history: complete unreturned members remain unresolved even with another service geometry', () => {
  const table = accepted([old]);
  const json = response({base: NEW, version: 2, refs: [101, 102], returned: []});
  addResult(table, toTable(json), 'B'); commitStage(table, 'B');
  const summary = geometrySummary(table).relations;
  assert.deepEqual(summary.details.find(detail => detail.relation === 1).unresolved, [101, 102]);
  assert.ok(visible(table).every(feature => feature.id !== 'relation-1'));
  assert.equal(stageGeometryHealth(table, 'B').status, 'incomplete');
});
test('relation history: same-snapshot agreeing declarations can combine positive returned eligibility', () => {
  const a = result({refs: [101, 102], returned: [101]}), b = result({refs: [101, 102], returned: [102]});
  assert.deepEqual(visible(accepted([a, b])), visible(accepted([result({refs: [101, 102], returned: [101, 102]})])));
});
test('relation history: malformed, absent and explicitly clipped members never certify deletion', () => {
  for (const members of [undefined, null, [{type: 'way', geometry: []}], [{type: 'way', ref: '101'}], [{type: 'way', ref: 101}], [{type: 'way', ref: 101, role: null}]]) {
    const json = response({base: NEW, version: 2}); json.elements[0].members = members;
    const observation = toTable(json), table = accepted([old, observation]);
    assert.equal(observation.routes[0].membership.snapshot, null);
    assert.equal(routeView(table.routes.get('r1')).label, 'Line 1');
    assert.ok(geometrySummary(table).relations.details.find(detail => detail.relation === 1).reasons.includes('ignored_unverified_relation'));
  }
  const partial = toTable(response({base: NEW, version: 2, refs: []}), {relationMembersComplete: false});
  assert.equal(partial.routes[0].membership.snapshot, null);
});
test('relation history: full ordered roles, duplicate refs, nested members and relevant tags persist without contributor data', () => {
  const members = [{type: 'node', ref: 5, role: 'stop'}, {type: 'way', ref: 101, role: 'forward'}, {type: 'way', ref: 101, role: 'backward'}, {type: 'relation', ref: 8, role: ''}];
  const json = response({members, tags: {'name:ja': '線', 'unrelated': 'omit'}}); Object.assign(json.elements[0], {user: 'secret', uid: 2, changeset: 3});
  const table = accepted([toTable(json, {stage: 'A', query: 'known-query'})]), evidence = drawnRelation(table.routes.get('r1'));
  assert.deepEqual(evidence.members, members); assert.equal(evidence.tags['name:ja'], '線'); assert.equal(evidence.tags.unrelated, undefined);
  assert.doesNotMatch(writeTable(table), /"(?:user|uid|changeset)"\s*:/); assert.equal(evidence.sources[0].query, 'known-query');
});
test('relation history: legacy storage stays unknown until verified declarations replace it', () => {
  const table = accepted([old]); for (const route of table.routes.values()) {delete route.evidence; for (const part of Object.values(route.stages)) delete part.membership;}
  const before = visible(table); assert.deepEqual(geometrySummary(restore(table)).relations.relationsWithUnknownProvenance, [1, 2]);
  addResult(table, fresh, 'B'); assert.deepEqual(visible(table), before); commitStage(table, 'B'); assert.deepEqual(visible(restore(table)), expected);
});
test('relation history: deleting newest owning stage never revives superseded older membership', () => {
  const table = accepted([old]); addResult(table, fresh, 'B'); commitStage(table, 'B'); commitStage(table, 'B');
  assert.equal(routeView(restore(table).routes.get('r1')).label, 'Current Line 1');
  assert.ok(visible(table).every(feature => feature.id !== 'relation-1'));
});
test('relation history: retired Europe migration and retirement retain the accepted frontier', () => {
  let table = accepted([old], 'europe-a'); addResult(table, fresh, 'europe-g'); commitStage(table, 'europe-g');
  const state = {downloadStages: 2, stages: {'europe-a': {completed: OLD}, 'europe-g': {completed: NEW}}};
  migrateServiceDownloads(state, table); table = restore(table); assert.deepEqual(visible(table), expected);
  addResult(table, old, 'europe-f'); commitStage(table, 'europe-f');
  const after = new Date(Date.parse(state.legacyEurope.migrated) + 1000).toISOString();
  for (const name of [...EUROPE_STAGE_NAMES, 'asia', 'world']) state.stages[name] = {started: after, completed: after};
  retireServiceEurope(state, table); assert.equal(state.legacyEurope, undefined);
  assert.equal(routeView(table.routes.get('r1')).label, 'Current Line 1');
  assert.ok(visible(table).every(feature => feature.id !== 'relation-1'));
});
test('relation history: reconciliation is commutative, associative, idempotent and bounded', () => {
  const inputs = [old, fresh, result({base: NEW, version: 2, name: 'Conflict', refs: [102], returned: [102]}), toTable({elements: response().elements})].map(r => r.routes[0].membership);
  const merge = (...items) => items.reduce(reconcileRelations, null);
  for (const a of inputs) for (const b of inputs) for (const c of inputs) {
    assert.deepEqual(merge(a, b), merge(b, a)); assert.deepEqual(merge(a, a), a);
    assert.deepEqual(merge(merge(a, b), c), merge(a, merge(b, c)));
  }
  const json = response({refs: Array.from({length: 60}, (_, i) => 1000 + i), returned: []});
  const detail = geometrySummary(accepted([toTable(json)])).relations.details.find(detail => detail.relation === 1);
  assert.equal(detail.unresolved.length, 20); assert.equal(detail.unresolvedCount, 60);
});
test('relation history: production headway rebuild publishes the same memberships and diagnostics', async () => {
  const table = accepted([old, fresh]), root = await mkdtemp(join(tmpdir(), 'atlas-relation-history-'));
  try {
    await writeFile(join(root, 'service-routes.ndjson.gz'), gzipSync(writeTable(table)));
    const run = spawnSync(process.execPath, ['scripts/rebuild-service-frequency.mjs', root, join(root, 'credits.html'), '--fixtures'], {encoding: 'utf8'});
    assert.equal(run.status, 0, run.stderr);
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')), actual = new Map();
    for (const key of index.tiles) actual.set(key, gunzipSync(await readFile(join(root, `${key}.pbf.gz`))));
    assert.deepEqual(visibleTiles(actual), expected);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'frequency-manifest.json'), 'utf8')).geometry, geometrySummary(table));
    assert.deepEqual(visible(table), expected);
  } finally {await rm(root, {recursive: true, force: true});}
});

test('relation history: retained dependencies missing after stage retirement are partial coverage, not unresolved eligibility', async () => {
  const {refreshRelationDependencyHealth} = await import('../scripts/service-geometry-health.mjs');
  let table = accepted([old]); addResult(table, fresh, 'B'); commitStage(table, 'B'); commitStage(table, 'B'); table = restore(table);
  assert.deepEqual(geometrySummary(table).routeRelationsWithoutGeometry, [1]);
  const relations = geometrySummary(table).relations;
  assert.deepEqual(relations.relationsWithUnavailableMemberships, [1]);
  assert.deepEqual(relations.relationsWithUnresolvedMembers, []);
  assert.deepEqual(relations.details.find(detail => detail.relation === 1).unavailableMemberships, [102]);
  assert.equal(relationStatus(drawnRelation(table.routes.get('r1'))).status, 'complete', 'declaration itself is complete');
  const health = stageGeometryHealth(table, 'A'); assert.equal(health.status, 'incomplete'); assert.deepEqual(health.unavailableRelations, [1]);
  const state = {stages: {A: {geometry: {status: 'complete', attempts: 4, retry: null, lastFailure: null}}, B: {geometry: {status: 'complete'}}}};
  refreshRelationDependencyHealth(state, table, NEW); assert.equal(state.stages.A.geometry.status, 'incomplete');
  assert.equal(state.stages.A.geometry.attempts, 4); assert.equal(state.stages.A.geometry.retry, 'next-stage-refresh');
  const before = structuredClone(state); refreshRelationDependencyHealth(state, table, NEW); assert.deepEqual(state, before);
  addResult(table, fresh, 'C'); commitStage(table, 'C'); refreshRelationDependencyHealth(state, table, NEW);
  assert.equal(state.stages.A.geometry.status, 'complete'); assert.equal(state.stages.A.geometry.dependencyGap, undefined);
  assert.equal(state.stages.A.geometry.attempts, 4); assert.deepEqual(visible(table), expected);
});

test('relation history: empty and inactive declarations do not require missing display memberships', () => {
  for (const options of [{refs: []}, {tags: {name: '', ref: ''}}]) {
    const table = accepted([result({base: NEW, version: 2, ...options})]);
    assert.deepEqual(geometrySummary(table).relations.relationsWithUnavailableMemberships, []);
    assert.equal(stageGeometryHealth(table, 'A').relationCounts.complete, 2);
  }
});

test('relation history: recovering a dependency cannot erase other current repair reasons', async () => {
  const {refreshRelationDependencyHealth} = await import('../scripts/service-geometry-health.mjs');
  const table = accepted([old]); addResult(table, fresh, 'B'); commitStage(table, 'B'); commitStage(table, 'B');
  const state = {stages: {A: {geometry: {status: 'complete', attempts: 4, retry: null, lastFailure: null, observed: {status: 'complete'}}}}};
  refreshRelationDependencyHealth(state, table, NEW);
  addResult(table, fresh, 'C'); commitStage(table, 'C');
  const conflict = response({base: NEW, version: 2, name: 'Current Line 1', refs: [102], returned: [101, 102]});
  conflict.elements.find(element => element.type === 'way' && element.id === 101).geometry.forEach(point => {point.lat += 0.01;});
  addResult(table, toTable(conflict), 'D'); commitStage(table, 'D'); refreshRelationDependencyHealth(state, table, NEW);
  const health = state.stages.A.geometry; assert.equal(health.dependencyGap, undefined);
  assert.equal(health.status, 'incomplete'); assert.equal(health.retry, 'next-stage-refresh');
  assert.equal(health.lastFailure, 'unresolved-source-geometry'); assert.equal(health.counts.conflict, 1);
  assert.equal(health.attempts, 4); assert.deepEqual(health.observed, {status: 'complete'});
});
