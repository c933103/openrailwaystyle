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
