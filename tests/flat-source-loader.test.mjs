import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFlatSourceLoader, flatTileURL} from '../styles/flat-source-loader.mjs';
import {createSharedTileProtocols} from '../styles/shared-tile-protocols.mjs';
import {flatVectorFixture} from './fixtures/flat-vector.mjs';

const baseURL='https://atlas.example/styles/world.style.json?v=2';
const options=()=>({baseURL,controller:new AbortController()});
test('custom archive asks the existing protocol for metadata and exact TMS bytes',async()=>{
  const protocols=createSharedTileProtocols(),calls=[];
  protocols.addProtocol('atlasbase',async ({url,type},controller)=>{
    calls.push([url,type,controller]);
    return {data:type==='json'?{tiles:['atlasbase://en/archive/{z}/{x}/{y}'],scheme:'tms',bounds:[-180,-80,180,80],maxzoom:13}:flatVectorFixture()};
  });
  const loader=createFlatSourceLoader({protocols,fetcher:()=>assert.fail('no direct HTTP fetch')});
  const o=options(),source=await loader.resolve({type:'vector',url:'atlasbase://en/archive',maxzoom:10},o);
  assert.equal(source.maxzoom,10);
  assert.deepEqual(source.bounds,[-180,-80,180,80]);
  const {vector}=await loader.load(source,{z:3,x:2,y:1},o);
  assert.ok(vector.layer('rail').length);
  assert.deepEqual(calls,[
    ['atlasbase://en/archive','json',o.controller],
    ['atlasbase://en/archive/3/2/6','arrayBuffer',o.controller],
  ]);
});
test('HTTP metadata uses the redirect URL but explicit tiles use the style URL',async()=>{
  const seen=[];
  const loader=createFlatSourceLoader({fetcher:async (url,opts)=>{
    seen.push([url,opts.signal]);
    return {ok:true,url:'https://cdn.example/archives/meta.json',json:async()=>({
      tiles:['../mvt/{z}/{x}/{y}{ratio}.pbf'],tileSize:256,scheme:'tms',minzoom:3,
    })};
  }});
  const o=options();
  const remote=await loader.resolve({type:'vector',url:'./metadata.json'},o);
  const override=await loader.resolve({type:'vector',url:'./metadata.json',tiles:['./local/{z}/{x}/{y}.pbf'],scheme:'xyz'},o);
  assert.deepEqual(seen,Array(2).fill(['https://atlas.example/styles/metadata.json',o.controller.signal]));
  assert.equal(remote.tileSize,256);
  assert.equal(override.minzoom,3);
  assert.equal(flatTileURL(remote,{z:4,x:2,y:1},{pixelRatio:2}),'https://cdn.example/mvt/4/2/14@2x.pbf');
  assert.equal(flatTileURL(override,{z:4,x:2,y:1}),'https://atlas.example/styles/local/4/2/1.pbf');
});
test('metadata, addressing and provider errors remain observable',async()=>{
  const loader=createFlatSourceLoader({fetcher:async()=>({ok:false,status:503}),protocols:createSharedTileProtocols()});
  await assert.rejects(loader.resolve({type:'vector',url:'./metadata.json'},options()),/503/);
  await assert.rejects(loader.resolve({type:'vector',url:'pmtiles://https://archive.example/x'},options()),/not registered/);
  await assert.rejects(loader.resolve({type:'vector'},options()),/no usable templates/);
  assert.throws(()=>flatTileURL({tiles:['https://cdn.example/{bad}']},{z:1,x:0,y:0}),/Unsupported tile template/);
});
test('a raster bitmap finishing after cancellation is disposed',async()=>{
  const o=options();let closed=0,finish;
  const decodeRaster=()=>new Promise(resolve=>{finish=()=>resolve({close(){closed++;}});});
  const loader=createFlatSourceLoader({fetcher:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}),decodeRaster});
  const source=await loader.resolve({type:'raster',tiles:['tiles/{z}/{x}/{y}.png']},o);
  const pending=loader.load(source,{z:0,x:0,y:0},o);
  await new Promise(resolve=>setImmediate(resolve));
  o.controller.abort();
  finish();
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(closed,1);
});

test('quadkey, prefix and BBOX use canonical XYZ even for a TMS tile',()=>{
  const source={tiles:['https://map.example/{prefix}/{quadkey}/{y}?bbox={bbox-epsg-3857}'],scheme:'tms'};
  assert.equal(flatTileURL(source,{z:1,x:1,y:0}),
    'https://map.example/10/1/1?bbox=0,0,20037508.342789244,20037508.342789244');
});
