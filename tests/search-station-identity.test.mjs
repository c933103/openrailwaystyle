import test from 'node:test';
import assert from 'node:assert/strict';
import {searchResults, railwaySearchRows, tileStations} from '../styles/map-model.mjs';

const station = (id, name = 'Fixture Central', extra = {}) =>
  ({osm_id:id, name, railway:'station', latitude:25.05, longitude:121.61, ...extra});
const place = (id, opts = {}) =>
  ({osm_id:id, osm_type:'node', category:'railway', type:'station', lat:'25.0501', lon:'121.6101', name:'Fixture Central', ...opts});

test('collapse the same typed OSM object while preserving distinct nearby nodes', () => {
  const rail = searchResults([station(1), station('1', 'Alias'), station(2)], [place(1), place(3)]).rail;
  assert.deepEqual(rail.map(r=>r.osm_id), [1, 2, 3]);
  assert.equal(rail[0].name, 'Fixture Central');
});

test('absent IDs do not deduplicate unrelated rows and different typed IDs do not compare exactly equal', () => {
  const rail = searchResults([station(null)], [place(null, {name:'Other station'})]).rail;
  assert.equal(rail.length, 2);
  assert.equal(searchResults([station(1)], [place(1, {osm_type:'way', name:'Other station'})]).rail.length, 2);
});

test('nearby cross-source station areas with conflicting network or reference remain separate', () => {
  const initial = station(1, 'Fixture Central', {network:'Metro', ref:'R1'});
  for (const extratags of [{network:'Regional'}, {ref:'R2'}]) {
    assert.equal(searchResults([initial], [place(2, {osm_type:'way', extratags})]).rail.length, 2);
  }
  assert.equal(searchResults([initial], [place(2, {osm_type:'way', extratags:{ref:'R1'}})]).rail.length, 1);
  const tile = id => ({geometry:{type:'Point',coordinates:[121.6101,25.0501]},
    properties:{id,feature:'station',name:'Fixture Central',network:'Metro'}});
  assert.deepEqual(tileStations([tile('node-1-station'), tile('node-2-station')], 'Fixture', [121.61,25.05], [initial])
    .map(item=>item.osm_id), [2]);
});

test('ambiguous station labels use a supplied code, network or street, then coordinates', () => {
  const examples = [
    [station(1, 'Central', {ref:'R1'}), station(2, 'Central', {ref:'R2'}), /R1/, /R2/],
    [station(1, 'Central', {network:'Metro'}), station(2, 'Central', {network:'Regional'}), /Metro/, /Regional/],
    [station(1, 'Central', {'addr:street':'North Street'}), station(2, 'Central', {'addr:street':'South Street'}), /North Street/, /South Street/],
    [station(1, 'Central'), station(2, 'Central', {latitude:25.0502}), /25\.050000/, /25\.050200/],
  ];
  for (const [a,b,x,y] of examples) {
    const [first,second]=railwaySearchRows([a,b], item=>item.name);
    assert.equal(first.title, 'Central');
    assert.equal(second.title, 'Central');
    assert.match(first.detail,x);
    assert.match(second.detail,y);
    assert.equal(first.item,a);
    assert.equal(second.item,b);
  }
  assert.equal(railwaySearchRows([examples[2][0]], item=>item.name)[0].detail, 'station');
});
