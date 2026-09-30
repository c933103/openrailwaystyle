import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {STAGES, buildTiles, partQuery, quarters, readTable, simplify, toFeatures, trainProtection, writeTable} from '../scripts/branch-lines.mjs';

test('branch-line stages: the requested order, Japan first and the rest of the world last', () => {
  assert.deepEqual(STAGES.map(s => s.name), ['japan', 'east-asia', 'china', 'russia', 'europe', 'india', 'asia', 'north-america', 'americas', 'world']);
  for (const stage of STAGES) for (const {box: [s, w, n, e]} of stage.parts) assert.ok(s < n && w < e && s >= -90 && n <= 90 && w >= -180 && e <= 180, `${stage.name} box`);
  assert.deepEqual(quarters([0, 90, 45, 135]), [[0, 90, 22.5, 112.5], [0, 112.5, 22.5, 135], [22.5, 90, 45, 112.5], [22.5, 112.5, 45, 135]]);
});

test('branch-line queries: within a country area, leaving out countries fetched earlier', () => {
  assert.equal(partQuery({area: 'ISO3166-1=JP', box: [20, 122, 46, 154]}, [20, 122, 46, 154]),
    '[out:json][timeout:180][maxsize:536870912];area["ISO3166-1"="JP"]->.a0;(way[railway~"^(rail|narrow_gauge)$"][usage=branch][!service](area.a0)(20,122,46,154););out tags geom qt;');
  const q = partQuery({area: 'ISO3166-1=CN', exclude: ['ISO3166-2=CN-GD'], box: [18, 73, 54, 135]}, [18, 73, 36, 104]);
  assert.match(q, /area\["ISO3166-1"="CN"\]->\.a0;area\["ISO3166-2"="CN-GD"\]->\.a1;\(way\[.*\]\(area\.a0\)\(18,73,36,104\); - \(way\[.*\]\(area\.a1\)\(18,73,36,104\);\);\);out tags geom qt;$/);
  assert.match(partQuery({box: [34, -25, 72, 26.5], exclude: ['ISO3166-1=RU']}, [34, -25, 72, 26.5]), /->\.a0;\(way\[.*?\]\(34,-25,72,26\.5\); - \(way\[.*\]\(area\.a0\)\(34,-25,72,26\.5\);\);\);/);
});

test('branch-line tags become the fields of the detailed railway tiles', () => {
  const json = {elements: [{type: 'way', id: 42, tags: {railway: 'rail', usage: 'branch', name: '磐越西線', 'name:en': 'Ban\'etsu West Line', 'name:ja-Latn': 'Ban\'etsu-sai-sen',
    maxspeed: '95', electrified: 'contact_line', voltage: '20000', frequency: '50', gauge: '1067', 'railway:ats': 'yes', 'railway:atc': 'no', operator: 'JR東日本'},
    geometry: [{lat: 37.4, lon: 140.38}, {lat: 37.40001, lon: 140.3801}, {lat: 37.5, lon: 140.0}, {lat: 37.5, lon: 139.9}]},
    {type: 'way', id: 43, tags: {railway: 'narrow_gauge', usage: 'branch', 'maxspeed:forward': '40 mph', electrified: 'no', gauge: '762;1067', 'railway:etcs': '2'}, geometry: [{lat: 1, lon: 1}, {lat: 1.1, lon: 1.1}]}]};
  const [a, b] = toFeatures(json);
  assert.deepEqual(a.properties, {osm_id: 42, feature: 'rail', usage: 'branch', state: 'present', name: '磐越西線', 'name:en': 'Ban\'etsu West Line', 'name:ja-Latn': 'Ban\'etsu-sai-sen',
    maxspeed: 95, speed_label: '95', electrification_state: 'present', voltage: 20000, frequency: 50, gauge0: '1067', gaugeint0: 1067, train_protection0: 'ats', operator: 'JR東日本'});
  assert.equal(a.geometry.coordinates.length, 3, 'a point within 50 m of the line is dropped');
  assert.deepEqual(b.properties, {osm_id: 43, feature: 'narrow_gauge', usage: 'branch', state: 'present', name: '', maxspeed: 64, speed_label: '40 mph / -', electrification_state: 'no',
    gauge0: '762', gaugeint0: 762, gauge1: '1067', gaugeint1: 1067, train_protection0: 'etcs_2'});
  assert.throws(() => toFeatures({remark: 'runtime error: Query timed out', elements: []}), /timed out/);
  assert.equal(trainProtection({'railway:ctcs': '1'}), 'ctcs');
  assert.equal(trainProtection({'railway:pzb': 'yes', 'railway:lzb': 'yes'}), 'lzb', 'the more advanced system first');
  assert.equal(trainProtection({}), undefined);
  assert.deepEqual(simplify([[0, 0], [1, 0.0001], [2, 0]]), [[0, 0], [2, 0]]);
  assert.deepEqual(simplify([[0, 0], [2, 0], [1, 0]]), [[0, 0], [2, 0], [1, 0]], 'a way that doubles back keeps its far end');
  assert.equal(toFeatures({elements: [{type: 'way', id: 10, tags: {railway: 'rail', maxspeed: '40 MPH'}, geometry: [{lat: 0, lon: 0}, {lat: 0, lon: 1}]}]})[0].properties.speed_label, '40 mph');
  assert.equal(toFeatures({elements: [{type: 'way', id: 9, tags: {railway: 'rail', maxspeed: 'signals'}, geometry: [{lat: 0, lon: 0}, {lat: 0, lon: 1}]}]})[0].properties.speed_label, undefined, 'no label for a word');
});

test('branch-line table and tiles: z4–6 only, the style\'s fields and the OSM way id', () => {
  const [feature] = toFeatures({elements: [{type: 'way', id: 7, tags: {railway: 'rail', usage: 'branch', name: 'Test', maxspeed: '85'}, geometry: [{lat: 37.4, lon: 139.9}, {lat: 37.6, lon: 140.3}]}]});
  const table = new Map([[7, {...feature, stage: 'japan'}]]);
  assert.deepEqual(readTable(writeTable(table)), table);
  const tiles = buildTiles(table);
  assert.deepEqual([...tiles.keys()].map(k => Number(k.split('/')[0])).sort(), [4, 5, 6]);
  const layer = new VectorTile(new Pbf(tiles.get([...tiles.keys()].find(k => k.startsWith('6/'))))).layers.branch_lines;
  assert.equal(layer.feature(0).id, 7);
  assert.deepEqual([layer.feature(0).properties.usage, layer.feature(0).properties.maxspeed, layer.feature(0).properties.stage], ['branch', 85, undefined]);
});

test('style: branch lines under the main overview lines in every view, from zoom 4 to 6', async () => {
  const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));
  const ids = style.layers.map(l => l.id);
  for (const mode of ['infrastructure', 'speed', 'electrification', 'control', 'gauge', 'loading']) {
    const layer = style.layers.find(l => l.id === `${mode}-branch-overview`), main = style.layers.find(l => l.id === `${mode}-overview`);
    assert.deepEqual([layer.source, layer['source-layer'], layer.minzoom, layer.maxzoom], ['branchLines', 'branch_lines', 4, 7]);
    assert.deepEqual(layer.paint['line-color'], main.paint['line-color'], `${mode}: same colours as the main lines`);
    assert.ok(ids.indexOf(layer.id) < ids.indexOf(main.id), `${mode}: drawn under the main lines`);
  }
  assert.deepEqual([style.sources.branchLines.minzoom, style.sources.branchLines.maxzoom], [4, 6]);
});
