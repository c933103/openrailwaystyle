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
for(const scenario of ['reroute','inactive','pending'])test(`relation history: production headway rebuild publishes the same memberships and diagnostics (${scenario})`, async () => {
  const table = scenario==='reroute'?accepted([old,fresh]):scenario==='inactive'?accepted([old,result({base:NEW,version:2,tags:{name:'',ref:''}})]):empty();
  if(scenario==='pending')addResult(table,old,'A');
  const expectedTiles=visible(table),root = await mkdtemp(join(tmpdir(), 'atlas-relation-history-'));
  try {
    await writeFile(join(root, 'service-routes.ndjson.gz'), gzipSync(writeTable(table)));
    const run = spawnSync(process.execPath, ['scripts/rebuild-service-frequency.mjs', root, join(root, 'credits.html'), '--fixtures'], {encoding: 'utf8'});
    assert.equal(run.status, 0, run.stderr);
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')), actual = new Map();
    for (const key of index.tiles) actual.set(key, gunzipSync(await readFile(join(root, `${key}.pbf.gz`))));
    assert.deepEqual(visibleTiles(actual), expectedTiles);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'frequency-manifest.json'), 'utf8')).geometry, geometrySummary(table));
    assert.deepEqual(visible(table), expectedTiles);
    if(scenario==='pending')assert.deepEqual(geometrySummary(table).relations.relationsWithPendingEvidence,[1,2]);
    if(scenario==='inactive'){assert.deepEqual(geometrySummary(table).routeRelationsWithoutGeometry,[]);assert.ok(expectedTiles.every(f=>f.id==='relation-2'&&f.n===1));}
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
    assert.deepEqual(geometrySummary(table).routeRelationsWithoutGeometry,options.refs ? [1] : [],'active empty routes remain gaps; inactive tombstones do not');
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

const single = options => {const json=response(options);json.elements=json.elements.filter(e=>e.type!=='relation'||e.id===1);return toTable(json);};
for(const settle of [commitStage,discardStage])test(`pending relation: initial complete evidence survives resume until ${settle.name}`,()=>{
  const table=empty();addResult(table,single(),'A');const bytes=writeTable(table),tiles=[...buildTiles(table)];
  for(const current of [table,restore(table)]){
    const summary=geometrySummary(current).relations;
    assert.deepEqual(summary.relationsWithPendingEvidence,[1]);assert.equal(summary.details[0].pending.status,'complete');
    assert.equal(summary.details[0].retainedAccepted,false);assert.equal(writeTable(current),bytes);assert.deepEqual([...buildTiles(current)],tiles);
  }
  settle(table,'A');assert.deepEqual(geometrySummary(restore(table)).relations.relationsWithPendingEvidence,[]);
  if(settle===commitStage)assert.deepEqual([...buildTiles(table)],tiles);else assert.equal(table.routes.size,0);
});
for(const settle of [commitStage,discardStage])test(`pending relation: identical accepted replay stays pending until ${settle.name}`,()=>{
  let table=accepted([single()]);const view=routeView(table.routes.get('r1')),tiles=[...buildTiles(table)];
  addResult(table,single(),'B');table=restore(table);
  assert.deepEqual(table.routes.get('r1').next.B.membership,drawnRelation(table.routes.get('r1')),'equality precondition');
  const summary=geometrySummary(table).relations;assert.deepEqual(summary.relationsWithPendingEvidence,[1]);assert.equal(summary.details[0].retainedAccepted,true);
  assert.deepEqual(routeView(table.routes.get('r1')),view);assert.deepEqual([...buildTiles(table)],tiles);
  settle(table,'B');assert.deepEqual(geometrySummary(restore(table)).relations.relationsWithPendingEvidence,[]);assert.deepEqual([...buildTiles(table)],tiles);
});
test('pending relation: two stages and duplicate replay count one ID until both settle',()=>{
  for(const stages of [['A','B'],['B','A']]){
    let table=empty();for(const stage of stages){addResult(table,single(),stage);addResult(table,single(),stage);table=restore(table);}
    assert.deepEqual(geometrySummary(table).relations.relationsWithPendingEvidence,[1]);
    commitStage(table,stages[0]);assert.deepEqual(geometrySummary(restore(table)).relations.relationsWithPendingEvidence,[1]);
    discardStage(table,stages[1]);assert.deepEqual(geometrySummary(restore(table)).relations.relationsWithPendingEvidence,[]);
  }
});
for(const [label,options,status] of [['partial',{refs:[101,102]},'partial'],['inactive',{tags:{name:'',ref:''}},'complete']])test(`pending relation: ${label} evidence retains its pending status`,()=>{
  const table=empty();addResult(table,single(options),'A');const summary=geometrySummary(restore(table)).relations;
  assert.deepEqual(summary.relationsWithPendingEvidence,[1]);assert.equal(summary.details[0].pending.status,status);assert.equal(summary.details[0].retainedAccepted,false);
});
test('pending relation: empty next and legacy parts without membership add no pending provenance',()=>{
  const table=accepted([single()]);assert.deepEqual(geometrySummary(table).relations.relationsWithPendingEvidence,[]);
  table.routes.get('r1').next.B={...routeView(table.routes.get('r1'))};
  assert.deepEqual(geometrySummary(table).relations.relationsWithPendingEvidence,[]);
});
for(const inactiveFirst of [false,true])test(`inactive declaration: accepted view controls activation before settlement (${inactiveFirst})`,()=>{
  const older=result(inactiveFirst?{tags:{name:'',ref:''}}:{}),newer=result({base:NEW,version:2,...(!inactiveFirst?{tags:{name:'',ref:''}}:{})});
  for(const settle of [commitStage,discardStage]){
    const table=accepted([older]),before=visible(table);addResult(table,newer,'B');
    assert.equal(routeView(table.routes.get('r1')).active===false,inactiveFirst);assert.deepEqual(visible(restore(table)),before);
    settle(table,'B');assert.equal(routeView(restore(table).routes.get('r1')).active===false,settle===commitStage?!inactiveFirst:inactiveFirst);
    assert.deepEqual(geometrySummary(table).routeRelationsWithoutGeometry,[]);
    assert.equal(table.routes.size,2);assert.equal(stageGeometryHealth(table,'A').relationCounts.complete,2);
  }
});
test('inactive declaration: older replay and removal of newer owning stage cannot revive tombstone',()=>{
  let table=accepted([old]);addResult(table,result({base:NEW,version:2,tags:{name:'',ref:''}}),'B');commitStage(table,'B');
  for(const action of [()=>addResult(table,old,'A'),()=>commitStage(table,'A'),()=>commitStage(table,'B')]){
    action();table=restore(table);assert.equal(routeView(table.routes.get('r1')).active,false);
    assert.deepEqual(geometrySummary(table).routeRelationsWithoutGeometry,[]);
    assert.ok(visible(table).every(f=>f.id==='relation-2'&&f.name==='Line 2'&&f.n===1));
    assert.equal(table.routes.size,2);
  }
});

test('pending relation: sorted IDs and bounded details retain partial samples without inventing acceptance',()=>{
  const table=empty();
  for(let id=102;id>0;id--)addResult(table,toTable({osm3s:{timestamp_osm_base:OLD},elements:[relation(id,Array.from({length:60},(_,i)=>i+1000))]}),'A');
  const summary=geometrySummary(restore(table)).relations;
  assert.deepEqual(summary.relationsWithPendingEvidence,Array.from({length:102},(_,i)=>i+1));assert.equal(summary.details.length,100);
  for(const detail of summary.details){assert.equal(detail.pending.status,'partial');assert.equal(detail.pending.unresolved.length,20);assert.equal(detail.pending.unresolvedCount,60);assert.equal(detail.retainedAccepted,false);}
});
test('inactive declaration: shared active service retains exact decoded properties, picking identity and bundle slot',async()=>{
  const inactive=accepted([old,result({base:NEW,version:2,tags:{name:'',ref:''}})]);
  const onlySecond=response({base:NEW});onlySecond.elements=onlySecond.elements.filter(e=>e.type!=='relation'||e.id===2);
  const expected=accepted([toTable(onlySecond)]);
  assert.deepEqual(visible(inactive),visible(expected));assert.deepEqual([...buildTiles(inactive)],[...buildTiles(expected)]);
  assert.equal(inactive.routes.size,2);assert.equal(expected.routes.size,1);
  const headways=JSON.parse(await readFile('styles/service-headways.json','utf8'));
  const actualFrequency=buildTiles(inactive,{headways});assert.deepEqual([...actualFrequency],[...buildTiles(expected,{headways})]);
  const tile=new VectorTile(new Pbf(actualFrequency.values().next().value)).layers[LAYER];
  assert.equal(tile.feature(0).properties.frequency_width_am,3.5,'unmatched active service keeps the unknown-frequency width');
});
