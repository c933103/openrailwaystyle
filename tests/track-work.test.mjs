import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrackCounter} from '../styles/track-work.mjs';
import {installLabelProtocols} from '../styles/tile-labels.mjs';
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
test('last cancelled count aborts its four active downloads and discards 23 queued tiles, but one reader keeps all work alive',async()=>{
 const protocols={},previous=globalThis.Worker;let calls=0,aborted=0,adapters;
 const a=new AbortController(),b=new AbortController();
 globalThis.Worker=class {constructor(){throw new Error('cancelled downloads must not create a worker');}};
 try{
  adapters=installLabelProtocols({addProtocol:(n,f)=>protocols[n]=f},{},async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(new DOMException('Aborted','AbortError'));},{once:true}));});
  const url='atlastracks://14/8192/8192';
  const first=protocols.atlastracks({url},{signal:a.signal}),second=protocols.atlastracks({url},{signal:b.signal});
  const outcomes=Promise.allSettled([first,second]);
  await tick();assert.equal(calls,4,'the provider receives four requests, not a burst of 27');
  assert.equal(adapters.requestStats().queued,23,'the other 23 inputs are retained, not dropped');
  a.abort();await tick();assert.equal(aborted,0,'one remaining consumer keeps the work alive');
  assert.equal(adapters.requestStats().queued,23);
  b.abort();const settled=await outcomes;await tick();
  assert.ok(settled.every(outcome=>outcome.status==='rejected'&&outcome.reason.name==='AbortError'));
  assert.equal(aborted,4);assert.equal(calls,4,'cancelled queued inputs never reach the provider');
  assert.equal(adapters.requestStats().queued,0);assert.equal(adapters.requestStats().active,0);
 }finally{a.abort();b.abort();adapters?.dispose();globalThis.Worker=previous;}
});
