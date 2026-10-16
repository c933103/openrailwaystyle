import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installControlsTerrainBatchBarrier,controlsTerrainBatchesEquivalent,controlsTerrainNaturalEquivalent,readControlsSourceBatch} from '../scripts/controls-painter-probe.mjs';
import {terrainDecisionFixture,terrainRepaintDriver,closeTerrainReplay} from '../scripts/controls-painter-terrain-replay.mjs';
after(closeTerrainReplay);
const topology=JSON.parse(await readFile(new URL('./fixtures/controls-painter-dem-arrivals.json',import.meta.url)));
function make({guard=false,mutation}={}){
 const f=terrainDecisionFixture({topology,warm:20,guard});
 const sources={};
 for(const [id,manager] of Object.entries(f.map.style.tileManagers)){
  const state=sources[id]={loaded:true,tiles:topology.sources[id].map(key=>({tileID:{key},state:'loaded'}))};
  manager.getSource=()=>({loaded:()=>state.loaded});manager._inViewTiles={getAllTiles:()=>state.tiles};
 }
 f.savedSlot=[...f.tiles[0].rtt];
 if(mutation){const original=f.map.painter._renderTileClippingMasks;let changed=false;
  f.map.painter._renderTileClippingMasks=function(layer,...args){if(!changed&&layer.isHidden(this.transform.zoom)){changed=true;mutation(f);}return original.call(this,layer,...args);};}
 const barrier=installControlsTerrainBatchBarrier(f.map);
 return {...f,sources,barrier};
}
function deliver(f,keys,{reverse=false,extraChecks=false}={}){
 for(const key of keys)f.sources.dem.tiles.find(tile=>tile.tileID.key===key).state='loading';
 f.probe.arm();
 f.map._render(); // A scheduled callback while the source batch is incomplete.
 for(const key of reverse?[...keys].reverse():keys){
  f.sourceData(key);f.sources.dem.tiles.find(tile=>tile.tileID.key===key).state='loaded';
  f.map._render();
  if(extraChecks&&key!==keys.at(-1)&&f.sources.dem.tiles.some(tile=>tile.state!=='loaded'))f.map._render();
 }
 f.probe.stop();const result={sourceBatch:f.barrier.snapshot(),probe:f.probe.snapshot()};f.barrier.dispose();return result;
}

test('complete arrival batches retain exact natural equality despite different completion order and pending callbacks',()=>{
 for(const keys of [topology.arms[0].nextDem,topology.arms[1].arrivals]){
  const a=deliver(make(),keys),b=deliver(make({guard:true}),keys,{reverse:true,extraChecks:true});
  assert.equal(a.probe.frameCount,1);assert.equal(b.probe.frameCount,1);
  assert.notEqual(a.sourceBatch.deferredCount,b.sourceBatch.deferredCount);
  assert.equal(controlsTerrainNaturalEquivalent(a.probe,b.probe),true);
  assert.equal(controlsTerrainBatchesEquivalent(a,b),true);
  assert.equal(a.probe.lastVisibleDispatch.length,keys.length===4?234:360);
 }
});

test('barrier cannot erase a guard-caused cache eviction or equal-count coordinate substitution',()=>{
 const keys=topology.arms[1].arrivals,baseline=deliver(make(),keys);
 for(const [mutation,expectedCount] of [[f=>{f.tiles[1].rtt=[];},252],[f=>{f.tiles[0].rtt=f.savedSlot;f.tiles[1].rtt=[];},234]]){
  const f=make({guard:true,mutation});
  const changed=deliver(f,keys,{reverse:true});
  assert.equal(changed.probe.lastVisibleDispatch.length,expectedCount);
  assert.deepEqual(baseline.sourceBatch.frames,changed.sourceBatch.frames,'the fixture inputs really match');
  assert.equal(controlsTerrainNaturalEquivalent(baseline.probe,changed.probe),false);
  assert.equal(controlsTerrainBatchesEquivalent(baseline,changed),false);
 }
});

test('intermediate-frame cache changes cannot hide behind equal final observations',()=>{
 const result=deliver(make(),topology.arms[1].arrivals),changed=structuredClone(result);
 changed.probe.frames[0].terrain.before.cache[1].slots=[];
 assert.equal(controlsTerrainBatchesEquivalent(result,changed),false);
});

test('missing, truncated, changed or incomplete batch evidence fails closed',()=>{
 const result=deliver(make(),topology.arms[1].arrivals);
 const mutations=[r=>{delete r.sourceBatch;},r=>{r.sourceBatch.failure='failed';},r=>{r.sourceBatch.truncated=true;},r=>{r.sourceBatch.frames=[];},r=>{r.sourceBatch.frameCount++;},r=>{r.sourceBatch.frames[0].before[0].tiles[0].state='loading';},r=>{r.sourceBatch.frames[0].before[0].tiles[0].key='changed';},r=>{r.sourceBatch.frames[0].after[0].revision++;},r=>{r.probe.frames=[];},r=>{r.probe.frames[0].terrain.dispatchTruncated=true;},r=>{delete r.probe.frames[0].terrain.records;},r=>{r.probe.frames[0].terrain.records[0].coords=['changed'];}];
 for(const mutate of mutations){const bad=structuredClone(result);mutate(bad);assert.equal(controlsTerrainBatchesEquivalent(result,bad),false);}
});

test('no completion means no renderer invocation, added timer, cache reset, or false idle',()=>{
 const f=make(),before=JSON.stringify(f.tiles.map(tile=>tile.rtt));
 f.sources.dem.tiles[0].state='reloading';f.probe.arm();
 for(let i=0;i<129;i++)f.map._render();
 assert.equal(f.probe.snapshot().frameCount,0);assert.equal(f.barrier.snapshot().truncated,true);
 assert.equal(JSON.stringify(f.tiles.map(tile=>tile.rtt)),before);
 f.probe.stop();f.barrier.dispose();
});

test('source metadata completion is part of the batch and source errors fail explicitly',()=>{
 const f=make();f.sources.dem.loaded=false;f.probe.arm();f.map._render();assert.equal(f.probe.snapshot().frameCount,0);
 f.sources.dem.loaded=true;f.map._render();assert.equal(f.probe.snapshot().frameCount,1);f.probe.stop();f.barrier.dispose();
 for(const mutate of [x=>{x.sources.dem.tiles[0].state='errored';},x=>{x.map.style.tileManagers.dem._sourceErrored=true;},x=>{delete x.map.style.tileManagers.dem._inViewTiles;}]){
  const x=make();mutate(x);assert.throws(()=>x.map._render(),/Terrain source batch:/);assert.ok(x.barrier.snapshot().failure);x.barrier.dispose();
 }
});

test('barrier installs only while idle, preserves render arguments/result, and restores only its own wrapper',()=>{
 for(const mutate of [m=>{m.loaded=()=>false;},m=>{m.areTilesLoaded=()=>false;},m=>{m.isMoving=()=>true;},m=>{m._frameRequest={};}]){
  const f=make();f.barrier.dispose();mutate(f.map);assert.throws(()=>installControlsTerrainBatchBarrier(f.map),/idle boundary/);
 }
 const f=make();f.barrier.dispose();const original=function(...args){assert.equal(this,f.map);assert.deepEqual(args,[123]);return 42;};f.map._render=original;
 const barrier=installControlsTerrainBatchBarrier(f.map);assert.equal(f.map._render(123),42);barrier.dispose();assert.equal(f.map._render,original);
 const next=installControlsTerrainBatchBarrier(f.map),replacement=()=>{};f.map._render=replacement;next.dispose();assert.equal(f.map._render,replacement);
 assert.throws(()=>readControlsSourceBatch({}),/unavailable/);
});

test('hosted check keeps the natural gate and records the complete-input batch separately from controlled samples',async()=>{
 const script=await readFile(new URL('../scripts/check-controls-painter-browser.mjs',import.meta.url),'utf8');
 assert.match(script,/if\(entry.terrain\)\{[\s\S]*installControlsTerrainBatchBarrier/);
 assert.match(script,/const dispatchEqual=naturalDispatchEqual&&naturalTerrainEqual&&naturalSourceBatchEqual&&/);
 assert.match(script,/controlsTerrainBatchesEquivalent\(a,b\)/);
 assert.match(script,/terrainCapture=await boundedRead/);
 assert.ok(script.indexOf('controlsTerrainSettlement=controlsMapIdle(controlsMap)')<script.indexOf("if(entry.terrain)controlsMap.setTerrain"));
 assert.match(script,/waitUntil\(page,\(\)=>controlsTerrainSettlement,undefined,\{timeout:60000\}\)/);
 const barrier=(await readFile(new URL('../scripts/controls-painter-probe.mjs',import.meta.url),'utf8')).split('export function installControlsTerrainBatchBarrier')[1].split('export function controlsTerrainBatchesEquivalent')[0];
 assert.doesNotMatch(barrier,/\.rtt\s*=|freeRtt\(|redraw\(|setTimeout\(|triggerRepaint\(/);
});


test('actual pinned source-update scheduler resumes on completion without a renderer-driven timer or retry',()=>{
 const f=make(),driver=terrainRepaintDriver(f.map),keys=topology.arms[1].arrivals;
 for(const key of keys)f.sources.dem.tiles.find(tile=>tile.tileID.key===key).state='loading';
 f.probe.arm();driver.sourceChanged();driver.sourceChanged();assert.equal(driver.pending(),1);
 assert.equal(driver.frame(),1);assert.equal(f.probe.snapshot().frameCount,0);assert.equal(driver.pending(),0);
 for(const key of keys){
  f.sourceData(key);f.sources.dem.tiles.find(tile=>tile.tileID.key===key).state='loaded';
  driver.sourceChanged();assert.equal(driver.pending(),1);driver.frame();
 }
 f.probe.stop();assert.equal(f.probe.snapshot().frameCount,1);assert.equal(f.probe.snapshot().lastVisibleDispatch.length,234);
 assert.equal(driver.pending(),0);assert.equal(f.map._frameRequest,null);f.barrier.dispose();
});

test('symmetric missing or malformed terrain/cache/source evidence fails both natural and batch gates',()=>{
 const valid=deliver(make(),topology.arms[1].arrivals);
 const mutateStates=mutate=>record=>{
  for(const terrain of new Set([...record.probe.frames.map(frame=>frame.terrain),record.probe.lastTerrain]))
   for(const stage of ['before','prepared','after'])mutate(terrain[stage]);
 };
 const mutations=[
  state=>{delete state.cache;},state=>{state.cache=null;},state=>{state.cache={};},state=>{state.cache=[];},
  state=>{state.cache[0]=null;},state=>{state.cache[0].tile='wrong-coordinate';},state=>{state.cache[1]=structuredClone(state.cache[0]);},
  state=>{delete state.cache[0].slots;},state=>{state.cache[0].slots=null;},state=>{state.cache[0].slots={};},
  state=>{state.cache[0].slots=[0];},state=>{state.cache[0].slots=[null];},state=>{state.cache[0].slots=new Array(1);},
  state=>{delete state.identity.terrain;},state=>{state.identity.terrain=[];},state=>{state.identity.terrain[1]=state.identity.terrain[0];},
  state=>{delete state.identity.layers;},state=>{state.identity.layers=[];},state=>{state.identity.layers=[null];},
  state=>{delete state.identity.sources;},state=>{state.identity.sources=[];},state=>{state.identity.sources[0]=null;},
  state=>{state.identity.sources[1]=structuredClone(state.identity.sources[0]);},
  state=>{delete state.identity.sources[0].id;},state=>{delete state.identity.sources[0].revision;},
  state=>{state.identity.sources[0].revision=null;},state=>{state.identity.sources[0].revision='0';},state=>{state.identity.sources[0].revision=-1;},
  state=>{delete state.identity.sources[0].coords;},state=>{state.identity.sources[0].coords={};},state=>{state.identity.sources[0].coords=[null];},
 ].map(mutateStates);
 for(const mutate of mutations){
  const a=structuredClone(valid),b=structuredClone(valid);mutate(a);mutate(b);
  assert.deepEqual(a,b,'both arms contain the same invalid evidence');
  assert.equal(controlsTerrainNaturalEquivalent(a.probe,b.probe),false);
  assert.equal(controlsTerrainBatchesEquivalent(a,b),false);
 }
});

test('symmetric missing or malformed coordinate-bearing dispatch records fail closed',()=>{
 const valid=deliver(make(),topology.arms[1].arrivals);
 for(const mutate of [record=>{delete record.pass;},record=>{delete record.layer;},record=>{delete record.coords;},record=>{record.coords=[null];},record=>{delete record.toTexture;},record=>{record.toTexture=0;}]){
  const a=structuredClone(valid),b=structuredClone(valid);
  for(const observation of [a,b]){
   for(const terrain of new Set([...observation.probe.frames.map(frame=>frame.terrain),observation.probe.lastTerrain]))mutate(terrain.records[0]);
   mutate(observation.probe.lastVisibleDispatchRecords[0]);
  }
  assert.deepEqual(a,b);
  assert.equal(controlsTerrainNaturalEquivalent(a.probe,b.probe),false);
  assert.equal(controlsTerrainBatchesEquivalent(a,b),false);
 }
});

test('batch source schemas reject symmetric missing revision, usage, tile and envelope fields',()=>{
 const valid=deliver(make(),topology.arms[1].arrivals);
 const sourceMutations=[source=>{delete source.id;},source=>{delete source.revision;},source=>{source.revision=null;},source=>{source.revision=-1;},source=>{delete source.used;},source=>{delete source.usedForTerrain;},source=>{source.used='true';},source=>{source.usedForTerrain=0;},source=>{delete source.loaded;},source=>{source.loaded=1;},source=>{delete source.tiles;},source=>{source.tiles={};},source=>{source.tiles=[null];},source=>{delete source.tiles[0].key;},source=>{delete source.tiles[0].state;},source=>{source.tiles[0].state='guessed';},source=>{source.tiles[1]=structuredClone(source.tiles[0]);}];
 const mutations=[...sourceMutations.map(mutate=>record=>mutate(record.sourceBatch.frames[0].before[0])),
  ...['failure','truncated','frameCount','frames','deferredCount','deferred'].map(key=>record=>{delete record.sourceBatch[key];})];
 for(const mutate of mutations){
  const a=structuredClone(valid),b=structuredClone(valid);mutate(a);mutate(b);assert.deepEqual(a,b);
  assert.equal(controlsTerrainNaturalEquivalent(a.probe,b.probe),true,'natural evidence is still complete');
  assert.equal(controlsTerrainBatchesEquivalent(a,b),false);
 }
});

test('explicit zero cache slots, zero source coordinates and zero dispatch remain valid evidence',()=>{
 const coldA=terrainDecisionFixture().capture(),coldB=terrainDecisionFixture({guard:true}).capture();
 assert.ok(coldA.probe.lastTerrain.before.cache.every(tile=>tile.slots.length===0));
 assert.deepEqual(coldA.probe.lastTerrain.before.identity.sources.find(source=>source.id==='hidden').coords,[]);
 assert.equal(controlsTerrainNaturalEquivalent(coldA.probe,coldB.probe),true);
 const warmA=deliver(make(),[]),warmB=deliver(make({guard:true}),[]);
 assert.deepEqual(warmA.probe.lastVisibleDispatch,[]);assert.deepEqual(warmA.probe.lastVisibleDispatchRecords,[]);
 assert.equal(warmA.sourceBatch.deferredCount,0);assert.deepEqual(warmA.sourceBatch.deferred,[]);
 assert.equal(controlsTerrainNaturalEquivalent(warmA.probe,warmB.probe),true);
 assert.equal(controlsTerrainBatchesEquivalent(warmA,warmB),true);
});
