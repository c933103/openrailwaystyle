import test from 'node:test';
import assert from 'node:assert/strict';
import {Measure} from '../styles/draw.mjs';

function fixture() {
  const handlers = {}, sources = {};
  let rendered = [];
  const map = {
    on(type, layer, fn) { handlers[type + (typeof layer === 'string' ? ' ' + layer : '')] = fn || layer; },
    getSource: id => sources[id], addSource(id) { sources[id] = {setData(data) { this.data = data; }}; },
    getLayer: () => ({}), addLayer() {}, getCanvas: () => ({style: {}}),
    doubleClickZoom: {enable() {}, disable() {}},
    queryRenderedFeatures: () => rendered,
  };
  const measure = new Measure(map); measure.install();
  return {measure, handlers, render: features => { rendered = features; },
    handles: () => measure.collection().features.filter(f => Number.isInteger(f.properties.index)),
    click: (lng, lat) => measure.click({lng, lat}, {x: lng, y: lat})};
}

test('old distance handles cannot consume new curve points while the renderer catches up', () => {
  const f = fixture(); f.measure.setMode('distance');
  f.click(0, 0); f.click(0.1, 0);
  const old = f.handles();
  f.measure.setMode('radius');
  f.render([old[0]]); f.click(0, 0);
  f.render([]); f.click(0.05, 0.05);
  // Index 1 now exists again, but belongs to a different measurement.
  f.render([old[1]]); f.click(0.1, 0);
  assert.deepEqual(f.measure.points, [[0,0],[0.05,0.05],[0.1,0]]);
  assert.equal(f.measure.selected, null);
  assert.ok(f.measure.profileCoordinates()?.length > 3, 'the exact three taps produce a fitted arc profile');
  f.measure.lastAdd = 0;
  f.render([f.handles()[1]]); f.click(0.05, 0.05);
  assert.equal(f.measure.selected, 1, 'current rendered points still select for editing');
});

test('stale measurement handles do not start a drag after clearing', () => {
  const f = fixture(); f.measure.setMode('distance'); f.click(0, 0); f.click(0.1, 0);
  const old = f.handles(); f.measure.clear();
  let prevented = false;
  f.handlers['mousedown measure-point-targets']({features:old, point:{x:0,y:0}, originalEvent:{button:0}, preventDefault(){prevented=true;}});
  f.handlers.mousemove({point:{x:20,y:20},lngLat:{lng:1,lat:1}});
  f.handlers.mouseup();
  assert.equal(prevented, false, 'stale handles must not capture map gestures');
  f.render(old); f.click(0, 0);
  assert.deepEqual(f.measure.points, [[0,0]], 'a stale drag must not suppress the new click');
});

test('current handles remain draggable, but a reset invalidates an in-flight drag', () => {
  const f = fixture(); f.measure.setMode('distance'); f.click(0, 0); f.click(0.1, 0);
  const start = () => f.handlers['mousedown measure-point-targets']({features:f.handles(), point:{x:0,y:0}, originalEvent:{button:0}, preventDefault(){}});
  start();
  f.handlers.mousemove({point:{x:20,y:20},lngLat:{lng:0.02,lat:0.03}});
  assert.deepEqual(f.measure.points[0], [0.02,0.03]);
  // Reset before mouseup must not move a replacement point at index zero.
  f.measure.clear(); f.click(2, 2);
  f.handlers.mousemove({point:{x:30,y:30},lngLat:{lng:3,lat:3}});
  f.handlers.mouseup();
  assert.deepEqual(f.measure.points, [[2,2]]);
  f.click(4, 4);
  assert.deepEqual(f.measure.points, [[2,2],[4,4]], 'invalidated drag does not swallow later clicks');
});

for (const reset of ['undo', 'deleteSelected', 'restart']) test(`${reset} invalidates handles whose indices can be reused`, () => {
  const f = fixture(); f.measure.setMode('distance');
  f.click(0,0); f.click(1,1); f.click(2,0);
  const old = f.handles();
  if (reset === 'restart') { f.measure.end(); f.click(3,3); }
  else if (reset === 'deleteSelected') { f.measure.select(1); f.measure.deleteSelected(); }
  else f.measure.undo();
  f.render([old[1]]); f.click(5,5);
  assert.deepEqual(f.measure.points.at(-1), [5,5]);
  assert.equal(f.measure.selected, null);
});
