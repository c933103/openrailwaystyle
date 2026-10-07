import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrackCounter} from '../styles/track-work.mjs';
import {installLabelProtocols} from '../styles/tile-labels.mjs';
import encode from 'vt-pbf';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const input=y=>({tiles:[{dx:0,dy:0,data:new ArrayBuffer(16)}],areas:[],stations:[],y});
function workers(){
 const instances=[],messages=[];
 const create=()=>{const w={terminate(){w.terminated=true;},postMessage(message,transfer){messages.push({worker:w,message:structuredClone(message,{transfer})});}};instances.push(w);return w;};
 const respond=(item=messages.at(-1))=>item.worker.onmessage({data:{id:item.message.id,result:{extent:4096,points:[{tracks:item.message.y}]}}});
 return {create,instances,messages,respond};
}
test('panning away drops queued counts and terminates the sole running worker',async()=>{
 const w=workers(),buffers=[],count=createTrackCounter(async(x,y)=>{const i=input(y);buffers.push(i.tiles[0].data);return i;},w.create);
 const controllers=Array.from({length:12},()=>new AbortController());
 const tasks=controllers.map((c,i)=>count(i,i,c.signal));const settled=Promise.allSettled(tasks);
 await tick();assert.equal(w.messages.length,1,'only one set of private buffers enters the worker');
 assert.ok(buffers.every(b=>b.byteLength===16),'originals remain reusable');
 controllers.forEach(c=>c.abort());const outcomes=await settled;
 assert.ok(outcomes.every(o=>o.status==='rejected'&&o.reason.name==='AbortError'));assert.equal(w.instances[0].terminated,true);assert.equal(w.messages.length,1,'cancelled queue entries never get copied or counted');
 const next=count(20,20,new AbortController().signal);await tick();assert.equal(w.instances.length,2);w.respond();assert.equal((await next).points[0].tracks,20);
});
test('one cancelled consumer does not cancel a shared count or its completed cache',async()=>{
 const w=workers(),a=new AbortController(),b=new AbortController();let loads=0;
 const count=createTrackCounter(async(x,y)=>{loads++;return input(y);},w.create);
 const first=count(1,2,a.signal);const rejected=assert.rejects(first,{name:'AbortError'}),second=count(1,2,b.signal);
 await tick();a.abort();await rejected;assert.equal(w.instances[0].terminated,undefined);assert.equal(loads,1);w.respond();const result=await second;
 assert.equal(await count(1,2,new AbortController().signal),result);assert.equal(loads,1);
});
test('unfinished counts remain shared when the completed-result cache is full',async()=>{
 const w=workers();let loads=0;const count=createTrackCounter(async(x,y)=>{loads++;return input(y);},w.create,{maxResults:1});
 const signal=new AbortController().signal,a=count(0,0,signal),b=count(1,1,signal);await tick();const again=count(0,0,signal);
 assert.equal(loads,2);w.respond(w.messages[0]);await a;await tick();w.respond();await b;assert.deepEqual(await again,await a);
});
test('last cancelled tile aborts its current nine-download phase while another shared consumer keeps it alive',async()=>{
 const protocols={},previous=globalThis.Worker;let calls=0,aborted=0;
 globalThis.Worker=class {constructor(){throw new Error('cancelled downloads must not create a worker');}};
 try{
  installLabelProtocols({addProtocol:(n,f)=>protocols[n]=f},{},async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(new DOMException('Aborted','AbortError'));},{once:true}));});
  const a=new AbortController(),b=new AbortController(),url='atlastracks://14/8192/8192';
  const first=protocols.atlastracks({url},{signal:a.signal}),second=protocols.atlastracks({url},{signal:b.signal});const outcomes=Promise.allSettled([first,second]);
  await tick();assert.equal(calls,9);a.abort();await tick();assert.equal(aborted,0);b.abort();await outcomes;await tick();assert.equal(aborted,9);
 }finally{globalThis.Worker=previous;}
});


const fixtureRailTile=(()=>{
 const b=encode.fromGeojsonVt({railway_line_high:{features:[{type:2,geometry:[[[0,2048],[4096,2048]]],tags:{id:'fixture'}}]}},{version:2,extent:4096});
 return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
})();
async function measureAmplification(views,{empty=false}={}){
 const protocols={},requests=[];let active=0,peak=0;const previous=globalThis.Worker;
 globalThis.Worker=class{terminate(){} postMessage(message){queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result:{extent:4096,points:[]}}}));}};
 try{
  const data=empty?new ArrayBuffer(0):fixtureRailTile;
  installLabelProtocols({addProtocol:(n,f)=>protocols[n]=f},{},async(url,{signal}={})=>{
   signal?.throwIfAborted?.();requests.push(url);active++;peak=Math.max(peak,active);await tick();active--;
   return {ok:true,status:200,arrayBuffer:async()=>data.slice(0)};
  },{tileRetries:[]});
  const req=([x,y])=>protocols.atlastracks({url:`atlastracks://14/${x}/${y}`},{signal:new AbortController().signal});
  const totals=[];for(const view of views){await Promise.all(view.map(req));totals.push(requests.length);}
  return {totals,peak,unique:new Set(requests).size};
 }finally{globalThis.Worker=previous;}
}
test('z14 track-count request amplification is measured and deduplicated',async()=>{
 const one=await measureAmplification([[[8192,8192]]]);
 assert.deepEqual(one.totals,[27]);assert.equal(one.unique,27);assert.equal(one.peak,9);
 const first=[[8192,8192],[8193,8192],[8192,8193],[8193,8193]],east=[[8193,8192],[8194,8192],[8193,8193],[8194,8193]];
 const dense=await measureAmplification([first,east]);
 assert.deepEqual(dense.totals,[48,60],'cold 2x2 deduplicates 108 candidates to 48; east pan adds 12');assert.equal(dense.peak,16);
 const blank=await measureAmplification([first,east],{empty:true});
 assert.deepEqual(blank.totals,[16,20],'blank 2x2 skips station halos; east pan adds four');assert.equal(blank.peak,16);
});