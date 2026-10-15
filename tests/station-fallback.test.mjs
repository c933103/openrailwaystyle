import test from 'node:test';
import assert from 'node:assert/strict';
import {featureFilter,validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {annotateLayers, layerVisibility} from '../styles/layer-semantics.mjs';
import {labelExpression} from '../styles/map-model.mjs';
import {assertSourceContracts} from '../scripts/style/source-contract.mjs';
import {addStationFallbackLayers, STATION_BASEMAP_POI_FILTER, STATION_FALLBACK_IDS, stationFallbackNamesEnabled, stationFallbackMarkersEnabled} from '../styles/station-fallback.mjs';

const sample = (cls, subclass) =>
  featureFilter(STATION_BASEMAP_POI_FILTER).filter({zoom: 12}, {type: 1, properties: {class: cls, subclass}});
test('fallback only accepts mapped rail station POIs, not entrances or road crossings', () => {
  for (const subclass of ['station', 'halt', 'tram_stop', 'subway'])
    assert.equal(sample('railway', subclass), true, subclass);
  for (const [cls, subclass] of [['railway', 'subway_entrance'], ['railway', 'level_crossing'], ['bus', 'bus_stop'], ['aerialway', 'station'], ['railway', 'platform']])
    assert.equal(sample(cls, subclass), false, cls + '/' + subclass);
});

test('fallback is added once, above crossing marks but beneath detailed station markers', () => {
  const style = {sources: {openmaptiles: {type: 'vector'}, stationMajor: {type: 'geojson'}},
    layers: [
      {id: 'infrastructure-crossing-marks', type: 'symbol'},
      {id: 'station-stationLow-dots', type: 'circle'},
      {id: 'station-stationLow-mover-names', type: 'symbol'},
      {id: 'station-detail-large-names', type: 'symbol'},
    ]};
  addStationFallbackLayers(style, {annotateLayers, labelExpression});
  const ids = style.layers.map(l => l.id), position = id => ids.indexOf(id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of STATION_FALLBACK_IDS) assert.ok(position(id) >= 0, id);
  assert.ok(position('infrastructure-crossing-marks') < position(STATION_FALLBACK_IDS[0]));
  assert.ok(position(STATION_FALLBACK_IDS[0]) < position(STATION_FALLBACK_IDS[1]));
  assert.ok(position(STATION_FALLBACK_IDS[1]) < position('station-stationLow-dots'));
  assert.ok(position(STATION_FALLBACK_IDS[2]) < position('station-stationLow-mover-names'));
  assert.ok(position(STATION_FALLBACK_IDS[2]) < position('station-detail-large-names'));
  const original = JSON.stringify(style);
  addStationFallbackLayers(style, {annotateLayers, labelExpression});
  assert.equal(JSON.stringify(style), original, 'cached-language restyling is idempotent');
  const fallback = style.layers.filter(l => STATION_FALLBACK_IDS.includes(l.id));
  for (const layer of fallback) {
    assert.equal(layer.metadata['atlas:group'], 'stations');
    assert.equal(layer.metadata['atlas:base-map'], false, 'station markers survive Carto/Hybrid');
    assert.equal(layerVisibility(layer, {stations: true, background: 'carto', mode: 'speed'}), true);
    assert.equal(layerVisibility(layer, {stations: true, background: 'hybrid', mode: 'speed'}), true);
    assert.equal(layerVisibility(layer, {stations: false, background: 'map', mode: 'speed'}), false);
    assert.equal(layerVisibility(layer, {stations: true, background: 'satellite', mode: 'speed'}), false);
  }
  assert.equal(style.layers.find(l=>l.id===STATION_FALLBACK_IDS[2]).layout.visibility, 'none');
});

test('station fallback activation is scoped to the active zoom band and its actual source failures', () => {
  const options={zoom:9.8,stationsEnabled:true,background:'map',failedSources:new Set(['stations'])};
  assert.equal(stationFallbackMarkersEnabled(options),true);
  assert.equal(stationFallbackNamesEnabled(options),true);
  assert.equal(stationFallbackNamesEnabled({...options,failedSources:new Set(['railway'])}),false);
  assert.equal(stationFallbackNamesEnabled({...options,zoom:7}),false);
  assert.equal(stationFallbackMarkersEnabled({...options,zoom:7}),false);
  assert.equal(stationFallbackMarkersEnabled({...options,zoom:7,failedSources:new Set(['stationMed'])}),true);
  assert.equal(stationFallbackMarkersEnabled({...options,zoom:6,failedSources:new Set(['stationLow'])}),false);
  assert.equal(stationFallbackNamesEnabled({...options,stationsEnabled:false}),false);
  assert.equal(stationFallbackNamesEnabled({...options,background:'satellite'}),false);
  assert.equal(stationFallbackNamesEnabled({...options,background:'hybrid'}),true);
  assert.equal(stationFallbackMarkersEnabled({...options,background:'hybrid'}),true);
  assert.equal(stationFallbackNamesEnabled({...options,failedSources:new Set()}),false);
});

test('entire deployed style plus fallback validates without new network sources', async () => {
  const style=JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));
  const originalSources=structuredClone(style.sources);
  const originalLayerCount=style.layers.length;
  addStationFallbackLayers(style,{annotateLayers,labelExpression});
  assert.deepEqual(style.sources, originalSources, 'no additional TileJSON, vectors or OSM network requests');
  assert.equal(style.layers.length, originalLayerCount+3);
  assert.deepEqual(validateStyleMin(style).map(error=>error.message),[]);
  assert.doesNotThrow(()=>assertSourceContracts(style));
  const low=style.layers.findIndex(layer=>layer.id==='infrastructure-crossing-overview');
  const fallback=style.layers.findIndex(layer=>layer.id==='station-basemap-fallback-dots');
  const provider=style.layers.findIndex(layer=>layer.id==='station-provider-dots');
  assert.ok(low>=0&&fallback>low&&provider>fallback,
    'fallback station dots paint above independent crossings and below provider stations');
});
