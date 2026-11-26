import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

// Execute the actual bundled Actor/dispatch/loader boundary; synthetic transport
// and image decoding are the only substitutes. No provider or browser is used.
test('bundled DEM worker receives movement before repair and honors actor cancellation',async()=>{
 const {outputFiles}=await build({entryPoints:['styles/dem-worker.mjs'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022'});
 const listeners=[],messages=[],requests=[];let decoded=0;
 const self={addEventListener:(name,fn)=>{assert.equal(name,'message');listeners.push(fn);},postMessage:message=>messages.push(message)};
 const context=vm.createContext({self,console,performance,AbortController,DOMException,setTimeout,clearTimeout,Blob,
  fetch:async url=>{requests.push(url);return {ok:true,headers:new Headers(),blob:async()=>new Blob(['fine'])};},
  createImageBitmap:async()=>{decoded++;return {width:1,height:1,close(){}};},
  OffscreenCanvas:class {getContext(){return {drawImage(){},getImageData:()=>({width:1,data:new Uint8ClampedArray([128,0,0,255])})};}},
 });
 vm.runInContext(outputFiles[0].text,context);
 const send=data=>{for(const listener of listeners)listener({data});return self.onmessage({data});};
 await send({type:'request',id:1,name:'init',args:[{managerId:7,demUrlPattern:'https://terrain.fixture/{z}/{x}/{y}.png',cacheSize:32,maxzoom:15,encoding:'terrarium',timeoutMs:20000}]});
 await send({type:'atlas-viewport',managerId:7,moving:true});
 const task=send({type:'request',id:2,name:'fetchTile',args:[7,14,8192,8192]});
 for(let i=0;i<80;i++)await Promise.resolve();
 assert.equal(requests.length,1,'primary bytes start immediately');assert.equal(decoded,0,'repair decode and reference fan-out wait');
 await send({type:'cancel',id:2});await task;
 assert.match(messages.find(m=>m.id===2).error,/cancel|abort/i);assert.equal(requests.length,1);assert.equal(decoded,0);
 await send({type:'atlas-viewport',managerId:7,moving:false});
 await send({type:'request',id:3,name:'fetchTile',args:[7,14,8193,8192]});
 const result=messages.find(m=>m.id===3);assert.equal(result.error,undefined);assert.equal(await result.response.data.text(),'fine');
 assert.ok(decoded>0,'settled worker performs optional repair');assert.ok(requests.length>2,'coarser repair reference resumes');
});

test('real contour actor receives a slow usable tile before its deadline despite a stalled optional repair',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 const {outputFiles}=await build({entryPoints:['styles/dem-worker.mjs'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022'});
 const listeners=[], calls=[], delayedBodies=new Map(), decodes=[];
 const deliver=(data)=>{for(const fn of listeners)fn({data});return self.onmessage({data});};
 const self={addEventListener:(name,fn)=>listeners.push(fn),
   postMessage:data=>queueMicrotask(()=>remote.onmessage({data}))};
 const remote={postMessage:data=>queueMicrotask(()=>deliver(data))};
 const context=vm.createContext({self,console,performance:{now:()=>Date.now()},AbortController,DOMException,setTimeout,clearTimeout,Blob,
  fetch:async(url,{signal})=>{
   calls.push({url,signal});
   if(url.includes('/8/'))return new Promise(()=>{});
   return {ok:true,headers:new Headers(),blob:()=>new Promise(resolve=>delayedBodies.set(url,resolve))};
  },
  createImageBitmap:async(blob)=>{decodes.push(Date.now());return {width:1,height:1,close(){}};},
  OffscreenCanvas:class {getContext(){return {drawImage(){},getImageData:()=>({width:1,data:new Uint8ClampedArray([128,0,0,255])})};}},
 });
 vm.runInContext(outputFiles[0].text,context);
 // Keep the actual Actor implementation and its 20-second timeout at both
 // ends of the transport. Only provider HTTP and image contents are fixtures.
 const mainActor=new self.actor.constructor(remote,{},20_000);
 const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
 const tick=async n=>{t.mock.timers.tick(n);await flush();};
 await mainActor.send('init',[],new AbortController(),undefined,{managerId:7,
  demUrlPattern:'https://terrain.fixture/{z}/{x}/{y}.png',cacheSize:32,maxzoom:15,encoding:'terrarium',timeoutMs:20_000});
 const run=async(x,wait,budget)=>{
  const start=Date.now();let outcome;
  const task=mainActor.send('fetchAndParseTile',[],new AbortController(),undefined,7,10,x,478)
    .then(data=>{outcome={data,elapsed:Date.now()-start};},error=>{outcome={error:error.message,elapsed:Date.now()-start};});
  await flush();await tick(wait);
  delayedBodies.get('https://terrain.fixture/10/'+x+'/478.png')(new Blob(['fine']));
  await flush();
  if(budget){
    const repair=calls.findLast(x=>x.url.includes('/8/'));
    assert.ok(repair,'optional reference starts while it has time');
    await tick(budget-1);assert.equal(outcome,undefined);
    await tick(1);assert.equal(repair.signal.aborted,true,'optional read is aborted before the Actor budget ends');
  }
  if(!outcome)await tick(20_000-(Date.now()-start));
  await task;
  assert.equal(outcome.error,undefined,JSON.stringify(outcome));
  assert.equal(outcome.data.width,1);
  assert.equal(outcome.elapsed,wait+budget);
 };
 await run(982,16_000,2_000);
 const earlierReferences=calls.filter(x=>x.url.includes('/8/')).length;
 await run(983,18_000,0);
 assert.equal(calls.filter(x=>x.url.includes('/8/')).length,earlierReferences,'no extra reference after the safe repair window');
 assert.equal(decodes.at(-1),Date.now(),'the actual final decoder still receives the late primary bytes');
});
