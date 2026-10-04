import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODES, BACKGROUNDS } from '../styles/map-model.mjs';
import { annotateLayers, getLayerSemantics, isBaseMap, layerVisibility, shouldLocalizeLayer } from '../styles/layer-semantics.mjs';

const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));
// An independent copy of the pre-refactor browser policy. This intentionally
// does not call the annotation adapter: it detects mistakes in that conversion.
function originalVisibility(layer, settings) {
  const runtime = /^(drawing|measure)-|^polar-caps$/.test(layer.id);
  const valueLabels = /^(speed|electrification|control|gauge|loading|axle|owner)-labels$/;
  const baseMap = layer.source === 'openmaptiles' || layer.id === 'background' || layer.id.startsWith('terrain-');
  let visible = runtime ? undefined : true;
  if (MODES.some(mode => layer.id.startsWith(`${mode}-`))) visible = layer.id.startsWith(`${settings.mode}-`) && (!valueLabels.test(layer.id) || settings.labels) && (layer.source !== 'trackCounts' || settings.trackCounts);
  if (layer.id.startsWith('station-')) visible = settings.stations && (!layer.id.startsWith('station-former-') || settings.inactive);
  if (layer.id.startsWith('inactive-')) visible = settings.inactive;
  if (layer.id.endsWith('-names') && !layer.id.startsWith('station-')) visible = settings.names && (!layer.id.startsWith('inactive-') || settings.inactive) && (!layer.id.startsWith('service-') || settings.mode === 'service');
  if (layer.id.startsWith('platform-')) visible = settings.mode === 'infrastructure' && (!['platform-lengths', 'platform-numbers'].includes(layer.id) || settings.labels);
  if (/^infrastructure-(signal|entrance)-references$/.test(layer.id)) visible = settings.mode === 'infrastructure' && settings.labels;
  if (layer.id.startsWith('terrain-')) visible = settings.relief;
  if (layer.id.startsWith('context-transport-')) visible = settings.transport;
  if (layer.id.startsWith('context-destinations-')) visible = settings.destinations;
  if (layer.id.startsWith('context-constraints-')) visible = settings.constraints;
  if (layer.id === 'carto') visible = settings.background === 'carto';
  else if (layer.id === 'satellite') visible = ['satellite', 'hybrid'].includes(settings.background);
  else if (settings.background === 'satellite' && !runtime) visible = false;
  else if (settings.background === 'hybrid' && baseMap) visible = false;
  else if (settings.background === 'carto' && baseMap && !layer.id.startsWith('terrain-')) visible = false;
  if (layer.id === 'terrain-bathymetry' && settings.background === 'carto') visible = false;
  return visible;
}
const booleans = ['stations', 'trackCounts', 'labels', 'inactive', 'relief', 'names', 'transport', 'destinations', 'constraints'];
const allSettings = Array.from({length: 2 ** booleans.length}, (_, mask) => Object.fromEntries(booleans.map((key, i) => [key, !!(mask & 2 ** i)])));
const runtimeLayers = [{id: 'drawing-line', type: 'line'}, {id: 'drawing-fill', type: 'fill'}, {id: 'measure-point', type: 'circle'}, {id: 'polar-caps', type: 'custom'}];

test('annotation changes only metadata, preserving every rendering property and initial visibility', () => {
  const before = structuredClone(style.layers);
  for (const layer of before) delete layer.metadata;
  const layers = structuredClone(before);
  assert.equal(annotateLayers(layers), layers);
  assert.ok(layers.every(layer => layer.metadata['atlas:semantics-version'] === 1));
  const rendering = structuredClone(layers);
  for (const layer of rendering) delete layer.metadata;
  assert.deepEqual(rendering, before);
});

test('every existing layer preserves visibility across all views, backgrounds, and checkbox combinations', () => {
  const plain = [...structuredClone(style.layers), ...runtimeLayers];
  for (const layer of plain) delete layer.metadata;
  const declared = annotateLayers(structuredClone(plain));
  for (const mode of MODES) for (const background of BACKGROUNDS) for (const toggles of allSettings) {
    const settings = {...toggles, mode, background};
    for (let i = 0; i < plain.length; i++) {
      const expected = originalVisibility(plain[i], settings);
      const actual = layerVisibility(declared[i], settings);
      if (actual !== expected) assert.equal(actual, expected, `${plain[i].id}: ${JSON.stringify(settings)}`);
    }
  }
});

test('unannotated cached styles and runtime overlays preserve the previous visibility policy', () => {
  const layers = [...structuredClone(style.layers), ...runtimeLayers];
  for (const layer of layers) delete layer.metadata;
  for (const mode of MODES) for (const background of BACKGROUNDS) for (const enabled of [true, false]) {
    const settings = {...Object.fromEntries(booleans.map(key => [key, enabled])), mode, background};
    for (const layer of layers) assert.equal(layerVisibility(layer, settings), originalVisibility(layer, settings), `${layer.id}: ${mode}, ${background}, ${enabled}`);
  }
});

test('visibility and localization use declared roles even after every layer and source is renamed', () => {
  const original = annotateLayers(structuredClone(style.layers));
  const renamed = original.map((layer, i) => ({...layer, id: `renamed-${i}`, ...(layer.source ? {source: `provider-${i}`} : {})}));
  for (const mode of MODES) for (const background of BACKGROUNDS) for (const enabled of [true, false]) {
    const settings = {...Object.fromEntries(booleans.map(key => [key, enabled])), mode, background};
    for (let i = 0; i < original.length; i++) {
      assert.equal(layerVisibility(renamed[i], settings), layerVisibility(original[i], settings));
      assert.equal(shouldLocalizeLayer(renamed[i]), shouldLocalizeLayer(original[i]));
      assert.equal(isBaseMap(renamed[i]), isBaseMap(original[i]));
    }
  }
});

test('localization preserves unit values, references, contours, and track-count text', () => {
  const layers = annotateLayers(structuredClone(style.layers));
  for (const layer of layers) {
    const expected = layer.type === 'symbol' && layer.id !== 'speed-labels' && layer.id !== 'platform-lengths' && !layer.id.startsWith('terrain-') && (layer.source === 'openmaptiles' || layer.id.startsWith('station-') || layer.id.endsWith('-names'));
    assert.equal(shouldLocalizeLayer(layer), expected, layer.id);
  }
  for (const id of ['speed-labels', 'platform-lengths', 'terrain-contour-labels', 'infrastructure-track-count', 'infrastructure-level-crossings']) {
    assert.equal(shouldLocalizeLayer(layers.find(layer => layer.id === id)), false, id);
  }
});

test('new modules may declare semantic controls independently of provider and naming conventions', () => {
  const [layer] = annotateLayers([{id: 'custom-number', type: 'symbol', source: 'newProvider', layout: {visibility: 'none'}, metadata: {
    'atlas:group': 'platforms', 'atlas:views': ['infrastructure'], 'atlas:settings': ['labels'], 'atlas:base-map': false, 'atlas:localize': false,
  }}]);
  assert.deepEqual(getLayerSemantics(layer)['atlas:views'], ['infrastructure']);
  assert.equal(layerVisibility(layer, {mode: 'speed', labels: true, background: 'map'}), false);
  assert.equal(layerVisibility(layer, {mode: 'infrastructure', labels: true, background: 'hybrid'}), true);
  assert.equal(layerVisibility(layer, {mode: 'infrastructure', labels: false, background: 'map'}), false);
  assert.equal(shouldLocalizeLayer(layer), false);
  assert.equal(layer.layout.visibility, 'none');
});
