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
