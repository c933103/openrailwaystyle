import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {controlsTerrainNaturalEquivalent} from '../scripts/controls-painter-probe.mjs';
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


test('natural cache-population changes remain failures even when cold/warm redraws would erase them',()=>{
 const a=fixture({warm:12}),b=fixture({guard:true,warm:12,mutateNaturalCache:true});
 const original=a.capture(),changed=b.capture();
 assert.deepEqual(original.composite,changed.composite,'pixels alone need not expose extra cache redraw work');
 assert.equal(original.dispatch.length,144);assert.equal(changed.dispatch.length,162);
 assert.equal(controlsTerrainNaturalEquivalent(original.probe,changed.probe),false);
 for(const cache of ['cold','warm']){
  const x=a.sample(cache),y=b.sample(cache);
  assert.deepEqual(x.sample.probe.lastVisibleDispatch,y.sample.probe.lastVisibleDispatch);
  assert.deepEqual(x.composite,y.composite);
 }
 assert.equal(controlsTerrainNaturalEquivalent(original.probe,changed.probe),false,'later controlled samples never convert the natural failure to success');
});

test('natural cache evidence rejects equal-count tile swaps and missing or altered observations',()=>{
 const clearCacheTiles=[12,13,14,15,16,17,18,19];
 const a=fixture({warm:20,clearCacheTiles}).capture(),same=fixture({guard:true,warm:20,clearCacheTiles}).capture(),swapped=fixture({warm:20,clearCacheTiles:[11,13,14,15,16,17,18,19]}).capture();
 assert.equal(controlsTerrainNaturalEquivalent(a.probe,same.probe),true);
 assert.deepEqual(a.dispatch,swapped.dispatch,'the old layer-only sequence cannot identify which tiles were cached');
 assert.equal(controlsTerrainNaturalEquivalent(a.probe,swapped.probe),false,'per-tile cache population and dispatched coordinate identity must agree');
 for(const mutate of [p=>{p.lastTerrain=null;},p=>{p.lastVisibleDispatchRecords=null;},p=>{p.lastVisibleDispatchRecords=[];},p=>{p.lastTerrain.after.identity.terrain=[];},p=>{p.framesTruncated=true;},p=>{p.dispatchTruncated=true;},p=>{p.lastTerrain.prepared.cache[0].slots=[false];},p=>{p.lastTerrain.after.cache[0].slots=[];},p=>{p.lastVisibleDispatchRecords[0].coords=['changed'];}]){
  const changed=structuredClone(same.probe);mutate(changed);
  assert.equal(controlsTerrainNaturalEquivalent(a.probe,changed),false);
 }
});

test('the original natural dispatch gate remains mandatory alongside richer cache evidence',async()=>{
 const s=await readFile(new URL('../scripts/check-controls-painter-browser.mjs',import.meta.url),'utf8');
 assert.match(s,/const dispatchEqual=naturalDispatchEqual&&naturalTerrainEqual&&/);
 assert.match(s,/controlsTerrainNaturalEquivalent\(a.probe,b.probe\)/);
});
