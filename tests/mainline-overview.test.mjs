import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {normalizeMainlineWay,mainlineRegion,mainlineTiles,MAINLINE_LAYER} from '../scripts/mainline-overview.mjs';

const way=(id,points,tags={railway:'rail',usage:'main'})=>({
 type:'way',id,version:1,timestamp:'2026-10-11T00:00:00Z',
 tags,geometry:points.map(([lon,lat])=>({lon,lat})),
});
const source=(...ways)=>mainlineRegion({elements:ways});
const decode=(bytes)=>new VectorTile(new Pbf(new Uint8Array(gunzipSync(bytes)))).layers[MAINLINE_LAYER];
const ids=(layer)=>new Set(Array.from({length:layer?.length||0},(_,i)=>layer.feature(i).properties.id));

test('operating main, high-speed and unspecified-usage railways survive; branches remain classified; sidings do not',()=>{
 const records=source(
   way(1,[[0,0],[12,0]]),
   way(2,[[0,2],[12,2]],{railway:'narrow_gauge',highspeed:'yes'}),
   way(3,[[0,4],[12,4]],{railway:'rail'}),
   way(4,[[0,6],[12,6]],{railway:'rail',usage:'branch'}),
   way(5,[[0,8],[12,8]],{railway:'rail',service:'yard'}),
   way(6,[[0,10],[12,10]],{railway:'rail',usage:'industrial'}),
   way(7,[[0,12],[12,12]],{railway:'construction',usage:'main'}),
   way(8,[[0,14],[12,14]],{railway:'rail',disused:'yes'}),
   way(9,[[0,16],[12,16]],{railway:'tram',usage:'main'}),
 );
 assert.deepEqual(records.map(r=>r.id),[1,2,3,4]);
 assert.equal(records[1].properties.rank,0);
 assert.equal(records[0].properties.rank,1);
 assert.equal(records[2].properties.rank,2);
 assert.ok(!Object.hasOwn(records[0].properties,'state'),'neutral geometry must not invent operational state');
 assert.ok(!Object.hasOwn(records[0].properties,'maxspeed'),'geometry must not invent attribute data');
 assert.ok(!Object.hasOwn(records[0].properties,'highspeed'),'unknown high-speed status must not become false');
 assert.equal(records[1].properties.highspeed_tag,'yes');
 assert.equal(records[2].properties.highspeed_tag,'');
});

test('input failures are explicit and do not publish partial, malformed railway geometry',()=>{
 assert.throws(()=>mainlineRegion({elements:[],remark:'runtime error'}),/Incomplete/);
 assert.throws(()=>mainlineRegion({elements:[way(1,[[0,0],[1,0]]),way(2,[[0,0],[1,0]])]},{maxElements:1}),/oversized/);
 assert.throws(()=>normalizeMainlineWay({type:'way',id:1,version:1,tags:{railway:'rail'}}),/missing complete bounded geometry/);
 assert.throws(()=>normalizeMainlineWay(way(9,[[0,0],[181,0]])),/Invalid mainline way/);
 assert.throws(()=>normalizeMainlineWay({...way(8,[[0,0],[1,0]]),version:null}),/missing version/);
 assert.throws(()=>normalizeMainlineWay(way(8,[[0,0],[0,0]])),/Degenerate/);
 assert.throws(()=>mainlineTiles([source(way(1,[[0,0],[20,0]]))[0],source(way(1,[[0,0],[20,0]]))[0]]),/duplicate/);
});

test('all-world fixture mainlines persist through z0–6 even without OpenRailwayMap',()=>{
 const corridors=[
  ['China',100,35],['Japan',132,35],['Korea',124,37],['Taiwan',119,24],
  ['India',70,21],['Russia',60,56],['United States',-103,40],['Canada',-105,51],
  ['UK',-12,55],['France',-1,47],['Spain',-11,40],['Germany',6,52],
  ['Italy',5,44],['Poland',16,53],['Australia',131,-27],['South Africa',17,-28],
  ['Brazil',-55,-15],
 ];
 const all=source(...corridors.map(([name,lon,lat],i)=>way(100+i,
   [[lon,lat],[lon+8,lat+1]],{railway:'rail',usage:'main',name})));
 const result=mainlineTiles(all);
 assert.equal(result.manifest.wayCount,corridors.length);
 assert.equal(result.manifest.complete,false);
 assert.equal(result.manifest.minzoom,0);
 assert.equal(result.manifest.maxzoom,6);
 assert.ok(result.index.tiles.includes('0/0/0'),'worldwide z0 tile is available at negative map zoom too');
 for(let z=0;z<=6;z++){
   const fromAllTiles=new Set();
   for(const [key,bytes] of result.tiles)if(key.startsWith(z+'/')){
     const layer=decode(bytes);
     assert.ok(layer?.length>0,key);
     for(const id of ids(layer))fromAllTiles.add(id);
   }
   assert.deepEqual([...fromAllTiles].sort(),all.map(l=>l.properties.id).sort(),
     `rail corridors in Asia, Europe, Americas, Oceania and Africa still present at z${z}`);
 }
});

test('railway across the date line is split without a world-spanning stroke',()=>{
 const segments=source(way(999,[[179.7,0],[-179.7,0]]));
 assert.equal(segments[0].geometry.type,'MultiLineString');
 assert.deepEqual(segments[0].geometry.coordinates.map(c=>c.map(x=>x[0])),[[179.7,180],[-180,-179.7]]);
 const out=mainlineTiles(segments);
 const keys=[...out.tiles.keys()];
 assert.ok(keys.some(k=>k.startsWith('6/0/')));
 assert.ok(keys.some(k=>k.startsWith('6/63/')));
});
