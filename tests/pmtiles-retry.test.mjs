import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {FetchSource, PMTiles, Protocol} from 'pmtiles';
import {installLabelProtocols, timedSource} from '../styles/tile-labels.mjs';
import {shareArchiveRequests} from '../styles/bathymetry.mjs';
import {pmtilesBytesResponse} from '../scripts/pmtiles-browser-fixture.mjs';

// One synthetic tile reached through a leaf directory. The actual pinned
// FetchSource, header cache, directory cache and ETag repair run in every case.
const tile=gzipSync(Buffer.alloc(0)),root=Buffer.from([1,0,0,5,1]),metadata=Buffer.from('{}'),leaf=Buffer.from([1,0,1,tile.length,1]);
const offsets={header:0,directory:134,tile:139,metadata:132};
const header=Buffer.alloc(127);header.write('PMTiles');header[7]=3;
for(const [at,n] of [[8,127],[16,5],[24,132],[32,2],[40,134],[48,5],[56,139],[64,tile.length],[72,1],[80,1],[88,1]])header.writeBigUInt64LE(BigInt(n),at);
header[96]=1;header[97]=1;header[98]=2;header[99]=1;header[101]=1;
for(const [at,n] of [[102,-180],[106,-85],[110,180],[114,85]])header.writeInt32LE(n*1e7,at);
const bytes=Buffer.concat([header,root,metadata,leaf,tile]),url='https://basemap.test/fixture.pmtiles';
function setup(t,{stage='header',answer=403,failures=Infinity,retries=[0,0]}={}) {
  const requests=[],made=[],protocols={};let failed=0;
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    assert.equal(String(input),url,'all fetches are explicit synthetic fixture reads');
    const range=new Headers(options.headers).get('range'),offset=Number(/^bytes=(\d+)-/.exec(range)[1]);
    requests.push(offset);
    if(offset===offsets[stage]&&failed++<failures) {
      if(answer instanceof Error)throw answer;
      return new Response('',{status:answer,headers:answer===416?{'content-range':`bytes */${bytes.length}`}:{}});
    }
    const response=pmtilesBytesResponse(bytes,range,'fixture-v1');return new Response(response.body,response);
  });
  const protocol=new Protocol({metadata:stage==='metadata'});protocol.tile=shareArchiveRequests(protocol.tile.bind(protocol));
  const adapters=installLabelProtocols({addProtocol:(id,fn)=>protocols[id]=fn},protocol,globalThis.fetch,{basemapRetries:retries,
    basemapArchive:address=>{made.push(address);return new PMTiles(timedSource(new FetchSource(address),1000));}});
  t.after(()=>adapters.dispose());
  const request=(controller=new AbortController())=>protocols.atlasbase({url:`atlasbase://en/${url}${stage==='metadata'?'':'/0/0/0'}`,type:stage==='metadata'?'json':'arrayBuffer'},controller);
  return {request,requests,made,protocol};
}
for(const stage of ['header','directory','tile','metadata']) for(const status of [400,401,403,404,410,422,451]) test(`${stage} HTTP ${status} reaches the caller once without archive replacement`,async t=>{
  const f=setup(t,{stage,answer:status});await assert.rejects(f.request(),new RegExp(`Bad response code: ${status}`));
  assert.equal(f.requests.filter(offset=>offset===offsets[stage]).length,1);assert.equal(f.made.length,1);
});
for(const status of [408,429,500,503,520]) test(`HTTP ${status} keeps exactly three wrapper attempts`,async t=>{
  const f=setup(t,{answer:status});await assert.rejects(f.request(),new RegExp(`Bad response code: ${status}`));
  assert.equal(f.requests.length,3);assert.equal(f.made.length,3);
});
for(const stage of ['header','directory','tile','metadata']) test(`${stage} transient failure recovers with fresh actual PMTiles state`,async t=>{
  const f=setup(t,{stage,answer:503,failures:1});const result=await f.request();assert.ok(result.data);
  assert.equal(f.requests.filter(offset=>offset===offsets[stage]).length,2);assert.equal(f.made.length,2);
});
test('transport failures retain the existing three-attempt bound',async t=>{
  const f=setup(t,{answer:new TypeError('Failed to fetch')});await assert.rejects(f.request(),/Failed to fetch/);assert.equal(f.requests.length,3);
});
test('cancellation before a request or during backoff issues no further ranges',async t=>{
  const f=setup(t,{answer:503,retries:[60000,60000]}),controller=new AbortController();
  const result=assert.rejects(f.request(controller),{name:'AbortError'});
  await new Promise(resolve=>setImmediate(resolve));controller.abort();await result;assert.equal(f.requests.length,1);
  await assert.rejects(f.request(controller),{name:'AbortError'});assert.equal(f.requests.length,1);
});
test('two consumers of a permanent header failure share one actual range',async t=>{
  const f=setup(t);await Promise.all([assert.rejects(f.request(),/403/),assert.rejects(f.request(),/403/)]);
  assert.deepEqual(f.requests,[0]);assert.equal(f.made.length,1);
});
test('pinned PMTiles small-archive 416 correction remains a single bounded repair',async t=>{
  const f=setup(t,{answer:416,failures:1});await f.request();assert.equal(f.requests.filter(x=>x===0).length,2);assert.equal(f.made.length,1);
});
test('persistent tile 416 exhausts PMTiles one ETag repair without outer amplification',async t=>{
  const f=setup(t,{stage:'tile',answer:416});await assert.rejects(f.request(),/non-matching ETag/);
  assert.equal(f.requests.filter(x=>x===offsets.tile).length,2);assert.equal(f.made.length,1);
});
test('cancelling one shared basemap reader leaves the other reader and its range intact',async t=>{
  const f=setup(t,{failures:0}),original=globalThis.fetch;let release,signal;
  t.mock.method(globalThis,'fetch',(input,options)=>{if(release)return original(input,options);signal=options.signal;return new Promise(resolve=>{release=()=>resolve(original(input,options));});});
  const cancelled=new AbortController(),first=assert.rejects(f.request(cancelled),{name:'AbortError'}),second=f.request();
  await new Promise(resolve=>setImmediate(resolve));cancelled.abort();await first;assert.equal(signal.aborted,false);release();
  await second;assert.deepEqual(f.requests,[0,offsets.directory,offsets.tile]);assert.equal(f.made.length,1);
});

for(const message of ['Load failed','The Internet connection appears to be offline.','The network connection was lost.']) {
  test(`WebKit transport rejection retains the three-attempt bound: ${message}`,async t=>{
    const f=setup(t,{answer:new TypeError(message)});await assert.rejects(f.request(),error=>error.message===message);assert.equal(f.requests.length,3);
  });
  test(`WebKit transport rejection recovers through a fresh archive: ${message}`,async t=>{
    const f=setup(t,{answer:new TypeError(message),failures:1});await f.request();assert.equal(f.made.length,2);assert.equal(f.requests.filter(x=>x===0).length,2);
  });
}
