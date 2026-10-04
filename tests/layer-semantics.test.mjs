import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODES, BACKGROUNDS } from '../styles/map-model.mjs';
import { annotateLayers, getLayerSemantics, isBaseMap, layerVisibility, shouldLocalizeLayer } from '../styles/layer-semantics.mjs';

const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));
// An independent copy of the browser policy, with the explicitly requested
// shared signal and Power-supply controls. This does not call the annotation
// adapter: it detects mistakes in that conversion.
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
  if (layer.id.startsWith('infrastructure-signal-')) visible = ['infrastructure','control'].includes(settings.mode) && (!layer.id.endsWith('-references') || settings.labels);
  if (/^electrification-(former-)?supply-/.test(layer.id)) visible = settings.mode === 'electrification' && (!layer.id.endsWith('-names') || settings.labels) && (!layer.id.startsWith('electrification-former-') || settings.inactive);
  if (layer.id.startsWith('terrain-')) visible = settings.relief;
  if (layer.id.startsWith('context-transport-')) visible = settings.transport;
  if (layer.id.startsWith('context-destinations-')) visible = settings.destinations;
  if (layer.id.startsWith('context-constraints-')) visible = settings.constraints;
  if (layer.id === 'carto') visible = settings.background === 'carto';
  else if (layer.id === 'satellite') visible = ['satellite', 'hybrid'].includes(settings.background);
  else if (settings.background === 'satellite' && !runtime) visible = false;
  else if (settings.background === 'hybrid' && baseMap) visible = false;
  else if (settings.background === 'carto' && baseMap && !layer.id.startsWith('terrain-')) visible = false;
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

test('signal locations share Infrastructure and train-control visibility while references follow labels',()=>{
  const signals=style.layers.filter(layer=>layer.id.startsWith('infrastructure-signal-'));
  assert.ok(signals.length>=4,'provider and supplementary signal layers are present');
  const settings={...Object.fromEntries(booleans.map(key=>[key,true])),background:'map'};
  for (const signal of signals) {
    assert.deepEqual(getLayerSemantics(signal)['atlas:views'],['infrastructure','control'],signal.id);
    for (const mode of ['infrastructure','control']) {
      assert.equal(layerVisibility(signal,{...settings,mode}),true,`${signal.id} in ${mode}`);
      assert.equal(layerVisibility(signal,{...settings,mode,labels:false}),!signal.id.endsWith('-references'),signal.id);
      assert.equal(layerVisibility(signal,{...settings,mode,background:'hybrid'}),true,signal.id);
      assert.equal(layerVisibility(signal,{...settings,mode,background:'carto'}),true,signal.id);
      assert.equal(layerVisibility(signal,{...settings,mode,background:'satellite'}),false,signal.id);
    }
    assert.equal(layerVisibility(signal,{...settings,mode:'speed'}),false,signal.id);
    assert.equal(shouldLocalizeLayer(signal),false,'signal references remain mapped identifiers');
  }
});

test('Power facility names follow labels, former supplies follow inactive, and both stay in Power view',()=>{
  const supplies=style.layers.filter(layer=>layer.source==='electricFacilities');
  assert.equal(supplies.length,6);
  const settings={...Object.fromEntries(booleans.map(key=>[key,true])),mode:'electrification',background:'map',names:false};
  for (const supply of supplies) {
    const former=supply.id.startsWith('electrification-former-'),name=supply.id.endsWith('-names');
    assert.equal(layerVisibility(supply,settings),true,supply.id);
    assert.equal(layerVisibility(supply,{...settings,mode:'control'}),false,supply.id);
    assert.equal(layerVisibility(supply,{...settings,labels:false}),!name,supply.id);
    assert.equal(layerVisibility(supply,{...settings,inactive:false}),!former,supply.id);
    assert.equal(layerVisibility(supply,{...settings,background:'hybrid'}),true,supply.id);
    assert.equal(layerVisibility(supply,{...settings,background:'carto'}),true,supply.id);
    assert.equal(layerVisibility(supply,{...settings,background:'satellite'}),false,supply.id);
    assert.equal(shouldLocalizeLayer(supply),name,supply.id);
  }
});
