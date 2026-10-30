import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {featureFilter,validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {AERIALWAY_KINDS,aerialwayKind,osmObject} from '../styles/map-model.mjs';
import {aerialwayLayers} from '../scripts/style/layers/aerialways.mjs';
import {layerVisibility} from '../styles/layer-semantics.mjs';

const style=JSON.parse(readFileSync(new URL('../styles/world.style.json',import.meta.url)));
const layers=style.layers.filter(l=>l.id.startsWith('aerialway-'));
const draws=(layer,properties,zoom=14)=>featureFilter(layer.filter).filter({zoom},{type:2,properties,geometry:[]});

test('aerial cableways and lifts come from the basemap transportation layer, one cable and one tick layer each',()=>{
  assert.deepEqual(layers.map(l=>l.id),['aerialway-cableway-cable','aerialway-cableway-ticks','aerialway-lift-cable','aerialway-lift-ticks']);
  assert.deepEqual(aerialwayLayers().map(l=>l.id),layers.map(l=>l.id));
  for(const layer of layers){
    assert.equal(layer.source,'openmaptiles');assert.equal(layer['source-layer'],'transportation');assert.equal(layer.minzoom,12);
  }
  const index=id=>style.layers.findIndex(l=>l.id===id);
  assert.ok(index('aerialway-cableway-cable')<index('aerialway-cableway-ticks'),'ticks sit on their cable');
  assert.ok(index('infrastructure-tracks')<index('aerialway-cableway-cable'),'drawn above railway lines');
});

test('each kind draws only its own aerialway subclasses',()=>{
  const cable=id=>layers.find(l=>l.id===`aerialway-${id}-cable`);
  for(const subclass of ['cable_car','gondola','mixed_lift'])assert.equal(draws(cable('cableway'),{class:'aerialway',subclass}),true,subclass);
  for(const subclass of ['chair_lift','drag_lift','t-bar','j-bar','platter'])assert.equal(draws(cable('lift'),{class:'aerialway',subclass}),true,subclass);
  assert.equal(draws(cable('cableway'),{class:'aerialway',subclass:'chair_lift'}),false);
  assert.equal(draws(cable('lift'),{class:'aerialway',subclass:'gondola'}),false);
  for(const layer of layers){
    assert.equal(draws(layer,{class:'rail',subclass:'gondola'}),false,'class must be aerialway');
    assert.equal(draws(layer,{class:'aerialway',subclass:'station'}),false,'stations are points, not lines');
    assert.equal(draws(layer,{class:'aerialway'}),false,'no subclass, no guess');
  }
  assert.equal(new Set(AERIALWAY_KINDS.flatMap(k=>k.subclasses)).size,AERIALWAY_KINDS.flatMap(k=>k.subclasses).length,'no subclass in two kinds');
});

test('aerialways show in every view, over hybrid imagery, but not over the Carto raster',()=>{
  const settings={mode:'infrastructure',labels:true,inactive:true,background:'map'};
  for(const layer of layers){
    assert.notEqual(layer.layout.visibility,'none','drawn from the first frame of the default view');
    for(const mode of ['speed','infrastructure','electrification','control','gauge','loading','axle','owner','service'])
      assert.equal(layerVisibility(layer,{...settings,mode}),true,`${layer.id} in ${mode}`);
    assert.equal(layerVisibility(layer,{...settings,labels:false,inactive:false}),true,'no setting turns them off');
    assert.equal(layerVisibility(layer,{...settings,background:'hybrid'}),true,'not a base-map layer');
    assert.equal(layerVisibility(layer,{...settings,background:'carto'}),false,'Carto already draws them');
    assert.equal(layerVisibility(layer,{...settings,background:'satellite'}),false);
  }
});

test('lift ticks are sparser than cableway ticks',()=>{
  const gap=id=>{const l=layers.find(x=>x.id===`aerialway-${id}-ticks`);return l.paint['line-dasharray'][1]*l.paint['line-width'];};
  assert.ok(gap('lift')>gap('cableway'));
  assert.deepEqual(validateStyleMin({...style,layers}).filter(e=>!/source/.test(e.message)),[]);
});

test('a clicked aerialway links its OSM way through the shared basemap id rule, and its kind',()=>{
  // Checked on the live basemap and OSM API: 263510452 is way 26351045 (Ngong Ping 360).
  const line=id=>({source:'openmaptiles',sourceLayer:'transportation',id,properties:{class:'aerialway',subclass:'gondola'}});
  assert.deepEqual(osmObject(line(263510452)),{type:'way',id:'26351045'});
  assert.equal(osmObject(line(231547120)),null,'a merged low-zoom line id names no object');
  assert.equal(osmObject(line(undefined)),null);
  assert.equal(aerialwayKind('gondola').id,'cableway');assert.equal(aerialwayKind('t-bar').id,'lift');assert.equal(aerialwayKind('zip_line'),undefined);
});
