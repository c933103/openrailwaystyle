import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {formatSpeed} from '../styles/map-model.mjs';
import {STAGES, BRANCH_DATA_VERSION, migrateBranchState, buildTiles, partQuery, quarters, readTable, simplify, toFeatures, trainProtection, trainProtections, writeTable} from '../scripts/branch-lines.mjs';

test('branch schema migration requeues all regions without losing completion safeguards or daily budget history', () => {
  const completed = '2026-10-03T00:00:00Z', runs = [{at: completed, bytes: 12345678}];
  const state = {version:2, stages:Object.fromEntries(STAGES.map((stage,i) => [stage.name, {
    completed, pending:i === 1 ? [{part:0,box:[1,2,3,4]}] : null, seen:[201,202], lines:321,
  }])), runs};
  assert.equal(migrateBranchState(state), state);
  assert.equal(state.version, BRANCH_DATA_VERSION); assert.equal(BRANCH_DATA_VERSION, 3);
  assert.equal(state.runs, runs, 'a migration retains download budget history');
  for (const stage of Object.values(state.stages)) {
    assert.equal(stage.completed, null, 'all regions will be fetched in existing order');
    assert.equal(stage.pending, null, 'an old partial pass restarts instead of keeping first-code-only rows');
    assert.deepEqual(stage.seen, []);
    assert.equal(stage.lines, 321, 'published coverage counts survive until each region is updated');
    assert.equal(stage.previousCompleted, completed, 'mass-deletion safeguard still recognizes a migrated refresh');
  }
  state.stages.japan.pending = [{part:0,box:[20,122,46,154]}]; state.stages.japan.seen = [203];
  const progress = structuredClone(state);
  migrateBranchState(state);
  assert.deepEqual(state, progress, 'subsequent version3 runs continue their saved progress');
});

test('branch-line stages: the requested order, Japan first and the rest of the world last', () => {
  assert.deepEqual(STAGES.map(s => s.name), ['japan', 'east-asia', 'china', 'russia', 'europe-a', 'europe-b', 'europe-c', 'europe-d', 'europe-e', 'europe-f', 'europe-g', 'india', 'asia', 'north-america', 'americas', 'world']);
  for (const stage of STAGES) for (const {box: [s, w, n, e]} of stage.parts) assert.ok(s < n && w < e && s >= -90 && n <= 90 && w >= -180 && e <= 180, `${stage.name} box`);
  assert.deepEqual(quarters([0, 90, 45, 135]), [[0, 90, 22.5, 112.5], [0, 112.5, 22.5, 135], [22.5, 90, 45, 112.5], [22.5, 112.5, 45, 135]]);
});

test('branch-line queries: branch and metro lines within a country area, leaving out countries fetched earlier', () => {
  assert.equal(partQuery({area: 'ISO3166-1=JP', box: [20, 122, 46, 154]}, [20, 122, 46, 154]),
    '[out:json][timeout:180][maxsize:536870912];area["ISO3166-1"="JP"]->.a0;(way[railway~"^(rail|narrow_gauge)$"][usage=branch][!service](area.a0)(20,122,46,154);way[railway=subway][!service](area.a0)(20,122,46,154););out tags geom qt;');
  const q = partQuery({area: 'ISO3166-1=CN', exclude: ['ISO3166-2=CN-GD'], box: [18, 73, 54, 135]}, [18, 73, 36, 104]);
  assert.match(q, /area\["ISO3166-1"="CN"\]->\.a0;area\["ISO3166-2"="CN-GD"\]->\.a1;\(\(way\[.*\]\(area\.a0\)\(18,73,36,104\);way\[railway=subway\]\[!service\]\(area\.a0\)\(18,73,36,104\);\); - \(way\[.*\]\(area\.a1\)\(18,73,36,104\);way\[railway=subway\]\[!service\]\(area\.a1\)\(18,73,36,104\);\);\);out tags geom qt;$/);
  assert.match(partQuery({box: [34, -25, 72, 26.5], exclude: ['ISO3166-1=RU']}, [34, -25, 72, 26.5]), /->\.a0;\(\(way\[.*?\]\(34,-25,72,26\.5\);.*\); - \(way\[.*\]\(area\.a0\)\(34,-25,72,26\.5\);\);\);/);
});

test('branch-line tags become the fields of the detailed railway tiles', () => {
  const json = {elements: [{type: 'way', id: 42, tags: {railway: 'rail', usage: 'branch', name: '磐越西線', 'name:en': 'Ban\'etsu West Line', 'name:ja-Latn': 'Ban\'etsu-sai-sen',
    maxspeed: '95', electrified: 'contact_line', voltage: '20000', frequency: '50', gauge: '1067', 'railway:ats': 'yes', 'railway:atc': 'no', operator: 'JR東日本'},
    geometry: [{lat: 37.4, lon: 140.38}, {lat: 37.40001, lon: 140.3801}, {lat: 37.5, lon: 140.0}, {lat: 37.5, lon: 139.9}]},
    {type: 'way', id: 43, tags: {railway: 'narrow_gauge', usage: 'branch', 'maxspeed:forward': '40 mph', electrified: 'no', gauge: '762;1067', 'railway:etcs': '2'}, geometry: [{lat: 1, lon: 1}, {lat: 1.1, lon: 1.1}]}]};
  const [a, b] = toFeatures(json);
  assert.deepEqual(a.properties, {osm_id: 42, feature: 'rail', usage: 'branch', state: 'present', name: '磐越西線', 'name:en': 'Ban\'etsu West Line', 'name:ja-Latn': 'Ban\'etsu-sai-sen',
    maxspeed: 95, speed_unit: 'km/h', speed_label: '95', electrification_state: 'present', voltage: 20000, frequency: 50, gauge0: '1067', gaugeint0: 1067, train_protection0: 'ats', operator: 'JR東日本'});
  assert.equal(a.geometry.coordinates.length, 3, 'a point within 50 m of the line is dropped');
  assert.deepEqual(b.properties, {osm_id: 43, feature: 'narrow_gauge', usage: 'branch', state: 'present', name: '', maxspeed: 64.374, speed_unit: 'mph', speed_label: '40 mph / -', electrification_state: 'no',
    gauge0: '762', gaugeint0: 762, gauge1: '1067', gaugeint1: 1067, train_protection0: 'etcs_2'});
  assert.throws(() => toFeatures({remark: 'runtime error: Query timed out', elements: []}), /timed out/);
  assert.equal(trainProtection({'railway:ctcs': '1'}), 'ctcs');
  assert.equal(trainProtection({'railway:pzb': 'yes', 'railway:lzb': 'yes'}), 'lzb', 'the more advanced system first');
  assert.equal(trainProtection({}), undefined);
  assert.deepEqual(simplify([[0, 0], [1, 0.0001], [2, 0]]), [[0, 0], [2, 0]]);
  assert.deepEqual(simplify([[0, 0], [2, 0], [1, 0]]), [[0, 0], [2, 0], [1, 0]], 'a way that doubles back keeps its far end');
  assert.equal(toFeatures({elements: [{type: 'way', id: 10, tags: {railway: 'rail', maxspeed: '40 MPH'}, geometry: [{lat: 0, lon: 0}, {lat: 0, lon: 1}]}]})[0].properties.speed_label, '40 mph');
  assert.equal(toFeatures({elements: [{type: 'way', id: 9, tags: {railway: 'rail', maxspeed: 'signals'}, geometry: [{lat: 0, lon: 0}, {lat: 0, lon: 1}]}]})[0].properties.speed_label, undefined, 'no label for a word');
  const way = tags => toFeatures({elements: [{type: 'way', id: 11, tags: {railway: 'rail', ...tags}, geometry: [{lat: 0, lon: 0}, {lat: 0, lon: 1}]}]})[0].properties;
  assert.deepEqual([way({maxspeed: '80;100'}).speed_label, way({maxspeed: '80;100'}).maxspeed], ['80;100', 100], 'a numeric list keeps its label');
  assert.equal(way({maxspeed: '80;signals'}).speed_label, undefined);
  assert.deepEqual(['80 kmh', '80 kph', '80 km/h', '30 knots', '40MPH'].map(v => way({maxspeed: v}).speed_label), ['80', '80', '80', '30 knots', '40 mph'], 'every unit the parser accepts');
  assert.deepEqual(way({'maxspeed:forward': '120', 'maxspeed:backward': '60', 'railway:preferred_direction': 'backward'}),
    {osm_id: 11, feature: 'rail', usage: 'branch', state: 'present', name: '', maxspeed: 60, speed_unit: 'km/h', speed_label: '120 / 60', preferred_direction: 'backward'}, 'the preferred direction\'s speed');
  assert.equal(way({'maxspeed:forward': '120', 'maxspeed:backward': '60', 'railway:preferred_direction': 'both'}).maxspeed, 120, 'else the faster direction');
  assert.equal(way({'maxspeed:forward': '120', 'railway:preferred_direction': 'backward'}).maxspeed, 120, 'an unmapped preferred direction falls back');
  assert.equal(way({maxspeed: 'signals', 'maxspeed:forward': '80', 'maxspeed:backward': '120', 'railway:preferred_direction': 'forward'}).maxspeed, 80, 'a word as plain limit does not hide the preferred direction');
  assert.equal(way({electrified: 'no', 'construction:electrified': 'contact_line'}).electrification_state, 'construction', 'electrification under way before the current "no"');
  assert.equal(way({electrified: 'no'}).electrification_state, 'no');
  const mixed = way({'maxspeed:forward': '60 mph', 'maxspeed:backward': '120', 'railway:preferred_direction': 'backward'});
  assert.deepEqual([mixed.maxspeed, mixed.speed_unit, mixed.speed_label], [120, 'km/h', '60 mph / 120'], 'the unit of the direction the speed comes from');
  assert.equal(formatSpeed(mixed).mapped, '120 km/h', 'not shown as converted from mph');
  assert.equal(way({'maxspeed:forward': '80 mph', 'maxspeed:backward': '100'}).speed_unit, 'mph', 'the faster direction\'s unit');
  assert.deepEqual([way({maxspeed: '80 mph;140'}).maxspeed, way({maxspeed: '80 mph;140'}).speed_unit], [140, 'km/h'], 'the list member that gives the speed');
  assert.equal(way({maxspeed: '30 knots'}).speed_unit, 'knots');
  assert.equal(way({'maxspeed:forward': '60 mph', 'maxspeed:backward': '97'}).speed_unit, 'km/h', 'units compared unrounded (96.56 < 97)');
  assert.deepEqual(way({electrified: 'no', 'construction:electrified': 'contact_line', voltage: '1500', 'construction:voltage': '25000'}).voltage, undefined, 'no current voltage while under construction, as in OpenRailwayMap');
  assert.equal(way({electrified: 'unknown'}).electrification_state, undefined);
  assert.equal(way({electrified: 'no', 'abandoned:electrified': 'contact_line'}).electrification_state, 'abandoned');
  assert.equal(formatSpeed(way({maxspeed: '30 knots'})).mapped, '55.6 km/h (30 knots)');
  const planned = way({electrified: 'no', 'construction:electrified': 'contact_line', 'construction:voltage': '25000', 'construction:frequency': '50'});
  assert.deepEqual([planned.electrification_state, planned.future_voltage, planned.future_frequency, planned.voltage], ['construction', 25000, 50, undefined], 'the planned current');
  const [gap] = toFeatures({elements: [{type: 'way', id: 12, tags: {railway: 'rail'}, geometry: [{lat: 0, lon: 0}, {lat: 0, lon: 1}, null, {lat: 5, lon: 5}, {lat: 5, lon: 6}]}]});
  assert.deepEqual(gap.geometry, {type: 'MultiLineString', coordinates: [[[0, 0], [1, 0]], [[5, 5], [6, 5]]]}, 'a missing node splits the way');
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
test('branch and metro tiles preserve simultaneous control systems and unknown list codes', () => {
  const tags = {'railway:etcs':'2','railway:lzb':'yes','railway:pzb':'yes'};
  assert.deepEqual(trainProtections(tags), ['etcs_2','lzb','pzb']);
  assert.deepEqual(trainProtections({'railway:train_protection':'ETCS;LZB;PZB;ETCS', 'railway:train_protection:ETCS':'2'}), ['etcs_2','lzb','pzb']);
  assert.deepEqual(trainProtections({'railway:pzb':'yes', 'railway:train_protection':'PZB;Unfamiliar:ATP'}), ['pzb','Unfamiliar:ATP']);
  assert.deepEqual(trainProtections({'railway:train_protection':'no'}), ['none']);
  assert.deepEqual(trainProtections({'railway:pzb':'no'}), []);
  assert.deepEqual(trainProtections({'railway:pzb':'no','railway:lzb':'no'}), []);
  assert.deepEqual(trainProtections({'railway:pzb':'no','railway:etcs':'2'}), ['etcs_2']);
  assert.deepEqual(trainProtections({}), [], 'missing data does not mean no protection');
  const features = toFeatures({elements:[
    {type:'way',id:201,tags:{railway:'rail',usage:'branch',...tags},geometry:[{lat:35,lon:139},{lat:35.01,lon:139.01}]},
    {type:'way',id:202,tags:{railway:'subway',...tags},geometry:[{lat:35,lon:139},{lat:35.01,lon:139.01}]},
  ]});
  for (const feature of features) assert.deepEqual([0,1,2].map(i => feature.properties[`train_protection${i}`]), ['etcs_2','lzb','pzb']);
  const tiles = buildTiles(new Map(features.map(f => [f.id,f])));
  for (const zoom of [6,9]) {
    const key = [...tiles.keys()].find(k => k.startsWith(`${zoom}/`));
    const layer = new VectorTile(new Pbf(tiles.get(key))).layers.branch_lines;
    assert.deepEqual([0,1,2].map(i => layer.feature(0).properties[`train_protection${i}`]), ['etcs_2','lzb','pzb']);
  }
  const [longList] = toFeatures({elements:[{type:'way',id:203,tags:{railway:'rail',usage:'branch',...tags,'railway:aws':'yes'},geometry:[{lat:35,lon:139},{lat:35.01,lon:139.01}]}]});
  assert.equal(longList.properties.train_protection, 'etcs_2;lzb;pzb;aws', 'exceptional fourth system retained for details');
});
test('metro lines: kept with their own usage, tiled at z7–9 only, apart from branch lines', () => {
  const [metro] = toFeatures({elements: [{type: 'way', id: 8, tags: {railway: 'subway', name: '銀座線', maxspeed: '65'}, geometry: [{lat: 35.67, lon: 139.70}, {lat: 35.71, lon: 139.80}]}]});
  assert.deepEqual([metro.properties.feature, metro.properties.usage], ['subway', '']);
  const [tunnel, surface] = toFeatures({elements: [{type: 'way', id: 9, tags: {railway: 'subway', tunnel: 'yes', bridge: 'no'}, geometry: [{lat: 1, lon: 1}, {lat: 1.1, lon: 1.1}]}, {type: 'way', id: 10, tags: {railway: 'subway', bridge: 'viaduct'}, geometry: [{lat: 1, lon: 1}, {lat: 1.1, lon: 1.1}]}]});
  assert.deepEqual([tunnel.properties.tunnel, tunnel.properties.bridge, surface.properties.bridge, surface.properties.tunnel], [true, undefined, true, undefined], 'structures as the detailed tiles\' booleans');
  const [branch] = toFeatures({elements: [{type: 'way', id: 7, tags: {railway: 'rail', usage: 'branch'}, geometry: [{lat: 37.4, lon: 139.9}, {lat: 37.6, lon: 140.3}]}]});
  const tiles = buildTiles(new Map([[7, branch], [8, metro]]));
  const ids = zoom => [...tiles].filter(([k]) => k.startsWith(`${zoom}/`)).flatMap(([, data]) => { const l = new VectorTile(new Pbf(data)).layers.branch_lines; return [...Array(l.length).keys()].map(i => l.feature(i).id); });
  for (const z of [4, 5, 6]) assert.deepEqual(ids(z), [7], `z${z}: branch lines only`);
  for (const z of [7, 8, 9]) assert.deepEqual(ids(z), [8], `z${z}: metro only`);
  assert.equal(ids(10).length, 0);
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
  assert.deepEqual([style.sources.branchLines.minzoom, style.sources.branchLines.maxzoom], [4, 9]);
  // Metro lines at zooms 7–9 in every view, drawn like the detailed tracks.
  for (const mode of ['infrastructure', 'speed', 'electrification', 'control', 'gauge', 'loading']) {
    const metro = style.layers.find(l => l.id === `${mode}-metro-overview`), tracks = style.layers.find(l => l.id === `${mode}-tracks`);
    assert.deepEqual([metro.source, metro['source-layer'], metro.minzoom, metro.maxzoom], ['branchLines', 'branch_lines', 7, 10], mode);
    assert.deepEqual(metro.paint, tracks.paint, `${mode}: same paint as the detailed tracks`);
  }
  // Bridges, tunnels and the second gauge on the snapshot's metro lines too.
  for (const [id, like] of [['structure-metro-bridge-edge', 'structure-bridge-edge'], ['structure-metro-bridge-deck', 'structure-bridge-deck'], ['structure-metro-tunnel', 'structure-tunnel'], ['gauge-metro-dual', 'gauge-dual']]) {
    const layer = style.layers.find(l => l.id === id), detailed = style.layers.find(l => l.id === like);
    assert.deepEqual([layer.source, layer['source-layer'], layer.minzoom, layer.maxzoom], ['branchLines', 'branch_lines', 7, 10], id);
    assert.deepEqual(layer.paint, detailed.paint, `${id} drawn as ${like}`);
  }
  assert.ok(ids.indexOf('structure-metro-bridge-edge') < ids.indexOf('infrastructure-metro-overview'), 'bridge parapets under the metro lines');
  assert.ok(ids.indexOf('gauge-metro-dual') < ids.indexOf('structure-metro-tunnel'), 'the tunnel core over both gauge halves');
  const dual = style.layers.find(l => l.id === 'gauge-branch-dual'), branch = style.layers.find(l => l.id === 'gauge-branch-overview');
  assert.deepEqual([dual.source, dual['source-layer'], dual.minzoom, dual.maxzoom], ['branchLines', 'branch_lines', 4, 7], 'second gauge drawn on branch lines');
  assert.ok(JSON.stringify(dual.filter).includes('gaugeint1') && ids.indexOf(dual.id) > ids.indexOf(branch.id));
  assert.ok(ids.indexOf(dual.id) < ids.indexOf('gauge-overview'), 'both halves under the main lines');
  assert.ok(branch.paint['line-offset'] && dual.paint['line-offset'], 'the two gauges side by side');
});
