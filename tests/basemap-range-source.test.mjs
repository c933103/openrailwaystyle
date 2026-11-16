import test from 'node:test';
import assert from 'node:assert/strict';
import {FetchSource,EtagMismatch} from 'pmtiles';
import {createBasemapSourceFactory} from '../styles/basemap-range-source.mjs';
const namespace={FetchSource,EtagMismatch},signal=()=>new AbortController().signal;
const response=(status,headers={},data=new ArrayBuffer(1))=>({status,headers:new Headers(headers),body:{cancel:async()=>{}},arrayBuffer:async()=>data});

test('header-time pause survives body failure and archive replacement, consuming elapsed body time',async()=>{
 let elapsed=0,calls=0;const waits=[];
 const create=createBasemapSourceFactory(namespace,{now:()=>elapsed,wallNow:()=>0,delay:async ms=>{waits.push(ms);elapsed+=ms;},fetcher:async()=>{
  calls++;if(calls===1)return {...response(206,{'retry-after':'2'}),arrayBuffer:async()=>{elapsed=1500;throw new Error('body failed');}};
  return response(206);
 }});
 await assert.rejects(create('https://fixture.test/a').getBytes(0,1,signal()),/body failed/);
 await create('https://fixture.test/a').getBytes(0,1,signal());
 assert.deepEqual(waits,[500]);assert.equal(calls,2);
});
test('successful headers pause later requests on the same origin, with early timer wakes rechecked',async()=>{
 let elapsed=0,calls=0;const waits=[];
 const create=createBasemapSourceFactory(namespace,{now:()=>elapsed,wallNow:()=>0,delay:async ms=>{waits.push(ms);elapsed+=Math.min(500,ms);},fetcher:async()=>{calls++;return response(206,calls===1?{'retry-after':'2'}:{});}});
 await create('https://fixture.test/a').getBytes(0,1,signal());
 await create('https://other.test/a').getBytes(0,1,signal());assert.equal(elapsed,0);
 await create('https://fixture.test/b').getBytes(0,1,signal());
 assert.deepEqual(waits,[2000,1500,1000,500]);assert.equal(calls,3);
});
test('HTTP-date pause remains monotonic after wall-clock corrections and permanent errors stay classified',async()=>{
 let elapsed=0,wall=Date.parse('Mon, 16 Nov 2026 00:00:00 GMT'),calls=0;const waits=[];
 const create=createBasemapSourceFactory(namespace,{now:()=>elapsed,wallNow:()=>wall,delay:async ms=>{waits.push(ms);elapsed+=ms;},fetcher:async()=>{calls++;return calls===1?response(503,{'retry-after':'Mon, 16 Nov 2026 00:00:03 GMT'}):response(403);}});
 await assert.rejects(create('https://fixture.test/a').getBytes(0,1,signal()),{status:503});
 wall+=86400000;elapsed=1000;
 await assert.rejects(create('https://fixture.test/a').getBytes(0,1,signal()),{status:403});
 assert.deepEqual(waits,[2000]);assert.equal(calls,2);
});
test('cancelling an enormous provider pause sends no later range and avoids timer overflow',async()=>{
 let calls=0,wait;
 const create=createBasemapSourceFactory(namespace,{now:()=>0,fetcher:async()=>{calls++;return response(503,{'retry-after':'9'.repeat(400)});},delay:(ms,s)=>{wait=ms;return new Promise((resolve,reject)=>s.addEventListener('abort',()=>reject(s.reason),{once:true}));}});
 await assert.rejects(create('https://fixture.test/a').getBytes(0,1,signal()),{status:503});
 const c=new AbortController(),task=create('https://fixture.test/a').getBytes(0,1,c.signal);
 const rejected=assert.rejects(task,{name:'AbortError'});assert.equal(wait,2147483647);c.abort();await rejected;assert.equal(calls,1);
});
test('the bounded small-archive 416 correction also observes its provider pause',async()=>{
 let calls=0,elapsed=0;const ranges=[];
 const create=createBasemapSourceFactory(namespace,{now:()=>elapsed,delay:async ms=>{elapsed+=ms;},fetcher:async(url,options)=>{
  ranges.push(new Headers(options.headers).get('range'));calls++;
  return calls===1?response(416,{'content-range':'bytes */1','retry-after':'1'}):response(206);
 }});
 await create('https://fixture.test/a').getBytes(0,16384,signal());
 assert.deepEqual(ranges,['bytes=0-16383','bytes=0-0']);assert.equal(elapsed,1000);
});
