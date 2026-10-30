import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {featureFilter,validateStyleMin,expression} from '@maplibre/maplibre-gl-style-spec';
import {AERIALWAY_KINDS,AERIALWAY_CABLE,CONVEYING_COLOUR,UNKNOWN_COLOR,OTHER_TRACK,aerialwayKind,osmObject,ownerColor,speedBands,viewLinePaint,viewLineWidth,VIEW_LINE_LAYERS} from '../styles/map-model.mjs';
import {aerialwayLayers} from '../scripts/style/layers/aerialways.mjs';
import {AERIALWAY_QUERY,AERIALWAY_ZOOM,aerialwaysGeoJSON,conveyingTiles} from '../scripts/conveying-data.mjs';
import {viewValues} from '../styles/conveying.mjs';
import {layerVisibility} from '../styles/layer-semantics.mjs';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';

const style=JSON.parse(readFileSync(new URL('../styles/world.style.json',import.meta.url)));
const layers=style.layers.filter(l=>l.id.startsWith('aerialway-'));
const draws=(layer,properties,zoom=14)=>featureFilter(layer.filter).filter({zoom},{type:2,properties,geometry:[]});
const way=(id,tags)=>({type:'way',id,tags,geometry:[{lon:113.9,lat:22.25},{lon:113.94,lat:22.29}]});
const colour=(paint,properties)=>expression.createExpression(paint).value.evaluate({zoom:14},{properties});

test('aerial cableways and lifts come from the project aerialway snapshot, one cable and one tick layer each',()=>{
  assert.deepEqual(layers.map(l=>l.id),['aerialway-cableway-cable','aerialway-cableway-ticks','aerialway-lift-cable','aerialway-lift-ticks']);
  assert.deepEqual(aerialwayLayers().map(l=>l.id),layers.map(l=>l.id));
  for(const layer of layers){assert.equal(layer.source,'aerialways');assert.equal(layer['source-layer'],'aerialways');assert.equal(layer.minzoom,12);}
  assert.deepEqual(style.sources.aerialways.tiles,['aerialwaytiles://{z}/{x}/{y}']);
  assert.equal(style.sources.aerialways.minzoom,AERIALWAY_ZOOM);assert.equal(style.sources.aerialways.maxzoom,AERIALWAY_ZOOM);
  const index=id=>style.layers.findIndex(l=>l.id===id);
  assert.ok(index('aerialway-cableway-cable')<index('aerialway-cableway-ticks'),'ticks sit on their cable');
  assert.ok(index('infrastructure-tracks')<index('aerialway-cableway-cable'),'drawn above railway lines');
  for(const kind of AERIALWAY_KINDS)assert.equal(draws(layers.find(l=>l.id===`aerialway-${kind.id}-cable`),{kind:kind.id}),true);
  assert.equal(draws(layers.find(l=>l.id==='aerialway-cableway-cable'),{kind:'lift'}),false);
});

test('the snapshot keeps every cableway and lift way with its names, owner and maxspeed, and nothing else',()=>{
  for(const subclass of AERIALWAY_KINDS.flatMap(k=>k.subclasses))assert.ok(AERIALWAY_QUERY.includes(subclass),subclass);
  assert.match(AERIALWAY_QUERY,/out tags geom;$/);
  // Ngong Ping 360 (way 26351045, OSM API October 2026), with an owner and speed added for the test.
  const data=aerialwaysGeoJSON({elements:[
    way(26351045,{aerialway:'gondola',name:'昂坪纜車 Ngong Ping Cable Car','name:en':'Ngong Ping Cable Car',owner:'Test Owner',maxspeed:'25',operator:'MTR',wikidata:'Q1'}),
    way(2,{aerialway:'chair_lift',maxspeed:'10 mph'}),way(3,{aerialway:'station'}),way(4,{aerialway:'zip_line'}),way(5,{highway:'footway'}),
  ]});
  assert.deepEqual(data.features.map(f=>[f.id,f.properties.kind,f.properties.aerialway]),[[2,'lift','chair_lift'],[26351045,'cableway','gondola']]);
  const np=data.features[1].properties;
  assert.deepEqual(Object.keys(np).sort(),['aerialway','kind','maxspeed','name','name:en','osm_id','owner','owner_color'].sort(),'operator and other tags stay out');
  assert.equal(np.owner_color,ownerColor('Test Owner'),'same owner colour as a track with that owner');
  assert.equal(np.maxspeed,25);assert.equal(data.features[0].properties.maxspeed,16,'mph converted to km/h');
  assert.deepEqual(viewValues({}),{},'no owner or speed, nothing invented');
  assert.deepEqual(viewValues({maxspeed:'fast',owner:' '},ownerColor),{});
  assert.throws(()=>aerialwaysGeoJSON({remark:'runtime error: Query timed out',elements:[]}),/timed out/);
  const tiles=conveyingTiles(data.features,{z:AERIALWAY_ZOOM,layer:'aerialways'});
  assert.ok([...tiles.keys()].every(key=>key.startsWith(`${AERIALWAY_ZOOM}/`)));
  const decoded=[...tiles.values()].map(bytes=>new VectorTile(new Pbf(bytes)).layers.aerialways);
  assert.ok(decoded.every(Boolean),'tiles carry the aerialways layer');
});

test('aerialways show in every view and on every background but satellite',()=>{
  const settings={mode:'infrastructure',labels:true,inactive:true,background:'map'};
  for(const layer of layers){
    assert.notEqual(layer.layout.visibility,'none','drawn from the first frame of the default view');
    for(const mode of ['speed','infrastructure','electrification','control','gauge','loading','axle','owner','service'])
      assert.equal(layerVisibility(layer,{...settings,mode}),true,`${layer.id} in ${mode}`);
    assert.equal(layerVisibility(layer,{...settings,labels:false,inactive:false}),true,'no setting turns them off');
    for(const background of ['hybrid','carto'])assert.equal(layerVisibility(layer,{...settings,background}),true,background);
    assert.equal(layerVisibility(layer,{...settings,background:'satellite'}),false);
  }
});

test('each view colours aerialway cables and escalator lines by its own value from their tags',()=>{
  const owned={owner:'Test Owner',owner_color:ownerColor('Test Owner'),maxspeed:25};
  for(const id of Object.keys(VIEW_LINE_LAYERS)){
    const own=id==='conveying-lines'?CONVEYING_COLOUR:AERIALWAY_CABLE;
    for(const mode of ['infrastructure','electrification'])assert.equal(viewLinePaint(id,mode),own,`${id} shows its type in ${mode}`);
    assert.equal(colour(viewLinePaint(id,'owner'),owned),ownerColor('Test Owner'),'Owner: by owner');
    assert.equal(colour(viewLinePaint(id,'owner'),{}),UNKNOWN_COLOR,'Owner: unknown without one');
    const band=speedBands('metric').filter(b=>(b.kmh??b.min??0)<=25).at(-1).color;
    assert.equal(colour(viewLinePaint(id,'speed','metric'),owned),band,'Speed: by maxspeed');
    assert.equal(colour(viewLinePaint(id,'speed','metric'),{}),UNKNOWN_COLOR,'Speed: unknown without one');
    assert.equal(viewLinePaint(id,'service'),OTHER_TRACK,'Service: other track');
    for(const mode of ['gauge','loading','axle','control'])assert.equal(viewLinePaint(id,mode),UNKNOWN_COLOR,`${mode}: none of its values exist on these`);
    assert.notDeepEqual(viewLineWidth(id,'owner'),viewLineWidth(id,'infrastructure'),'thematic views draw a readable width');
  }
  // Ticks and arrows keep showing the type in every view.
  for(const id of ['aerialway-cableway-ticks','aerialway-lift-ticks'])assert.equal(VIEW_LINE_LAYERS[id],undefined);
});

test('lift ticks are sparser than cableway ticks',()=>{
  const gap=id=>{const l=layers.find(x=>x.id===`aerialway-${id}-ticks`);return l.paint['line-dasharray'][1]*l.paint['line-width'];};
  assert.ok(gap('lift')>gap('cableway'));
  assert.deepEqual(validateStyleMin({...style,layers}).filter(e=>!/source/.test(e.message)),[]);
});

test('a clicked aerialway links its OSM way from the snapshot id, and its kind',()=>{
  assert.deepEqual(osmObject({source:'aerialways',properties:{osm_id:'26351045',kind:'cableway'}}),{type:'way',id:'26351045'});
  assert.equal(aerialwayKind('gondola').id,'cableway');assert.equal(aerialwayKind('t-bar').id,'lift');assert.equal(aerialwayKind('zip_line'),undefined);
});
