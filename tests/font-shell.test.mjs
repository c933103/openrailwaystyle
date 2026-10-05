import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('Chinese fonts are optional during installation and cached for offline use after selection',async()=>{
 const source=await readFile(new URL('../styles/sw.js',import.meta.url),'utf8'),scope='https://atlas.test/',handlers={},stores=new Map(),requests=[];let offline=false;
 const caches={keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),open:async key=>{if(!stores.has(key))stores.set(key,new Map());const rows=stores.get(key);return {match:async key=>rows.get(typeof key==='string'?key:key.url)?.clone(),put:async(key,response)=>rows.set(typeof key==='string'?key:key.url,response.clone()),keys:async()=>[...rows.keys()].map(url=>new Request(url)),delete:async request=>rows.delete(request.url)};}};
 const fetcher=async input=>{const url=typeof input==='string'?input:input.url||input.href;requests.push(url);if(offline)throw Error('offline');return new Response(new URL(url).pathname==='/'?'<script type="module" src="app.mjs?v=new"></script>':'font or shell');};
 vm.runInNewContext(source,{URL,Response,Request,location:{origin:'https://atlas.test'},caches,fetch:fetcher,self:{registration:{scope},addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
 let installation;handlers.install({waitUntil:p=>installation=p});await installation;assert.ok(!requests.some(url=>url.includes('/fonts/')),'neither font may hold up app installation');
 const get=path=>{let result;handlers.fetch({request:{method:'GET',url:new URL(path,scope).href,mode:'cors'},respondWith:p=>result=p});return result;};
 assert.equal(await (await get('fonts/atlas-cjk-tc-v1.woff2')).text(),'font or shell');
 offline=true;assert.equal(await (await get('fonts/atlas-cjk-tc-v1.woff2')).text(),'font or shell');
 await assert.rejects(get('fonts/atlas-cjk-sc-v1.woff2'),/offline/,'a missing other-script font stays optional');
 assert.equal(requests.filter(url=>url.includes('atlas-cjk-tc')).length,1);
});
test('a Chinese font is still served when Cache Storage is unavailable or full',async()=>{
 const source=await readFile(new URL('../styles/sw.js',import.meta.url),'utf8'),scope='https://atlas.test/',handlers={};
 for(const caches of [{open:async()=>{throw Error('storage denied');}},{open:async()=>({match:async()=>undefined,put:async()=>{throw Error('QuotaExceededError');}})}]){
  vm.runInNewContext(source,{URL,Response,Request,location:{origin:'https://atlas.test'},caches,fetch:async()=>new Response('font'),self:{registration:{scope},addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
  let result;handlers.fetch({request:{method:'GET',url:new URL('fonts/atlas-cjk-sc-v1.woff2',scope).href,mode:'cors'},respondWith:p=>result=p});
  assert.equal(await (await result).text(),'font');
 }
});
test('rare Han slices and the index listing them are kept for offline use',async()=>{
 const source=await readFile(new URL('../styles/sw.js',import.meta.url),'utf8'),scope='https://atlas.test/',handlers={},stores=new Map();let offline=false;
 const caches={keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),open:async key=>{if(!stores.has(key))stores.set(key,new Map());const rows=stores.get(key);return {match:async key=>rows.get(typeof key==='string'?key:key.url)?.clone(),put:async(key,response)=>rows.set(typeof key==='string'?key:key.url,response.clone())};}};
 vm.runInNewContext(source,{URL,Response,Request,location:{origin:'https://atlas.test'},caches,fetch:async input=>{if(offline)throw Error('offline');return new Response(new URL(typeof input==='string'?input:input.url).pathname);},self:{registration:{scope},addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
 const get=path=>{let result;handlers.fetch({request:{method:'GET',url:new URL(path,scope).href,mode:'cors'},respondWith:p=>result=p});return result;};
 for(const path of ['fonts/rare-han-v1/index.json','fonts/rare-han-v1/2a7.woff2'])await get(path);
 offline=true;
 assert.equal(await (await get('fonts/rare-han-v1/index.json')).text(),'/fonts/rare-han-v1/index.json');
 assert.equal(await (await get('fonts/rare-han-v1/2a7.woff2')).text(),'/fonts/rare-han-v1/2a7.woff2');
});
