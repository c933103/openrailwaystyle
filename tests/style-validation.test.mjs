import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateStyleMin, createExpression } from '@maplibre/maplibre-gl-style-spec';
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
