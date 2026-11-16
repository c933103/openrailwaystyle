import test from 'node:test';import assert from 'node:assert/strict';
import {createEnergyNetworkProtocol} from '../styles/energy-network.mjs';
import {energyNetworkLayers} from '../scripts/style/layers/energy-network.mjs';
import {layerVisibility} from '../styles/layer-semantics.mjs';
const params={url:'energynetwork://detail/12/2048/2048'},controller=()=>new AbortController();
test('energy context requests zero bytes outside Power, including manifest',async()=>{
 let active=false,calls=0;
 const tile=createEnergyNetworkProtocol({root:new URL('https://atlas.test/data/energy-network/'),active:()=>active,fetcher:async()=>{calls++;return new Response('{"complete":false}');}});
 assert.equal((await tile(params,controller())).data.byteLength,0);assert.equal(calls,0);
 active=true;assert.equal((await tile(params,controller())).data.byteLength,0);assert.equal(calls,1);
 assert.equal((await tile(params,controller())).data.byteLength,0);assert.equal(calls,1,'missing snapshot cached for this page');
});
test('leaving Power during manifest fetch prevents index and bundle fanout',async()=>{
 let active=true,calls=0;
 const tile=createEnergyNetworkProtocol({root:new URL('https://atlas.test/data/energy-network/'),active:()=>active,fetcher:async()=>{calls++;active=false;return Response.json({schema:2,dataset:'energy-network',complete:true,format:'atlas-tile-bundle-1',minzoom:5,maxzoom:14});}});
 assert.equal((await tile(params,controller())).data.byteLength,0);assert.equal(calls,1);
});
test('malformed coordinates and cancellation cause no download',async()=>{
 const tile=createEnergyNetworkProtocol({root:new URL('https://atlas.test/'),active:()=>true,fetcher:()=>assert.fail('no download')});
 await assert.rejects(tile({url:'energynetwork://detail/12/4096/0'},controller()),/coordinate/);
 const abort=controller();abort.abort();await assert.rejects(tile(params,abort),{name:'AbortError'});
});
test('network layers keep civil versus rail outlines and explicit zoom thresholds',()=>{
 const layers=energyNetworkLayers();assert.equal(layers.areas.length,18);assert.equal(layers.lines.length,42);assert.equal(layers.points.length,8);
 for(const layer of [...layers.areas,...layers.lines,...layers.points]){
  assert.deepEqual(layer.metadata['atlas:views'],['electrification']);assert.ok(JSON.stringify(layer.filter).includes('energy_minzoom'));
 }
 const civil=layers.areas.find(l=>l.id==='energy-detail-civil-outlines');assert.deepEqual(civil.paint['line-dasharray'],[3,2]);
 const rail=layers.areas.find(l=>l.id==='energy-detail-rail-outlines');assert.equal(rail.paint['line-dasharray'],undefined);
 for(const layer of layers.points.filter(l=>l.type==='symbol'))assert.ok(layer.minzoom>=13&&layer.metadata['atlas:settings'].includes('labels'));
});
