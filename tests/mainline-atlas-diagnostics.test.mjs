import test from 'node:test';
import assert from 'node:assert/strict';
import {mainlineAtlasDiagnostics} from '../scripts/mainline-atlas-diagnostics.mjs';
test('Atlas failure evidence identifies the selected source and bounds tile/feature evidence',()=>{
 const savedMap=globalThis.atlasMap,savedDocument=globalThis.document;
 try{
  delete globalThis.atlasMap;assert.deepEqual(mainlineAtlasDiagnostics(),{mapAvailable:false});
  globalThis.document={querySelector:()=>({dataset:{mode:'control'}}),getElementById:()=>({textContent:'Provider unavailable'})};
  const layers=[{id:'rail-reference-main',source:'railReference'},{id:'control-overview',source:'control'},{id:'control-tracks',source:'railway'}];
  const manager={getIds:()=>Array.from({length:50},(_,i)=>i),getTileByID:key=>({state:'errored',tileID:{canonical:{z:6,x:key,y:25}}})};
  globalThis.atlasMap={getStyle:()=>({layers}),getZoom:()=>6,getSource:id=>({url:`fixture://${id}`}),
   getLayoutProperty:()=> 'none',queryRenderedFeatures:()=>Array.from({length:30},(_,id)=>({properties:{id}})),isSourceLoaded:()=>false,
   style:{tileManagers:{control:manager,railReference:manager}}};
  const result=mainlineAtlasDiagnostics();
  assert.equal(result.mode,'control');assert.equal(result.status,'Provider unavailable');
  assert.deepEqual(result.sources.map(s=>s.id),['railReference','control']);
  assert.deepEqual(result.layers.map(l=>l.id),['rail-reference-main','control-overview']);
  assert.equal(result.layers[0].visibility,'none');assert.equal(result.layers[0].renderedIds.length,20);
  assert.equal(result.sources[1].tiles.length,20);assert.equal(result.sources[1].tiles[0].state,'errored');
  assert.doesNotThrow(()=>JSON.stringify(result));
 }finally{globalThis.atlasMap=savedMap;globalThis.document=savedDocument;}
});
