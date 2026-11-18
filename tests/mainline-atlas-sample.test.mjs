import test from 'node:test';
import assert from 'node:assert/strict';
import {mainlineAtlasSample} from '../scripts/mainline-atlas-sample.mjs';
test('actual Atlas sample captures nonempty visible geometry at the requested camera atomically',()=>{
 const saved=globalThis.atlasMap;let zoom=6,visible=true,features=[];
 const options={ids:['expected'],shown:['rail-reference-main'],hidden:['infrastructure-reference-main'],zoom:6};
 globalThis.atlasMap={getZoom:()=>zoom,isSourceLoaded:()=>true,getLayoutProperty:id=>id===options.hidden[0]||!visible?'none':'visible',queryRenderedFeatures:()=>features};
 try{
  assert.equal(mainlineAtlasSample(options),false);
  features=[{properties:{id:'other'}}];assert.equal(mainlineAtlasSample(options),false);
  features=[{properties:{id:'expected'}}];visible=false;assert.equal(mainlineAtlasSample(options),false,'hidden queryable buckets are not rendered evidence');
  visible=true;zoom=7;assert.equal(mainlineAtlasSample(options),false);
  zoom=6;const sample=mainlineAtlasSample(options);
  features=[];visible=false;zoom=7;
  assert.deepEqual(sample,{cameraZoom:6,ids:['expected'],hidden:['none']},'later map transitions cannot empty the accepted frame');
 }finally{globalThis.atlasMap=saved;}
});

test('consecutive-frame evidence records disappearance instead of hiding it with a later valid snapshot',()=>{
 const savedMap=globalThis.atlasMap,savedPerformance=globalThis.performance,savedStates=globalThis.mainlineAcceptanceFrames;
 let now=0,present=true;
 globalThis.performance={now:()=>now};globalThis.mainlineAcceptanceFrames=new Map();
 globalThis.atlasMap={getZoom:()=>6,isSourceLoaded:()=>true,getLayoutProperty:()=> 'visible',queryRenderedFeatures:()=>present?[{properties:{id:'rail'}}]:[]};
 const options={ids:['rail'],shown:['reference'],hidden:[],zoom:6,token:'test',settleMs:3000};
 try{
  assert.equal(mainlineAtlasSample(options),false);now=1000;assert.equal(mainlineAtlasSample(options),false);
  now=1100;present=false;assert.equal(mainlineAtlasSample(options),false);
  now=1200;present=true;assert.equal(mainlineAtlasSample(options),false);
  now=2000;assert.equal(mainlineAtlasSample(options),false);
  now=4200;const sample=mainlineAtlasSample(options);
  assert.equal(sample.stableMs,3000);assert.equal(sample.unstableDrops.length,1);
 }finally{globalThis.atlasMap=savedMap;globalThis.performance=savedPerformance;globalThis.mainlineAcceptanceFrames=savedStates;}
});
