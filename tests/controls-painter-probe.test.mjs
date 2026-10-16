import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {runInNewContext} from 'node:vm';
import {guardHiddenTileMasks,installControlsFetchProbe,installControlsPainterProbe,controlsMapIdle} from '../scripts/controls-painter-probe.mjs';
import {nonemptyMaskTile,nonemptyPainterStyle,comparePixelBytes,controlsPainterManifest,controlsPainterSourceIdentity} from '../scripts/controls-painter-fixture.mjs';
const deferred=()=>Promise.withResolvers();
function scope(fetch=async()=>new Response(new Uint8Array([1,2]))){
 let time=0,timerId=0;const timers=new Map();
 return {fetch,location:{href:'http://127.0.0.1:4173/'},performance:{now:()=>++time,timeOrigin:1000},
  setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);},timers};
}
function renderer(s){
 const counts={masks:0,layers:0,renders:0},painter={transform:{zoom:9},renderPass:'opaque',
  _renderTileClippingMasks(layer,tiles){counts.masks++;this._renderTileMasks({},tiles);},
  _renderTileMasks(){},clearStencil(){},renderLayer(){counts.layers++;}};
 const map={painter,_render(){counts.renders++;painter.clearStencil();for(const hidden of [false,true]){const layer={id:hidden?'hidden':'visible',type:'line',isHidden:()=>hidden};painter._renderTileClippingMasks(layer,[1,2]);painter.renderLayer(painter,null,layer,[1,2]);}}};
 return {map,painter,counts,s};
}

test('guard returns before every hidden-mask side effect and preserves this, arguments and result',()=>{
 const self={transform:{zoom:9}},args=[{isHidden:z=>z===9},'tiles','target'];let calls=0;
 const original=function(...actual){calls++;assert.equal(this,self);assert.deepEqual(actual,args);return 42;};
 const guard=guardHiddenTileMasks(original);assert.equal(guard.apply(self,args),undefined);assert.equal(calls,0);
 args[0].isHidden=()=>false;assert.equal(guard.apply(self,args),42);assert.equal(calls,1);
});
test('probe arms only explicit windows and restores every original method',()=>{
 const s=scope(),f=renderer(s),originals={render:f.map._render,mask:f.painter._renderTileClippingMasks};
 const probe=installControlsPainterProbe(f.map,{guard:true,scope:s});f.map._render();assert.equal(probe.snapshot().frameCount,0);
 probe.arm();f.map._render();probe.stop();const snap=probe.snapshot();
 assert.equal(snap.frameCount,1);assert.equal(snap.maskDraws,2);assert.equal(snap.stencilClears,1);assert.equal(snap.hiddenMaskCalls,1);
 assert.deepEqual(snap.lastVisibleDispatch,['opaque:visible']);assert.equal(snap.frames.length,1);assert.ok(snap.frames[0].maskMs>=0);
 assert.equal(snap.stopReason,'settlement-finished');assert.equal(s.timers.size,0);
 probe.dispose();assert.equal(f.map._render,originals.render);assert.equal(f.painter._renderTileClippingMasks,originals.mask);
});
test('baseline observes hidden work without changing the underlying call count',()=>{
 const s=scope(),f=renderer(s),probe=installControlsPainterProbe(f.map,{scope:s});probe.arm();f.map._render();probe.stop();
 assert.equal(f.counts.masks,2);assert.equal(probe.snapshot().maskDraws,4);probe.dispose();
});
test('frame retention and capture watchdog are bounded and do not call renderer readiness',()=>{
 const s=scope(),f=renderer(s),probe=installControlsPainterProbe(f.map,{scope:s});probe.arm();
 for(let i=0;i<140;i++)f.map._render();
 const timer=[...s.timers.values()][0];assert.equal(timer.ms,60000);timer.fn();
 const snap=probe.snapshot();assert.equal(snap.frameCount,140);assert.equal(snap.frames.length,128);assert.equal(snap.framesTruncated,true);assert.equal(snap.active,false);assert.equal(snap.stopReason,'capture-limit');
 f.map._render();assert.equal(probe.snapshot().frameCount,140);probe.dispose();
});
test('fetch observations preserve original request/response/body and separate same-clock boundaries',async()=>{
 const headers=deferred(),body=deferred(),calls=[],response={status:200,arrayBuffer:()=>body.promise};
 const s=scope((...args)=>{calls.push(args);return headers.promise;}),original=s.fetch,probe=installControlsFetchProbe(s);
 probe.arm();const signal=new AbortController().signal,request=s.fetch('https://user:secret@openrailwaymap.app/tiles/9/1/2?token=secret#secret',{signal});
 headers.resolve(response);assert.equal(await request,response);assert.equal(calls.length,1);assert.equal(calls[0][1].signal,signal);
 const consumed=response.arrayBuffer();let snap=probe.snapshot();assert.equal(snap.records[0].url,'https://openrailwaymap.app/tiles/9/1/2');assert.ok(snap.records[0].bodyStart>snap.records[0].headers);assert.equal(snap.records[0].bodyEnd,undefined);
 const bytes=new Uint8Array([3,4]).buffer;body.resolve(bytes);assert.equal(await consumed,bytes);probe.stop();snap=probe.snapshot();assert.equal(snap.records[0].bytes,2);assert.ok(snap.records[0].bodyEnd>snap.records[0].bodyStart);
 assert.doesNotMatch(JSON.stringify(snap),/secret|token|signal/);probe.dispose();assert.equal(s.fetch,original);
});
test('late reads cannot overwrite a successor capture or previously returned snapshot',async()=>{
 const body=deferred(),s=scope(async()=>({status:200,arrayBuffer:()=>body.promise})),probe=installControlsFetchProbe(s);
 probe.arm();const response=await s.fetch('https://openrailwaymap.app/old');const read=response.arrayBuffer(),old=probe.snapshot();probe.stop();probe.arm();
 body.resolve(new ArrayBuffer(0));await read;
 assert.equal(old.records[0].bodyEnd,undefined);assert.equal(probe.snapshot().total,0);probe.dispose();
});
test('fetch failure and non-extensible responses remain original outcomes',async()=>{
 const error=new Error('secret query'),s=scope(async()=>{throw error;}),probe=installControlsFetchProbe(s);probe.arm();
 await assert.rejects(s.fetch('https://openrailwaymap.app/fail'),e=>e===error);assert.doesNotMatch(JSON.stringify(probe.snapshot()),/secret query/);probe.dispose();
 const response=Object.freeze({status:200,arrayBuffer:async()=>new ArrayBuffer(0)}),s2=scope(async()=>response),p2=installControlsFetchProbe(s2);p2.arm();assert.equal(await s2.fetch('https://openrailwaymap.app/frozen'),response);assert.equal(p2.snapshot().records[0].bodyObservationUnavailable,true);p2.dispose();
});
test('provider observations have fixed bounds and ignore unrelated URLs',async()=>{
 const s=scope(),p=installControlsFetchProbe(s);p.arm();await s.fetch('https://other.invalid/private');
 for(let i=0;i<520;i++)await s.fetch(`https://openrailwaymap.app/${i}`);
 const snap=p.snapshot();assert.equal(snap.total,520);assert.equal(snap.records.length,512);assert.equal(snap.truncated,true);p.dispose();
});
test('idle cannot waive any original loaded/tile/motion/canvas predicate',async()=>{
 for(const bad of ['loaded','tiles','moving','width','height',null]){
  const map={once:(_name,fn)=>{map.done=fn;},triggerRepaint:()=>map.done(),loaded:()=>bad!=='loaded',areTilesLoaded:()=>bad!=='tiles',isMoving:()=>bad==='moving',getPixelRatio:()=>.25,getContainer:()=>({clientWidth:2048,clientHeight:2048}),getCanvas:()=>({width:bad==='width'?511:512,height:bad==='height'?511:512})};
  assert.equal(await controlsMapIdle(map),bad===null);
 }
});
test('nonempty fixtures include buffered adjacent-tile geometry and a visible toggle',()=>{
 const tile=new VectorTile(new Pbf(nonemptyMaskTile)),layer=tile.layers.fixture;assert.equal(layer.length,3);
 assert.ok(layer.feature(1).loadGeometry()[0][0].x<0);assert.ok(layer.feature(1).loadGeometry()[0].at(-1).x>4096);
 const style=nonemptyPainterStyle('http://127.0.0.1:4173/');assert.equal(style.layers.at(-1).id,'hidden-toggle');assert.equal(style.layers.at(-1).layout.visibility,'none');assert.equal(style.sources.dem.encoding,'terrarium');
 assert.ok(style.layers.some(l=>l.paint?.['fill-opacity']===1));assert.ok(style.layers.some(l=>l.paint?.['fill-opacity']===.35));
});
test('pixel comparator rejects missing/truncated buffers and detects even one changed channel',()=>{
 const a=Buffer.alloc(512*512*4,255),b=Buffer.from(a);assert.equal(comparePixelBytes(a,b),0);b[42]=0;assert.equal(comparePixelBytes(a,b),1);
 assert.throws(()=>comparePixelBytes(a,undefined));assert.throws(()=>comparePixelBytes(a,b.subarray(0,10)));assert.throws(()=>comparePixelBytes(a.subarray(0,10),b.subarray(0,10)));
});
test('source/runtime hashes are fixed and a complete diagnostic manifest is available',async()=>{
 const manifest=await controlsPainterManifest();assert.equal(manifest.settlementDeadlineMs,60000);assert.equal(manifest.repetitionsPerArm,1);assert.equal(manifest.productionChanges,true);assert.equal(Object.keys(manifest.sources).length,10);assert.ok(manifest.inputs['styles/map-controls.mjs']);
});
test('workflow checkout, declaration and artifact select the PR head or push SHA consistently',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/controls-painter-diagnostic.yml',import.meta.url),'utf8');
 const expressions=[/ref: \$\{\{ (.+) \}\}/,/ATLAS_DIAGNOSTIC_REF: \$\{\{ (.+) \}\}/,/name: controls-painter-diagnostic-\$\{\{ (.+) \}\}/].map(pattern=>{const match=workflow.match(pattern);assert.ok(match);return match[1];});
 for(const expression of expressions){
  assert.equal(runInNewContext(expression,{github:{event_name:'pull_request',event:{pull_request:{head:{sha:'pr-head'}}},sha:'merge-sha'}}),'pr-head');
  assert.equal(runInNewContext(expression,{github:{event_name:'push',event:{},sha:'push-sha'}}),'push-sha');
 }
});
test('source identity records the actual checkout, distinguishes event SHA and rejects wrong checkout',()=>{
 const pr={ATLAS_DIAGNOSTIC_REF:'head',ATLAS_DIAGNOSTIC_HEAD:'head',GITHUB_SHA:'merge'};
 assert.deepEqual(controlsPainterSourceIdentity('head',pr),{sourceCommit:'head',eventCommit:'merge',pullRequestHead:'head'});
 assert.throws(()=>controlsPainterSourceIdentity('merge',pr),/Actual checkout/);
 assert.deepEqual(controlsPainterSourceIdentity('push',{ATLAS_DIAGNOSTIC_REF:'push',GITHUB_SHA:'push'}),{sourceCommit:'push',eventCommit:'push',pullRequestHead:null});
 assert.throws(()=>controlsPainterSourceIdentity('stale',{ATLAS_DIAGNOSTIC_REF:'push'}),/Actual checkout/);
 assert.deepEqual(controlsPainterSourceIdentity('local',{}),{sourceCommit:'local',eventCommit:null,pullRequestHead:null});
});
test('hosted experiment is isolated, fixture guarded, single-pair, and retains failed artifacts',async()=>{
 const script=await readFile(new URL('../scripts/check-controls-painter-browser.mjs',import.meta.url),'utf8'),workflow=await readFile(new URL('../.github/workflows/controls-painter-diagnostic.yml',import.meta.url),'utf8');
 assert.match(script,/for\(const guard of \[false,true\]\)/);assert.match(script,/timeout:60000/);assert.match(script,/installControlsPainterFixtures/);assert.match(script,/changedBytes===0&&c.dispatchEqual/);assert.match(script,/a.transition.settled/);assert.match(script,/finally\{clearTimeout\(deadline\);await save\(\);\}/);
 assert.match(workflow,/if: always\(\)/);assert.doesNotMatch(workflow,/rerun|retry|workflow_dispatch/);assert.match(workflow,/contents: read/);
 const fixture=await readFile(new URL('../scripts/controls-painter-fixture.mjs',import.meta.url),'utf8');assert.doesNotMatch(fixture,/route\.fetch\(/);assert.match(script,/This experiment is loopback-only/);
 const app=await readFile(new URL('../styles/app.mjs',import.meta.url),'utf8');assert.doesNotMatch(app,/controls-painter/);
 assert.match(script,/if\(guard\)installHiddenTileMaskGuard\(controlsMap\)/);
 assert.match(script,/painter\._renderTileClippingMasks=original/);
 assert.match(script,/productionGuardInstalled,true/);
});

// The event SHA stays available to the measurement manifest; only the build
// process receives the reviewed checkout identity.
test('diagnostic build overrides merge-event provenance with the selected checkout',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/controls-painter-diagnostic.yml',import.meta.url),'utf8');
 const block=workflow.split('- name: Build with the checked-out source identity')[1]?.split('\n      - ')[0];
 assert.ok(block);
 assert.match(block,/run: GITHUB_SHA="\$ATLAS_DIAGNOSTIC_REF" GITHUB_REPOSITORY="\$ATLAS_DIAGNOSTIC_REPOSITORY" npm run build/);
 const expression=block.match(/ATLAS_DIAGNOSTIC_REF: \$\{\{ (.+) \}\}/)?.[1];
 assert.ok(expression);
 for(const [event,head,merge] of [['pull_request','a'.repeat(40),'b'.repeat(40)],['push',null,'c'.repeat(40)]]){
  const selected=runInNewContext(expression,{github:{event_name:event,event:head?{pull_request:{head:{sha:head}}}:{},sha:merge}});
  assert.equal(selected,head||merge);
  if(head)assert.notEqual(selected,merge);
 }
});

test('diagnostic build uses fork source repository for PRs and event repository for pushes',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/controls-painter-diagnostic.yml',import.meta.url),'utf8');
 const block=workflow.split('- name: Build with the checked-out source identity')[1]?.split('\n      - ')[0];
 const expression=block?.match(/ATLAS_DIAGNOSTIC_REPOSITORY: \$\{\{ (.+) \}\}/)?.[1];assert.ok(expression);
 for(const [event,head,base,expected] of [['pull_request','contributor/atlas','c933103/openrailwaystyle','contributor/atlas'],['pull_request','c933103/openrailwaystyle','c933103/openrailwaystyle','c933103/openrailwaystyle'],['push',null,'c933103/openrailwaystyle','c933103/openrailwaystyle']]){
  const actual=runInNewContext(expression,{github:{event_name:event,event:head?{pull_request:{head:{repo:{full_name:head}}}}:{},repository:base}});assert.equal(actual,expected);
 }
});
