import test from 'node:test';
import assert from 'node:assert/strict';
import {flatStationFallbackLayer,flatStationFallbackMask} from '../styles/flat-station-fallback.mjs';

const point=(x,y)=>({type:1,extent:4096,paths:[[{x,y}]]});

test('Canvas permits only the existing vector station fallback layers',()=>{
  assert.equal(flatStationFallbackLayer('station-basemap-fallback-dots'),true);
  assert.equal(flatStationFallbackLayer('station-basemap-fallback-names'),true);
  assert.equal(flatStationFallbackLayer('station-curated-fallback-dots'),false);
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
