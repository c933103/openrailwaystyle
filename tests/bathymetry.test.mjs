import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createExpression} from '@maplibre/maplibre-gl-style-spec';
import {DEPTH_ZOOM, depthColour, depthTile, colourPixels, oceanPolygons, installBathymetry, shareArchiveRequests, seabedContourOpacity} from '../styles/bathymetry.mjs';

test('depth colours distinguish shallow reefs, shelves, deep basins and trenches', () => {
  const depths = [0, 20, 200, 1000, 3000, 6000, 11000].map(d => depthColour(-d));
  assert.equal(new Set(depths.map(c => c.join(','))).size, depths.length);
  assert.ok(depths.every(c => c[3] === 255));
  assert.ok(depths.every((c, i) => i === 0 || c[0] < depths[i - 1][0]));
  assert.deepEqual(depthColour(-100), [158, 213, 215, 255]);
  for (const missing of [NaN, Infinity, -32768, -11501]) assert.equal(depthColour(missing)[3], 0);
});

test('street-detail tiles keep using bathymetry instead of fine DEM tiles without depths', () => {
  assert.deepEqual(depthTile(8, 201, 97), {z:8, x:201, y:97, scale:1, ox:0, oy:0});
  assert.deepEqual(depthTile(14, 15823, 7798), {z:DEPTH_ZOOM, x:988, y:487, scale:16, ox:15, oy:6});
});

test('deep and fine contours are subdued, with the same weight in metres and feet', () => {
  const compiled = units => {
    const result=createExpression(seabedContourOpacity(units));assert.equal(result.result,'success');
    return (ele,level)=>result.value.evaluate({zoom:9},{type:2,properties:{ele,level}});
  };
  const metric=compiled('metric'), imperial=compiled('imperial');
  assert.ok(metric(-4000,0)<metric(-50,0));
  assert.ok(metric(-4000,1)>metric(-4000,0));
  assert.ok(Math.abs(metric(-4000,1)-imperial(-4000*3.28084,1))<1e-12);
});

test('overzooming crops the right shallow/deep quadrant and keeps missing data transparent', () => {
  const dem = {width:2, height:2, data:Float32Array.from([-20, -1000, -6000, -11000])};
  for (const [x, y, depth] of [[0,0,20],[1,0,1000],[0,1,6000],[1,1,11000]]) {
    assert.deepEqual([...colourPixels(dem, depthTile(11, x, y), 1)], depthColour(-depth));
  }
  assert.deepEqual([...colourPixels({width:1,height:1,data:[-32768]}, depthTile(10,0,0),1)], [0,0,0,0]);
  // Positive heights mixed into coastal samples do not punch holes in the
  // sea colour: the ocean polygon mask, including islands, decides coverage.
  assert.deepEqual([...colourPixels({width:1,height:1,data:[10]},depthTile(10,0,0),1)], depthColour(0));
});

test('the water mask preserves island holes and excludes lakes and dry lowlands', () => {
  const rings = [[{x:0,y:0},{x:4096,y:0},{x:4096,y:4096},{x:0,y:4096}],
    [{x:1000,y:1000},{x:2000,y:1000},{x:2000,y:2000},{x:1000,y:2000}]];
  const f = klass => ({type:3, properties:{class:klass}, extent:4096, loadGeometry:()=>rings});
  const water = {length:2, feature:i=>f(i ? 'lake' : 'ocean')};
  assert.deepEqual(oceanPolygons({layers:{water}}), [{extent:4096,rings}]);
  assert.deepEqual(oceanPolygons({layers:{}}), []);
});

test('invalid and cancelled requests do not fetch water or terrain', async () => {
  let protocol, water = 0, terrain = 0;
  installBathymetry({addProtocol:(_, handler)=>protocol=handler}, {getDemTile:()=>terrain++}, {
    waterTile:()=>water++, readTile:()=>{},
  });
  await assert.rejects(protocol({url:'atlas-depth://15/0/0'},new AbortController()), /bounds/);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(protocol({url:'atlas-depth://10/0/0'},cancelled), /abort/i);
  assert.equal(water,0); assert.equal(terrain,0);
});

test('archive tile sharing avoids duplicate requests and isolates cancellation and buffers', async () => {
  let finish, controller, count = 0;
  const shared = shareArchiveRequests((_, c) => {count++; controller=c;return new Promise(resolve=>finish=resolve);});
  const params={url:'pmtiles://archive/10/982/478',type:'arrayBuffer'}, a=new AbortController(), b=new AbortController();
  const first=shared(params,a), second=shared(params,b);
  const cancelled=assert.rejects(first,/abort/i);
  await Promise.resolve(); a.abort();
  assert.equal(controller.signal.aborted,false);
  finish({data:Uint8Array.from([1,2,3]).buffer});
  await cancelled;
  const result=await second; assert.equal(count,1);assert.deepEqual([...new Uint8Array(result.data)],[1,2,3]);
  const third=shared(params,new AbortController()), fourth=shared(params,new AbortController());
  await Promise.resolve();finish({data:Uint8Array.from([4,5,6]).buffer});
  const [c,d]=await Promise.all([third,fourth]);new Uint8Array(c.data)[0]=0;
  assert.equal(new Uint8Array(d.data)[0],4);
  assert.equal(count,2,'completed vector tiles must not occupy a second persistent cache');
});

test('depth shading stays below islands, contours and railways and respects the terrain setting', async () => {
  const style = JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
  const ids = style.layers.map(l=>l.id), depth = ids.indexOf('terrain-bathymetry');
  assert.ok(depth > ids.indexOf('water'));
  for (const id of ['landcover-ice-shelf','terrain-relief','terrain-seabed-contours','speed-tracks']) assert.ok(ids.indexOf(id) > depth);
  assert.equal(style.sources.bathymetry.maxzoom,14);
});

test('with a worker, depth tiles are drawn there: land needs no terrain, a cancelled tile is dropped', async t => {
  // Node has no OffscreenCanvas or Worker; minimal ones stand in (the
  // canvas for the 1-pixel land tile the page encodes itself).
  const had = [globalThis.OffscreenCanvas, globalThis.Worker];
  globalThis.OffscreenCanvas = class { getContext() { return {}; } convertToBlob() { return Promise.resolve(new Blob([new Uint8Array([7])])); } };
  globalThis.Worker ??= class {};
  t.after(() => { [globalThis.OffscreenCanvas, globalThis.Worker] = had; });
  const posted = [];
  class FakeWorker {
    postMessage(message) {
      posted.push(message);
      if (message.drop) return;
      // Sea where the water tile has bytes; the PNG is the tile's key.
      const answer = message.water ? {ocean: message.water.byteLength > 0} : {data: new TextEncoder().encode(message.key).buffer};
      if (message.key.endsWith('/stall')) return;
      setTimeout(() => this.onmessage({data: {id: message.id, ...answer}}));
    }
  }
  let protocol, demRequests = 0;
  installBathymetry({addProtocol: (_, handler) => { protocol = handler; }}, {getDemTile: async () => { demRequests++; return {width: 2, height: 2, data: new Float32Array([-10, -20, -30, -40])}; }}, {
    waterTile: async (z, x) => ({data: x === 1 ? new ArrayBuffer(0) : new Uint8Array([1, 2]).buffer}),
    readTile: () => { throw new Error('the page must not decode water tiles when a worker draws them'); },
    createWorker: () => new FakeWorker(),
  });
  const land = await protocol({url: 'atlas-depth://5/1/3'}, new AbortController());
  assert.deepEqual([...new Uint8Array(land.data)], [7]);
  assert.equal(demRequests, 0, 'no terrain tile for land');
  const sea = await protocol({url: 'atlas-depth://5/2/3'}, new AbortController());
  assert.match(new TextDecoder().decode(sea.data), /^atlas-depth:\/\/5\/2\/3#\d+$/);
  assert.equal(demRequests, 1);
  const paint = posted.find(m => m.heights);
  assert.deepEqual([paint.heights.width, paint.heights.height, [...paint.heights.data]], [2, 2, [-10, -20, -30, -40]]);
  assert.deepEqual(paint.tile, depthTile(5, 2, 3));
  // A tile cancelled while the worker paints it: rejected as cancelled, and
  // the worker forgets its polygons.
  const original = FakeWorker.prototype.postMessage;
  FakeWorker.prototype.postMessage = function (message) { if (message.heights) { posted.push(message); return; } original.call(this, message); };
  const cancelled = new AbortController(), pending = protocol({url: 'atlas-depth://5/4/3'}, cancelled);
  await new Promise(resolve => setTimeout(resolve, 20));
  cancelled.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.ok(posted.some(m => m.drop && m.key.startsWith('atlas-depth://5/4/3#')));
});

test('a depth worker that fails is not used again: its tiles and later ones are drawn on the page', async t => {
  const had = [globalThis.OffscreenCanvas, globalThis.Worker, globalThis.ImageData];
  globalThis.OffscreenCanvas = class { getContext() { return {putImageData() {}, drawImage() {}, getImageData() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}}; } convertToBlob() { return Promise.resolve(new Blob([new Uint8Array([9])])); } };
  globalThis.Worker ??= class {};
  globalThis.ImageData ??= class { constructor(data, width, height) { Object.assign(this, {data, width, height}); } };
  t.after(() => { [globalThis.OffscreenCanvas, globalThis.Worker, globalThis.ImageData] = had; });
  let worker, created = 0, decoded = 0;
  class DeadWorker { constructor() { created++; worker = this; this.posted = 0; } postMessage() { this.posted++; } terminate() { this.terminated = true; } }
  let protocol;
  const ocean = {layers: {water: {length: 1, extent: 4096, feature: () => ({type: 3, properties: {class: 'ocean'}, loadGeometry: () => [[{x: 0, y: 0}, {x: 4096, y: 0}, {x: 4096, y: 4096}]]})}}};
  installBathymetry({addProtocol: (_, handler) => { protocol = handler; }}, {getDemTile: async () => ({width: 2, height: 2, data: new Float32Array([-10, -20, -30, -40])})}, {
    waterTile: async () => ({data: new Uint8Array([1]).buffer}),
    readTile: () => { decoded++; return ocean; },
    createWorker: () => new DeadWorker(),
  });
  // The worker script fails to load while a tile waits on it.
  const first = protocol({url: 'atlas-depth://5/2/3'}, new AbortController());
  await new Promise(resolve => setTimeout(resolve));
  worker.onerror({message: 'script failed'});
  assert.deepEqual([...new Uint8Array((await first).data)], [9], 'the waiting tile is drawn on the page');
  assert.ok(worker.terminated);
  const posted = worker.posted;
  await protocol({url: 'atlas-depth://5/3/3'}, new AbortController());
  assert.equal(worker.posted, posted, 'later tiles are not sent to the failed worker');
  assert.equal(decoded, 2);
  assert.equal(created, 1);
});

test('a depth worker that reports a processing error hands its tiles to the page and is not used again', async t => {
  const had = [globalThis.OffscreenCanvas, globalThis.Worker, globalThis.ImageData];
  globalThis.OffscreenCanvas = class { getContext() { return {putImageData() {}, drawImage() {}, getImageData() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}}; } convertToBlob() { return Promise.resolve(new Blob([new Uint8Array([9])])); } };
  globalThis.Worker ??= class {};
  globalThis.ImageData ??= class { constructor(data, width, height) { Object.assign(this, {data, width, height}); } };
  t.after(() => { [globalThis.OffscreenCanvas, globalThis.Worker, globalThis.ImageData] = had; });
  // The worker starts, but its canvas cannot draw: it answers with an error.
  let worker, decoded = 0;
  class NoCanvasWorker { constructor() { worker = this; this.posted = 0; } postMessage(message) { this.posted++; if (!message.drop) queueMicrotask(() => this.onmessage({data: {id: message.id, error: 'getContext is not a function'}})); } terminate() { this.terminated = true; } }
  let protocol;
  const ocean = {layers: {water: {length: 1, extent: 4096, feature: () => ({type: 3, properties: {class: 'ocean'}, loadGeometry: () => [[{x: 0, y: 0}, {x: 4096, y: 0}, {x: 4096, y: 4096}]]})}}};
  installBathymetry({addProtocol: (_, handler) => { protocol = handler; }}, {getDemTile: async () => ({width: 2, height: 2, data: new Float32Array([-10, -20, -30, -40])})}, {
    waterTile: async () => ({data: new Uint8Array([1]).buffer}),
    readTile: () => { decoded++; return ocean; },
    createWorker: () => new NoCanvasWorker(),
  });
  assert.deepEqual([...new Uint8Array((await protocol({url: 'atlas-depth://5/2/3'}, new AbortController())).data)], [9], 'the tile is drawn on the page');
  assert.ok(worker.terminated);
  const posted = worker.posted;
  await protocol({url: 'atlas-depth://5/3/3'}, new AbortController());
  assert.equal(worker.posted, posted, 'later tiles are not sent to the worker');
  assert.equal(decoded, 2);
});

test('world-wrap requests of the same depth tile keep independent worker state',async t=>{
 const had=[globalThis.OffscreenCanvas,globalThis.Worker];globalThis.OffscreenCanvas=class{};globalThis.Worker=class{};
 t.after(()=>{[globalThis.OffscreenCanvas,globalThis.Worker]=had;});
 let protocol;const polygons=new Set(),keys=[],release=[];
 const worker={postMessage(message){
  if(message.drop){polygons.delete(message.key);return;}
  if(message.water){polygons.add(message.key);keys.push(message.key);queueMicrotask(()=>this.onmessage({data:{id:message.id,ocean:true}}));}
  else {const found=polygons.delete(message.key);queueMicrotask(()=>this.onmessage({data:found?{id:message.id,data:new Uint8Array([1]).buffer}:{id:message.id,error:'lost polygons'}}));}
 }};
 installBathymetry({addProtocol:(_,handler)=>protocol=handler},{getDemTile:()=>new Promise(r=>release.push(()=>r({width:1,height:1,data:[-10]})))},{waterTile:async()=>({data:new Uint8Array([1]).buffer}),readTile:()=>{},createWorker:()=>worker});
 const cancelled=new AbortController(),first=protocol({url:'atlas-depth://5/2/3'},cancelled),second=protocol({url:'atlas-depth://5/2/3'},new AbortController());
 await new Promise(r=>setImmediate(r));assert.equal(keys.length,2);assert.notEqual(keys[0],keys[1]);
 cancelled.abort();release.forEach(r=>r());await assert.rejects(first,{name:'AbortError'});
 assert.deepEqual([...new Uint8Array((await second).data)],[1]);assert.equal(polygons.size,0);
});


test('depth worker retains every active mask beyond 64 requests and releases painted or cancelled masks', async () => {
  const {runInNewContext}=await import('node:vm');
  const source=(await readFile(new URL('../styles/depth-worker.mjs',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  const replies=[],self={postMessage:message=>replies.push(message)};
  // Exercise the real worker message lifecycle; decoding and canvas output
  // are independent of whether queued water masks survive concurrent work.
  runInNewContext(source,{self,Map,Uint8Array,Error,
    VectorTile:class {},Pbf:class {},oceanPolygons:()=>[{}],
    OffscreenCanvas:class {getContext(){return {putImageData(){}};}},
    ImageData:class {},colourPixels:()=>new Uint8Array(4),maskOcean(){},
    encodePng:async()=>new Uint8Array([7]).buffer,
  });
  const send=message=>self.onmessage({data:message});
  for(let id=0;id<96;id++)await send({id,key:`tile-${id}`,water:new Uint8Array([1]).buffer});
  assert.equal(replies.filter(reply=>reply.ocean).length,96);
  for(let id=0;id<96;id++)await send({id:100+id,key:`tile-${id}`,heights:{},tile:{}});
  assert.equal(replies.filter(reply=>reply.data).length,96,'every active tile must paint, including the oldest mask');
  assert.deepEqual(replies.filter(reply=>reply.error),[]);
  await send({id:300,key:'cancelled',water:new Uint8Array([1]).buffer});
  await send({key:'cancelled',drop:true});
  await send({id:301,key:'cancelled',heights:{},tile:{}});
  await send({id:302,key:'tile-0',heights:{},tile:{}});
  assert.deepEqual(replies.filter(reply=>reply.error).map(reply=>reply.id),[301,302],'cancelled and painted masks are released');
});
