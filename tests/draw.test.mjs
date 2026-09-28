import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {lengthKm, areaKm2, formatLength, formatArea, formatRadius, readDrawing, Drawing, Measure, smoothCurve, fitCircle, circleArc, drawingStyle} from '../styles/draw.mjs';

test('drawing measurements', () => {
  // One degree of latitude is about 111.2 km.
  assert.ok(Math.abs(lengthKm([[0,0],[0,1]]) - 111.19) < 0.1);
  // A 1°×1° cell at the equator is about 12,364 km².
  assert.ok(Math.abs(areaKm2([[0,0],[1,0],[1,1],[0,1],[0,0]]) - 12364) / 12364 < 0.01);
  // Across the antimeridian: a 2°×1° cell, not one spanning 358°.
  assert.ok(Math.abs(areaKm2([[179,0],[-179,0],[-179,1],[179,1],[179,0]]) - 2*12364) / (2*12364) < 0.01);
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
    getLayer: () => undefined, addLayer() {}, getCanvas: () => ({style:{}}), on() {},
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
  const map = {getSource: id => sources[id], addSource: (id, source) => { sources[id] = source; }, getLayer: () => undefined, addLayer: layer => layers.push(layer), getCanvas: () => ({style:{}}), on() {}};
  new Drawing(map).install();
  new Measure(map).install();
  const errors = validateStyleMin({version:8, glyphs:'https://example.org/{fontstack}/{range}.pbf', sources, layers});
  assert.deepEqual(errors.map(e => e.message), []);
});
// Points on a circle of the given radius (km) around a centre.
const onCircle = (radiusKm, angles, [lng0, lat0] = [139.7, 35.7]) => angles.map(a => [lng0 + radiusKm*Math.cos(a*Math.PI/180)/(6371.0088*Math.cos(lat0*Math.PI/180))*180/Math.PI, lat0 + radiusKm*Math.sin(a*Math.PI/180)/6371.0088*180/Math.PI]);
test('curve radius from points along a curve', () => {
  const fit = fitCircle(onCircle(0.8, [10, 40, 70]));
  assert.ok(Math.abs(fit.radiusKm - 0.8) < 0.002, `radius ${fit.radiusKm}`);
  // Noisy points: the least-squares fit stays close.
  const noisy = onCircle(1.2, [0, 15, 30, 45, 60]).map(([x, y], i) => [x + (i % 2 ? 1 : -1) * 0.00002, y]);
  assert.ok(Math.abs(fitCircle(noisy).radiusKm - 1.2) < 0.03);
  assert.equal(fitCircle([[0,0],[0.001,0.001],[0.002,0.002]]), null, 'points in a line have no radius');
  assert.equal(fitCircle([[0,0],[1,1]]), null);
  const points = onCircle(0.5, [0, 45, 90]);
  const arc = circleArc(fitCircle(points), points);
  assert.ok(lengthKm([arc[0], points[0]]) < 0.001 && lengthKm([arc.at(-1), points[2]]) < 0.001, 'the arc runs from the first to the last point');
  assert.ok(Math.abs(lengthKm(arc) - 0.5*Math.PI/2) < 0.01, 'through the middle point: a quarter circle');
  assert.equal(formatRadius(0.8), '800 m');
  assert.equal(formatRadius(0.3048, 'imperial'), '1,000 ft');
});
test('smooth curves pass through the clicked points', () => {
  const points = [[139.70,35.70],[139.71,35.705],[139.72,35.70],[139.73,35.71]];
  const curve = smoothCurve(points);
  for (const p of points) assert.ok(curve.some(q => Math.abs(q[0]-p[0]) < 1e-6 && Math.abs(q[1]-p[1]) < 1e-6));
  assert.ok(curve.length > points.length * 5);
  assert.deepEqual(smoothCurve(points.slice(0, 2)), points.slice(0, 2));
});
test('drawing style is kept on features and validated in files', () => {
  assert.deepEqual(drawingStyle({color:'#1565C0', dash:'dotted', width:5}), {color:'#1565c0', dash:'dotted', width:5});
  assert.deepEqual(drawingStyle({color:'red; x', dash:'wavy', width:99}), {});
  const [f] = readDrawing({type:'Feature', properties:{color:'#212121', dash:'dashed', width:2, other:1}, geometry:{type:'LineString', coordinates:[[0,0],[1,1]]}});
  assert.deepEqual(f.properties, {color:'#212121', dash:'dashed', width:2});
});
test('curve drawing and measuring', () => {
  const sources = {};
  globalThis.localStorage = {getItem: () => null, setItem() {}};
  const map = {getSource: id => sources[id], addSource: id => { sources[id] = {setData(data) { this.data = data; }}; }, getLayer: () => undefined, addLayer() {}, getCanvas: () => ({style:{}}), on() {}, doubleClickZoom: {enable() {}, disable() {}}, project: () => ({x:0, y:0})};
  const d = new Drawing(map); d.install();
  d.setStyle({color:'#1565c0', dash:'dashed', width:5});
  d.setMode('curve');
  for (const [lng, lat] of [[139.70,35.70],[139.71,35.705],[139.72,35.70]]) d.click({lng, lat}, {x:1000, y:1000});
  d.finish();
  assert.equal(d.features[0].geometry.type, 'LineString');
  assert.ok(d.features[0].geometry.coordinates.length > 10, 'curves are stored as smooth lines');
  assert.deepEqual(d.features[0].properties, {color:'#1565c0', dash:'dashed', width:5, line_points:[[139.7,35.7],[139.71,35.705],[139.72,35.7]], curved:[1,1,1]}, 'style and curve points kept');
  const statuses = [];
  const m = new Measure(map, {status: s => statuses.push(s)}); m.install();
  m.setMode('distance');
  m.click({lng:0, lat:0}); m.click({lng:0, lat:1}); m.click({lng:0, lat:1}); m.end();
  assert.match(statuses.at(-1), /111 km over 1 segment/);
  m.click({lng:1, lat:1});
  assert.equal(m.points.length, 1, 'after ending, a click starts a new measurement');
  m.setMode('radius');
  for (const [lng, lat] of onCircle(0.6, [0, 30, 60, 90])) m.click({lng, lat});
  assert.match(statuses.at(-1), /Curve radius ≈ 600 m, fitted to 4 points/);
  const labels = sources['atlas-measure'].data.features.map(f => f.properties.label).filter(Boolean);
  assert.deepEqual(labels, ['R ≈ 600 m']);
});

test('one line can join straight track and curves', async () => {
  const {buildLine} = await import('../styles/draw.mjs');
  const points = [[0,0],[1,0],[2,0.5],[3,0],[4,0]], curved = [0,0,1,0,0];
  const line = buildLine(points, curved);
  // Corners are kept exactly; the curve between them passes through the
  // curve point.
  assert.deepEqual(line[0], [0,0]);
  assert.ok(line.some(p => p[0] === 1 && p[1] === 0));
  assert.ok(line.some(p => Math.abs(p[0] - 2) < 1e-6 && Math.abs(p[1] - 0.5) < 1e-6));
  assert.deepEqual(line.at(-1), [4,0]);
  // The last straight stretch stays straight: [3,0] then [4,0].
  assert.deepEqual(line.slice(-2), [[3,0],[4,0]]);
  assert.ok(line.length > points.length, 'the curved part is smoothed');
  assert.deepEqual(buildLine(points, [0,0,0,0,0]), points);
});

function editingMap(sources, handlers, pick) {
  return {getSource: id => sources[id], addSource: id => { sources[id] = {setData(data) { this.data = data; }}; }, getLayer: id => id.endsWith('targets') ? {} : undefined, addLayer() {},
    getCanvas: () => ({style:{}}), on(type, layer, fn) { handlers[`${type} ${typeof layer === 'string' ? layer : ''}`] = fn || layer; },
    doubleClickZoom: {enable() {}, disable() {}}, project: () => ({x:1e9, y:1e9}), queryRenderedFeatures: () => pick() ? [{properties: pick()}] : []};
}

test('drawing points are selected, then moved, deleted, curved or extended', async () => {
  const {Drawing, editablePoints, readDrawing} = await import('../styles/draw.mjs');
  const sources = {}, handlers = {};
  let picked = null;
  const d = new Drawing(editingMap(sources, handlers, () => picked)); d.clear(); d.install();
  const at = (lng, lat) => d.click({lng, lat}, {x:lng, y:lat});
  d.setMode('area');
  for (const [lng, lat] of [[0,0],[1,0],[1,1],[0,1]]) at(lng, lat);
  d.finish();
  const area = d.features.at(-1);
  assert.equal(sources['atlas-drawing-handles'].data.features.length, 4, 'handles while a tool is in use');
  d.movePoint(area.id, 2, [2, 2]);
  assert.deepEqual(d.features.at(-1).geometry.coordinates[0], [[0,0],[1,0],[2,2],[0,1],[0,0]]);
  // Clicking a point selects it; delete removes just that point.
  picked = {drawing: area.id, index: 3}; at(0, 1); picked = null;
  assert.deepEqual(d.selection().index, 3);
  d.deleteSelected();
  assert.deepEqual(d.features.at(-1).geometry.coordinates[0], [[0,0],[1,0],[2,2],[0,0]]);
  assert.equal(d.selected, null);
  d.removePoint(area.id, 0); // an area needs three corners
  assert.equal(d.features.length, 0);
  // A line with straight and curved parts; the middle point becomes a curve point.
  d.setMode('line');
  for (const [lng, lat] of [[0,0],[1,0],[2,1]]) at(lng, lat);
  d.setCurved(true); at(3, 1); d.setCurved(false); at(4, 1);
  d.finish();
  let line = d.features.at(-1);
  assert.deepEqual(line.properties.curved, [0,0,0,1,0]);
  picked = {drawing: line.id, index: 1}; at(1, 0); picked = null;
  assert.equal(d.selection().canCurve, true);
  assert.equal(d.selection().canExtend, false);
  d.toggleSelectedCurve();
  assert.deepEqual(d.features.at(-1).properties.curved, [0,1,0,1,0]);
  // Extend from the start: the line becomes the shape in progress, reversed.
  line = d.features.at(-1);
  at(9, 9); // clears the selection
  picked = {drawing: line.id, index: 0}; at(0, 0); picked = null;
  assert.equal(d.selection().canExtend, true);
  d.extendSelected();
  assert.equal(d.features.length, 0);
  assert.deepEqual(d.draft[0], [4, 1]);
  at(-1, 0); d.finish();
  assert.deepEqual(editablePoints(d.features.at(-1)), [[4,1],[3,1],[2,1],[1,0],[0,0],[-1,0]]);
  assert.deepEqual(d.features.at(-1).properties.curved, [0,1,0,1,0,0]);
  // Kept through saving and opening.
  const saved = readDrawing(d.collection());
  assert.deepEqual(saved[0].properties.curved, [0,1,0,1,0,0]);
  // Files from before keep curves: curve_points are all curve points.
  const old = readDrawing({type:'Feature', properties:{curve_points:[[0,0],[1,1],[2,0]]}, geometry:{type:'LineString', coordinates:[[0,0],[1,1],[2,0]]}});
  assert.deepEqual(old[0].properties.curved, [1,1,1]);
  d.clear();
});

test('measured points are selected, then moved or deleted', async () => {
  const {Measure} = await import('../styles/draw.mjs');
  const sources = {}, handlers = {};
  let picked = null;
  const m = new Measure(editingMap(sources, handlers, () => picked)); m.install(); m.setMode('distance');
  for (const lng of [0, 1, 2]) m.click({lng, lat: 0}, {x: lng, y: 0});
  m.lastAdd = 0; // not part of a double-click
  picked = {index: 1}; m.click({lng: 1, lat: 0}, {x: 1, y: 0}); picked = null;
  assert.equal(m.selected, 1);
  m.deleteSelected();
  assert.deepEqual(m.points, [[0,0],[2,0]]);
  assert.equal(sources['atlas-measure'].data.features.filter(f => f.properties.index !== undefined).length, 2);
});
