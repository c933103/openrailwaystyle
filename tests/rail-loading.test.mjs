import test from 'node:test';
import assert from 'node:assert/strict';
import {railTileMetadata,zoomOverrides,railTileNeedsGlyphs,RAIL_TILE_RANGES,RAIL_COMPOSITE_PATHS,railProviderTileURL} from '../styles/rail-source-catalog.mjs';
import {installLabelProtocols} from '../styles/tile-labels.mjs';
import {railwaySources} from '../scripts/style/sources/railway.mjs';
import encode from 'vt-pbf';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
const origin='https://openrailwaymap.app';
test('all catalog ranges match the generated source contract, including the station underzoom override',()=>{
 for(const source of Object.values(railwaySources())){
  if(!source.url||!source.url.startsWith(origin+'/'))continue;const [address,fragment='']=source.url.split('#');
  const data={...railTileMetadata(address),...zoomOverrides(fragment)};
  assert.equal(data.minzoom,source.minzoom,address);assert.equal(data.maxzoom,source.maxzoom,address);
 }
 assert.equal(railTileMetadata(origin+'.evil.invalid/railway_line_high'),null);
 assert.equal(railTileMetadata(origin+'/new_unknown_endpoint'),null);
});
test('absent and invalid station zoom options do not become zero',()=>{
 assert.deepEqual(zoomOverrides(''),{});assert.deepEqual(zoomOverrides('minzoom=&maxzoom=bad'),{});
 assert.deepEqual(zoomOverrides('minzoom=0&maxzoom=7&underzoom=7'),{minzoom:0,maxzoom:7,underzoom:7});
});
test('known hidden-source metadata causes zero network requests',async()=>{
 const handlers={};let fetched=0;
 const protocols=installLabelProtocols({addProtocol:(name,fn)=>handlers[name]=fn},{},async()=>{fetched++;throw new Error('network must not be used');});
 try{
  for(const endpoint of Object.keys(RAIL_TILE_RANGES)){
   const result=await handlers.atlasrail({type:'json',url:'atlasrail://'+origin+'/'+endpoint},new AbortController());
   assert.equal(result.data.vector_layers[0].id,endpoint);
  }
  const result=await handlers.atlasstation({type:'json',url:'atlasstation://en/'+origin+'/standard_railway_text_stations'},new AbortController());
  assert.equal(result.data.minzoom,8);assert.equal(result.data.maxzoom,16);assert.equal(fetched,0);
  console.log('RAIL_METADATA_NETWORK_REQUESTS',fetched,'for',Object.keys(RAIL_TILE_RANGES).length,'endpoints');
 }finally{protocols.dispose();}
});
test('malformed HTTP-success provider tile is retried before it can enter the shared cache',async()=>{
 const handlers={};let fetched=0;
 const tile=encode.fromGeojsonVt({railway_line_high:{features:[{type:2,geometry:[[[1,1],[100,100]]],tags:{id:'way-1',feature:'rail',state:'present'}}]}});
 const valid=tile.buffer.slice(tile.byteOffset,tile.byteOffset+tile.byteLength);
 const invalid=new TextEncoder().encode('temporarily unavailable').buffer;
 const protocols=installLabelProtocols({addProtocol:(name,fn)=>handlers[name]=fn},{},async()=>({
   ok:true,status:200,arrayBuffer:async()=>++fetched===1?invalid:valid
 }),{tileRetries:[0]});
 try{
  const url='atlasrail://'+origin+'/railway_line_high/7/104/52';
  const result=await handlers.atlasrail({type:'arrayBuffer',url},new AbortController());
  assert.ok(result.data.byteLength);assert.equal(fetched,2,'malformed body consumes one retry');
  await handlers.atlasrail({type:'arrayBuffer',url},new AbortController());
  assert.equal(fetched,2,'only the validated replacement is cached');
 }finally{protocols.dispose();}
});

test('zoom-seven railway geometry is not delayed by optional rare-Han fonts',async()=>{
 const handlers={};let fonts=0;
 const tile=encode.fromGeojsonVt({railway_line_high:{features:[{type:2,geometry:[[[1,1],[100,100]]],tags:{id:'way-1',name:'𠮷',feature:'rail',state:'present'}}]}});
 const protocols=installLabelProtocols({addProtocol:(name,fn)=>handlers[name]=fn},{},async()=>({ok:true,arrayBuffer:async()=>tile.buffer.slice(tile.byteOffset,tile.byteOffset+tile.byteLength)}),{rareGlyphs:async()=>{fonts++;}});
 try{
  const result=await handlers.atlasrail({type:'arrayBuffer',url:'atlasrail://'+origin+'/railway_line_high/7/104/52'},new AbortController());
  assert.ok(result.data.byteLength);assert.equal(fonts,0);
  await handlers.atlasrail({type:'arrayBuffer',url:'atlasrail://'+origin+'/railway_line_high/9/416/208'},new AbortController());
  assert.equal(fonts,1,'retain the text/glyph path where railway names are drawn');
  assert.equal(railTileNeedsGlyphs(origin+'/speed_railway_line_low/0/0/0'),false);
 }finally{protocols.dispose();}
});

test('public ORM composite aliases translate only recognized geographic tiles, preserving lang',()=>{
 const groups={
  railway_line_high:'railway_line_high,railway_text_km',
  standard_railway_text_stations:'standard_railway_text_stations,standard_railway_grouped_stations,standard_railway_grouped_station_areas,standard_station_entrances,standard_railway_stop_positions,standard_interlocking,standard_interlocking_text',
  standard_railway_platforms:'standard_railway_platforms,standard_railway_platform_edges',
  signals_railway_line_low:'signals_railway_line_low,signals_railway_line_low_construction',
  points_of_interest:'points_of_interest,points_of_interest_areas,level_crossings_grouped,level_crossings_grouped_buffered',
 };
 for(const [layer,group] of Object.entries(groups)){
  assert.equal(RAIL_COMPOSITE_PATHS[layer],group,layer);
  for(const member of group.split(',')){
   assert.equal(RAIL_COMPOSITE_PATHS[member],group,member);
   const logical=`${origin}/${member}/7/104/52?lang=ja`;
   assert.equal(railProviderTileURL(logical),`${origin}/${group}/7/104/52?lang=ja`);
  }
 }
 for(const url of [
  `${origin}/railway_line_high`,
  `${origin}/api/feature/railway_line_high/way-4`,
  `${origin}/other_dataset/7/104/52`,
  `${origin}/railway_line_high/7/999/52`,
  `${origin}/railway_line_high/23/1/2`,
  `${origin}/railway_line_high/7/104/52#fragment`,
  `${origin}.evil.example/railway_line_high/7/104/52`,
  'https://other.example/railway_line_high/7/104/52',
  'https://login:password@openrailwaymap.app/railway_line_high/7/104/52',
 ])assert.equal(railProviderTileURL(url),url,url);
 assert.equal(railProviderTileURL(`${origin}/railway_line_high/7/104/52.pbf`),
  `${origin}/railway_line_high,railway_text_km/7/104/52`);
 assert.equal(railProviderTileURL(`${origin}/railway_line_high/7/104/52`, 'https://private-orm.example'),
  `${origin}/railway_line_high/7/104/52`,'do not rewrite private provider URLs');
 const privateURL='https://private-orm.example/railway_line_high/7/104/52';
 assert.equal(railProviderTileURL(privateURL,'https://private-orm.example'),privateURL,
  'a selected private provider keeps its own endpoint contract');
 for(const provider of [origin+'/private/',origin+'?key=private',origin+'#private'])
  assert.equal(railProviderTileURL(`${origin}/railway_line_high/7/104/52`,provider),
   `${origin}/railway_line_high/7/104/52`,'only the exact public provider root enables routing');
});

test('composite requests coalesce across logical sources and accept a supplementary-only MVT',async()=>{
 const handlers={},urls=[];
 const encoded=encode.fromGeojsonVt({standard_railway_platform_edges:{features:[
  {type:2,geometry:[[[1,1],[100,100]]],tags:{ref:'A',id:'edge-1'}}]}});
 const body=encoded.buffer.slice(encoded.byteOffset,encoded.byteOffset+encoded.byteLength);
 const protocols=installLabelProtocols({addProtocol:(id,fn)=>handlers[id]=fn},{},
  async url=>{urls.push(url);return {ok:true,status:200,arrayBuffer:async()=>body};});
 const p=origin+'/standard_railway_platforms/17/1/2', e=origin+'/standard_railway_platform_edges/17/1/2';
 try {
  const results=await Promise.all([
   handlers.atlasrail({type:'arrayBuffer',url:'atlasrail://'+p},new AbortController()),
   handlers.atlastext({type:'arrayBuffer',url:'atlastext://'+e},new AbortController()),
  ]);
  assert.ok(results.every(x=>x.data.byteLength>0));
  assert.deepEqual(urls,[origin+'/standard_railway_platforms,standard_railway_platform_edges/17/1/2'],
   'one composite fetch serves both logical sources');
  await handlers.atlasrail({type:'arrayBuffer',url:'atlasrail://'+p},new AbortController());
  assert.equal(urls.length,1,'validated composite tile is shared and cached');
 } finally {protocols.dispose();}
});

test('public ORM obsolete single-layer 404 remains a visible failure, not empty geometry',async()=>{
 const handlers={},urls=[];
 const protocols=installLabelProtocols({addProtocol:(id,fn)=>handlers[id]=fn},{},
  async url=>{urls.push(url);return {ok:false,status:404,headers:{get:()=>null}};},{tileRetries:[0]});
 try {
  await assert.rejects(handlers.atlasrail({type:'arrayBuffer',
   url:'atlasrail://'+origin+'/railway_line_high/7/104/52'},new AbortController()),/404/);
  assert.deepEqual(urls,[origin+'/railway_line_high,railway_text_km/7/104/52']);
 }finally{protocols.dispose();}
});

test('station localization cannot cross layer boundaries in a composite ORM tile',async()=>{
 const handlers={}, urls=[];
 const fixture=encode.fromGeojsonVt({
  standard_railway_text_stations:{features:[{type:1,geometry:[[100,100]],tags:{
   id:'same-osm-id',name:'Station Alpha','name:en':'Station Alpha'}}]},
  standard_railway_grouped_stations:{features:[{type:1,geometry:[[200,200]],tags:{
   id:'same-osm-id',name:'Unrelated grouped point','name:en':'Unrelated grouped point'}}]},
 });
 const bytes=fixture.buffer.slice(fixture.byteOffset,fixture.byteOffset+fixture.byteLength);
 const protocols=installLabelProtocols({addProtocol:(name,fn)=>handlers[name]=fn},{},async url=>{
  urls.push(url);return {ok:true,status:200,arrayBuffer:async()=>bytes};
 });
 try{
  const result=await handlers.atlasstation({type:'arrayBuffer',
   url:'atlasstation://en/'+origin+'/standard_railway_text_stations/8/130/90'},new AbortController());
  const tile=new VectorTile(new Pbf(new Uint8Array(result.data))).layers;
  const station=tile.standard_railway_text_stations.feature(0).properties;
  const other=tile.standard_railway_grouped_stations.feature(0).properties;
  assert.equal(station.atlas_name,'Station Alpha');
  assert.equal(station.atlas_language,'en');
  assert.equal(other.name,'Unrelated grouped point');
  assert.equal(other.atlas_name,undefined,'unrelated source-layer must not be localized');
  assert.equal(other.atlas_han,undefined,'unrelated layer must not receive station location data');
  assert.ok(urls.length>=1);
  assert.ok(urls.every(url=>url.includes('/standard_railway_text_stations,standard_railway_grouped_stations,standard_railway_grouped_station_areas,')),
   'all station fetches use the public upstream composite URL');
 }finally{protocols.dispose();}
});
