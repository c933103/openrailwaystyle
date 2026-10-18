import test from 'node:test';
import assert from 'node:assert/strict';
import encode from 'vt-pbf';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {encodeBundle} from '../styles/tile-bundles.mjs';
import {
  WORLD_STATION_SOURCE,WORLD_STATION_DOTS,WORLD_STATION_PROTOCOL,
  WORLD_STATION_SUPERSEDED_DOTS,worldStationLayer,
  validWorldStationSnapshot,prepareWorldStationOverlay,
} from '../styles/station-world.mjs';

const root=new URL('https://atlas.example.invalid/data/station-points/');
const manifest={complete:true,schema:1,license:'ODbL-1.0',minzoom:3,maxzoom:7,
  stations:50000,tiles:10,bundles:1,polar:0,pendingRegions:0,completedRegions:32};
const index={zoom:3,bundles:['4/4']};
const geo={type:'FeatureCollection',features:[
  {type:'Feature',id:42,properties:{id:'node-42',osm_id:'42',osm_type:'node',
    name:'Unlabelled node',feature:'station',state:'present',station:'train'},
    geometry:{type:'Point',coordinates:[0,0]}},
]};
const bytes=encode.fromGeojsonVt({atlas_station_points:{
  features:[{type:1,id:42,geometry:[[2048,2048]],
    tags:{...geo.features[0].properties}}]}},{version:2});
const bundle=encodeBundle(new Map([['3/4/4',bytes]]));
function fixtureFetcher({completed=true,badIndex=false,failBundle=false,seen=[]}={}){
 const m=completed?manifest:{...manifest,complete:false,pendingRegions:20,completedRegions:12};
 return async url=>{
   const path=new URL(url).pathname;
   seen.push(path);
   if(path.endsWith('/manifest.json'))return new Response(JSON.stringify(m),{status:200});
   if(path.endsWith('/index.json'))return new Response(JSON.stringify(badIndex?{zoom:3,bundles:['4/4','bad']}:index),{status:200});
   if(path.endsWith('/3/4/4.bundle.gz')&&!failBundle)return new Response(bundle,{status:200});
   return new Response('Not found',{status:404});
 };
}
function fakeMap(){
 const calls=[],objects=new Map(),layers=new Map([
  ['place_label_city',{id:'place_label_city',type:'symbol'}],
  ['infrastructure-crossing-overview',{id:'infrastructure-crossing-overview',type:'circle'}],
 ]);
 return {calls,objects,layers,
  getSource:id=>objects.get(id),getLayer:id=>layers.get(id),
  addSource(id,src){calls.push(['source',id]);objects.set(id,src);},
  addLayer(layer,before){calls.push(['layer',layer.id,before]);layers.set(layer.id,layer);},
 };
}
test('the independent worldwide station layer is a pure marker with no name placement dependency',()=>{
 const layer=worldStationLayer();
 assert.equal(layer.id,WORLD_STATION_DOTS);
 assert.equal(layer.type,'circle');
 assert.equal(layer.source,WORLD_STATION_SOURCE);
 assert.equal(layer['source-layer'],'atlas_station_points');
 assert.deepEqual([layer.minzoom,layer.maxzoom],[3,12]);
 assert.equal(layer.layout.visibility,'none','do not show the layer before settings resolve');
 assert.ok(layer.metadata['atlas:settings'].includes('stations'));
 assert.equal(layer.metadata['atlas:localize'],false);
 assert.equal(WORLD_STATION_SUPERSEDED_DOTS.includes('station-stations-dots'),false,
   'detailed station dots at z12+ must remain');
 assert.ok(WORLD_STATION_SUPERSEDED_DOTS.includes('station-provider-dots'));
});

test('incomplete, missing and tampered snapshots never install a map source',async()=>{
 assert.equal(validWorldStationSnapshot(manifest,index),true);
 assert.equal(validWorldStationSnapshot({...manifest,complete:false},index),false);
 assert.equal(validWorldStationSnapshot({...manifest,pendingRegions:1},index),false);
 assert.equal(validWorldStationSnapshot({...manifest,polar:2},index),false);
 assert.equal(validWorldStationSnapshot({...manifest,bundles:2},index),false);
 assert.equal(validWorldStationSnapshot(manifest,{zoom:3,bundles:['4/4','4/4']}),false);
 assert.equal(validWorldStationSnapshot(manifest,{zoom:3,bundles:['8/0']}),false);
 assert.equal(validWorldStationSnapshot(manifest,{zoom:4,bundles:['4/4']}),false);
 const seen=[];
 const none=await prepareWorldStationOverlay({root,fetcher:fixtureFetcher({completed:false,seen})});
 assert.equal(none,null);
 assert.deepEqual(seen.map(x=>x.split('/').at(-1)),['manifest.json'],
  'no incomplete snapshot index or tile should be requested');
 const logs=[];
 const bad=await prepareWorldStationOverlay({root,
   fetcher:fixtureFetcher({badIndex:true}),logger:{warn:m=>logs.push(m)}});
 assert.equal(bad,null);assert.ok(logs.length);
 const offline=await prepareWorldStationOverlay({root,fetcher:async()=>{throw Error('offline')},
   logger:{warn:()=>{}}});
 assert.equal(offline,null,'network errors must retain established station sources');
});

test('completed snapshot registers bounded local tile protocol and places stations over crossings',async()=>{
 const seen=[],protocols={};
 const overlay=await prepareWorldStationOverlay({root,fetcher:fixtureFetcher({seen})});
 assert.ok(overlay);
 overlay.register({addProtocol:(id,handler)=>protocols[id]=handler});
 assert.equal(Object.keys(protocols).length,1);
 const map=fakeMap();assert.equal(overlay.install(map),true);
 assert.deepEqual(map.calls,[['source',WORLD_STATION_SOURCE],
   ['layer',WORLD_STATION_DOTS,'place_label_city']]);
 assert.equal(map.objects.get(WORLD_STATION_SOURCE).maxzoom,7);
 assert.equal(map.objects.get(WORLD_STATION_SOURCE).promoteId,'id');
 assert.deepEqual(map.objects.get(WORLD_STATION_SOURCE).tiles,
   [WORLD_STATION_PROTOCOL+'://{z}/{x}/{y}']);
 assert.throws(()=>overlay.install(map),/Duplicate/);
 const loaded=await protocols[WORLD_STATION_PROTOCOL]({url:WORLD_STATION_PROTOCOL+'://3/4/4'},
   {signal:new AbortController().signal});
 const vector=new VectorTile(new Pbf(new Uint8Array(loaded.data)));
 assert.equal(vector.layers.atlas_station_points.length,1);
 assert.equal(vector.layers.atlas_station_points.feature(0).properties.id,'node-42');
 const empty=await protocols[WORLD_STATION_PROTOCOL]({url:WORLD_STATION_PROTOCOL+'://3/0/0'},
   {signal:new AbortController().signal});
 assert.equal(empty.data.byteLength,0);
 assert.ok(seen.some(path=>path.endsWith('/index.json')));
 assert.ok(seen.some(path=>path.endsWith('/3/4/4.bundle.gz')));
 await assert.rejects(protocols[WORLD_STATION_PROTOCOL]({url:WORLD_STATION_PROTOCOL+'://7/999/0'},{}),/Invalid/);
 await assert.rejects(protocols[WORLD_STATION_PROTOCOL]({url:WORLD_STATION_PROTOCOL+'://7/7/..'},{}),/Invalid/);
});

test('a failed vector tile never becomes a fabricated successful station inventory',async()=>{
 const overlay=await prepareWorldStationOverlay({root,fetcher:fixtureFetcher({failBundle:true})});
 const handlers={};overlay.register({addProtocol:(id,fn)=>handlers[id]=fn});
 await assert.rejects(handlers[WORLD_STATION_PROTOCOL]({url:WORLD_STATION_PROTOCOL+'://3/4/4'},{}),/404/);
});
