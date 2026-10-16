import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {terrainDecisionFixture as fixture,closeTerrainReplay} from '../scripts/controls-painter-terrain-replay.mjs';
after(closeTerrainReplay);

test('actual pinned renderer reproduces 360/144 with no guard and identical composited terrain',()=>{
 const cold=fixture().capture(),warm=fixture({warm:12}).capture();
 assert.equal(cold.dispatch.length,360);assert.equal(warm.dispatch.length,144);
 assert.deepEqual(cold.composite,warm.composite);assert.equal(cold.composite.length,20);
 assert.deepEqual(cold.coverageErrors,[]);assert.deepEqual(warm.coverageErrors,[]);
 for(const count of [0,12,20]){
  const baseline=fixture({warm:count}).capture(),guard=fixture({guard:true,warm:count}).capture();
  assert.deepEqual(baseline.dispatch,guard.dispatch);assert.deepEqual(baseline.composite,guard.composite);
  assert.equal(baseline.dispatch.length,18*(20-count));
 }
});

test('one cold frame and one warm frame compare exactly despite different natural cache histories',()=>{
 const baseline=fixture(),guard=fixture({guard:true,warm:12});
 const naturalA=baseline.capture(),naturalB=guard.capture();
 assert.notDeepEqual(naturalA.dispatch,naturalB.dispatch);
 const before=JSON.stringify(naturalB);
 for(const cache of ['cold','warm']){
  const a=baseline.sample(cache),b=guard.sample(cache);
  assert.deepEqual(a.sample.identity,b.sample.identity);
  assert.deepEqual(a.sample.probe.lastVisibleDispatch,b.sample.probe.lastVisibleDispatch);
  assert.deepEqual(a.composite,b.composite);assert.deepEqual(a.composite,naturalA.composite);
  assert.equal(a.sample.probe.frameCount,1);assert.equal(b.sample.probe.frameCount,1);
  assert.equal(a.sample.probe.lastVisibleDispatch.length,cache==='cold'?360:0);
  assert.deepEqual(a.coverageErrors,[]);assert.deepEqual(b.coverageErrors,[]);
 }
 assert.equal(JSON.stringify(naturalB),before,'controlled sampling preserves the raw observation');
});

test('cold comparisons reject missing/reordered layers and a missing terrain tile',()=>{
 const original=fixture().sample('cold');
 for(const mutation of ['dropLayer','reverseLayers','dropTile']){
  const changed=fixture({guard:true,warm:12,[mutation]:true}).sample('cold');
  assert.notDeepEqual(original.sample.identity,changed.sample.identity,mutation);
  assert.notDeepEqual(original.sample.probe.lastVisibleDispatch,changed.sample.probe.lastVisibleDispatch,mutation);
  assert.notDeepEqual(original.composite,changed.composite,mutation);
 }
});

test('dispatch equality cannot replace the unchanged pixel/coverage gate',()=>{
 const original=fixture().sample('cold'),changed=fixture({guard:true,skipVisibleMasks:true}).sample('cold');
 assert.deepEqual(original.sample.probe.lastVisibleDispatch,changed.sample.probe.lastVisibleDispatch);
 assert.equal(changed.coverageErrors.length,20,'skipping a visible source mask breaks coverage even with identical dispatch');
});

test('sampling fails closed for unsettled, empty or unavailable boundaries without rendering',()=>{
 for(const change of [f=>{f.map.loaded=()=>false;},f=>{f.map.areTilesLoaded=()=>false;},f=>{f.map.isMoving=()=>true;},f=>{f.map.getCanvas=()=>({width:511,height:512});},f=>{f.map.redraw=undefined;},f=>{f.map.painter.renderToTexture=undefined;},f=>{f.map.painter.renderToTexture.terrain.tileManager.getRenderableTiles=()=>[];}]){
  const f=fixture();change(f);assert.throws(()=>f.sample('cold'),/Terrain sample:/);assert.equal(f.probe.snapshot().frameCount,0);
 }
 assert.throws(()=>fixture().sample('warm'),/warm sample requires every terrain texture/);
 assert.throws(()=>fixture().sample('guess'),/explicit cold\/warm/);
});

test('sampling rejects no-op, repeated, failed and identity-changing redraws without retry',()=>{
 for(const kind of ['none','twice','throws','tiles','source','unsettled','cache']){
  const f=fixture(),original=f.map.redraw;let calls=0;
  f.map.redraw=function(){calls++;if(kind==='throws')throw new Error('redraw failed');if(kind==='none')return;
   original.call(this);if(kind==='twice')original.call(this);
   if(kind==='tiles')f.tiles[0].tileID.key='changed';
   if(kind==='source')f.map.style.tileManagers.A.getState=()=>({revision:2});
   if(kind==='unsettled')f.map.loaded=()=>false;
   if(kind==='cache')f.tiles[0].rtt=[];
  };
  assert.throws(()=>f.sample('cold'),/Terrain sample:|redraw failed/,kind);
  assert.equal(calls,1);assert.equal(f.probe.snapshot().active,false,kind);
 }
});

test('browser gate retains natural pixels/traces and requires both cold and warm exact comparisons',async()=>{
 const s=await readFile(new URL('../scripts/check-controls-painter-browser.mjs',import.meta.url),'utf8');
 assert.match(s,/changedBytes===0&&c.dispatchEqual/);
 assert.match(s,/sample.changedBytes===0&&sample.identityEqual&&sample.dispatchEqual/);
 assert.match(s,/assert.equal\(sample.naturalChangedBytes,0/);
 assert.match(s,/naturalDispatchEqual/);assert.match(s,/record.terrainSamples.push\(sample\)/);
 assert.match(s,/for\(const cache of \['cold','warm'\]\)/);
 assert.match(s,/const record=\{case:entry.name,sha256:digest\(bytes\),\.\.\.pixels,probe\}/);
 assert.match(s,/12\*60\*1000/);assert.match(s,/timeout:60000/);
});
