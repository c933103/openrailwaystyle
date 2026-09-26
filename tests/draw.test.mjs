import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {lengthKm, areaKm2, formatLength, formatArea, readDrawing, Drawing} from '../styles/draw.mjs';

test('drawing measurements', () => {
  // One degree of latitude is about 111.2 km.
  assert.ok(Math.abs(lengthKm([[0,0],[0,1]]) - 111.19) < 0.1);
  // A 1°×1° cell at the equator is about 12,364 km².
  assert.ok(Math.abs(areaKm2([[0,0],[1,0],[1,1],[0,1],[0,0]]) - 12364) / 12364 < 0.01);
  assert.equal(formatLength(0.25), '250 m');
  assert.equal(formatLength(12.345), '12.3 km');
  assert.equal(formatLength(1.609344, 'imperial'), '1 mi');
  assert.equal(formatLength(0.01, 'imperial'), '33 ft');
  assert.equal(formatArea(0.5), '50 ha');
  assert.equal(formatArea(2.589988, 'imperial'), '1 sq mi');
});
test('opened files keep points, lines and areas only', () => {
  const features = readDrawing({type:'FeatureCollection', features:[
    {type:'Feature', properties:{name:'A', evil:'<script>'}, geometry:{type:'Point', coordinates:[1,2,3]}},
    {type:'Feature', geometry:{type:'MultiLineString', coordinates:[[[0,0],[1,1]],[[2,2]]]}},
    {type:'Feature', geometry:{type:'Polygon', coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}},
    {type:'Feature', geometry:{type:'GeometryCollection', geometries:[]}},
    {type:'Feature', geometry:{type:'Point', coordinates:['x',1]}},
  ]});
  assert.deepEqual(features.map(f => f.geometry.type), ['Point','LineString','Polygon']);
  assert.deepEqual(features[0], {type:'Feature', properties:{name:'A'}, geometry:{type:'Point', coordinates:[1,2]}});
  assert.deepEqual(readDrawing('nonsense'), []);
});
test('drawing lines and areas, undo, erase and saving', () => {
  const sources = {}, stored = {};
  globalThis.localStorage = {getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = value; }};
  let hit;
  const map = {
    getSource: id => sources[id], addSource: (id) => { sources[id] = {setData(data) { this.data = data; }}; },
    getLayer: () => undefined, addLayer() {}, getCanvas: () => ({style:{}}),
    doubleClickZoom: {enable() { this.on = true; }, disable() { this.on = false; }},
    project: ([lng, lat]) => ({x:lng*100, y:-lat*100}),
    queryRenderedFeatures: () => hit ? [hit] : [],
  };
  const statuses = [];
  const d = new Drawing(map, {status: s => statuses.push(s)});
  d.install();
  d.setMode('line');
  assert.equal(map.doubleClickZoom.on, false, 'double-click finishes instead of zooming');
  const at = (lng, lat) => d.click({lng, lat}, {x:lng*100, y:-lat*100});
  at(0,0); at(0,1); at(0,1); // the double-click repeats the last point
  assert.equal(statuses.at(-1), '111 km');
  d.finish();
  assert.deepEqual(d.features[0].geometry, {type:'LineString', coordinates:[[0,0],[0,1]]});
  d.setMode('area');
  at(0,0); at(1,0); at(1,1); at(0.001,0.001); // clicking the first corner closes the area
  assert.equal(d.features[1].geometry.type, 'Polygon');
  assert.equal(d.features[1].geometry.coordinates[0].length, 4);
  assert.match(sources['atlas-drawing'].data.features[1].properties.measure, /km²/);
  const saved = JSON.parse(stored['openrailwayatlas-drawing']);
  assert.equal(saved.features.length, 2);
  assert.equal(saved.features[0].properties.measure, undefined, 'saved files carry no display properties');
  d.setMode('erase');
  hit = {properties:{drawing:d.features[0].id}};
  at(0, 0.5);
  assert.deepEqual(d.features.map(f => f.geometry.type), ['Polygon']);
  d.undo();
  assert.equal(d.features.length, 0);
  // Reloading restores what was kept in the browser.
  d.add(readDrawing(saved));
  assert.equal(new Drawing(map).features.length, 2);
});
test('drawing layers are valid MapLibre style layers', () => {
  const sources = {}, layers = [];
  const map = {getSource: id => sources[id], addSource: (id, source) => { sources[id] = source; }, getLayer: () => undefined, addLayer: layer => layers.push(layer), getCanvas: () => ({style:{}})};
  new Drawing(map).install();
  const errors = validateStyleMin({version:8, glyphs:'https://example.org/{fontstack}/{range}.pbf', sources, layers});
  assert.deepEqual(errors.map(e => e.message), []);
});
