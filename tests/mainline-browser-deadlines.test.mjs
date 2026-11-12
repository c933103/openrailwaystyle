import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {withinDeadline,closeBrowser,armWatchdog} from '../scripts/mainline-browser-deadlines.mjs';

const never=()=>new Promise(()=>{});
test('completed evidence is returned unchanged; real assertion failures are not swallowed',async()=>{
 const evidence={ids:['way-1'],painted:3};
 assert.equal(await withinDeadline(()=>evidence,'pixels',100),evidence);
 const failure=new Error('no painted geometry');
 await assert.rejects(withinDeadline(()=>{throw failure},'pixels',100),error=>error===failure);
});
test('a renderer promise that never settles fails on the Node-side deadline',async()=>{
 await assert.rejects(withinDeadline(never,'safari globe Tokyo z6 render',10),error=>
  error.code==='MAINLINE_DEADLINE'&&/safari globe Tokyo z6 render exceeded 10 ms/.test(error.message));
});
test('a late renderer rejection is still handled after timeout',async()=>{
 let reject;
 await assert.rejects(withinDeadline(()=>new Promise((_,r)=>{reject=r}),'late',10),/exceeded/);
 reject(new Error('renderer closed'));
 await new Promise(resolve=>setImmediate(resolve));
});
test('cleanup closes the context and browser without evaluating the stalled page',async()=>{
 const calls=[];
 await closeBrowser({close:async()=>calls.push('context')},{close:async()=>calls.push('browser')});
 assert.deepEqual(calls,['context','browser']);
});
test('context timeout cannot prevent browser close and forces a nonzero termination',async()=>{
 const calls=[];
 await assert.rejects(closeBrowser({close:never},{close:async()=>calls.push('browser')},
  {timeout:10,terminate:code=>calls.push(code)}),AggregateError);
 assert.deepEqual(calls,['browser',1]);
});
test('browser close timeout also forces a nonzero termination',async()=>{
 const codes=[];
 await assert.rejects(closeBrowser({close:async()=>{}},{close:never},{timeout:10,terminate:code=>codes.push(code)}),AggregateError);
 assert.deepEqual(codes,[1]);
});
test('cleanup retains transport/network-guard failures instead of reporting success',async()=>{
 const error=new Error('Unmocked browser network requests were blocked');
 await assert.rejects(closeBrowser({close:async()=>{}},{close:async()=>{throw error}}),failure=>failure.errors[0]===error);
});
test('watchdog reports the latest checkpoint and actually exits a stuck process with failure',()=>{
 const module=new URL('../scripts/mainline-browser-deadlines.mjs',import.meta.url).href;
 const result=spawnSync(process.execPath,['--input-type=module','-e',`import {armWatchdog} from ${JSON.stringify(module)};
 let phase='setup'; armWatchdog(()=>({phase}),{timeout:20});phase='render and pixel evidence';setInterval(()=>{},1000);`],{encoding:'utf8',timeout:2000});
 assert.equal(result.status,1,result.stderr);
 assert.match(result.stderr,/MAINLINE_CHECK_DEADLINE.*render and pixel evidence/);
});
test('successful completion cancels the failure-only watchdog',async()=>{
 let called=false;
 const stop=armWatchdog(()=>({}),{timeout:10,terminate:()=>{called=true}});stop();
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(called,false);
});
test('checker keeps actual rendering assertions and routes all evaluations through the Node deadline',async()=>{
 const source=await readFile(new URL('../scripts/check-mainline-reference-browser.mjs',import.meta.url),'utf8');
 assert.equal((source.match(/page\.evaluate\(/g)||[]).length,1,'only the deadline wrapper calls evaluate directly');
 assert.match(source,/withinDeadline\(\(\)=>page\.evaluate\(fn,arg\)/);
 assert.match(source,/testMap\.once\('render',resolve\)/);
 assert.match(source,/gl\.readPixels\(/);
 assert.match(source,/result\.ids\.length&&result\.painted>0/);
 assert.match(source,/Math\.abs\(result\.zoom-zoom\)<\.001/);
 assert.doesNotMatch(source,/testMap\?\.remove|atlasMap\?\.remove/);
 assert.equal((source.match(/finally\{.*closeBrowser\(/g)||[]).length,2);
 const workflow=await readFile(new URL('../.github/workflows/site.yml',import.meta.url),'utf8');
 assert.match(workflow,/name: Verify deployed independent OSM geometry with live overview unavailable\n\s+timeout-minutes: 35/);
});

test('cleanup failure preserves the primary rendering failure',async()=>{
 const primaryError=new Error('actual stroke did not paint');
 await assert.rejects(closeBrowser({close:async()=>{throw new Error('transport closed')}},{close:async()=>{}},{primaryError}),error=>error===primaryError);
});
