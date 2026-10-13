import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {layerVisibility} from '../styles/layer-semantics.mjs';
import {MODES} from '../styles/map-model.mjs';

const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
const layer=style.layers.find(l=>l.id==='rail-basemap-reference');
test('detailed-zoom rail reference reuses basemap geometry below all thematic tracks',()=>{
 assert.equal(layer.source,'openmaptiles');assert.equal(layer['source-layer'],'transportation');
 assert.equal(layer.minzoom,8);assert.equal(layer.maxzoom,undefined);
 const at=id=>style.layers.findIndex(l=>l.id===id);
 for(const mode of MODES)assert.ok(at(layer.id)<at(`${mode}-tracks`));
 assert.ok(at(layer.id)>at('road-major'));
 assert.ok(layer.paint['line-dasharray']);assert.equal(layer.paint['line-color'],'#70777b');
});
test('reference rail eligibility excludes roads, inactive subclasses, ferries and aerialways',()=>{
 const filter=featureFilter(layer.filter).filter;
 const accepts=(properties,type=2)=>filter({zoom:10.9},{type,properties});
 for(const subclass of ['rail','narrow_gauge','preserved','funicular'])assert.ok(accepts({class:'rail',subclass}));
 assert.ok(accepts({class:'rail'}),'older basemap tiles may omit the subclass');
 for(const subclass of ['subway','light_rail','monorail','tram'])assert.ok(accepts({class:'transit',subclass}));
 for(const subclass of ['abandoned','disused','construction','proposed','platform','cable_car','ferry']){
  for(const cls of ['rail','transit'])assert.equal(accepts({class:cls,subclass}),false);
 }
 for(const cls of ['primary','motorway','path','aerialway','ferry'])assert.equal(accepts({class:cls,subclass:'rail'}),false);
 assert.equal(accepts({class:'transit'}),false);assert.equal(accepts({class:'rail'},3),false);
});
test('reference remains in every rail view on Map, Carto and Hybrid, but not Satellite-only',()=>{
 for(const mode of MODES){
  for(const background of ['map','carto','hybrid'])assert.equal(layerVisibility(layer,{mode,background}),true);
  assert.equal(layerVisibility(layer,{mode,background:'satellite'}),false);
 }
});
