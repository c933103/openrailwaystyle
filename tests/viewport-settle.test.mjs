import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForViewport} from '../styles/viewport-settle.mjs';
import {installLabelProtocols} from '../styles/tile-labels.mjs';
import {installBathymetry} from '../styles/bathymetry.mjs';
const flush = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };

test('idle views need no timer; moving views recheck until settled', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let moving = false, done = 0;
  await waitForViewport(new AbortController().signal, () => moving);
  moving = true;
  const task = waitForViewport(new AbortController().signal, () => moving).then(() => done++);
  t.mock.timers.tick(120); await flush(); assert.equal(done, 0);
  moving = false;
  t.mock.timers.tick(119); await flush(); assert.equal(done, 0);
  t.mock.timers.tick(1); await task; assert.equal(done, 1);
});
test('cancellation during the gate prevents later work', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const c = new AbortController(); let done = false;
  const task = waitForViewport(c.signal, () => true).then(() => { done=true; });
  const rejected = assert.rejects(task, {name:'AbortError'});
  c.abort(); await rejected; t.mock.timers.tick(1000); assert.equal(done,false);
  assert.throws(() => waitForViewport(c.signal), {name:'AbortError'});
});
test('moving track requests share the gate; primary vectors stay immediate', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let requests=0, workers=0, moving=true;
  const previous=globalThis.Worker;
  globalThis.Worker=class { constructor(){workers++;} terminate(){} postMessage(message){queueMicrotask(()=>this.onmessage({data:{id:message.id,result:{extent:4096,points:[]}}}));} };
  t.after(()=>{globalThis.Worker=previous;});
  const protocols={};
  const adapter=installLabelProtocols({addProtocol:(id,fn)=>protocols[id]=fn},{},async()=>{requests++;return {ok:true,status:200,arrayBuffer:async()=>new ArrayBuffer(0)};},{isMoving:()=>moving});
  t.after(()=>adapter.dispose());
  const a=new AbortController(), b=new AbortController();
  const first=protocols.atlastracks({url:'atlastracks://14/8192/8192'},a);
  const rejected=assert.rejects(first,{name:'AbortError'});
  const second=protocols.atlastracks({url:'atlastracks://14/8192/8192'},b);
  await flush(); assert.equal(requests,0); assert.equal(workers,0);
  await protocols.atlasrail({url:'atlasrail://https://fixture.test/0/0/0'},new AbortController());
  assert.equal(requests,1,'ordinary vector load bypasses optional gate');
  a.abort(); await rejected; assert.equal(requests,1);
  moving=false; t.mock.timers.tick(120); await second;
  assert.equal(requests,10,'all nine track neighbors are retained'); assert.equal(workers,1);
});
test('cancelled moving bathymetry creates no worker and fetches nothing', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let handler, requests=0,workers=0;
  const original=[globalThis.Worker,globalThis.OffscreenCanvas];
  globalThis.Worker=class {};globalThis.OffscreenCanvas=class {};
  t.after(()=>{[globalThis.Worker,globalThis.OffscreenCanvas]=original;});
  installBathymetry({addProtocol:(id,fn)=>handler=fn},{getDemTile:()=>requests++},{isMoving:()=>true,waterTile:()=>requests++,readTile:()=>{},createWorker:()=>{workers++;return {};}});
  const c=new AbortController(), task=handler({url:'atlas-depth://10/0/0'},c);
  const rejected=assert.rejects(task,{name:'AbortError'}); await flush();
  assert.equal(requests,0);assert.equal(workers,0);
  c.abort(); await rejected;t.mock.timers.tick(1000);
  assert.equal(requests,0);assert.equal(workers,0);
});
test('a failed movement check rejects and releases its scheduled work', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let checks=0;
  const task=waitForViewport(new AbortController().signal,()=>{if(++checks>1)throw new Error('fixture movement failure');return true;});
  const rejected=assert.rejects(task,/fixture movement failure/);
  t.mock.timers.tick(120); await rejected; t.mock.timers.tick(1000);
  assert.equal(checks,2);
});
test('last cancelled track subscriber prevents every halo download', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const previous=globalThis.Worker;let requests=0;
  globalThis.Worker=class {constructor(){throw new Error('cancelled work must not create a worker');}};
  t.after(()=>{globalThis.Worker=previous;});
  const protocols={};
  const adapter=installLabelProtocols({addProtocol:(id,fn)=>protocols[id]=fn},{},async()=>{requests++;throw new Error('unexpected download');},{isMoving:()=>true});
  t.after(()=>adapter.dispose());
  const c=new AbortController(), task=protocols.atlastracks({url:'atlastracks://14/8192/8192'},c);
  const rejected=assert.rejects(task,{name:'AbortError'});await flush();c.abort();await rejected;
  t.mock.timers.tick(1000);await flush();assert.equal(requests,0);
});

test('terrain movement messages are per manager, deduplicated and cleared on removal', async () => {
  const {bindTerrainViewport}=await import('../styles/viewport-settle.mjs');
  const listeners=new Map(),messages=[];let moving=false;
  const map={on:(name,fn)=>listeners.set(name,fn),off:(name)=>listeners.delete(name),isMoving:()=>moving,isZooming:()=>false};
  bindTerrainViewport(map,{manager:{managerId:7,actor:{dest:{postMessage:m=>messages.push(m)}}}});
  moving=true;listeners.get('movestart')();listeners.get('zoomstart')();
  listeners.get('remove')();
  assert.deepEqual(messages.map(m=>m.moving),[false,true,false]);
  assert.ok(messages.every(m=>m.managerId===7&&m.type==='atlas-viewport'));
  assert.equal(listeners.size,0);
});

test('cancellation after settlement but before the continuation still starts no bathymetry work',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let handler,moving=true,calls=0;
 installBathymetry({addProtocol:(id,fn)=>handler=fn},{getDemTile:()=>calls++},{isMoving:()=>moving,waterTile:()=>calls++,readTile:()=>{},createWorker:()=>{calls++;return {};}});
 const c=new AbortController(),task=handler({url:'atlas-depth://10/0/0'},c);
 const rejected=assert.rejects(task,{name:'AbortError'});
 moving=false;t.mock.timers.tick(120);c.abort();await rejected;assert.equal(calls,0);
});
