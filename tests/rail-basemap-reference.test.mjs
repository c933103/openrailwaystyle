import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {featureFilter, createExpression} from '@maplibre/maplibre-gl-style-spec';
import {layerVisibility} from '../styles/layer-semantics.mjs';
import {MODES, INFRASTRUCTURE} from '../styles/map-model.mjs';

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
test('neutral reference stays in other rail views; Infrastructure has its own colored reference',()=>{
 for(const mode of MODES){
  for(const background of ['map','carto','hybrid'])assert.equal(layerVisibility(layer,{mode,background}),mode!=='infrastructure');
  assert.equal(layerVisibility(layer,{mode,background:'satellite'}),false);
 }
});

const infrastructure=style.layers.find(l=>l.id==='infrastructure-basemap-reference');
test('Infrastructure reference uses mapped rail kind and explicit service values without inventing high speed',()=>{
 assert.deepEqual(infrastructure.filter,layer.filter);
 assert.equal(infrastructure.minzoom,8);
 assert.equal(infrastructure.paint['line-dasharray'],undefined);
 const expression=createExpression(infrastructure.paint['line-color']);assert.equal(expression.result,'success');
 const color=properties=>expression.value.evaluate({zoom:12},{properties});
 for(const subclass of ['subway','light_rail','monorail'])assert.equal(color({subclass}),INFRASTRUCTURE[3][0]);
 assert.equal(color({subclass:'tram'}),INFRASTRUCTURE[4][0]);
 assert.equal(color({subclass:'funicular'}),INFRASTRUCTURE[6][0]);
 for(const service of ['yard','siding','spur','crossover'])assert.equal(color({subclass:'rail',service}),INFRASTRUCTURE[5][0]);
 for(const properties of [{},{subclass:'rail'},{subclass:'narrow_gauge'},{subclass:'preserved'},{service:''},{service:'unknown'}])assert.equal(color(properties),INFRASTRUCTURE[1][0]);
 for(const mode of MODES)for(const background of ['map','carto','hybrid','satellite'])
  assert.equal(layerVisibility(infrastructure,{mode,background}),mode==='infrastructure'&&background!=='satellite');
});
test('static Infrastructure style never pre-renders neutral references before app initialization',()=>{
 for(const l of style.layers.filter(l=>/^rail-(backbone|reference)-/.test(l.id)||l.id==='rail-basemap-reference'))
  assert.equal(l.layout.visibility,'none',l.id);
 assert.notEqual(infrastructure.layout.visibility,'none');
 for(const l of style.layers.filter(l=>l.id.startsWith('infrastructure-reference-')))assert.notEqual(l.layout.visibility,'none',l.id);
 for(const l of style.layers.filter(l=>l.id.startsWith('rail-backbone-')))
  assert.equal(layerVisibility(l,{mode:'infrastructure',background:'map'}),false);
});
