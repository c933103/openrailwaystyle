import test from 'node:test';
import assert from 'node:assert/strict';
import {ByteCache} from '../styles/byte-cache.mjs';
import {PolarLayer} from '../styles/polar-layer.mjs';
import {installLabelProtocols} from '../styles/tile-labels.mjs';
import encode from 'vt-pbf';
test('raw response cache limits bytes as well as count and respects recent use',()=>{
 const c=new ByteCache({maxBytes:12,maxEntries:3});
 c.set('a',new ArrayBuffer(4));c.set('b',new ArrayBuffer(4));c.set('c',new ArrayBuffer(4));c.get('a');c.set('d',new ArrayBuffer(4));
 assert.equal(c.has('b'),false);assert.equal(c.bytes,12);assert.equal(c.get('a').byteLength,4);
 c.set('huge',new ArrayBuffer(20));assert.equal(c.has('huge'),false);assert.equal(c.bytes,12);
 c.set('a',new ArrayBuffer(2));assert.equal(c.bytes,10);
 const large=new ByteCache();for(let i=0;i<120;i++)large.set(i,new ArrayBuffer(1024*1024));assert.equal(large.bytes,24*1024*1024);assert.equal(large.size,24);
});
test('track-count worker transfers private copies while keeping downloaded buffers intact',async()=>{
 const protocols={},originals=[],sent=[],previous=globalThis.Worker;
 globalThis.Worker=class {postMessage(message,transfer){sent.push({message,transfer});const own=structuredClone(message,{transfer});queueMicrotask(()=>this.onmessage({data:{id:own.id,result:{extent:4096,points:[]}}}));}};
 try {
  installLabelProtocols({addProtocol:(id,f)=>protocols[id]=f},{},async url=>({ok:true,status:200,arrayBuffer:async()=>{
    const endpoint=new URL(url).pathname.split('/')[1];
    const tile=encode.fromGeojsonVt({[endpoint]:{features:[{type:2,geometry:[[[1,1],[2,2]]],tags:{id:'way-1'}}]}});
    const b=tile.buffer.slice(tile.byteOffset,tile.byteOffset+tile.byteLength);originals.push(b);return b;
  }}));
  await protocols.atlastracks({url:'atlastracks://14/8192/8192'},{signal:new AbortController().signal});
  // The nine railway tiles around the tile, and its nine station-area and nine station tiles.
  assert.equal(sent[0].transfer.length,27);assert.equal(new Set(sent[0].transfer).size,27);
  assert.ok(sent[0].transfer.every(b=>b.byteLength===0),'worker received ownership');
  assert.ok(originals.length===27&&originals.every(b=>b.byteLength>0),'cache retains reusable validated originals');
 }finally{globalThis.Worker=previous;}
});
test('polar meshes evict old views within byte/count budgets and release programs on removal',()=>{
 const deleted=[],programs=[],layer=new PolarLayer({data:'https://example.org/',units:()=> 'metric',maxTileBytes:10,maxTiles:2});
 layer.onAdd({triggerRepaint(){}},{deleteBuffer:b=>deleted.push(b),deleteProgram:p=>programs.push(p),deleteTexture(){}});
 for(let i=0;i<5;i++)layer.tiles.set(String(i),{bytes:4,buffers:[i]});
 layer.visibleKeys=new Set(['0']);layer.pruneTiles();assert.ok(layer.tiles.has('0'));assert.equal(layer.tiles.size,2);assert.equal(deleted.length,3);
 layer.programs.set('fill',{program:77});layer.onRemove();assert.equal(deleted.length,5);assert.deepEqual(programs,[77]);assert.equal(layer.tiles.size,0);
});
test('a contour response arriving after removal cannot upload new GPU buffers',async()=>{
 const layer=new PolarLayer({data:'https://example.org/',units:()=> 'metric'});let resolve,uploads=0;
 layer.onAdd({triggerRepaint(){}},{deleteBuffer(){},deleteProgram(){},deleteTexture(){}});
 layer.json=()=>new Promise(r=>{resolve=r;});layer.upload=()=>{uploads++;return {};};
 layer.loadTile('north-metric-0-0-0');layer.onRemove();resolve({lines:[]});await Promise.resolve();await Promise.resolve();assert.equal(uploads,0);
});
