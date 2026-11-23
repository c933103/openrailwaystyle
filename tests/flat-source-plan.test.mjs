import assert from 'node:assert/strict';
import test from 'node:test';
import {flatCamera} from '../styles/flat-camera.mjs';
import {planFlatSourceTiles} from '../styles/flat-source-plan.mjs';
const at=(zoom,center=[7.44,46.94],width=750)=>flatCamera({zoom,center,width,height:500});
const levels=(camera,source)=>[...new Set(planFlatSourceTiles(camera,source).map(tile=>tile.canonical.z))];

test('MapLibre source resolutions use raster rounding, vector flooring and the 512 px camera world',()=>{
  for (const [source,wanted] of [[{type:'raster',tileSize:256},[10,11]],
    [{type:'raster',tileSize:512},[9,10]],[{type:'raster-dem'},[9,10]],[{type:'vector'},[9,9]]]) {
    assert.deepEqual([levels(at(9.49),source),levels(at(9.50),source)],wanted.map(z=>[z]));
  }
  assert.deepEqual(levels(at(9.50),{type:'raster',tileSize:256,maxzoom:10}),[10]);
  assert.deepEqual(levels(at(9.49),{type:'raster',tileSize:256,minzoom:11}),[]);
  assert.deepEqual(levels(at(9.49),{type:'raster',active:false}),[]);
  assert.deepEqual(levels(at(-2),{type:'vector'}),[0]);
});

test('bounds and availability filter requests before one canonical plan entry serves multiple world copies',()=>{
  const plan=planFlatSourceTiles(at(-1,[179,0],900),{type:'raster',maxzoom:0});
  assert.equal(plan.length,1);
  assert.deepEqual(plan[0].canonical,{z:0,x:0,y:0});
  assert.ok(plan[0].copies.length>2);
  assert.ok(plan[0].copies.every(tile=>tile.x===0));
  assert.equal(new Set(plan[0].copies.map(tile=>tile.worldX)).size,plan[0].copies.length);
  assert.equal(planFlatSourceTiles(at(10,[7.44,46.94]),{type:'raster',bounds:[110,20,120,30]}).length,0);
  assert.ok(planFlatSourceTiles(at(10,[7.44,46.94]),{type:'raster',bounds:[6,45,9,48]}).length);
  assert.throws(()=>planFlatSourceTiles(at(10),{type:'raster',bounds:[0,0,30]}),RangeError);
});
