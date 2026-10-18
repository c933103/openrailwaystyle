import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {Drawing} from '../styles/draw.mjs';

const app = await readFile(new URL('../styles/app.mjs', import.meta.url), 'utf8');
const begin = app.indexOf("$('draw-clear').addEventListener('click'");
const end = app.indexOf("\n$('draw-save').addEventListener", begin);
assert.ok(begin >= 0 && end > begin, 'actual Clear toolbar handler is present');
const handler = app.slice(begin, end);
const storedKey = 'openrailwayatlas-drawing';
const line = {type: 'Feature', properties: {name: 'Existing line', color: '#123456'},
  geometry: {type: 'LineString', coordinates: [[0, 0], [1, 0]]}};

function harness() {
  const dom = new JSDOM('<button id="draw-clear">Clear</button>');
  const sources = {}, stored = new Map(), prompts = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value),
  }});
  const map = {
    on() {}, getSource: id => sources[id],
    addSource(id) { sources[id] = {setData(data) { this.data = data; }}; },
    getLayer() {}, addLayer() {}, getCanvas: () => ({style: {}}),
    project: ([lng, lat]) => ({x: lng * 100, y: lat * 100}),
    doubleClickZoom: {enable() {}, disable() {}},
  };
  const drawing = new Drawing(map); drawing.install();
  let accepted = true;
  vm.runInNewContext(handler, {drawing, $: id => dom.window.document.getElementById(id),
    confirm: message => { prompts.push(message); return accepted; }});
  return {drawing, stored, prompts, sources, map,
    click(accept = true) { accepted = accept; dom.window.document.getElementById('draw-clear').click(); },
    close() {
      dom.window.close();
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete globalThis.localStorage;
    },
  };
}

function prepare(h, scenario) {
  const d = h.drawing;
  if (scenario.startsWith('extension') || scenario === 'saved' || scenario === 'saved-and-draft') d.add([structuredClone(line)]);
  if (scenario.startsWith('extension')) {
    d.setMode('line'); d.select({drawing: d.features[0].id, index: 1}); d.extendSelected();
    if (scenario === 'extension-without-points') { d.undo(); d.undo(); }
    assert.equal(d.features.length, 0, 'the original line is held by the pending extension');
    assert.equal(JSON.parse(h.stored.get(storedKey)).features.length, 1, 'the original remains saved until acceptance');
  } else if (scenario !== 'saved') {
    d.setMode(scenario === 'area' ? 'area' : scenario === 'curve' ? 'curve' : 'line');
    d.click({lng: 0, lat: 0}, {x: 500, y: 500});
    if (scenario !== 'single-point') d.click({lng: 1, lat: 0}, {x: 600, y: 500});
    d.move({lng: 2, lat: 1});
    if (scenario === 'paused') d.setPaused(true);
  }
}

const scenarios = ['single-point', 'line', 'area', 'curve', 'paused', 'saved', 'saved-and-draft', 'extension', 'extension-without-points'];
for (const scenario of scenarios) {
  test(`Clear confirms and removes ${scenario} through the actual toolbar handler`, () => {
    const h = harness();
    try {
      prepare(h, scenario); const mode = h.drawing.mode, paused = h.drawing.paused;
      h.click();
      assert.deepEqual(h.prompts, ['Delete all drawings?']);
      for (const key of ['features', 'draft', 'draftCurved']) assert.deepEqual(h.drawing[key], [], key);
      for (const key of ['cursor', 'selected', 'extending']) assert.equal(h.drawing[key], null, key);
      for (const key of ['atlas-drawing', 'atlas-drawing-draft', 'atlas-drawing-handles']) assert.deepEqual(h.sources[key].data.features, [], key);
      assert.deepEqual(JSON.parse(h.stored.get(storedKey)), {type: 'FeatureCollection', features: []});
      assert.equal(h.drawing.mode, mode, 'clearing keeps the chosen drawing tool');
      assert.equal(h.drawing.paused, paused, 'clearing preserves the Move map state');
      h.drawing.cancel(); h.drawing.finish();
      assert.deepEqual(h.drawing.collection().features, [], 'cancel/finish cannot resurrect a cleared extension');
      assert.deepEqual(new Drawing(h.map).features, [], 'reload cannot restore cleared drawings');
      h.click(); assert.equal(h.prompts.length, 1, 'repeated Clear on an empty drawing does not prompt');
    } finally { h.close(); }
  });
  test(`declining Clear preserves ${scenario} and its saved/rendered state`, () => {
    const h = harness();
    try {
      prepare(h, scenario);
      const state = () => JSON.stringify({features: h.drawing.features, draft: h.drawing.draft,
        curved: h.drawing.draftCurved, cursor: h.drawing.cursor, selected: h.drawing.selected,
        extending: h.drawing.extending, mode: h.drawing.mode, paused: h.drawing.paused,
        stored: [...h.stored], sources: h.sources});
      const before = state(); h.click(false);
      assert.deepEqual(h.prompts, ['Delete all drawings?']);
      assert.equal(state(), before, 'declining performs no mutation or persistence write');
      if (scenario.startsWith('extension')) {
        h.drawing.cancel();
        assert.deepEqual(h.drawing.collection().features, [line], 'declined clearing retains extension cancellation recovery');
      }
    } finally { h.close(); }
  });
}

test('Clear ignores empty/cursor-only state and remains usable for a later drawing', () => {
  const h = harness();
  try {
    h.click(); h.drawing.setMode('line'); h.drawing.move({lng: 2, lat: 1}); h.click();
    assert.deepEqual(h.prompts, []); assert.equal(h.stored.size, 0);
    h.drawing.click({lng: 0, lat: 0}, {x: 500, y: 500}); h.click();
    assert.equal(h.prompts.length, 1); assert.deepEqual(h.drawing.draft, []);
    h.drawing.click({lng: 2, lat: 2}, {x: 500, y: 500});
    h.drawing.click({lng: 3, lat: 3}, {x: 600, y: 500}); h.drawing.finish();
    assert.deepEqual(h.drawing.features[0].geometry.coordinates, [[2, 2], [3, 3]], 'fresh drawing contains no cleared points');
  } finally { h.close(); }
});

test('Clear before drawing initialization remains a no-op', () => {
  const dom = new JSDOM('<button id="draw-clear">Clear</button>');
  let prompts = 0;
  try {
    vm.runInNewContext(handler, {drawing: undefined, $: id => dom.window.document.getElementById(id), confirm: () => prompts++});
    dom.window.document.getElementById('draw-clear').click(); assert.equal(prompts, 0);
  } finally { dom.window.close(); }
});
