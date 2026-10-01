import test from 'node:test';
import assert from 'node:assert/strict';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {addResult, buildTiles, commitStage, discardStage, joinLines, orient, routeView, stageChange, partQuery, readTable, routeLabel, routeOf, toTable, writeTable, LAYER} from '../scripts/service-routes.mjs';

test('service routes: names without their direction', () => {
  assert.equal(routeLabel('港鐵荃灣綫 MTR Tsuen Wan Line (南行 Southbound)'), '港鐵荃灣綫 MTR Tsuen Wan Line');
  assert.equal(routeLabel('地铁 1号线：罗湖 → 机场东'), '地铁 1号线');
  assert.equal(routeLabel('輕鐵751綫 Light Rail 751 (天逸 Tin Yat → 友愛 Yau Oi)'), '輕鐵751綫 Light Rail 751');
  assert.equal(routeLabel('港鐵迪士尼綫 (下) MTR Disneyland Resort Line (南行 Southbound)'), '港鐵迪士尼綫 MTR Disneyland Resort Line');
  assert.equal(routeLabel('Tram 7: Praterstern => Schwedenplatz'), 'Tram 7');
  // A loop's description stays (it names no direction).
  assert.equal(routeLabel('輕鐵705綫 Light Rail 705 (天水圍循環綫 Tin Shui Wai Circular)'), '輕鐵705綫 Light Rail 705 (天水圍循環綫 Tin Shui Wai Circular)');
});

test('service routes: both directions are one route; urban kinds only in the query', () => {
  const north = routeOf({id: 11, tags: {route: 'subway', ref: 'A', name: 'Line A (Northbound)', colour: 'F00', network: 'Metro'}});
  const south = routeOf({id: 10, tags: {route: 'subway', ref: 'A', name: 'A line (Southbound)', colour: '#ff0000', network: 'Metro'}});
  assert.equal(north.key, south.key);
  assert.equal(north.colour, '#ff0000');
  assert.equal(routeOf({id: 1, tags: {route: 'train', service: 'commuter', name: 'S1'}}).kind, 'commuter');
  assert.equal(routeOf({id: 1, tags: {route: 'tram'}}), null, 'nothing to call it');
  const q = partQuery({area: 'ISO3166-1=HK'}, [22.1, 113.8, 22.6, 114.5]);
  assert.match(q, /route~"\^\(subway\|light_rail\|tram\|monorail\)\$"/);
  assert.match(q, /route=train\]\[service~"\^\(commuter\|urban\)\$"\]/);
  assert.doesNotMatch(q, /long_distance|high_speed/);
  assert.match(q, /\.r out body;way\(r\.r\)\[railway~/);
});

const sample = {elements: [
  {type: 'relation', id: 10, tags: {route: 'subway', ref: 'A', name: 'Line A (Northbound)', colour: '#ff0000', network: 'Metro', 'name:en': 'Line A (Northbound)'}, members: [{type: 'way', ref: 1, role: ''}, {type: 'way', ref: 2, role: ''}, {type: 'node', ref: 5, role: 'stop'}]},
  {type: 'relation', id: 11, tags: {route: 'subway', ref: 'A', name: 'Line A (Southbound)', colour: '#ff0000', network: 'Metro'}, members: [{type: 'way', ref: 2, role: ''}, {type: 'way', ref: 1, role: ''}]},
  {type: 'relation', id: 12, tags: {route: 'tram', ref: '7', name: 'Tram 7: X → Y', colour: '00f', network: 'Trams'}, members: [{type: 'way', ref: 2, role: ''}, {type: 'way', ref: 3, role: 'platform'}]},
  {type: 'way', id: 1, geometry: [{lat: 35.68, lon: 139.70}, {lat: 35.69, lon: 139.71}]},
  {type: 'way', id: 2, geometry: [{lat: 35.70, lon: 139.73}, {lat: 35.69, lon: 139.71}]},
  {type: 'way', id: 3, geometry: [{lat: 35.70, lon: 139.73}, {lat: 35.71, lon: 139.74}]},
]};

test('service routes: table and tiles, each route along its tracks in its place', () => {
  const {routes, ways} = toTable(sample);
  assert.equal(routes.length, 2);
  assert.equal(routes.find(r => r.ref === 'A').relation, 10, 'linked to its lowest relation id');
  assert.deepEqual(ways.map(w => w.id), [1, 2], 'platforms are not tracks');
  const built = {routes: new Map(), ways: new Map()};
  addResult(built, {routes, ways}, 'japan');
  commitStage(built, 'japan');
  const table = readTable(writeTable(built));
  assert.equal(table.routes.size, 2); assert.equal(table.ways.size, 2);
  const tiles = buildTiles(table);
  const read = key => { const l = new VectorTile(new Pbf(tiles.get(key))).layers[LAYER]; return Array.from({length: l.length}, (_, i) => l.feature(i)); };
  const close = read([...tiles.keys()].find(k => k.startsWith('12/')));
  const shared = close.filter(f => f.properties.n === 2).map(f => [f.properties.name, f.properties.i]);
  assert.deepEqual(shared, [['Line A', 0], ['Tram 7', 1]], 'metro before tram on a shared track');
  assert.deepEqual(close.filter(f => f.properties.n === 2).map(f => f.properties.slot), [-1, 1], 'names stand apart across the track');
  assert.equal(close.find(f => f.properties.name === 'Line A').properties.id, 'relation-10');
  assert.equal(close.find(f => f.properties.name === 'Line A')?.properties['name:en'], 'Line A');
  // Below zoom 10, trams are not drawn and do not take a place.
  const far = read([...tiles.keys()].find(k => k.startsWith('9/')));
  assert.ok(far.every(f => f.properties.kind === 'subway' && f.properties.n === 1));
  assert.ok(![...tiles.keys()].some(k => Number(k.split('/')[0]) < 7 || Number(k.split('/')[0]) > 12));
  // Lines run west to east, so neighbouring ways keep each route's side.
  assert.deepEqual(orient([[2, 0], [1, 1]]), [[1, 1], [2, 0]]);
  assert.deepEqual(orient([[0, 2], [0, 1]]), [[0, 1], [0, 2]]);
});

test('service routes: consecutive ways join into one line, long enough for a name', () => {
  assert.deepEqual(joinLines([[[1, 0], [2, 0]], [[0, 0], [1, 0]], [[2, 0], [3, 1]], [[5, 5], [6, 6]]]), [[[0, 0], [1, 0], [2, 0], [3, 1]], [[5, 5], [6, 6]]]);
  // Never by reversing one (the route would swap sides).
  assert.equal(joinLines([[[0, 0], [1, 0]], [[2, 0], [1, 0]]]).length, 2);
});

test('service view: grey tracks under the services, side by side, named in the label language', async () => {
  const {readFile} = await import('node:fs/promises');
  const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));
  const {MODES} = await import('../styles/map-model.mjs');
  assert.ok(MODES.includes('service'));
  const ids = style.layers.map(l => l.id);
  const routes = style.layers.find(l => l.id === 'service-routes'), names = style.layers.find(l => l.id === 'service-names');
  assert.equal(routes.source, 'serviceRoutes'); assert.equal(routes['source-layer'], LAYER);
  assert.ok(ids.indexOf('service-tracks') < ids.indexOf('service-routes'), 'services over the tracks');
  assert.equal(routes.paint['line-offset'][0], 'interpolate');
  assert.ok(JSON.stringify(routes.paint['line-offset']).includes('"get","i"'));
  assert.equal(routes.layout.visibility, 'none'); assert.equal(names.layout.visibility, 'none');
  assert.ok(names.id.endsWith('-names'), 'the label language applies to it as to the other names');
  assert.deepEqual(names.layout['text-offset'].slice(0, 2), ['match', ['get', 'slot']], 'names of services sharing a track stand apart');
  const offsets = new Map(); const m = names.layout['text-offset'];
  for (let k = 2; k < m.length - 1; k += 2) offsets.set(m[k], m[k + 1][1][1]);
  for (const slot of [-63, -12, -1, 1, 12, 63]) assert.ok(Math.abs(offsets.get(slot) - slot * 0.65) < 1e-9, `slot ${slot} has its own offset`);
  assert.deepEqual(style.sources.serviceRoutes.tiles, ['servicetiles://{z}/{x}/{y}']);
});

test('service routes: memberships add up within a pass, are kept per stage, and a rejected refresh changes nothing', () => {
  const lines = [[[0, 0], [1, 0]]], table = {routes: new Map(), ways: new Map()};
  const route = (key, relation) => ({key, relation, kind: 'subway', ref: key, label: key, colour: '', network: 'N', operator: '', names: {}});
  // Stage A, two boxes: the second selects only the long route.
  addResult(table, {routes: [route('local', 5), route('long', 7)], ways: [{id: 1, routes: ['local', 'long'], lines}]}, 'A');
  addResult(table, {routes: [route('long', 6)], ways: [{id: 1, routes: ['long'], lines}]}, 'A');
  commitStage(table, 'A');
  assert.deepEqual(table.ways.get(1).routes, {A: ['local', 'long']});
  assert.equal(routeView(table.routes.get('long')).relation, 6, 'the lowest relation id of the pass');
  // Stage B finds its own route on the same way.
  addResult(table, {routes: [route('cross', 9)], ways: [{id: 1, routes: ['cross'], lines}]}, 'B');
  commitStage(table, 'B');
  // A rejected refresh of A (incomplete) leaves everything as it was, names and geometry too.
  addResult(table, {routes: [{...route('long', 6), label: 'renamed'}], ways: [{id: 1, routes: ['long'], lines: [[[5, 5], [6, 5]]]}]}, 'A');
  assert.deepEqual(stageChange(table, 'A'), {stale: 1, total: 3}, 'the local route was not found again');
  // What a pass newly finds does not dilute what it no longer found.
  addResult(table, {routes: [route('extra', 20)], ways: [{id: 2, routes: ['extra'], lines}]}, 'A');
  assert.deepEqual(stageChange(table, 'A'), {stale: 1, total: 3});
  discardStage(table, 'A');
  assert.deepEqual(table.ways.get(1).routes, {A: ['local', 'long'], B: ['cross']});
  assert.equal(routeView(table.routes.get('long')).label, 'long');
  assert.deepEqual(table.ways.get(1).lines, lines);
  assert.ok(table.routes.has('local'));
  // An accepted refresh: the local route goes, B's stays; the deleted
  // lower-id relation no longer gives the link.
  addResult(table, {routes: [route('long', 8)], ways: [{id: 1, routes: ['long'], lines}]}, 'A');
  commitStage(table, 'A');
  assert.deepEqual(table.ways.get(1).routes, {A: ['long'], B: ['cross']});
  assert.ok(!table.routes.has('local') && table.routes.has('cross'));
  assert.equal(routeView(table.routes.get('long')).relation, 8);
  // A way no stage holds any more goes.
  commitStage(table, 'A'); commitStage(table, 'B');
  assert.equal(table.ways.size, 0);
});

test('service routes: the same reference and network in two places are two routes; both directions of one are one', () => {
  const rel = (id, name, ways) => ({type: 'relation', id, tags: {route: 'subway', ref: '1', network: 'Metro', colour: 'red', name}, members: ways.map(ref => ({type: 'way', ref, role: ''}))});
  const way = (id, lon, lat) => ({type: 'way', id, geometry: [{lon, lat}, {lon: lon + 0.01, lat}]});
  const {routes, ways} = toTable({elements: [
    rel(1, 'Metro 1 (northbound)', [10]), rel(2, 'Metro 1 (southbound)', [11]), rel(3, 'Metro 1', [20]),
    way(10, 2.35, 48.85), way(11, 2.351, 48.851), way(20, 13.4, 52.5),
  ]});
  assert.equal(routes.length, 2, 'two cities, one route each');
  assert.deepEqual(routes.map(r => r.relation).sort(), [1, 3]);
  assert.equal(ways.find(w => w.id === 10).routes[0], ways.find(w => w.id === 11).routes[0], 'both directions are one route');
  assert.notEqual(ways.find(w => w.id === 10).routes[0], ways.find(w => w.id === 20).routes[0]);
  assert.notEqual(routeOf({id: 3, tags: {route: 'tram', ref: '1', network: 'X', name: 'One'}}).key, routeOf({id: 4, tags: {route: 'subway', ref: '1', network: 'X', name: 'One'}}).key);
});
