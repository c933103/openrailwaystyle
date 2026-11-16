import test from 'node:test';import assert from 'node:assert/strict';
import {shapeEnergyRelations} from '../scripts/energy-site-relations.mjs';
import {energyNetworkGeoJSON,energyNetworkKind} from '../scripts/energy-network-data.mjs';
import {networkTiles} from '../scripts/build-extract-energy-network.mjs';
const point={type:'node',id:1,lon:0,lat:0,tags:{power:'generator'}};
const child={type:'relation',id:2,tags:{type:'site'},members:[{type:'node',ref:1,role:''}]};
const site={type:'relation',id:3,tags:{type:'site',power:'plant'},members:[{type:'relation',ref:2,role:''}]};
const options=records=>({subset:async(pbf,ids)=>{assert.deepEqual(ids,['r3']);return {file:'subset',remove:async()=>{}};},read:async(pbf,{onElement})=>{for(const record of records)onElement(record);return {withoutGeometry:0};}});
test('node and nested site members retain actual geometry and produce vector tiles',async()=>{
 const shaped=await shapeEnergyRelations('fixture',[site],options([site,child,point]));
 const data=energyNetworkGeoJSON(shaped.relations);
 assert.deepEqual(data.features[0].geometry,{type:'GeometryCollection',geometries:[{type:'GeometryCollection',geometries:[{type:'Point',coordinates:[0,0]}]}]});
 assert.equal(data.features[0].properties.rail_served,false,'site membership invents no enclosure');
 assert.ok(networkTiles(data,{minZoom:12,maxZoom:12}).size>0);
 const direct={...site,members:[{type:'node',ref:1,role:''}]};
 assert.equal((await shapeEnergyRelations('fixture',[direct],options([direct,point]))).relations[0].members[0].lat,0);
});
test('missing or cyclic site members remain a completeness failure',async()=>{
 await assert.rejects(shapeEnergyRelations('fixture',[site],options([site,child])),/Missing energy site member node\/1/);
 await assert.rejects(shapeEnergyRelations('fixture',[site],options([site,{...child,members:[{type:'relation',ref:3}]}])),/Cyclic energy site/);
});
test('power frequency converters survive classification, lifecycle and feature generation',()=>{
 for(const tags of [{power:'frequency_converter',usage:'traction'},{'disused:power':'frequency_converter',usage:'traction'}]){
  const kind=energyNetworkKind(tags);assert.equal(kind.kind,'frequency_converter');assert.equal(kind.minzoom,8);
  assert.equal(energyNetworkGeoJSON([{...point,tags}]).features.length,1);
 }
});
test('complete candidate builder accepts a nested node-only power site',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {buildExtractEnergyNetwork}=await import('../scripts/build-extract-energy-network.mjs');const {currentFilter}=await import('../scripts/extract-release.mjs');
 const dir=await mkdtemp(join(tmpdir(),'energy-site-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const report={schema:1,regions:1,oldestTimestamp:'2026-11-01T00:00:00Z',newestTimestamp:'2026-11-01T00:00:00Z',missingNodeRefs:0,missingRegions:[],selectionFilters:{region:currentFilter('region'),gap:currentFilter('gap/0')}};
 const fixture=options([site,child,point]);const nestedRead=fixture.read;
 fixture.read=async(pbf,callbacks)=>pbf==='fixture'?(callbacks.onElement(site),{withoutGeometry:0}):nestedRead(pbf,callbacks);
 const manifest=await buildExtractEnergyNetwork('fixture',report,join(dir,'candidate'),fixture);
 assert.equal(manifest.complete,true);assert.equal(manifest.features,1);assert.ok(manifest.bundles>0);
});
test('site membership never turns closed non-area ways into filled plant polygons',()=>{
 const ring=[{lon:0,lat:0},{lon:.001,lat:0},{lon:.001,lat:.001},{lon:0,lat:0}];
 for(const tags of [{highway:'service'},{railway:'rail'},{},{area:'no',building:'yes'}]){
  const member={type:'way',ref:4,tags,geometry:ring};
  const feature=energyNetworkGeoJSON([{...site,members:[member]}]).features[0];
  assert.equal(feature.geometry.geometries[0].type,'LineString');
 }
 const feature=energyNetworkGeoJSON([{...site,members:[{type:'way',ref:4,tags:{area:'yes'},geometry:ring}]}]).features[0];
 assert.equal(feature.geometry.geometries[0].type,'Polygon');
});
