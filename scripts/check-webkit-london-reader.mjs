// Diagnostic only: use the exact archived London z5 payloads without MapLibre.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readProtocolSchedule} from './webkit-reference-replay.mjs';
import {launchBrowser} from './browser.mjs';
import {withinDeadline,closeBrowser,armWatchdog} from './mainline-browser-deadlines.mjs';

const mode=process.argv[2], generation='4d7af9e6912208868194dd2e';
assert.ok(['serial','parallel','replay'].includes(mode),'Expected serial, parallel or replay');
const schedule=mode==='replay'?readProtocolSchedule(await readFile(process.argv[3],'utf8')):null;
const replayDeadline=schedule?Math.ceil(schedule.at(-1).offsetMs)+40000:30000;
const base=new URL(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/');
assert.equal(base.origin,'http://127.0.0.1:4173','Only the staged loopback archive is supported');
const shell=new URL('reader-only-test.html',base).href;
const tiles=['5/15/11','5/15/10','5/16/11','5/16/10'];
const stop=armWatchdog(()=>({mode,stage:'reader-only'}),{timeout:replayDeadline+60000});
const started=Date.now();
function log(stage,data={}) {
 console.log('READER_ONLY '+JSON.stringify({mode,stage,elapsedMs:Date.now()-started,...data}));
}
const heartbeat=setInterval(()=>log('NODE_HEARTBEAT'),2500);
let browser,context,error;
try {
 browser=await launchBrowser({engine:'webkit',timeout:20000});
 context=await browser.newContext();
 await context.route(shell,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Reader-only diagnostic</title>'}));
 const control=await context.newPage(), page=await context.newPage();
 for(const [label,tab] of [['control',control],['reader',page]]){
  tab.on('console',event=>{
   if(event.text().startsWith('READER_PAGE '))log('PAGE',{label,detail:event.text().slice(12)});
  });
  tab.on('crash',()=>log('PAGE_CRASH',{label}));
  await tab.goto(shell,{timeout:10000});
  await withinDeadline(()=>tab.evaluate(()=>{
   setInterval(()=>console.log('READER_PAGE '+JSON.stringify({stage:'HEARTBEAT',time:Date.now()})),1000);
  }),label+' heartbeat setup',5000);
 }
 const result=await withinDeadline(()=>page.evaluate(async ({mode,tiles,generation,schedule})=>{
  const {createReferenceReader}=await import('/mainline-reference.mjs');
  const reader=createReferenceReader({
   root:new URL('/data/mainline-reference/',location.href),
   onTileStage:(key,stage,bytes)=>console.log('READER_PAGE '+JSON.stringify({key,stage,bytes}))
  });
  if(schedule){
   // Keep the reader's metadata cache cold until the first scheduled call.
   const manifest=await (await fetch('/data/mainline-reference/manifest.json',{cache:'no-store'})).json();
   if(manifest.generation!==generation)throw new Error('Unexpected archive generation '+manifest.generation);
   const controllers=new Map(), completions=[];
   const epoch=performance.now();let maxLatenessMs=0;
   const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
   for(const e of schedule){
    for(let remaining;(remaining=e.offsetMs-(performance.now()-epoch))>0;)await wait(Math.ceil(remaining));
    maxLatenessMs=Math.max(maxLatenessMs,performance.now()-epoch-e.offsetMs);
    if(e.kind==='ABORT'){controllers.get(e.requestId).abort();continue;}
    const controller=new AbortController();controllers.set(e.requestId,controller);
    if(e.aborted)controller.abort();
    completions.push(reader.tile(e.key,controller.signal).then(
     data=>({bytes:data.byteLength}),error=>({error:error.name,message:error.message})
    ));
   }
   const results=await Promise.all(completions);
   return {starts:results.length,abortEvents:schedule.length-results.length,maxLatenessMs,
    resolved:results.filter(r=>'bytes' in r).length,aborted:results.filter(r=>r.error==='AbortError').length,
    unexpected:results.filter(r=>r.error&&r.error!=='AbortError').slice(0,10),stats:reader.statistics()};
  }
  const manifest=await reader.manifest();
  if(manifest.generation!==generation)throw new Error('Unexpected archive generation '+manifest.generation);
  const check=async key=>({key,bytes:(await reader.tile(key)).byteLength});
  const result=[];
  if(mode==='serial')for(const key of tiles)result.push(await check(key));
  else result.push(...await Promise.all(tiles.map(check)));
  return result;
 },{mode,tiles,generation,schedule}),mode+' London reader',replayDeadline);
 if(schedule)assert.deepEqual(result.unexpected,[],'Unexpected reader error');
 else{
  assert.deepEqual(result.map(row=>row.key),tiles);
  assert.ok(result.every(row=>row.bytes>0),'A missing tile is not a passing decode');
 }
 log('RESULT',{generation,result});
} catch(cause) {
 error=cause;
 log('FAILURE',{message:cause.message});
 process.exitCode=1;
} finally {
 try{
  if(browser)await closeBrowser(context??{close:async()=>{}},browser,{primaryError:error});
 }finally{clearInterval(heartbeat);stop();}
}
