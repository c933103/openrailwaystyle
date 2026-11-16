import test from 'node:test';import assert from 'node:assert/strict';
import {HYDROGEN_FUEL_KEYS} from '../scripts/energy-fuel-tags.mjs';
import {selectsTag} from '../scripts/extract-filter.mjs';
import {energyNetworkKind,energyNetworkGeoJSON} from '../scripts/energy-network-data.mjs';
test('locomotive hydrogen dispensers retain documented raw offering keys and lifecycle',()=>{
 for(const key of HYDROGEN_FUEL_KEYS){
  for(const tags of [{railway:'fuel',[key]:'yes'},{'disused:railway':'fuel',[key]:'yes'},{'proposed:railway':'fuel',['proposed:'+key]:'yes'}]){
   assert.ok(Object.entries(tags).some(([k,v])=>selectsTag(k,v)),'existing railway union selects the whole tagged object');
   const kind=energyNetworkKind(tags);assert.equal(kind.domain,'hydrogen');assert.equal(kind.minzoom,11);
   assert.equal(kind.state,tags['disused:railway']?'disused':tags['proposed:railway']?'proposed':'present');
   const feature=energyNetworkGeoJSON([{type:'node',id:1,lat:0,lon:0,tags}]).features[0];
   for(const [k,v] of Object.entries(tags))assert.equal(feature.properties[k],v);
   assert.equal(feature.properties.supply_tier,'trackside');
  }
  for(const value of ['no','unknown','yes;no'])assert.equal(energyNetworkKind({railway:'fuel',[key]:value}).domain,'fuel');
  assert.equal(energyNetworkKind({amenity:'fuel',[key]:'yes'}),null,'road offering alone does not establish locomotive servicing');
 }
});
