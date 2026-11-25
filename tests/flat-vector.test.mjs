import assert from 'node:assert/strict';
import test from 'node:test';
import {flatVectorTile,offsetFlatPath,flatLineIntersectsViewport,flatPlatformIntersectsViewport,flatPolygonGeometry} from '../styles/flat-vector.mjs';
import {flatVectorFixture} from './fixtures/flat-vector.mjs';

test('CPU vector tile reads exact source layers, ID, geometry and feature properties', () => {
  const input=flatVectorFixture();
  for(const bytes of [input,input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength)]) {
    const tile=flatVectorTile(bytes);
    const [rail]=tile.layer('rail');
    assert.equal(rail.id,83);
    assert.equal(rail.extent,4096);
    assert.equal(rail.type,2);
    assert.equal(rail.properties.railway,'rail');
    assert.equal(rail.properties.name,'Fixture Line');
    assert.deepEqual(rail.paths.map(path=>path.map(({x,y})=>[x,y])),[[[300,900],[3800,900]]]);
    assert.equal(tile.layer('area')[0].paths.length,2);
    assert.equal(tile.layer('station')[0].type,1);
    assert.deepEqual(tile.layer('missing'),[]);
    assert.deepEqual(tile.layer('constructor'),[]);
  }
  assert.deepEqual(flatVectorTile(new ArrayBuffer(0)).layer('rail'),[]);
});

test('line offsets translate right on screen and maintain bounded joins',()=>{
  assert.deepEqual(offsetFlatPath([[0,0],[12,0]],4),[[0,4],[12,4]]);
  assert.deepEqual(offsetFlatPath([[0,0],[0,12]],4),[[-4,0],[-4,12]]);
  const turn=offsetFlatPath([[0,0],[12,0],[12,0],[12,12]],2);
  assert.deepEqual(turn.map(p=>p.map(x=>Math.round(x))),[[0,2],[10,2],[10,12]]);
  const turnback=offsetFlatPath([[0,0],[12,0],[0,0.01]],3);
  assert.ok(Math.hypot(turnback[1][0]-12,turnback[1][1])<=6.001);
  const square=offsetFlatPath([[0,0],[12,0],[12,12],[0,12],[0,0]],2,true);
  assert.deepEqual(square.map(p=>p.map(x=>Math.round(x))),[[2,2],[10,2],[10,10],[2,10]]);
});

test('legend line observation excludes offscreen and tile-buffer-only geometry under rotation',()=>{
  const tile={}, feature=(...path)=>({type:2,extent:100,paths:[path.map(([x,y])=>({x,y}))]});
  const camera={width:50,height:50,tileTransform:()=>[0,100,-100,0,40,-25]};
  assert.equal(flatLineIntersectsViewport(camera,tile,feature([0,10],[100,10])),true);
  assert.equal(flatLineIntersectsViewport(camera,tile,feature([0,99],[100,99])),false);
  assert.equal(flatLineIntersectsViewport(camera,tile,feature([0,-5],[100,-5])),false);
  assert.equal(flatLineIntersectsViewport(camera,tile,feature([-20,10],[20,10])),false);
});


test('platform visibility considers interior, holes, and canonical tile clipping',()=>{
  const tile={}, feature=(...paths)=>({type:3,extent:100,paths:paths.map(p=>p.map(([x,y])=>({x,y})))});
  const ring=(l,t,r,b)=>[[l,t],[r,t],[r,b],[l,b],[l,t]];
  const camera={width:30,height:30,tileTransform:()=>[100,0,0,100,-35,-35]};
  assert.equal(flatPlatformIntersectsViewport(camera,tile,feature(ring(10,10,90,90))),true);
  assert.equal(flatPlatformIntersectsViewport(camera,tile,feature(ring(10,10,90,90),ring(30,30,70,70).reverse())),false);
  assert.equal(flatPlatformIntersectsViewport(camera,tile,feature(ring(10,40,50,50))),true);
  assert.equal(flatPlatformIntersectsViewport({...camera,tileTransform:()=>[100,0,0,100,10,0]},tile,feature(ring(-10,0,-1,50))),false);
  assert.equal(flatPlatformIntersectsViewport({...camera,tileTransform:()=>[0,100,-100,0,60,-35]},tile,feature(ring(10,10,90,90))),true);
});

test('platform polygons retain holes and disconnected shells even at small coordinate scales',()=>{
  const ring=(l,b,s)=>[[l,b],[l+s,b],[l+s,b+s],[l,b+s],[l,b]];
  const exterior=ring(139.7,35.6,1e-7),hole=ring(139.70000001,35.60000001,1e-8).reverse(),separate=ring(139.71,35.6,1e-7);
  assert.deepEqual(flatPolygonGeometry([exterior,hole,separate]),{
    type:'MultiPolygon',coordinates:[[exterior,hole],[separate]],
  });
});
