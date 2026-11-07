import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {createRequestPool} = await import(new URL('./styles/request-pool.mjs', pathToFileURL(process.cwd() + '/')));
const tick = () => new Promise(resolve => setImmediate(resolve));
for (const header of ['Wed, 07 Oct 2026 00:02:00 GMT','Wed Oct  7 00:02:00 2026']) test(`actual request pool honors UTC provider date ${header}`, async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let now=Date.parse('2026-10-07T00:00:00Z');
  const calls=[];
  const pool=createRequestPool({retries:[],perOrigin:1,now:()=>now,fetcher:async url=>{
    calls.push(url);
    return url.endsWith('/busy')?{ok:false,status:429,headers:{get:()=>header}}:{ok:true,arrayBuffer:async()=>new Uint8Array([8]).buffer};
  }});
  let outcome;
  try {
    await assert.rejects(pool.get('https://fixture.test/busy'),error=>error.status===429);
    outcome=pool.get('https://fixture.test/next').then(value=>({value}),error=>({error}));
    now+=119999;t.mock.timers.tick(119999);await tick();
    assert.equal(calls.length,1,'no subsequent request before the actual UTC deadline');
    now+=1;t.mock.timers.tick(1);await tick();
    assert.equal((await outcome).value.byteLength,1);
  } finally {pool.dispose();await outcome;}
});
