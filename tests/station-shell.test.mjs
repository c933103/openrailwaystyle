import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('installed station data stays with its app version through an update and offline use',async()=>{
 const source=await readFile(new URL('../styles/sw.js',import.meta.url),'utf8'),scope='https://atlas.test/',handlers={},stores=new Map();let deployed='old',offline=false;
 const caches={keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),open:async key=>{if(!stores.has(key))stores.set(key,new Map());const rows=stores.get(key);return {match:async key=>rows.get(typeof key==='string'?key:key.url)?.clone(),put:async(key,response)=>rows.set(typeof key==='string'?key:key.url,response.clone()),keys:async()=>[...rows.keys()].map(url=>new Request(url)),delete:async request=>rows.delete(request.url)};}};
 const fetcher=async input=>{if(offline)throw Error('offline');const url=new URL(typeof input==='string'?input:input.url||input.href),body=url.pathname==='/'?`<script type="module" src="app.mjs?v=${deployed}"></script>`:`${deployed}:${url.pathname}`;return new Response(body);};
 vm.runInNewContext(source,{URL,Response,Request,location:{origin:'https://atlas.test'},caches,fetch:fetcher,self:{registration:{scope},addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
 let install;handlers.install({waitUntil:p=>install=p});await install;
 const request=async(path,version)=>{let result;handlers.fetch({request:{method:'GET',url:new URL(path+(version?'?v='+version:''),scope).href,mode:path==='/'?'navigate':'cors'},respondWith:p=>result=p});assert.ok(result);return (await result).text();};
 assert.equal(await request('major-stations.geojson','old'),'old:/major-stations.geojson');deployed='new';await request('/');offline=true;
 assert.equal(await request('major-stations.geojson','old'),'old:/major-stations.geojson');assert.equal(await request('major-stations.geojson','new'),'new:/major-stations.geojson');
 let tileHandled=false;handlers.fetch({request:{method:'GET',url:'https://tile.openstreetmap.org/3/4/2.png',mode:'cors'},respondWith:()=>tileHandled=true});assert.equal(tileHandled,false);
});
