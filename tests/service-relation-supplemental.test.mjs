import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync, gunzipSync} from 'node:zlib';
import {addResult, buildTiles, commitStage, discardStage, geometrySummary, migrateServiceDownloads, readTable,
  retireServiceEurope, routeView, serviceRoutes, toTable, wayRoutes, writeTable} from '../scripts/service-routes.mjs';
import {drawnRelation, reconcileRelations, relationStatus} from '../scripts/service-relations.mjs';
import {EUROPE_STAGE_NAMES} from '../scripts/download-stages.mjs';
import {stageGeometryHealth} from '../scripts/service-geometry-health.mjs';

const OLD = '2026-10-06T00:00:00Z', NEW = '2026-10-07T00:00:00Z';
const hash = value => createHash('sha256').update(value).digest('hex');
const empty = () => ({routes: new Map(), ways: new Map()});
const restore = table => readTable(writeTable(table));
const merge = (...items) => items.reduce(reconcileRelations, null);
const withoutSupplemental = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'supplemental' ? undefined : item));
function result({snapshot = OLD, version = 1, tags = {}, source = {}} = {}) {
  return toTable({osm3s: {timestamp_osm_base: snapshot}, elements: [1, 2].map(id => ({type: 'relation', id, version,
    timestamp: `2026-10-0${version}T00:00:00Z`, tags: {type: 'route', route: 'subway', ref: '1', name: 'One', network: 'Synthetic', brand: 'Brand', from: 'A', to: 'B', ...tags},
    members: [{type: 'way', ref: 10, role: ''}]})).concat([{type: 'way', id: 10, version: 1, timestamp: '2026-10-01T00:00:00Z', nodes: [1, 2],
    geometry: [{lon: 139.70, lat: 35.68}, {lon: 139.74, lat: 35.69}]}])}, source);
}
const observation = options => result(options).routes[0].membership;
const accepted = inputs => {const table = empty(); for (const input of inputs) addResult(table, input, 'A'); commitStage(table, 'A'); return restore(table);};
const evidence = table => drawnRelation(table.routes.get('r1'));
const variants = item => item.supplemental.revisions.find(revision => revision.declaration === item.revisionKeys[0]).variants;
const tileBytes = table => [...buildTiles(table)].map(([key, value]) => [key, Buffer.from(value).toString('base64')]);
function outputs(table) {
  return {views: [...table.routes.values()].map(routeView), groups: [...serviceRoutes(table)], memberships: [...table.ways.values()].map(way => wayRoutes(way, table.routes)),
    diagnostics: geometrySummary(table), health: stageGeometryHealth(table, 'A'), tiles: tileBytes(table)};
}

test('supplemental relation: authentic archived fixture retains exact context, revision and source without changing deployed core hashes', async () => {
  const text = await readFile(new URL('./fixtures/service-geometry/overpass-meta-relation-10003040.json', import.meta.url), 'utf8');
  assert.equal(hash(text), '75a13a5e7586a2f1f58ee11fd42ef7582cfdde0358d8188b5de8072f5f8215f5');
  const json = JSON.parse(text), source = {endpoint: 'https://overpass-api.de/api/interpreter', query: hash('[out:json][timeout:25];rel(10003040);out meta;')};
  const item = toTable(json, source).routes[0].membership, envelope = item.supplemental, revision = envelope.revisions[0], variant = revision.variants[0];
  assert.deepEqual(variant.tags, {brand: 'Southern', duration: '0:43', from: 'Epsom', interval: '00:30', 'network:wikidata': 'Q26334',
    opening_hours: 'Mo-Fr 05:45-22:45; Sa 06:45-22:45; Su off', 'public_transport:version': '2', to: 'London Bridge'});
  assert.equal(envelope.schema, 1); assert.equal(envelope.fingerprint, hash(JSON.stringify([1, envelope.revisions])));
  assert.equal(revision.relation, 10003040); assert.equal(revision.version, 25); assert.equal(revision.timestamp, '2026-06-12T01:19:51Z');
  assert.equal(revision.declaration, item.revisionKeys[0]); assert.equal(revision.conflict, false);
  assert.deepEqual(variant.sources, [{sourceSnapshot: '2026-10-07T04:09:50Z', ...item.sources[0]}]);
  assert.equal(item.members.length, 115); assert.deepEqual(item.members, json.elements[0].members);
  assert.deepEqual(item.eligible, []); assert.equal(relationStatus(item).status, 'partial');
  assert.equal(item.fingerprint, '1015e1e64da67c9a944018de7774d1acb8c1982b38b4419f41abb5c5d94dc43e');
  assert.equal(item.sources[0].observation, '047ff876ccfd6a3f64bef89c8af258861eebb20c65dc87da8fefe7775cdca4d5');
  assert.deepEqual(item.revisionKeys, ['700d9580e43dae060b8462be930793ccab8ee21b0e719a73b47281b3d2c94435']);
  assert.equal(item.tags.brand, undefined); assert.equal(variant.tags.wheelchair, undefined);
  assert.doesNotMatch(JSON.stringify(item), /"(?:user|uid|changeset)"\s*:/);
});

for (const reverse of [false, true]) for (const separateStages of [false, true]) test(`supplemental relation: old/new same revision survives both orders, stages=${separateStages}, reverse=${reverse}`, () => {
  const rich = result(), old = withoutSupplemental(rich), baseline = outputs(accepted([old]));
  let table = empty(); const inputs = reverse ? [rich, old] : [old, rich];
  for (const [i, input] of inputs.entries()) {addResult(table, input, separateStages ? ['A', 'B'][i] : 'A'); if (separateStages) commitStage(table, ['A', 'B'][i]); table = restore(table);}
  if (!separateStages) commitStage(table, 'A');
  assert.deepEqual(evidence(table).supplemental, rich.routes[0].membership.supplemental);
  assert.deepEqual(withoutSupplemental(evidence(table)), old.routes[0].membership);
  // Stage-health ownership differs with two accepted stages, but its source
  // diagnostics, route identity, grouping and all representative tile bytes do not.
  const actual = outputs(table); assert.deepEqual(actual, baseline);
  addResult(table, rich, 'A'); addResult(table, old, 'A'); commitStage(table, 'A');
  const before = writeTable(table); addResult(table, old, 'A'); addResult(table, rich, 'A'); commitStage(table, 'A');
  assert.equal(writeTable(table), before, 'duplicate replay is byte-stable');
});

test('supplemental relation: newer old-format snapshot cannot erase same-revision context or relabel its source time', () => {
  const rich = observation(), newer = withoutSupplemental(observation({snapshot: NEW}));
  for (const inputs of [[rich, newer], [newer, rich]]) {
    const item = merge(...inputs);
    assert.equal(item.snapshot, NEW); assert.deepEqual(item.supplemental, rich.supplemental);
    assert.equal(variants(item)[0].sources[0].sourceSnapshot, OLD);
    assert.deepEqual(withoutSupplemental(item), newer); assert.equal(relationStatus(item).status, 'complete');
  }
  const observedAgain = merge(rich, observation({snapshot: NEW}));
  assert.deepEqual(variants(observedAgain)[0].sources.map(source => source.sourceSnapshot), [OLD, NEW]);
});

test('supplemental relation: a new revision keeps distinct observed context, never promotes previous tags into it', () => {
  const first = observation(), second = observation({snapshot: NEW, version: 2, tags: {brand: 'New brand', from: 'C'}});
  const item = merge(first, second);
  assert.deepEqual(withoutSupplemental(item), withoutSupplemental(second));
  assert.equal(item.supplemental.revisions.length, 2); assert.equal(variants(item)[0].tags.brand, 'New brand');
  const unobserved = merge(first, withoutSupplemental(second));
  assert.ok(!unobserved.supplemental.revisions.some(revision => revision.declaration === unobserved.revisionKeys[0]));
});

test('supplemental relation: pending restore/discard/commit preserve accepted boundaries and exact bytes', () => {
  let table = accepted([withoutSupplemental(result())]), before = writeTable(table), drawn = tileBytes(table);
  addResult(table, result(), 'A'); table = restore(table);
  assert.equal(evidence(table).supplemental, undefined);
  assert.equal(table.routes.get('r1').next.A.membership.supplemental.schema, 1);
  assert.deepEqual(tileBytes(table), drawn); discardStage(table, 'A'); assert.equal(writeTable(table), before);
  addResult(table, result(), 'A'); commitStage(table, 'A'); table = restore(table);
  assert.equal(variants(evidence(table))[0].tags.brand, 'Brand'); before = writeTable(table);
  addResult(table, result({snapshot: NEW, version: 2, tags: {brand: 'Pending brand'}}), 'B'); table = restore(table);
  assert.equal(variants(evidence(table))[0].tags.brand, 'Brand'); discardStage(table, 'B'); assert.equal(writeTable(table), before);
});

test('supplemental relation: stage migration and retirement retain accepted evidence, not interrupted new tags', () => {
  let table = empty(); addResult(table, result(), 'europe-a'); commitStage(table, 'europe-a');
  const before = evidence(table).supplemental, state = {downloadStages: 2, stages: {'europe-a': {completed: OLD}}};
  addResult(table, result({snapshot: NEW, version: 2, tags: {brand: 'Pending brand'}}), 'europe-a');
  migrateServiceDownloads(state, table); table = restore(table);
  assert.deepEqual(evidence(table).supplemental, before);
  addResult(table, withoutSupplemental(result()), 'europe-f'); commitStage(table, 'europe-f');
  const after = new Date(Date.parse(state.legacyEurope.migrated) + 1000).toISOString();
  for (const name of [...EUROPE_STAGE_NAMES, 'asia', 'world']) state.stages[name] = {started: after, completed: after};
  retireServiceEurope(state, table); table = restore(table);
  assert.equal(state.legacyEurope, undefined); assert.deepEqual(evidence(table).supplemental, before);
});

test('supplemental relation: contradictory context and observed absence stay explicit without fabricating core conflicts', () => {
  const a = result(), b = result({tags: {brand: 'Contradictory brand'}}), absent = result();
  // A new-format observation of absence is different from an old table that
  // never recorded the field. Build it from the source, not by editing a hash.
  const source = {osm3s: {timestamp_osm_base: OLD}, elements: [{type: 'relation', id: 1, version: 1, timestamp: '2026-10-01T00:00:00Z',
    tags: {type: 'route', route: 'subway', ref: '1', name: 'One', network: 'Synthetic', from: 'A', to: 'B'}, members: [{type: 'way', ref: 10, role: ''}]}]};
  absent.routes[0].membership = toTable(source).routes[0].membership;
  for (const inputs of [[a, b], [b, a], [a, absent]]) {
    const table = accepted(inputs), item = evidence(table);
    assert.equal(item.supplemental.revisions[0].conflict, true); assert.equal(variants(item).length, 2);
    assert.equal(item.conflict, false); assert.equal(item.revisionKeys.length, 1); assert.equal(relationStatus(item).status, 'complete');
    assert.deepEqual(outputs(table), outputs(accepted(inputs.map(withoutSupplemental))));
  }
  assert.deepEqual(merge(a.routes[0].membership, b.routes[0].membership), merge(b.routes[0].membership, a.routes[0].membership));
});

test('supplemental relation: bounded revision/variant/source witnesses are replay- and grouping-invariant', () => {
  const inputs = Array.from({length: 90}, (_, i) => observation({version: i % 3 + 1, tags: {brand: `Brand ${i % 5}`}, source: {query: `synthetic-${i}`}}));
  const item = merge(...inputs);
  assert.equal(item.supplemental.revisions.length, 2);
  for (const revision of item.supplemental.revisions) {
    assert.equal(revision.variants.length, 2); assert.equal(revision.conflict, true);
    assert.ok(revision.variants.every(variant => variant.sources.length <= 8));
  }
  assert.deepEqual(merge(...inputs.toReversed()), item);
  assert.deepEqual(merge(merge(...inputs.slice(0, 40)), merge(...inputs.slice(40))), item);
  assert.deepEqual(merge(item, ...inputs), item);
});

test('supplemental relation: unrelated/contributor tags stay omitted, rejected values stay unobserved, and unverified input certifies nothing', () => {
  const item = observation({tags: {unrelated: 'omit', user: 'omit', changeset: 'omit', 'gtfs:route_id': 'R1'}});
  assert.equal(variants(item)[0].tags['gtfs:route_id'], 'R1'); assert.equal(item.view.timetable.routeIds[0], 'R1', 'existing view behavior is not changed');
  assert.doesNotMatch(JSON.stringify(item), /"(?:unrelated|user|uid|changeset)"\s*:/);
  for (const tags of [{via: 'x'.repeat(1025)}, {interval: 30}]) {
    const rejected = observation({tags}); assert.equal(rejected.supplemental, undefined);
    assert.deepEqual(merge(observation(), rejected).supplemental, observation().supplemental);
  }
  assert.equal(observation({snapshot: null}).supplemental, undefined);
});

test('supplemental relation: production headway rebuild leaves source archive, tile bytes, matching and diagnostics unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-supplemental-rebuild-'));
  try {
    const tables = [accepted([withoutSupplemental(result())]), accepted([result()])], runs = [];
    for (const [i, table] of tables.entries()) {
      const directory = join(root, String(i)); await mkdir(directory);
      const raw = gzipSync(writeTable(table)); await writeFile(join(directory, 'service-routes.ndjson.gz'), raw);
      const run = spawnSync(process.execPath, ['scripts/rebuild-service-frequency.mjs', directory, join(directory, 'credits.html'), '--fixtures'], {encoding: 'utf8'});
      assert.equal(run.status, 0, run.stderr); assert.deepEqual(await readFile(join(directory, 'service-routes.ndjson.gz')), raw);
      const index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8')), tiles = [];
      for (const key of index.tiles) tiles.push([key, gunzipSync(await readFile(join(directory, `${key}.pbf.gz`))).toString('base64')]);
      const manifest = JSON.parse(await readFile(join(directory, 'frequency-manifest.json'), 'utf8'));
      runs.push({tiles, geometry: manifest.geometry, matching: manifest.matching});
    }
    assert.ok(runs[0].tiles.length > 0); assert.deepEqual(runs[0], runs[1]);
  } finally {await rm(root, {recursive: true, force: true});}
});
