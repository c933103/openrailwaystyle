import test from 'node:test';
import assert from 'node:assert/strict';
import {railTileMetadata,zoomOverrides,railTileNeedsGlyphs,RAIL_TILE_RANGES} from '../styles/rail-source-catalog.mjs';
import {installLabelProtocols} from '../styles/tile-labels.mjs';
import {railwaySources} from '../scripts/style/sources/railway.mjs';
import encode from 'vt-pbf';
const origin='https://openrailwaymap.app';
test('all catalog ranges match the generated source contract, including the station underzoom override',()=>{
 for(const source of Object.values(railwaySources())){
  if(!source.url)continue;const [address,fragment='']=source.url.split('#');
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
