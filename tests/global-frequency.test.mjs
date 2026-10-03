import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mergeInventories} from '../scripts/assemble-global-frequency.mjs';
import {mergeServiceTiles} from '../scripts/merge-service-tiles.mjs';
import vtpbf from 'vt-pbf';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
test('worldwide discovery, selective downloads and shapeless data processing',()=>{
  const run=spawnSync('python3',['-m','unittest','discover','-s','tests','-p','global_frequency_test.py'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stdout+run.stderr);
});
test('global assembly rejects missing shards, duplicate feeds and catalogue drift',()=>{
  const base={schema:2,shards:2,catalogue_sha256:'hash',catalogue_entries:2,service_date:'2026-10-05'};
  const a={...base,shard:0,entries:[{id:'a'}]},b={...base,shard:1,entries:[{id:'b'}]};
  assert.equal(mergeInventories([a,b]).entries.length,2);
  assert.throws(()=>mergeInventories([a]),/Incomplete/);
  assert.throws(()=>mergeInventories([a,{...b,entries:[{id:'a'}]}]),/Duplicate feed/);
  assert.throws(()=>mergeInventories([a,{...b,catalogue_sha256:'changed'}]),/Inconsistent/);
});
test('tile merging retains distinct services and withholds conflicting duplicate rates',()=>{
  const tile=(id,ref,rate)=>vtpbf.fromGeojsonVt({service_routes:{features:[{type:2,geometry:[[[1,2],[3,4]]],tags:{id,operator:'Rail',ref,kind:'rail',frequency_id:id,frequency_until:1900000000,frequency_am:rate}}]}},{version:2});
  let layer=new VectorTile(new Pbf(mergeServiceTiles([tile('a','A',4),tile('b','B',2)]))).layers.service_routes;
  assert.equal(layer.length,2);assert.equal(layer.feature(0).properties.n,2);
  assert.notEqual(layer.feature(0).properties.frequency_offset_am,layer.feature(1).properties.frequency_offset_am);
  layer=new VectorTile(new Pbf(mergeServiceTiles([tile('a','A',4),tile('dup','A',6)]))).layers.service_routes;
  assert.equal(layer.length,1);assert.equal(layer.feature(0).properties.frequency_am,undefined);
  assert.match(layer.feature(0).properties.frequency_note,/disagree/);
});
