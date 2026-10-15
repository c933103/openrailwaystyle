import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {featureFilter,validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {annotateLayers, layerVisibility} from '../styles/layer-semantics.mjs';
import {labelExpression} from '../styles/map-model.mjs';
import {assertSourceContracts} from '../scripts/style/source-contract.mjs';
import {addStationFallbackLayers, createStationFallbackState, stationFallbackFilter, STATION_BASEMAP_POI_FILTER, STATION_FALLBACK_IDS, stationFallbackNamesEnabled, stationFallbackMarkersEnabled, shouldRefreshCuratedStationSource} from '../styles/station-fallback.mjs';

const failedTile = (x=518,y=352,z=10) => ({state:'errored',tileID:{canonical:{z,x,y}}});
const contains = (filter, tile, properties={class:'railway',subclass:'station',feature:'station',tier:3}) =>
  featureFilter(filter).filter({zoom:tile.z},{type:1,properties,geometry:[[{x:4096,y:4096}]]},tile);

test('mixed station failures scope basemap dots, names and curated hubs to failed tiles', () => {
  const sources={stations:{url:'atlasstation://en/stations'}},state=createStationFallbackState({getSource:id=>sources[id]});
  const a=failedTile(),b=failedTile(519);
  for(const status of [503,403]){
    state.noteError({sourceId:'stations',tile:a,error:{status}});
    for(const id of STATION_FALLBACK_IDS){
      const filter=stationFallbackFilter(id,state.area(10));
      assert.equal(contains(filter,a.tileID.canonical),true,`${status} ${id}: failed tile`);
      assert.equal(contains(filter,b.tileID.canonical),false,`${status} ${id}: healthy neighbor`);
    }
    state.noteSourceData({sourceId:'stations',isSourceLoaded:true,tile:{...b,state:'loaded'}});
    assert.ok(state.area(10),'healthy neighbor completion does not recover the failed tile');
  }
  state.noteError({sourceId:'stations',tile:b,error:{status:503}});
  state.noteSourceData({sourceId:'stations',tile:{...a,state:'loaded'}});
  const filter=stationFallbackFilter(STATION_FALLBACK_IDS[0],state.area(10));
  assert.equal(contains(filter,a.tileID.canonical),false,'only recovered tile loses fallback');
  assert.equal(contains(filter,b.tileID.canonical),true,'other failure survives recovery');
  b.state='unloaded';
  assert.equal(state.area(10),null,'panning unloads retired failed tiles');
  state.noteError({sourceId:'stations',tile:failedTile(520),error:{status:503}});
  assert.ok(state.area(10),'new viewport failure is independently tracked');
  sources.stations={url:'atlasstation://fr/stations'};
  assert.equal(state.area(10),null,'style/source replacement cannot retain old failures');
});

test('only metadata failures permit source-wide fallback; success, language and aborts retire it', () => {
  const source={url:'atlasstation://en/stations'},state=createStationFallbackState({getSource:()=>source});
  state.noteError({sourceId:'stations',tile:{state:'errored'},error:{status:503}});
  assert.equal(state.area(10),null,'unlocated tile is not treated as a source-wide error');
  state.noteError({sourceId:'stations',error:{status:403}});
  assert.equal(state.area(10),true);
  state.noteSourceData({sourceId:'stations',tile:{...failedTile(),state:'loaded'},isSourceLoaded:true});
  assert.equal(state.area(10),true,'tile completion cannot clear failed metadata');
  state.noteSourceData({sourceId:'stations',sourceDataType:'metadata'});
  assert.equal(state.area(10),null);
  state.noteError({sourceId:'stations',tile:failedTile(),error:{name:'AbortError'}});
  assert.equal(state.area(10),null);
  state.noteError({sourceId:'stations',tile:failedTile(),error:{status:503}});
  source.url='atlasstation://fr/stations';
  assert.equal(state.area(10),null,'same source object with a changed URL drops old-language failures');
  state.noteError({sourceId:'stationMed',tile:failedTile(1,1,7),error:{status:503}});
  assert.ok(state.area(7));assert.equal(state.area(8),null);assert.equal(state.area(6),null);
});

test('failed-tile filters validate in the complete production style', async () => {
  const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
  addStationFallbackLayers(style,{annotateLayers,labelExpression});
  const source={},state=createStationFallbackState({getSource:()=>source});
  state.noteError({sourceId:'stations',tile:failedTile(),error:{status:503}});
  for(const area of [null,true,state.area(10)]){
    for(const id of STATION_FALLBACK_IDS)style.layers.find(l=>l.id===id).filter=stationFallbackFilter(id,area);
    assert.deepEqual(validateStyleMin(style).map(error=>error.message),[]);
  }
});

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

test('curated station fallback can populate after a cold load at maximum More detail zoom', () => {
  const settings={ready:true,stationsEnabled:true,background:'map'};
  for(const zoom of [3,7,9.8,21.999,22,24])
    assert.equal(shouldRefreshCuratedStationSource({...settings,zoom}),true,'raw zoom '+zoom);
  for(const zoom of [-1,0,2.99,NaN,Infinity])
    assert.equal(shouldRefreshCuratedStationSource({...settings,zoom}),false,'invalid or insufficient zoom '+zoom);
  assert.equal(shouldRefreshCuratedStationSource({...settings,stationsEnabled:false,zoom:22}),false);
  assert.equal(shouldRefreshCuratedStationSource({...settings,background:'satellite',zoom:22}),false);
  assert.equal(shouldRefreshCuratedStationSource({...settings,ready:false,zoom:22}),false);
});

const viewport=(west,south,east,north)=>({getWest:()=>west,getSouth:()=>south,getEast:()=>east,getNorth:()=>north});
test('coordinate-only failures retire after a pan without a tile lifecycle event',()=>{
 let bounds=viewport(2,48,3,49);const source={};
 const state=createStationFallbackState({getSource:()=>source,getBounds:()=>bounds});
 const coord={canonical:{z:10,x:518,y:352}};
 for(const status of [403,503]){
  bounds=viewport(2,48,3,49);state.noteError({sourceId:'stations',coord,error:{status}});
  assert.ok(state.area(10));assert.equal(state.hasSourceFailure('stations'),true);
  bounds=viewport(20,48,21,49);
  assert.equal(state.area(10),null);assert.equal(state.hasSourceFailure('stations'),false);
  bounds=viewport(2,48,3,49);assert.equal(state.area(10),null,'returning cannot resurrect a retired error');
 }
});
test('coordinate-only retirement handles wrapped bounds and latitude exclusion',()=>{
 let bounds=viewport(170,-60,-170,60);const source={};
 const state=createStationFallbackState({getSource:()=>source,getBounds:()=>bounds});
 const error=x=>state.noteError({sourceId:'stations',coord:{canonical:{z:2,x,y:1}},error:{status:403}});
 error(0);error(3);assert.equal(state.area(10).coordinates.length,2);
 bounds=viewport(530,-60,550,60);assert.equal(state.area(10).coordinates.length,2,'wrapped world copy retained');
 bounds=viewport(-180,70,180,80);assert.equal(state.area(10),null,'latitude proves exclusion even across full world');
 bounds=viewport(-180,-60,180,60);error(0);error(3);assert.equal(state.area(10).coordinates.length,2);
 bounds=viewport(0,-60,20,60);assert.equal(state.area(10),null);
});
test('unknown bounds do not invent offscreen evidence or clear metadata failure',()=>{
 let bounds=undefined;const source={};const state=createStationFallbackState({getSource:()=>source,getBounds:()=>bounds});
 state.noteError({sourceId:'stations',coord:{canonical:{z:10,x:518,y:352}},error:{status:503}});
 assert.ok(state.area(10));bounds=viewport(NaN,48,NaN,49);assert.ok(state.area(10));
 state.noteError({sourceId:'stations',error:{status:403}});bounds=viewport(20,48,21,49);assert.equal(state.area(10),true);
});

test('coordinate-only failures expire when camera tile selection or station band changes',()=>{
 let zoom=10;const source={maxzoom:22};const state=createStationFallbackState({getSource:()=>source,getZoom:()=>zoom});
 const fail=()=>state.noteError({sourceId:'stations',coord:{canonical:{z:10,x:518,y:352}},error:{status:403}});
 fail();assert.ok(state.area(zoom));zoom=10.9;assert.ok(state.area(zoom),'fractional zoom within same selection retains error');
 zoom=11;assert.equal(state.area(zoom),null);assert.equal(state.hasSourceFailure('stations'),false);
 state.noteSourceData({sourceId:'stations',tile:{state:'loaded',tileID:{canonical:{z:11,x:1036,y:704}}}});
 assert.equal(state.area(zoom),null,'healthy child cannot revive obsolete parent');
 zoom=10;fail();zoom=7;assert.equal(state.hasSourceFailure('stations'),false,'inactive station source band retires coord-only errors');
 zoom=10;assert.equal(state.area(zoom),null);
});
test('overzooming unchanged canonical source selection retains coord-only failures',()=>{
 let zoom=14;const source={maxzoom:14};const state=createStationFallbackState({getSource:()=>source,getZoom:()=>zoom});
 const coord={canonical:{z:14,x:8290,y:5640}};
 state.noteError({sourceId:'stations',coord,error:{status:503}});assert.ok(state.area(zoom));
 zoom=20;assert.ok(state.area(zoom),'source maxzoom caps canonical selection');
 state.noteSourceData({sourceId:'stations',tile:{state:'loaded',tileID:coord}});assert.equal(state.area(zoom),null);
});
test('tile-object failures retain explicit lifecycle authority across zoom changes',()=>{
 let zoom=10;const source={maxzoom:22};const state=createStationFallbackState({getSource:()=>source,getZoom:()=>zoom});
 const tile=failedTile();state.noteError({sourceId:'stations',tile,error:{status:503}});
 zoom=11;assert.ok(state.area(zoom));tile.state='unloaded';assert.equal(state.area(zoom),null);
});

test('delayed coordinate-only parent failures cannot adopt a newer camera selection',()=>{
 let zoom=11;const source={maxzoom:22};const state=createStationFallbackState({getSource:()=>source,getZoom:()=>zoom});
 const event={sourceId:'stations',coord:{canonical:{z:10,x:518,y:352}},error:{status:403}};
 assert.equal(state.noteError(event),true,'obsolete event remains owned for status cleanup');
 assert.equal(state.area(zoom),null);assert.equal(state.hasSourceFailure('stations'),false);
 zoom=7;assert.equal(state.noteError(event),true);assert.equal(state.hasSourceFailure('stations'),false);
 zoom=10;assert.equal(state.area(zoom),null,'returning cannot revive discarded events');
});

test('active inventory preserves mixed LOD and retires removed or replaced coordinate-only tiles',()=>{
 let zoom=11;const source={maxzoom:22};let tiles=[];
 const manager={getSource:()=>source,getIds:()=>tiles.map((_,i)=>i),getTileByID:i=>tiles[i]};
 const state=createStationFallbackState({getSource:()=>source,getZoom:()=>zoom,style:{tileManagers:{stations:manager}}});
 const a=failedTile(),event={sourceId:'stations',coord:a.tileID,error:{status:503}};
 tiles=[{...failedTile(1036,704,11),state:'loaded'}];
 assert.equal(state.noteError(event),true);assert.equal(state.area(zoom),null,'old parent no longer in inventory');
 tiles.push(a);state.noteError(event);assert.ok(state.area(zoom),'active lower-LOD errored tile retained');
 zoom=12;assert.ok(state.area(zoom),'camera heuristic cannot discard active mixed LOD');
 tiles[1]=failedTile();assert.equal(state.area(zoom),null,'same coordinate replacement has independent lifecycle');
 state.noteError(event);assert.ok(state.area(zoom));tiles.pop();assert.equal(state.area(zoom),null,'removal retires without unloaded notification');
 tiles=[{...a,state:'loaded'}];state.noteError(event);assert.equal(state.area(zoom),null,'late event cannot mask a healthy replacement');
 tiles=[{...a,state:'loaded'},a];state.noteError(event);assert.ok(state.area(zoom),'failed world copy survives healthy copy');
 a.state='loaded';assert.equal(state.area(zoom),null,'hydrated lifecycle recovery clears failure');
});

test('inventory belonging to a replaced source cannot authorize obsolete coordinates',()=>{
 const source={maxzoom:22},oldSource={maxzoom:22},tile=failedTile();
 const state=createStationFallbackState({getSource:()=>source,getZoom:()=>11,style:{tileManagers:{stations:{
  getSource:()=>oldSource,getIds:()=>[0],getTileByID:()=>tile,
 }}}});
 state.noteError({sourceId:'stations',coord:tile.tileID,error:{status:503}});assert.equal(state.area(11),null);
});

test('pinned renderer exposes active errored-tile inventory rather than renderable-only coordinates',async()=>{
 const source=await readFile(new URL('../node_modules/maplibre-gl/src/tile/tile_manager.ts',import.meta.url),'utf8');
 assert.match(source,/getIds\(\)[^{]*\{\s*return this\._inViewTiles\.getAllIds\(true\);/);
 assert.match(source,/getTileByID\(id:[^)]*\)[^{]*\{\s*return this\._inViewTiles\.getTileById\(id\);/);
 assert.match(source,/getSource\(\)/);
 const style=await readFile(new URL('../node_modules/maplibre-gl/src/style/style.ts',import.meta.url),'utf8');
 assert.match(style,/tileManagers/);
});
