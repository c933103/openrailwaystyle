import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateStyleMin, createExpression } from '@maplibre/maplibre-gl-style-spec';
import {installHybridRailCasings, layerVisibility} from '../styles/layer-semantics.mjs';
const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));

test('generated worldwide style validates against MapLibre', () => {
  assert.deepEqual(validateStyleMin(style).map(e => e.message), []);
});
test('MapLibre evaluates unknown and mph-normalized speeds correctly', () => {
  const expression = style.layers.find(l => l.id === 'speed-tracks').paint['line-color'];
  const compiled = createExpression(expression);
  assert.equal(compiled.result, 'success');
  const evalColor = properties => compiled.value.evaluate({ zoom:12 }, { type:2, properties });
  assert.equal(evalColor({}), '#899197');
  assert.equal(evalColor({ maxspeed:null }), '#899197');
  assert.equal(evalColor({ maxspeed:0 }), '#536da8');
  assert.equal(evalColor({ maxspeed:160.9344 }), '#d98213');
  assert.equal(evalColor({ maxspeed:300 }), '#742da0');
});

test('network colours distinguish classes, including empty service fields', () => {
  const expression=style.layers.find(l=>l.id==='infrastructure-tracks').paint['line-color'];
  const compiled=createExpression(expression);assert.equal(compiled.result,'success');
  const color=p=>compiled.value.evaluate({zoom:12},{type:2,properties:p});
  const values=[{highspeed:true},{feature:'rail',service:null},{feature:'rail',usage:'branch',service:''},{feature:'subway'},{feature:'tram'},{service:'siding'}].map(color);
  assert.equal(new Set(values).size,6);
  assert.equal(color({feature:'rail'}),color({feature:'rail',service:''}));
});

test('Hybrid uses a centred casing over the same detailed rail data and does not change other render modes', () => {
  const augmented=structuredClone(style);
  installHybridRailCasings(augmented);
  installHybridRailCasings(augmented);
  const {layers}=augmented, isCasing=l=>l.id.startsWith('hybrid-')&&l.id.endsWith('-casing');
  const casings=layers.filter(isCasing);
  assert.equal(casings.length,18);
  assert.deepEqual(augmented.sources,style.sources);
  assert.deepEqual(layers.filter(l=>!isCasing(l)),style.layers);
  assert.deepEqual(validateStyleMin(augmented).map(e=>e.message), []);
  for(const casing of casings){
    const base=layers.find(l=>l.id===casing.id.slice(7,-7));
    for(const field of ['source','source-layer','filter','minzoom','maxzoom'])
      assert.deepEqual(casing[field],base[field],`${casing.id} ${field}`);
    const mode=casing.metadata['atlas:views'][0];
    for(const background of ['map','carto','satellite','hybrid'])
      assert.equal(layerVisibility(casing,{mode,background}),background==='hybrid');
    assert.equal(layerVisibility(casing,{mode:'unrelated',background:'hybrid'}),false);
    assert.equal(casing.paint['line-offset'],undefined);
    assert.ok(layers.indexOf(casing)<layers.indexOf(base));
    assert.ok(layers.indexOf(casing)<layers.findIndex(l=>l.id==='structure-bridge-edge'));
  }
});
