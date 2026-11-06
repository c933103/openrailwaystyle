import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPolarTextFetcher} from '../scripts/polar-fetch.mjs';
function setup(replies){
 let clock=Date.parse('2026-11-06T00:00:00Z');const calls=[],waits=[];
 const read=createPolarTextFetcher({userAgent:'Atlas test',now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;},warn:()=>{},fetcher:async(url,options)=>{
  calls.push({url,options,at:clock});const rule=replies[Math.min(calls.length-1,replies.length-1)];
  if(rule.error)throw new TypeError(rule.error);
  const headers={...rule.headers};if(rule.dateDelay)headers['Retry-After']=new Date(clock+rule.dateDelay).toUTCString();
  const response=new Response(rule.body??'valid',{status:rule.status??200,headers});
  if(rule.bodyError)response.text=async()=>{throw Error('body reset');};
  return response;
 }});
 return {read,calls,waits};
}
const url='https://overpass.example/api/interpreter';
test('polar builder uses one shared fetcher for elevation, cap features and detail sectors',async()=>{
 const source=await readFile('scripts/build-polar.mjs','utf8');
 assert.match(source,/import \{createPolarTextFetcher\} from '\.\/polar-fetch\.mjs'/);
 assert.equal((source.match(/createPolarTextFetcher\(\{userAgent: USER_AGENT\}\)/g)||[]).length,1);
 assert.equal((source.match(/fetchText\(/g)||[]).length,3);
 assert.match(source,/catch \(error\) \{[\s\S]*Using the previous copy/);
 assert.match(source,/await rename\(output, 'snapshot\/polar'\)/);
});
test('polar failed request honors seconds Retry-After without changing body or request count',async()=>{
 const r=setup([{status:503,headers:{'Retry-After':'600'}},{}]),body=new URLSearchParams({data:'original query'});
 assert.equal(await r.read(url,{method:'POST',body}),'valid');assert.equal(r.calls.length,2);
 assert.equal(r.calls[1].at-r.calls[0].at,600000);assert.equal(r.calls[1].options.body,body);
 assert.equal(r.calls[0].options.headers['User-Agent'],'Atlas test');assert.ok(r.calls[0].options.signal instanceof AbortSignal);
});
test('polar interrupted body retains its header-time HTTP-date pause',async()=>{
 const r=setup([{dateDelay:600000,bodyError:true},{}]);await r.read(url);
 assert.equal(r.calls.length,2);assert.equal(r.calls[1].at-r.calls[0].at,600000);
});
for(const value of ['901','9999999999999999999999999999999999999999'])test(`polar long pause ${value} stops retries and later same-origin calls`,async()=>{
 const r=setup([{status:503,headers:{'Retry-After':value}}]);
 await assert.rejects(r.read(url),/Retry-After/);await assert.rejects(r.read('https://overpass.example/next'),/Retry-After/);
 assert.equal(r.calls.length,1);assert.deepEqual(r.waits,[]);
});
test('polar successful response still defers the next request to the same provider',async()=>{
 const r=setup([{headers:{'Retry-After':'600'}},{}]);await r.read(url);await r.read('https://overpass.example/next');
 assert.equal(r.calls.length,2);assert.equal(r.calls[1].at-r.calls[0].at,600000);
});
test('polar successful long-pause response can be cached but cannot bypass its later-request stop',async()=>{
 const r=setup([{headers:{'Retry-After':'3600'}},{}]);assert.equal(await r.read(url),'valid');
 await assert.rejects(r.read('https://overpass.example/next'),/Retry-After/);assert.equal(r.calls.length,1);
});
test('polar provider pauses do not stop the independent elevation origin',async()=>{
 const r=setup([{status:503,headers:{'Retry-After':'3600'}},{}]);await assert.rejects(r.read(url),/Retry-After/);
 assert.equal(await r.read('https://elevation.example/grid'),'valid');assert.equal(r.calls.length,2);assert.deepEqual(r.waits,[]);
});
for(const status of [400,401,403,404])test(`polar permanent HTTP ${status} has one request`,async()=>{
 const r=setup([{status}]);await assert.rejects(r.read(url),new RegExp(`HTTP ${status}`));assert.equal(r.calls.length,1);assert.deepEqual(r.waits,[]);
});
test('polar transport failures retain four attempts and the original 30/60/90-second waits',async()=>{
 const r=setup([{error:'fetch failed'}]);await assert.rejects(r.read(url),/fetch failed/);
 assert.equal(r.calls.length,4);assert.deepEqual(r.waits,[30000,60000,90000]);
});
test('polar 406/408/429 and a 15-minute pause can recover without an extra retry',async()=>{
 for(const status of [406,408,429]){const r=setup([{status,headers:{'Retry-After':'900'}},{}]);await r.read(url);assert.equal(r.calls.length,2);assert.equal(r.calls[1].at-r.calls[0].at,900000);}
});
test('polar malformed and past pauses preserve the original retry floor',async()=>{
 for(const value of ['soon','-1','Thu, 05 Nov 2026 00:00:00 GMT']){const r=setup([{status:503,headers:{'Retry-After':value}},{}]);await r.read(url);assert.deepEqual(r.waits,[30000]);}
});
test('polar final failed attempt still protects a later call from an early request',async()=>{
 const r=setup([{status:503},{status:503},{status:503},{status:503,headers:{'Retry-After':'600'}},{}]);
 await assert.rejects(r.read(url),/HTTP 503/);await r.read('https://overpass.example/next');
 assert.equal(r.calls.length,5);assert.equal(r.calls[4].at-r.calls[3].at,600000);
});
