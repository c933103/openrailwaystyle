import test from 'node:test';
import assert from 'node:assert/strict';
import {flatStationFallbackLayer,flatStationFallbackMask,compileFlatCuratedStations} from '../styles/flat-station-fallback.mjs';

const point=(x,y)=>({type:1,extent:4096,paths:[[{x,y}]]});

test('Canvas identifies the existing station fallback layers',()=>{
  assert.equal(flatStationFallbackLayer('station-basemap-fallback-dots'),true);
  assert.equal(flatStationFallbackLayer('station-basemap-fallback-names'),true);
  assert.equal(flatStationFallbackLayer('station-curated-fallback-dots'),true);
  assert.equal(flatStationFallbackLayer('station-provider-dots'),false);
});

test('Canvas station fallback follows failed canonical tiles, not the whole viewport',()=>{
  const mask=flatStationFallbackMask({tiles:[{tile:{z:8,x:128,y:128}}]});
  const parent={z:7,x:64,y:64};
  assert.equal(mask(point(1536,1024),parent),true);
  assert.equal(mask(point(2560,1024),parent),false);
  assert.equal(mask(point(2048,1024),parent),false);
  assert.equal(mask(point(128,128),{z:9,x:257,y:257,worldX:-255}),true);
  assert.equal(mask(point(128,128),{z:9,x:258,y:257}),false);
  assert.equal(mask(point(0,-1),parent),false);
});

test('metadata failure alone allows the whole visible coverage while loading does not',()=>{
  const tile={z:10,x:512,y:512};
  assert.equal(flatStationFallbackMask()(point(100,100),tile),false);
  assert.equal(flatStationFallbackMask({metadataFailed:true})(point(100,100),tile),true);
  assert.equal(flatStationFallbackMask({metadataFailed:true})(point(4096,0),tile),false);
});

test('curated GeoJSON maps into canonical Canvas tiles for normal and wrapped copies',()=>{
  const data={features:[
    {id:'east',properties:{name:'East'},geometry:{type:'Point',coordinates:[1,0]}},
    {id:'invalid',geometry:{type:'Point',coordinates:[0,90]}},
    {id:'line',geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}},
  ]};
  const render=compileFlatCuratedStations(data);
  const tiles=[{x:64,y:64,z:7,worldX:64},{x:64,y:64,z:7,worldX:192},{x:65,y:64,z:7,worldX:65}];
  const result=render({visibleTiles:z=>{assert.equal(z,7);return tiles;}});
  assert.deepEqual(result.map(r=>r.tile.worldX),[64,192]);
  const [feature]=result[0].vector.layer('curated-stations');
  assert.equal(feature.id,'east');
  assert.equal(feature.paths[0][0].y,0);
  assert.ok(feature.paths[0][0].x>0&&feature.paths[0][0].x<feature.extent);
  assert.deepEqual(result[0].vector.layer('poi'),[]);
});
