import test from 'node:test';
import assert from 'node:assert/strict';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {addResult, commitStage, toTable, buildTiles, readTable, serviceRoutes, writeTable, LAYER} from '../scripts/service-routes.mjs';
import {serviceProvenanceFixture} from '../scripts/service-provenance-fixture.mjs';

const decode = tiles => [...tiles].filter(([key]) => key.startsWith('12/')).flatMap(([key, bytes]) => {
  const [z, x, y] = key.split('/').map(Number), layer = new VectorTile(new Pbf(bytes)).layers[LAYER];
  return Array.from({length: layer.length}, (_, i) => layer.feature(i).toGeoJSON(x, y, z));
});
const variants = features => [...new Set(features.map(f => JSON.stringify({id: f.properties.id,
  group: JSON.parse(f.properties.group_relation_ids), segment: JSON.parse(f.properties.segment_relation_ids),
  n: f.properties.n, i: f.properties.i})))].sort();

test('service provenance: sorted, deduplicated group IDs retain directions and branch without unrelated services', () => {
  for (const reverse of [false, true]) {
    const table = readTable(writeTable(serviceProvenanceFixture({reverse}))), grouped = serviceRoutes(table);
    assert.deepEqual(grouped.get('r10').relations, [10, 20, 30]);
    assert.equal(grouped.get('r20'), grouped.get('r10'));
    assert.equal(grouped.get('r30'), grouped.get('r10'));
    assert.equal(grouped.get('r30').relation, 10, 'canonical display identity is preserved');
    assert.deepEqual(grouped.get('r40').relations, [40], 'shared track is not identity');
    assert.deepEqual(grouped.get('r50').relations, [50], 'same tags in a different place stay apart');
    assert.deepEqual(grouped.get('r60').relations, [60], 'different service kind stays apart');
    assert.equal(table.routes.get('r10').relations, undefined, 'group projection does not mutate source records');
  }
});

test('service provenance: MVT round-trip keeps segment contributors distinct through line joining and tile clipping', () => {
  const features = decode(buildTiles(serviceProvenanceFixture())), a = features.filter(f => f.properties.id === 'relation-10');
  assert.ok(a.length);
  assert.ok(a.every(f => f.properties.group_relation_ids === '[10,20,30]'));
  assert.deepEqual([...new Set(a.map(f => f.properties.segment_relation_ids))].sort(), ['[10,20,30]', '[10]', '[20]', '[30]'].sort());
  for (const feature of features) {
    const p = feature.properties, group = JSON.parse(p.group_relation_ids), segment = JSON.parse(p.segment_relation_ids);
    assert.ok(segment.every(id => group.includes(id)), 'a contributor belongs to this service');
    if (p.id !== 'relation-10') assert.equal(p.group_relation_ids, p.segment_relation_ids);
    if (p.segment_relation_ids === '[10,20,30]') assert.equal(p.n, 3, 'directions and branch occupy one display slot beside B and tram');
    assert.equal(p.frequency_am, undefined, 'relation multiplicity never invents frequency');
  }
  assert.deepEqual(variants(features), variants(decode(buildTiles(readTable(writeTable(serviceProvenanceFixture({reverse: true})))))));
});

test('service provenance: rejected or withdrawn memberships never become segment contributors', () => {
  const table = serviceProvenanceFixture();
  // A source-stage row that names an absent relation cannot acquire identity.
  table.ways.get(1).routes.A.push('r999');
  // Remove the relation entirely, as a committed withdrawal does.
  table.routes.delete('r20');
  const features = decode(buildTiles(table));
  const a = features.filter(f => f.properties.id === 'relation-10');
  assert.ok(a.length);
  assert.ok(a.every(f => f.properties.group_relation_ids === '[10,30]'));
  assert.ok(features.every(f => !JSON.parse(f.properties.segment_relation_ids).some(id => [20, 999].includes(id))));
});

test('service provenance: source identity/tag resolution does not grow with way membership count', () => {
  const resolveCount = count => {
    const table = {routes: new Map(), ways: new Map()};
    const ways = Array.from({length: count}, (_, i) => ({type: 'way', id: i + 1, tags: {railway: 'subway'},
      geometry: [{lon: .005 + i * .0001, lat: .04}, {lon: .0051 + i * .0001, lat: .04}]}));
    addResult(table, toTable({elements: [{type: 'relation', id: 10,
      tags: {type: 'route', route: 'subway', ref: 'A', name: 'A', network: 'Metro'},
      members: ways.map(way => ({type: 'way', ref: way.id, role: ''}))}, ...ways]}), 'A');
    commitStage(table, 'A');
    const evidence = table.routes.get('r10').evidence, tags = evidence.tags;
    let reads = 0;
    Object.defineProperty(evidence, 'tags', {get() { reads++; return tags; }});
    assert.ok(buildTiles(table).size);
    return reads;
  };
  const one = resolveCount(1);
  assert.ok(one > 0, 'instrument the real routeView tag processing');
  assert.equal(resolveCount(100), one, 'one identity resolution per source relation, not per contributed way');
});
