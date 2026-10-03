import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertSourceContracts, consumedLayerFields} from '../scripts/style/source-contract.mjs';
import {createSources, GLYPHS} from '../scripts/style/sources/index.mjs';
import {composeStyle} from '../scripts/style/compose-style.mjs';
import {LANGUAGES, labelExpression} from '../styles/map-model.mjs';
import {shouldLocalizeLayer} from '../styles/layer-semantics.mjs';

const style = JSON.parse(readFileSync(new URL('../styles/world.style.json', import.meta.url)));
const withLayer = layer => ({sources:style.sources, layers:[layer]});

test('the generated style consumes only declared provider layers and attributes', () => {
  assert.doesNotThrow(() => assertSourceContracts(style));
});

test('source contracts cover runtime label fields in every offered language', () => {
  for (const [language] of LANGUAGES) {
    const localized = structuredClone(style);
    for (const layer of localized.layers) {
      if (shouldLocalizeLayer(layer)) layer.layout['text-field'] = labelExpression(language);
    }
    assert.doesNotThrow(() => assertSourceContracts(localized), language);
  }
});

test('composed source definitions preserve the generated source URLs and configuration', () => {
  assert.equal(JSON.stringify(createSources(style.sources.stationMajor.data)), JSON.stringify(style.sources));
  assert.equal(GLYPHS, style.glyphs);
});

test('source contracts reject unknown sources and source layers', () => {
  assert.throws(() => assertSourceContracts(withLayer({id:'invalid-source', source:'missing'})), /invalid-source: unknown source missing/);
  assert.throws(() => assertSourceContracts(withLayer({id:'invalid-layer', source:'openmaptiles', 'source-layer':'misspelled_water'})), /invalid-layer: undeclared source layer openmaptiles\/misspelled_water/);
});

test('source contracts reject misspelled modern and legacy field references', () => {
  for (const filter of [['==', ['get', 'intermitent'], 1], ['==', 'intermitent', 1]]) {
    assert.throws(() => assertSourceContracts(withLayer({id:'invalid-field', source:'openmaptiles', 'source-layer':'water', filter})), /invalid-field: undeclared field openmaptiles\/water\/intermitent/);
  }
});

test('field discovery handles legacy filters and label tokens without treating literals as reads', () => {
  const fields = consumedLayerFields({
    filter:['all', ['in', 'class', 'river'], ['==', ['get', 'state'], 'present'], ['==', '$type', 'LineString']],
    layout:{'text-field':'{name:en}'},
    paint:{'line-color':['literal', ['get', 'literal_value']], 'line-width':['get', 'object_value', ['literal', {}]]},
  });
  assert.deepEqual([...fields].sort(), ['class', 'name:en', 'state']);
});

test('close-zoom infrastructure source contracts cover platform geometry, signal references and entrances', () => {
  const sources = createSources({type:'FeatureCollection', features:[]});
  assert.doesNotThrow(() => assertSourceContracts({sources, layers:[
    {id:'platform', source:'platforms', 'source-layer':'standard_railway_platforms', filter:['==', ['geometry-type'], 'Polygon']},
    {id:'signal', source:'railwaySignals', 'source-layer':'railway_signals', filter:['==', ['get', 'railway'], 'signal'], layout:{'text-field':['coalesce', ['get', 'ref'], ['get', 'caption'], '']}},
    {id:'entrance', source:'stationEntrances', 'source-layer':'standard_station_entrances', layout:{'text-field':['get', 'label']}},
  ]}));
});

test('each composition owns its sources, GeoJSON and layers without changing the input', () => {
  const majorStationData = {type:'FeatureCollection', features:[{type:'Feature', geometry:{type:'Point', coordinates:[1, 2]}, properties:{name:'Station'}}]};
  const inputBefore = structuredClone(majorStationData);
  const options = {majorStationData, curatedFilter:['==', ['get', 'id'], 'example']};
  const first = composeStyle(options), before = structuredClone(first);
  first.sources.stationMajor.data.features[0].properties.name = 'Changed';
  first.sources.stationMajor.data.features[0].geometry.coordinates[0] = 9;
  first.sources.openmaptiles.url = 'changed://provider';
  first.sources.satellite.tiles[0] = 'changed://imagery';
  first.layers[0].paint['background-color'] = '#000000';
  first.layers.find(layer => shouldLocalizeLayer(layer)).layout['text-field'] = 'Changed';
  assert.deepEqual(majorStationData, inputBefore);
  assert.deepEqual(composeStyle(options), before);
});
