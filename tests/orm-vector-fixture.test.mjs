import test from 'node:test';
import assert from 'node:assert/strict';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {ormVectorFixture} from '../scripts/orm-vector-fixture.mjs';
import {RAIL_TILE_RANGES} from '../styles/rail-source-catalog.mjs';
import {validProviderVectorTile} from '../styles/vector-tile-validation.mjs';

const feature={type:2, geometry:[[[10,10],[100,100]]], tags:{id:'fixture-1',ref:'1 / 2'}};
test('every catalogue direct XYZ contract gets PBF with the exact source layer at its zoom bounds',()=>{
  for(const [layer,zooms] of Object.entries(RAIL_TILE_RANGES))for(const z of zooms){
    const calls=[],indexes={[layer]:{getTile:(...args)=>{calls.push(args);return {features:[feature],extent:4096};}}};
    const path=`/${layer}/${z}/1/2`,response=ormVectorFixture(path,indexes);
    assert.equal(response.contentType,'application/x-protobuf');
    assert.deepEqual(calls,[[z,1,2]]);
    assert.ok(validProviderVectorTile('https://openrailwaymap.app'+path,200,response.body));
    const decoded=new VectorTile(new Pbf(response.body));
    assert.deepEqual(Object.keys(decoded.layers),[layer]);
    assert.equal(decoded.layers[layer].length,1);
    assert.deepEqual(decoded.layers[layer].feature(0).properties,{id:'fixture-1',ref:'1 / 2'});
  }
});
test('empty or absent fixture tiles have valid empty bodies, never TileJSON or an empty encoded layer',()=>{
  for(const indexes of [{},{railway_signals:{getTile:()=>null}},{railway_signals:{getTile:()=>({features:[]})}}]){
    const response=ormVectorFixture('/railway_signals/19/1/2',indexes);
    assert.equal(response.body.length,0);
    assert.ok(validProviderVectorTile('https://openrailwaymap.app/railway_signals/19/1/2',200,response.body));
  }
});
test('platform measurement z15 and advertised .pbf paths retain their original coordinates and request accounting',()=>{
  const calls=[],indexes={standard_railway_platforms:{getTile:()=>({features:[feature]})}};
  const direct=ormVectorFixture('/standard_railway_platforms/15/1/2',indexes,entry=>calls.push(entry));
  const advertised=ormVectorFixture('/standard_railway_platforms/15/1/2.pbf',indexes,entry=>calls.push(entry));
  assert.deepEqual(direct,advertised);
  assert.deepEqual(calls,[{layer:'standard_railway_platforms',z:15,x:1,y:2},{layer:'standard_railway_platforms',z:15,x:1,y:2}]);
});
test('metadata and API routes remain separate, including unknown-endpoint fallback',()=>{
  for(const path of ['/standard_railway_platforms','/unknown_endpoint','/api/feature/standard_railway_platforms/way-1'])assert.equal(ormVectorFixture(path,{}),null);
});
