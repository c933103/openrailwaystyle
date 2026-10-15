import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import maplibre from 'maplibre-gl';
import {railReferenceSettled} from '../scripts/rail-reference-settlement.mjs';
import {waitUntil} from '../scripts/wait-until.mjs';

// Execute the pinned renderer's real loaded(), _render() and Evented methods.
// Only drawing/source plumbing is replaced, so no WebGL or provider is needed
// to reproduce loaded=true before the placement-complete idle boundary.
function renderer() {
  const map=Object.create(maplibre.Map.prototype);
  let placementPending=true,repaints=0;
  Object.assign(map,{
    _styleDirty:false,_sourcesDirty:false,_loaded:true,_idleTriggered:true,_fadeDuration:300,
    painter:{context:{setDirty(){}},setBaseState(){},render(){}},
    _renderTaskQueue:{run(){}},
    style:{loaded:()=>true,_updatePlacement:()=>placementPending,hasTransitions:()=>false,_releaseSymbolFadeTiles(){}},
    transform:{center:{lat:0},setTransitionState(){},setMinElevationForCurrentTile(){}},
    isRotating:()=>false,isZooming:()=>false,isMoving:()=>false,areTilesLoaded:()=>true,
    triggerRepaint:()=>{repaints++;},
  });
  return {map,placement:pending=>{placementPending=pending;},repaints:()=>repaints};
}

test('reference acceptance waits through real MapLibre loaded-before-idle placement',async()=>{
  const f=renderer(),{map}=f;
  let status='Explore the rail network',settled=false;
  map.on('idle',()=>{status='Only basemap railway reference is visible here; detailed railway data is unavailable.';});
  // Match the browser serialization; the function cannot depend on imports.
  const serialized=(0,eval)(`(${railReferenceSettled.toString()})`);
  const acceptance=serialized(map).then(value=>{settled=true;return value;});
  assert.equal(f.repaints(),1,'request a fresh idle even if the earlier idle was missed');
  map._render(0);
  assert.equal(map.loaded(),true,'the previous checker would already accept this state');
  assert.equal(map._placementDirty,true);
  await Promise.resolve();
  assert.equal(settled,false);
  assert.doesNotMatch(status,/reference.*detailed railway data/i);
  f.placement(false);map._render(1);
  assert.equal(await acceptance,true);
  assert.match(status,/reference.*detailed railway data/i,'status listener ran before acceptance');
});

test('an already idle renderer still produces a fresh bounded acceptance event',async()=>{
  const f=renderer();f.placement(false);f.map._render(0);
  const acceptance=railReferenceSettled(f.map);
  assert.equal(f.repaints(),1);f.map._render(1);
  assert.equal(await acceptance,true);
});

test('idle cannot waive loaded, tile-completeness or motion predicates',async()=>{
  for(const method of ['loaded','areTilesLoaded','isMoving']) {
    const {map}=renderer();map[method]=()=>method==='isMoving';
    const acceptance=railReferenceSettled(map);
    map.fire('idle');
    assert.equal(await acceptance,false,method);
  }
});

test('missing idle fails at the external deadline rather than accepting loaded()',async()=>{
  const {map}=renderer();
  const page={evaluate:fn=>fn(map)};
  assert.equal(map.loaded(),true);
  await assert.rejects(waitUntil(page,railReferenceSettled,undefined,{timeout:25,polling:1}),/Timed out after 25 ms/);
  map.fire('idle');
});

test('the browser checker keeps status assertions, deadline and failure evidence',async()=>{
  const source=await readFile(new URL('../scripts/check-rail-reference-browser.mjs',import.meta.url),'utf8');
  assert.match(source,/waitUntil\(page,railReferenceSettled,undefined,\{timeout:60000\}\)/);
  assert.match(source,/assert\.match\(report\.status,\/reference\.\*detailed railway data\/i\)/);
  assert.match(source,/Reference must not conceal a real provider error/);
  assert.match(source,/shanghai-rail-reference-failure\.json/);
  assert.match(source,/finally\{await browser\.close\(\)\}/);
});
