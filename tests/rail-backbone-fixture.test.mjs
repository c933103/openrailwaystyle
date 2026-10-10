import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installEmptyMapProviders} from '../scripts/browser-renderer-fixture.mjs';
import {guardBrowserNetwork} from '../scripts/browser-network-guard.mjs';

test('the backbone metadata and tile are fixture-only while first-party assets remain actual reads',async()=>{
 const routes=[],blocked=[],base='https://deployed.example/atlas/';
 const context={route:async(match,handler)=>routes.push(handler),unroute:async()=>{},pages:()=>[],on:()=>{},routeWebSocket:async()=>{}};
 await guardBrowserNetwork(context,{bases:[base],blocked});
 await installEmptyMapProviders(context,base,{firstParty:'network'});
 const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
 const request=async url=>{
  const calls={fetch:0,continue:0,fulfill:[],abort:[]};
  await routes.at(-1)({request:()=>({url:()=>url}),
   fetch:async()=>{calls.fetch++;return {status:()=>200,headers:()=>({'content-type':'text/javascript'}),body:async()=>Buffer.from('actual deployed bytes')};},
   continue:async()=>{calls.continue++;},fulfill:async value=>calls.fulfill.push(value),abort:async reason=>calls.abort.push(reason)});
  return calls;
 };
 const metadata=await request(style.sources.railBackbone.url);
 assert.equal(new URL(style.sources.railBackbone.url).hostname,'papers.reearth.land');
 assert.equal(metadata.fetch,0);assert.equal(metadata.continue,0);assert.equal(metadata.fulfill.length,1);
 const tiles=metadata.fulfill[0].json.tiles;assert.equal(tiles.length,1);
 const tile=await request(tiles[0].replace('{z}',4).replace('{x}',8).replace('{y}',5));
 assert.equal(tile.fetch,0);assert.equal(tile.continue,0);assert.equal(tile.fulfill[0].contentType,'application/x-protobuf');
 assert.ok(Buffer.isBuffer(tile.fulfill[0].body));
 const deployed=await request(base+'world.style.json');assert.equal(deployed.fetch,1);
 assert.equal(deployed.fulfill[0].body.toString(),'actual deployed bytes');
 assert.deepEqual(blocked,[]);
});
