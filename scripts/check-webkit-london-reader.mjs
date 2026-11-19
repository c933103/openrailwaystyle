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
const decoder=process.env.ATLAS_WEBKIT_REFERENCE_DECODER??'native';
assert.ok(['native','native-chunked','fflate'].includes(decoder),'Unknown diagnostic decoder');
assert.ok(decoder==='native'||mode==='replay','Alternate decoder is only a reader replay arm');
const codecUrl=decoder==='fflate'?new URL('reference-alt-decode.mjs',base).href:null;
const tiles=['5/15/11','5/15/10','5/16/11','5/16/10'];
const stop=armWatchdog(()=>({mode,stage:'reader-only'}),{timeout:replayDeadline+60000});
const started=Date.now();
function log(stage,data={}) {
 console.log('READER_ONLY '+JSON.stringify({mode,decoder,stage,elapsedMs:Date.now()-started,...data}));
}
const heartbeat=setInterval(()=>log('NODE_HEARTBEAT'),2500);
let browser,context,error;
try {
 browser=await launchBrowser({engine:'webkit',timeout:20000});
 context=await browser.newContext();
 await context.route(shell,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Reader-only diagnostic</title>'}));
 if(codecUrl)await context.route(codecUrl,route=>route.fulfill({path:'london-diagnostics/reference-alt-decode.mjs',contentType:'text/javascript'}));
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
 const result=await withinDeadline(()=>page.evaluate(async ({mode,tiles,generation,schedule,codecUrl,decoder})=>{
  const {createReferenceReader}=await import('/mainline-reference.mjs');
  // Same native transform and bounded output consumer in both arms. Only input differs.
  const decodeNative=async (data,maxBytes)=>{
   const fixed=decoder==='native-chunked', bytes=new Uint8Array(data);
   const logControl=stage=>{
    if(bytes.byteLength===849970||bytes.byteLength===829296)
     console.log('READER_PAGE '+JSON.stringify({stage,compressedBytes:bytes.byteLength}));
   };
   let offset=0;
   const input=fixed?new ReadableStream({
    pull(controller){
     if(offset===bytes.length){controller.close();return;}
     const end=Math.min(offset+65536,bytes.length);
     controller.enqueue(bytes.subarray(offset,end));offset=end;
    }
   }):new Blob([data]).stream();
   const streamReader=input.pipeThrough(new DecompressionStream('gzip')).getReader();
   const chunks=[];let size=0;
   try{
    while(true){
     const {done,value}=await streamReader.read();
     if(done){logControl('NATIVE_OUTPUT_EOF');break;}
     if(chunks.length===0)logControl('NATIVE_FIRST_OUTPUT');
     size+=value.byteLength;
     if(size>maxBytes){await streamReader.cancel();throw Error('Oversized decoded OSM reference tile');}
     chunks.push(value);
    }
   }finally{streamReader.releaseLock();}
   const result=new Uint8Array(size);
   let outputOffset=0;
   for(const c of chunks){result.set(c,outputOffset);outputOffset+=c.byteLength;}
   logControl('NATIVE_OUTPUT_COMPLETE');
   return result.buffer;
  };
  const decompress=codecUrl?(await import(codecUrl)).decodeReferenceForDiagnostic:decodeNative;
  const reader=createReferenceReader({
   root:new URL('/data/mainline-reference/',location.href),
   ...(mode==='replay'?{decompress}:{}),
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
 },{mode,tiles,generation,schedule,codecUrl,decoder}),mode+' London reader',replayDeadline);
 if(schedule){
  assert.deepEqual(result.unexpected,[],'Unexpected reader error');
  assert.equal(result.resolved+result.aborted,result.starts,'Every replay call must settle as expected');
  if(schedule.every(e=>e.kind==='START'&&!e.aborted))assert.equal(result.resolved,result.starts,'No calls were aborted in this trace');
 }
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
