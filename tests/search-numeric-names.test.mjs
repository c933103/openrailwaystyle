import test from 'node:test';
import assert from 'node:assert/strict';
import {samePlaceName, searchResults, tileStations} from '../styles/map-model.mjs';

const distinct = [
  ['Terminal 1', 'Terminal 10'], ['Terminal 1', 'Terminal 11'],
  ['Terminal 1', 'Terminal 1-1'], ['Terminal 1', '1 Terminal 1'],
  ['Central', 'Central 2'], ['Central', '2 Central'], ['Central', 'Central-2'],
  ['中央', '中央2'], ['中央', '2中央'],
  ['Central', 'Central２'], ['Central', 'Central٢'],
  ['Central', 'Central²'], ['Central', 'CentralⅡ'],
  ['Terminal 1', '第1航廈 Terminal 10'],
  ['Terminal 1', '第1航廈 Terminal 1-1'],
  ['Terminal 1', '第2航廈 Terminal 1'],
  ['Central', '中央2 Central'],
  ['Terminal 1', 'Terminal 1-1航廈'], ['Terminal 1', 'Terminal 1.1航廈'],
  ['Terminal 1', 'Terminal 1/1航廈'], ['Terminal 1', 'Terminal 1–1航廈'],
  ['Terminal 1', 'Terminal 1−1航廈'],
  ['1 Terminal', '第1-1 Terminal'], ['1 Terminal', '11 Terminal 第1航廈'],
  ['Terminal 𝟙', '第𝟙航廈 Terminal 𝟙𝟙'],
  ['Terminal 1', '第２航廈 Terminal 1'],
];
const aliases = [
  ['大埔墟 Tai Po Market', 'Tai Po Market'],
  ['大埔墟 Tai Po Market', '大埔墟'],
  ['紅磡 Hung Hom Station', 'Hung Hom'], ['東京駅', '東京'],
  ['第1航廈 Terminal 1', 'Terminal 1'],
  ['第1航廈 Terminal 1', '第1航廈'],
  ['Terminal 1 (第1航廈)', 'Terminal 1'],
  ['Terminal 1 / 1號航廈', 'Terminal 1'], ['Terminal 1(1號航廈)', 'Terminal 1'],
  ['中央2 Central 2', 'Central 2'], ['中央2 Central 2', '中央2'],
  ['中央２ Central ２', 'Central ２'],
  ['第１航廈 Terminal 1', 'Terminal 1'], ['第１航廈 Terminal 1', '第１航廈'],
  ['第²航廈 Terminal 2', 'Terminal 2'],
  ['中央٢ Central ٢', 'Central ٢'],
  ['中央² Central ²', 'Central ²'],
  ['中央Ⅱ Central Ⅱ', 'Central Ⅱ'],
  ['第1-2航廈 Terminal 1-2', 'Terminal 1-2'],
];
const facility = (name, extra = {}) => ({osm_id: 1, name, railway: 'station', latitude: 22.28, longitude: 114.158, ...extra});
const place = (name, extra = {}) => ({osm_type: 'way', osm_id: 2, category: 'railway', type: 'station', lat: '22.2805', lon: '114.1585', namedetails: {name}, ...extra});
const tile = (name, extra = {}, coordinates = [114.1585, 22.2805]) => ({geometry: {type: 'Point', coordinates}, properties: {id: 'way-2-station', name, feature: 'station', ...extra}});

test('search names: numeric differences never become bilingual aliases', () => {
  for (const [a, b] of distinct) {
    assert.equal(samePlaceName(a, b), false, `${a} / ${b}`);
    assert.equal(samePlaceName(b, a), false, `${b} / ${a}`);
  }
});

test('search names: bilingual aliases retain matching numeric identities', () => {
  for (const [a, b] of aliases) {
    assert.equal(samePlaceName(a, b), true, `${a} / ${b}`);
    assert.equal(samePlaceName(b, a), true, `${b} / ${a}`);
  }
  assert.equal(samePlaceName(' Terminal  1 Station ', 'terminal 1'), true);
  assert.equal(samePlaceName('Central Park', 'Central'), false);
});

test('search reconciliation keeps nearby distinct numbered geocoder stations', () => {
  for (const [a, b] of distinct) {
    for (const [found, next] of [[a, b], [b, a]]) {
      assert.deepEqual(searchResults([facility(found)], [place(next)]).rail.map(item => item.osm_id), [1, 2], `${found} / ${next}`);
    }
  }
});

test('tile search keeps nearby distinct numbered stations already found by name', () => {
  for (const [a, b] of distinct) {
    for (const [found, next] of [[a, b], [b, a]]) {
      assert.deepEqual(tileStations([tile(next)], next, [114.158, 22.28], [facility(found)]).map(item => item.osm_id), [2], `${found} / ${next}`);
    }
  }
});

test('both search reconciliation paths still merge nearby bilingual aliases', () => {
  for (const [a, b] of aliases) {
    for (const [found, next] of [[a, b], [b, a]]) {
      assert.deepEqual(searchResults([facility(found)], [place(next)]).rail.map(item => item.osm_id), [1], `${found} / ${next}`);
      assert.deepEqual(tileStations([tile(next)], next, [114.158, 22.28], [facility(found)]), [], `${found} / ${next}`);
    }
  }
});

test('stable OSM identities still deduplicate despite differing numbered names', () => {
  assert.deepEqual(searchResults([facility('Terminal 1')], [place('Terminal 10', {osm_type: 'node', osm_id: 1})]).rail.map(item => item.osm_id), [1]);
  assert.deepEqual(tileStations([tile('Terminal 10', {id: 'node-1-station'})], 'Terminal', [114.158, 22.28], [facility('Terminal 1')]), []);
  assert.deepEqual(searchResults([facility('Terminal 1')], [place('Terminal 10', {osm_id: 1})]).rail.map(item => item.osm_type ?? 'node'), ['node', 'way']);
  assert.deepEqual(tileStations([tile('Terminal 10', {id: 'way-1-station'})], 'Terminal', [114.158, 22.28], [facility('Terminal 1')]).map(item => item.osm_type), ['way']);
});

test('name-based deduplication still requires nearby coordinates', () => {
  for (const name of ['第1航廈 Terminal 1', 'Terminal 1']) {
    assert.deepEqual(searchResults([facility('Terminal 1')], [place(name, {lat: '22.29', lon: '114.17'})]).rail.map(item => item.osm_id), [1, 2]);
    assert.deepEqual(tileStations([tile(name, {}, [114.17, 22.29])], 'Terminal', [114.158, 22.28], [facility('Terminal 1')]).map(item => item.osm_id), [2]);
  }
});

test('tile search ranks an exact numbered name before a closer numeric extension', () => {
  const items = [tile('Terminal 10'), tile('Terminal 1', {id: 'way-3-station'}, [114.17, 22.29])];
  assert.deepEqual(tileStations(items, 'Terminal 1', [114.1585, 22.2805]).map(item => item.name), ['Terminal 1', 'Terminal 10']);
});
