import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const baseUrl='https://deployed.example/atlas/';
const manifest=(extra={})=>Buffer.from(JSON.stringify({complete:true,generation:'a'.repeat(24),inputSha256:'b'.repeat(64),sources:Array.from({length:8},(_,i)=>({region:String(i)})),rendererAcceptance:{sha256:'c'.repeat(64)},...extra}));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const verify=async(...args)=>(await import('../scripts/verify-deployed-reference.mjs')).verifyDeployedReference(...args);
const options=extra=>({baseUrl,expectedBytes:manifest(),wait:async()=>{},warn:()=>{},...extra});

test('deployment compares the served reference with the reviewed artifact before checkout discards staged data',async()=>{
 const source=await readFile('.github/workflows/site.yml','utf8');
 const deploy=source.indexOf('- name: Deploy to GitHub Pages');
 const check=source.indexOf('node scripts/verify-deployed-reference.mjs "$PAGE_URL" styles/data/mainline-reference/manifest.json',deploy);
 assert.ok(check>deploy,'a valid older manifest must not satisfy publication of the expected artifact');
 assert.ok(check<source.indexOf('- uses: actions/checkout@v4',deploy),'use the downloaded artifact, not a later checkout');
 assert.match(source,/name: Verify deployed reference manifest matches the reviewed artifact\n\s+timeout-minutes: 6/);
});

test('exact manifest bytes pass on the first request to the canonical deployment path',async()=>{
 const calls=[],expected=manifest();
 const result=await verify(options({expectedBytes:expected,fetcher:async(url,init)=>{calls.push({url:String(url),init});return new Response(expected);}}));
 assert.equal(result.attempts,1);assert.equal(result.sha256,hash(expected));
 assert.equal(calls[0].url,baseUrl+'data/mainline-reference/manifest.json');
 assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.headers['Cache-Control'],'no-cache');
 assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('an internally valid old generation is rejected until the expected artifact is served',async()=>{
 const expected=manifest(),old=manifest({generation:'d'.repeat(24)}),waits=[];let calls=0;
 const result=await verify(options({fetcher:async()=>new Response(++calls<3?old:expected),wait:async ms=>waits.push(ms)}));
 assert.equal(result.attempts,3);assert.deepEqual(waits,[5000,5000]);
});

test('same generation and input with older acceptance metadata is not exact adoption',async()=>{
 const old=manifest({rendererAcceptance:{sha256:'d'.repeat(64)}});let calls=0;
 await assert.rejects(verify(options({maxAttempts:2,fetcher:async()=>{calls++;return new Response(old);}})),error=>{
  assert.match(error.message,/after 2 attempts/);assert.match(error.message,new RegExp(hash(old)));return true;
 });
 assert.equal(calls,2);
});

test('empty, malformed and differently serialized bodies cannot certify adoption',async()=>{
 for(const body of ['', '{}',manifest().toString()+'\n'])await assert.rejects(verify(options({maxAttempts:1,fetcher:async()=>new Response(body)})),/manifest|body/i);
});

test('oversized streamed bodies are cancelled at the artifact byte bound',async()=>{
 let pulls=0,cancelled=false;const size=manifest().length;
 const body=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(size+1));},cancel(){cancelled=true;}},{highWaterMark:0});
 await assert.rejects(verify(options({maxAttempts:1,fetcher:async()=>new Response(body)})),/exceeds expected/);
 assert.equal(pulls,1);assert.equal(cancelled,true);
});

test('HTTP errors and interrupted bodies have bounded retries but never pass as a match',async()=>{
 for(const failure of ['http','body']){
  let calls=0;
  const result=await verify(options({fetcher:async()=>{
   if(++calls>1)return new Response(manifest());
   if(failure==='http')return new Response('temporarily unavailable',{status:503});
   return new Response(new ReadableStream({start(c){c.error(new Error('body reset'));}}));
  }}));
  assert.equal(result.attempts,2);
 }
 let calls=0;
 await assert.rejects(verify(options({maxAttempts:3,fetcher:async()=>{calls++;return new Response('not found',{status:404});}})),/HTTP 404/);
 assert.equal(calls,3);
});

test('a hanging body is cancelled by the per-request deadline without reading a tail',async()=>{
 let cancelled=false;
 // Keep one ordinary timer alive: AbortSignal.timeout intentionally uses an unref timer.
 const keepAlive=setTimeout(()=>{},1000);
 try{
  await assert.rejects(verify(options({maxAttempts:1,requestTimeoutMs:10,fetcher:async()=>new Response(new ReadableStream({pull(){},cancel(){cancelled=true;}},{highWaterMark:0}))})),/timeout|aborted/i);
  assert.equal(cancelled,true);
 }finally{clearTimeout(keepAlive);}
});

test('invalid expected artifacts and unsafe bounds fail before making any request',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('must not fetch');};
 for(const expectedBytes of [Buffer.from('{}'),Buffer.from('invalid'),manifest({complete:false})])await assert.rejects(verify(options({expectedBytes,fetcher})),/expected|JSON/i);
 for(const extra of [{maxAttempts:0},{maxAttempts:13},{requestTimeoutMs:20001},{retryDelayMs:-1}])await assert.rejects(verify(options({fetcher,...extra})),/bound/i);
 assert.equal(calls,0);
});


test('matching bytes with a late EOF still fail the response deadline',async()=>{
 const keepAlive=setTimeout(()=>{},1000);
 try{
  await assert.rejects(verify(options({maxAttempts:1,requestTimeoutMs:10,fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(manifest());},cancel(){}},{highWaterMark:0}))})),/timeout|aborted/i);
 }finally{clearTimeout(keepAlive);}
});

test('transport failure retries only the same first-party manifest and stops at the bound',async()=>{
 const urls=[];
 await assert.rejects(verify(options({maxAttempts:2,fetcher:async url=>{urls.push(String(url));throw new TypeError('fetch failed');}})),/after 2 attempts.*fetch failed/);
 assert.deepEqual(urls,[baseUrl+'data/mainline-reference/manifest.json',baseUrl+'data/mainline-reference/manifest.json']);
});

test('HTTP-error and oversized bodies do not wait for an unresponsive cancellation promise',async()=>{
 for(const kind of ['http','oversize']){
  let cancelled=false,timer;
  const body=new ReadableStream({pull(c){if(kind==='oversize')c.enqueue(new Uint8Array(manifest().length+1));},cancel(){cancelled=true;return new Promise(()=>{});}},{highWaterMark:0});
  try{
   await assert.rejects(Promise.race([
    verify(options({maxAttempts:1,requestTimeoutMs:10,fetcher:async()=>new Response(body,{status:kind==='http'?503:200})})),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('cancellation exceeded request bound')),1000);})
   ]),kind==='http'?/HTTP 503/:/exceeds expected/);
   assert.equal(cancelled,true);
  }finally{clearTimeout(timer);}
 }
});
