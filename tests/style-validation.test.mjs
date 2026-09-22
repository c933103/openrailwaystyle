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

test('translated label expressions retain native names when translation is absent or empty', async () => {
  const {labelExpression}=await import('../styles/map-model.mjs');
  for(const lang of ['local','en','ko','zh-Hant']) {
    const compiled=createExpression(labelExpression(lang,true));
    assert.equal(compiled.result,'success');
    const value=p=>compiled.value.evaluate({zoom:9},{type:1,properties:p});
    assert.equal(value({name:'서울'}),'서울');
    assert.equal(value({'name:nonlatin':'서울','name:latin':'Seoul'}),'서울');
    assert.equal(value({'name:en':'',name:'서울'}),'서울');
    assert.equal(value({'name:en':null,name:'서울'}),'서울');
  }
  const compiled=createExpression(labelExpression('en',true));
  assert.equal(compiled.value.evaluate({zoom:9},{type:1,properties:{name:'서울',localized_name:'Seoul'}}),'Seoul');
});
