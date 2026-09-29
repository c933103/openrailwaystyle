import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {streetRunning} from '../styles/street-running.mjs';
import {contextDescription,nearbyTransport} from '../styles/context.mjs';
const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
const match=(id,p,zoom,type=2)=>{const l=style.layers.find(l=>l.id===id);return zoom>=(l.minzoom||0)&&featureFilter(l.filter).filter({zoom},{type,properties:p});};
test('surface streets, cycling paths and walking trails survive as subdued context below rail',()=>{
 for(const [id,p,z] of [['major',{class:'motorway'},7],['local',{class:'minor'},14],['cycle',{class:'path',subclass:'cycleway'},15],['walk',{class:'path',subclass:'footway'},15],['walk',{class:'path',subclass:'bridleway'},15],['track',{class:'track'},15]]) {
  assert.ok(match('road-'+id,p,z));assert.ok(style.layers.findIndex(l=>l.id==='road-'+id)<style.layers.findIndex(l=>l.id==='infrastructure-tracks'));
 }
 assert.ok(!match('road-local',{class:'rail'},17));
});
test('local connection symbols appear at street zoom and retain their own categories',()=>{
 const order=id=>style.layers.findIndex(l=>l.id===id);
 assert.ok(order('context-transport-bus-label')>order('context-transport-bus-stop-label'),'terminals take collision priority over ordinary stops');
 for(const [id,subclass] of [['bus-stop','bus_stop'],['taxi','taxi'],['bike-rental','bicycle_rental']]) {
  assert.ok(!match('context-transport-'+id+'-label',{subclass},14,1));assert.ok(match('context-transport-'+id+'-label',{subclass},15,1));
  const f={id:1,properties:{subclass},sourceLayer:'poi',geometry:{type:'Point',coordinates:[0,0]}};
  assert.equal(nearbyTransport([0,0],[f],500,14).length,0);assert.equal(nearbyTransport([0,0],[f],500,15)[0].category.id,id);
 }
});
test('Indigenous jurisdictions are separate from protection and administrative borders',()=>{
 assert.ok(match('context-constraints-indigenous-area',{class:'aboriginal_lands'},8,3));
 assert.ok(!match('context-constraints-protected-area',{class:'aboriginal_lands'},8,3));
 assert.ok(!match('context-constraints-indigenous-area',{class:'national_park'},8,3));
 for(const [source,p] of [['boundary',{class:'aboriginal_lands'}],['landuse',{class:'military'}],['park',{class:'archaeological_site'}],['poi',{class:'place_of_worship',subclass:'buddhist'}]]) assert.equal(contextDescription(p,source).group,'constraints');
});
test('street running needs explicit active shared-road evidence, never tram classification or proximity alone',()=>{
 for(const p of [{railway:'tram'},{railway:'rail',embedded:'no'},{highway:'residential',embedded_rails:'no'},{highway:'residential',embedded_rails:'disused'},{railway:'disused',embedded:'yes'},{highway:'footway',embedded_rails:'rail'}]) assert.equal(streetRunning(p),null,JSON.stringify(p));
 for(const p of [{railway:'rail',embedded:'yes'},{highway:'residential',embedded_rails:'tram'}]) assert.ok(streetRunning(p));
});
test('only level crossings receive a crossing marker',()=>{
 assert.ok(match('infrastructure-level-crossings',{type:'level_crossing',feature:'general/crossing'},15,1));
 assert.ok(!match('infrastructure-level-crossings',{type:'railway_crossing'},16,1));
 assert.ok(match('infrastructure-level-crossings',{type:'level_crossing'},14,1));
 assert.ok(!match('infrastructure-level-crossings',{type:'level_crossing'},13,1));
 // The provider fills its tiles from zoom 15: zoom 14 is made from children.
 assert.match(style.sources.crossings.url,/#minzoom=14&maxzoom=18&underzoom=15$/);
});

test('shared roadway includes private vehicle access and explicit bus-only exceptions',()=>{
 for(const tags of [
  {railway:'rail',embedded:'yes',motor_vehicle:'private'},
  {highway:'busway',embedded_rails:'tram',motor_vehicle:'no',bus:'yes'},
  {highway:'residential',embedded_rails:'tram; rail',motor_vehicle:'no',psv:'designated'},
 ]) assert.ok(streetRunning(tags),JSON.stringify(tags));
 assert.equal(streetRunning({highway:'residential',embedded_rails:'tram',motor_vehicle:'no'}),null);
 // Access inherits: access=no or vehicle=no bars road vehicles unless a more
 // specific tag allows them.
 for(const tags of [{access:'no'},{vehicle:'no'},{access:'no',vehicle:'no'}]) assert.equal(streetRunning({highway:'residential',embedded_rails:'tram',...tags}),null,JSON.stringify(tags));
 for(const tags of [{access:'no',motor_vehicle:'yes'},{vehicle:'no',bus:'yes'},{access:'no',psv:'designated'}]) assert.ok(streetRunning({highway:'residential',embedded_rails:'tram',...tags}),JSON.stringify(tags));
});
