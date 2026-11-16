import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {normalizeMainlineWay, mainlineTiles, MAINLINE_LAYER, MAINLINE_THEME_FIELDS} from '../scripts/mainline-overview.mjs';
import {mainlineChains} from '../scripts/mainline-chains.mjs';
import {railwayThemeProperties, toFeatures} from '../scripts/branch-lines.mjs';
const way=(id,tags={})=>({type:'way',id,version:1,nodes:[id,id+1],tags:{railway:'rail',usage:'main',...tags},geometry:[{lon:id,lat:0},{lon:id+1,lat:0}]});
const thematic={maxspeed:'60 mph',electrified:'contact_line',voltage:'25000',frequency:'50',gauge:'1435;1000',loading_gauge:'GC','railway:etcs':'2','railway:pzb':'yes',operator:'Example operator'};
test('mainline and branch tiles use the same mapped thematic normalization',()=>{
 const element=way(1,thematic),main=normalizeMainlineWay(element),branch=toFeatures({elements:[element]})[0];
 const expected=railwayThemeProperties(element.tags);
 for(const [key,value] of Object.entries(expected)){assert.deepEqual(main.properties[key],value,key);assert.deepEqual(branch.properties[key],value,key);}
 assert.equal(main.properties.maxspeed,96.561);assert.equal(main.properties.speed_label,'60 mph');
 assert.equal(main.properties.electrification_state,'present');assert.equal(main.properties.gaugeint1,1000);
 assert.equal(main.properties.train_protection0,'etcs_2');assert.equal(main.properties.train_protection1,'pzb');
 assert.equal(main.properties.operator,'Example operator');
});
test('missing tags stay unknown and proposed electrification never becomes current voltage',()=>{
 const absent=normalizeMainlineWay(way(1)).properties;
 for(const key of MAINLINE_THEME_FIELDS.filter(k=>k!=='state'))assert.equal(absent[key],undefined,key);
 const future=normalizeMainlineWay(way(1,{electrified:'no','proposed:electrified':'contact_line','proposed:voltage':'25000'})).properties;
 assert.equal(future.electrification_state,'proposed');assert.equal(future.voltage,undefined);assert.equal(future.future_voltage,25000);
});
test('chain joins retain every thematic boundary and deterministic identities',()=>{
 for(const [field,other] of [['maxspeed','100'],['operator','Other operator'],['gauge','1067'],['voltage','1500'],['frequency','0'],['loading_gauge','GA'],['railway:etcs','1']]){
  const features=[normalizeMainlineWay(way(1,thematic)),normalizeMainlineWay(way(2,{...thematic,[field]:other}))];
  assert.equal(mainlineChains(features).features.length,2,field);
  const stable=result=>Object.fromEntries(Object.entries(result).map(([key,rows])=>[key,rows.sort((a,b)=>String(a.id).localeCompare(String(b.id)))]));
  assert.deepEqual(stable(mainlineChains(features)),stable(mainlineChains([...features].reverse())));
 }
 const features=[1,2].map(id=>normalizeMainlineWay(way(id,thematic))),joined=mainlineChains(features);
 assert.equal(joined.features.length,1);assert.equal(joined.features[0].properties.osm_way_count,2);
 for(const key of MAINLINE_THEME_FIELDS)assert.deepEqual(joined.features[0].properties[key],features[0].properties[key],key);
 const unknown=normalizeMainlineWay(way(2));assert.equal(mainlineChains([features[0],unknown]).features.length,2);
});
test('thematic values survive chain projection and actual MVT encoding',()=>{
 const {features}=mainlineChains([normalizeMainlineWay(way(1,thematic))]);
 const {tiles}=mainlineTiles(features,{allowChains:true});
 const layer=new VectorTile(new Pbf(gunzipSync(tiles.get('0/0/0')))).layers[MAINLINE_LAYER];
 assert.equal(layer.length,1);
 for(const key of MAINLINE_THEME_FIELDS.filter(k=>features[0].properties[k]!==undefined))
  assert.deepEqual(layer.feature(0).properties[key],features[0].properties[key],key);
});

test('direction-sensitive connected ways retain their original orientation',()=>{
 for(const tags of [
  {'maxspeed:forward':'80','maxspeed:backward':'120'},
  {maxspeed:'100','railway:preferred_direction':'forward'},
  {'maxspeed:backward':'70','railway:preferred_direction':'backward'}
 ]){
  const first=way(1,tags),second=way(2,tags);
  second.nodes.reverse();second.geometry.reverse();
  const originals=[first,second].map(normalizeMainlineWay);
  const result=mainlineChains(originals);
  assert.equal(result.features.length,2);
  for(let i=0;i<2;i++){
   assert.equal(result.features[i].properties.osm_way_count,1);
   assert.deepEqual(result.features[i].geometry,originals[i].geometry);
   assert.equal(result.features[i].properties.speed_label,originals[i].properties.speed_label);
   assert.equal(result.features[i].properties.preferred_direction,originals[i].properties.preferred_direction);
  }
 }
});
