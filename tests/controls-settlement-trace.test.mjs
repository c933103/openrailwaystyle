import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {runInNewContext,createContext,SyntheticModule} from 'node:vm';
import {createControlsSettlementTrace,armControlsSettlementProbe,readControlsSettlementProbe} from '../scripts/controls-settlement-trace.mjs';
import {installControlsFetchProbe} from '../scripts/controls-painter-probe.mjs';
import {createRequestLifecycle} from '../scripts/request-lifecycle.mjs';
import {plan} from '../scripts/ci-plan.mjs';

test('operation observation preserves values, errors, ordering and unmodified outcomes',async()=>{
 let time=100,calls=0;const trace=createControlsSettlementTrace({now:()=>time}),value={private:'not recorded'};
 assert.equal(await trace.observe('outside',()=>{calls++;return value;}),value);
 assert.equal(trace.snapshot().operations.length,0);trace.start();
 time=110;assert.equal(await trace.observe('click',()=>{calls++;time=120;return value;}),value);
 const error=Error('credential=private');time=130;
 await assert.rejects(trace.observe('idle-acceptance',()=>{calls++;time=60130;throw error;}),e=>e===error);
 const requests={timeOrigin:50,pendingCount:4,pending:[{id:1,started:500}]};
 assert.equal(trace.stop('settlement-finished',requests),true);requests.pendingCount=0;requests.pending[0].started=0;
 const state=trace.snapshot();assert.equal(calls,3);assert.equal(state.endedAt,60130);
 assert.deepEqual(state.operations,[{phase:'click',startedAt:110,outcome:'returned',endedAt:120},
  {phase:'idle-acceptance',startedAt:130,outcome:'threw',endedAt:60130}]);
 assert.equal(state.requestsAtEnd.pendingCount,4);assert.equal(state.requestsAtEnd.pending[0].started,500);
 assert.doesNotMatch(JSON.stringify(state),/credential|private/);
 state.operations[0].outcome='changed';assert.equal(trace.snapshot().operations[0].outcome,'returned');
 trace.start();assert.equal(trace.active(),false);assert.equal(trace.stop('late',{}),false);
 await trace.observe('later',()=>{});assert.equal(trace.snapshot().operationCount,2);
});

test('operation retention is bounded without changing work or exact counts',async()=>{
 const trace=createControlsSettlementTrace();trace.start();let calls=0;
 for(let i=0;i<20;i++)await trace.observe('operation',()=>calls++);
 assert.equal(calls,20);assert.equal(trace.snapshot().operationCount,20);
 assert.equal(trace.snapshot().operations.length,16);assert.equal(trace.snapshot().operationsTruncated,true);
});

async function setupPage({late=false,delayImport}={}){
 const calls=[],map={},probe={arm:()=>calls.push('arm'),snapshot:()=>({timeOrigin:1000,started:25})};
 const context=createContext({document:{querySelector:()=>({src:'http://127.0.0.1:4173/app.mjs'})}});
 const exported=installControlsPainterProbe=>({installControlsPainterProbe});
 const modules={
  'http://127.0.0.1:4173/__controls-painter-probe.mjs':exported((actual,options)=>{assert.equal(actual,map);assert.equal(options.guard,false);calls.push('install');return probe;}),
  'http://127.0.0.1:4173/app.mjs':{map},
 };
 const loaded={};
 for(const [specifier,values] of Object.entries(modules)){
  const module=new SyntheticModule(Object.keys(values),function(){for(const [key,value] of Object.entries(values))this.setExport(key,value);},{context});
  await module.link(()=>{});await module.evaluate();loaded[specifier]=module;
 }
 const page={evaluate:async(fn,arg)=>{
  context.argument=arg;context.Date={now:()=>late?arg.deadline:arg.deadline-1};
  const {Script}=await import('node:vm');
  return new Script(`(${fn.toString()})(argument)`,{importModuleDynamically:async specifier=>{if(delayImport)await delayImport;assert.ok(loaded[specifier]);return loaded[specifier];}}).runInContext(context);
 }};
 return {page,calls,context};
}

test('actual serialized setup installs only the baseline probe and arms before returning',async()=>{
 const f=await setupPage();const result=await armControlsSettlementProbe(f.page,'http://127.0.0.1:4173/');
 assert.equal(result.timeOrigin,1000);assert.equal(result.started,25);assert.deepEqual(f.calls,['install','arm']);
});

test('late setup and hung imports never arm a new late capture',async()=>{
 const late=await setupPage({late:true});const result=await armControlsSettlementProbe(late.page,'http://127.0.0.1:4173/');
 assert.equal(result.reason,'late-probe-setup');assert.deepEqual(late.calls,[]);
 let release;const delayImport=new Promise(resolve=>{release=resolve;});
 const hung=await setupPage({late:true,delayImport});
 const timeout=await armControlsSettlementProbe(hung.page,'http://127.0.0.1:4173/',10);
 assert.equal(timeout.reason,'page-evaluation-timeout');release();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(hung.calls,[]);
});

test('setup failure is explicit and contains no exception contents',async()=>{
 const result=await armControlsSettlementProbe({evaluate:()=>{throw Error('token=private');}},'http://127.0.0.1:4173/');
 assert.equal(result.reason,'page-evaluation-failed');assert.doesNotMatch(JSON.stringify(result),/private|token/);
});

test('post-acceptance reads stop, snapshot and restore both observers in order',async()=>{
 const calls=[],scope={__atlasControlsSettlementProbe:{stop:reason=>calls.push(reason),snapshot:()=>{calls.push('snapshot');return {frameCount:3};},dispose:()=>calls.push('painter-dispose')},__atlasControlsFetchProbe:{dispose:()=>calls.push('fetch-dispose')}};
 const page={evaluate:async(fn,arg)=>runInNewContext(`(${fn.toString()})(reason)`,{...scope,reason:arg})};
 assert.equal((await readControlsSettlementProbe(page,'settlement-finished')).frameCount,3);
 assert.deepEqual(calls,['settlement-finished','snapshot','painter-dispose','fetch-dispose']);
});

test('missing, failing, hung and late reads remain unavailable rather than acceptance',async()=>{
 let disposed=0;const page={evaluate:async(fn,arg)=>runInNewContext(`(${fn.toString()})(reason)`,{reason:arg,__atlasControlsFetchProbe:{dispose:()=>disposed++}})};
 assert.equal((await readControlsSettlementProbe(page,'check-ended')).reason,'probe-not-installed');assert.equal(disposed,1);
 assert.equal((await readControlsSettlementProbe({evaluate:()=>{throw Error('private');}},'check-ended')).reason,'page-evaluation-failed');
 let resolve;const pending=readControlsSettlementProbe({evaluate:()=>new Promise(r=>{resolve=r;})},'check-ended',10);
 const result=await pending;assert.equal(result.reason,'page-evaluation-timeout');resolve({frameCount:100});
 await new Promise(r=>setImmediate(r));assert.equal(result.reason,'page-evaluation-timeout');
});

test('inactive fetch probe preserves the original promise and this before and after its window',async()=>{
 const promise=Promise.resolve({status:200}),receiver={},calls=[];
 const scope={fetch:function(...args){calls.push({receiver:this,args});return promise;},performance:{now:()=>1},location:{href:'http://127.0.0.1:4173/'}};
 const original=scope.fetch,probe=installControlsFetchProbe(scope),wrapped=scope.fetch;
 assert.equal(wrapped.call(receiver,'https://openrailwaymap.app/tile'),promise);
 probe.arm();probe.stop();assert.equal(wrapped.call(receiver,'https://openrailwaymap.app/tile'),promise);
 probe.dispose();assert.equal(scope.fetch,original);assert.equal(wrapped.call(receiver,'https://openrailwaymap.app/tile'),promise);
 assert.ok(calls.every(call=>call.receiver===receiver));assert.equal(probe.snapshot().total,0);
});

test('the real controls path records operations without skipping or loosening acceptance',()=>{
 const root=new URL('..',import.meta.url),read=path=>existsSync(new URL(path,root))?readFileSync(new URL(path,root),'utf8'):null;
 const source=read('scripts/check-map-controls-browser.mjs'),helper=read('scripts/controls-settlement-trace.mjs');
 assert.match(source,/page.addInitScript\(installControlsFetchProbe\)/);
 assert.match(source,/settlementTrace.observe\('idle-acceptance',\(\)=>waitUntil\(page,async\(\)=>\{/);
 assert.match(source,/map.once\('idle',\(\)=>resolve\(\)\);map.triggerRepaint\(\)/);
 assert.match(source,/map.loaded\(\)&&map.areTilesLoaded\(\)&&!map.isMoving\(\)/);
 assert.match(source,/canvas.width===Math.floor\(container.clientWidth\*ratio\)&&canvas.height===Math.floor\(container.clientHeight\*ratio\)/);
 assert.match(source,/\},null,\{timeout:60000\}\)\)/);
 assert.match(source,/settlementTrace.observe\('visible-pointer-click',\(\)=>clickVisibleControl/);
 assert.match(source,/settlementTrace.observe\('detail-state',\(\)=>waitUntil[\s\S]*?\},next,\{timeout:20000\}\)\)/);
 assert.match(source,/cookie-readback',async\(\)=>assert.equal\(\(await cookie\(\)\).detail,next/);
 assert.ok(source.indexOf("settlementTrace.stop('settlement-finished',requestLifecycle.snapshot())")<source.indexOf('timing:await readBrowserTiming(page)'));
 assert.match(source,/map-controls-transition.json/);assert.match(helper,/installControlsPainterProbe\(map, \{guard: false\}\)/);
 assert.doesNotMatch(helper,/triggerRepaint|setData\(|setTiles\(|retry\(|timeout\s*=\s*6000[1-9]/);
 assert.deepEqual(plan(['scripts/controls-settlement-trace.mjs'],read).groups.map(g=>({group:g.group,checks:g.checks})),[{group:'controls',checks:['check-map-controls-browser.mjs']}]);
});

test('the actual transition block starts CPU sampling only for the explicit option',async()=>{
 const source=readFileSync(new URL('../scripts/check-map-controls-browser.mjs',import.meta.url),'utf8');
 const enabledExpression=source.match(/const cpuProfileEnabled=([^;]+);/)[1];
 const transition=source.split('if(size.width===1365&&size.height===900&&expanded&&readout&&detail===1){')[1].split('\n          }')[0];
 for(const setting of [undefined,'0','true','1']){
  const counts={cpu:0,probe:0,start:0},cpuProfileEnabled=runInNewContext(enabledExpression,{process:{env:{ATLAS_CONTROLS_CPU_PROFILE:setting}}});
  const context={cpuProfileEnabled,profileSettlement:false,probeSetup:null,base:'http://127.0.0.1:4173/',
   settlementTrace:{start:()=>counts.start++,observe:(_phase,operation)=>operation()},
   cpuProfile:{start:async()=>counts.cpu++},armControlsSettlementProbe:async()=>{counts.probe++;return {started:1};},page:{}};
  await runInNewContext(`(async()=>{${transition}})()`,context);
  assert.equal(counts.start,1);assert.equal(counts.probe,1);assert.equal(counts.cpu,setting==='1'?1:0);
  assert.equal(context.profileSettlement,setting==='1');assert.equal(context.probeSetup.started,1);
 }
});

test('actual early-failure catch freezes requests before diagnostics; removing it reproduces the gap',async()=>{
 const source=readFileSync(new URL('../scripts/check-map-controls-browser.mjs',import.meta.url),'utf8');
 const catchAndFinally=source.slice(source.indexOf('} catch(error){\n')+2);
 const captureLine="  if(settlementTrace.active()&&settlementTrace.stop('acceptance-failed',requestLifecycle.snapshot()))earlyProbeRead=readControlsSettlementProbe(page,'acceptance-failed');\n";
 assert.ok(catchAndFinally.includes(captureLine));
 for(const phase of ['visible-pointer-click','detail-state','cookie-state','cookie-readback']){
  for(const removeBoundary of [false,true]){
   let time=100;const requestLifecycle=createRequestLifecycle({now:()=>time}),settlementTrace=createControlsSettlementTrace({now:()=>time});
   const request={url:()=> 'https://openrailwaymap.app/fixture/9/1/2'};
   requestLifecycle.start(request);settlementTrace.start();
   const error=Error('original acceptance failure');
   await assert.rejects(settlementTrace.observe(phase,async()=>{throw error;}),e=>e===error);
   const writes=new Map(),observations=[];
   const context={error,settlementTrace,requestLifecycle,earlyProbeRead:undefined,probeResult:{unavailable:true},probeSetup:{started:1},cpuProfileEnabled:false,
    console:{error:()=>{}},errors:[],pending:new Set(),requestFailures:[],fixtureTiles:{},results:[],settlements:[],
    readControlsSettlementProbe:async(_page,reason)=>{observations.push(reason);return {frameCount:1};},
    readMapRenderState:async()=>{time=200;requestLifecycle.finished(request);return {loaded:false};},
    geometry:async()=>({}),mkdir:async()=>{},writeFile:async(path,bytes)=>writes.set(path,JSON.parse(bytes)),
    page:{screenshot:async()=>{}},cpuProfile:{stop:async()=>{},snapshot:()=>({})},browser:{close:async()=>{}},
   };
   const block=removeBoundary?catchAndFinally.replace(captureLine,''):catchAndFinally;
   await assert.rejects(runInNewContext(`(async()=>{try{throw error;} ${block}})()`,context),e=>e===error);
   assert.equal(requestLifecycle.snapshot().pendingCount,0,'mock diagnostics really complete the request');
   const saved=writes.get('browser-review/map-controls-transition.json');
   assert.equal(saved.requestsAtEnd.pendingCount,removeBoundary?0:1,`${phase}: sensitivity control exposes the original late snapshot`);
   assert.equal(saved.endedAt,removeBoundary?200:100);
   assert.equal(saved.stopReason,removeBoundary?'check-ended':'acceptance-failed');
   assert.equal(saved.operations[0].outcome,'threw');assert.equal(saved.operations[0].phase,phase);
   assert.deepEqual(observations,[removeBoundary?'check-ended':'acceptance-failed']);
  }
 }
});
