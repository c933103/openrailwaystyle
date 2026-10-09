import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {serveFixture,fixtureLine,sha256} from './fixture-server.mjs';
import {emptyPmtiles} from './source/scripts/pmtiles-browser-fixture.mjs';
const wire=(url,{method='GET',headers={}}={})=>new Promise((resolve,reject)=>{const q=request(url,{method,headers},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,body:Buffer.concat(chunks)}));});q.on('error',reject);q.end();});
test('fixture coordinates/properties are exactly the accepted production-browser fixture',async()=>{
 const code=await readFile('source/scripts/check-orm-fixture-browser.mjs','utf8');const expression=code.match(/const line=([\s\S]*?);\nconst indexes=/)[1];assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext('('+expression+')'))),fixtureLine);
});
test('route-free loopback transport preserves cache, bytes, range and fail-closed contracts',async t=>{
 const f=await serveFixture();try{
  await t.test('all three origins are distinct loopback HTTP endpoints',()=>{assert.equal(new Set(Object.values(f.origins)).size,3);for(const url of Object.values(f.origins))assert.equal(new URL(url).hostname,'127.0.0.1');});
  await t.test('fresh cache control + conditional ETag returns 304 without a body',async()=>{const a=await wire(f.app+'/__controls/cached'),b=await wire(f.app+'/__controls/cached',{headers:{'If-None-Match':a.headers.etag}});assert.equal(a.status,200);assert.equal(a.headers['cache-control'],'public, max-age=3600');assert.equal(b.status,304);assert.equal(b.body.length,0);assert.equal(b.headers.etag,a.headers.etag);});
  await t.test('stale-cache control requires revalidation',async()=>{const a=await wire(f.app+'/__controls/revalidate');assert.equal(a.headers['cache-control'],'public, max-age=0, must-revalidate');});
  await t.test('root and project documents serve the same current HTML with no-store',async()=>{const a=await wire(f.app+'/'),b=await wire(f.app+'/atlas-project/');assert.equal(a.status,200);assert.deepEqual(a.body,b.body);assert.equal(a.headers['cache-control'],'no-store');assert.ok(a.body.toString().includes('Railway Atlas'));});
  await t.test('production vendor renderer bytes remain byte-exact',async()=>{const path='/vendor/maplibre-gl-5.24.0-atlas.1.js',a=await wire(f.app+path);assert.deepEqual(a.body,await readFile('source/styles'+path));});
  await t.test('only declared provider origins relocate; provenance records original/served hashes',async()=>{const a=await wire(f.app+'/world.style.json'),source=await readFile('source/styles/world.style.json');assert.deepEqual(a.body,f.relocate(source));assert.equal(f.relocations.get('world.style.json').originalSha256,sha256(source));assert.ok(a.body.toString().includes(f.origins['https://openrailwaymap.app']));assert.ok(!a.body.toString().includes('https://openrailwaymap.app'));});
  await t.test('CSP allows only the synthetic loopback origins for connect',async()=>{const a=await wire(f.app+'/');const csp=a.headers['content-security-policy'];assert.ok(csp.includes("object-src 'none'"));assert.ok(!csp.includes('https:'));for(const origin of Object.values(f.origins))assert.ok(csp.includes(origin));});
  await t.test('PMTiles response and range bytes match accepted fixture exactly',async()=>{const base=f.origins['https://tuiles.enliberte.fr'];const a=await wire(base+'/planet.pmtiles'),b=await wire(base+'/planet.pmtiles',{headers:{range:'bytes=0-126'}}),c=await wire(base+'/planet.pmtiles',{headers:{range:'bytes=9999-10000'}});assert.deepEqual(a.body,emptyPmtiles);assert.equal(b.status,206);assert.deepEqual(b.body,emptyPmtiles.subarray(0,127));assert.equal(c.status,416);});
  await t.test('known empty tiles are successful exact empty bodies',async()=>{const a=await wire(f.origins['https://openrailwaymap.app']+'/railway_line_high/14/0/0');assert.equal(a.status,200);assert.equal(a.body.length,0);assert.equal(a.headers['content-type'],'application/x-protobuf');});
  await t.test('known nonempty fixture tile contains actual encoded bytes',async()=>{const a=await wire(f.origins['https://openrailwaymap.app']+'/railway_line_high/14/13396/6729');assert.equal(a.status,200);assert.ok(a.body.length>0);});
  await t.test('unknown origin path and forbidden metadata fail instead of fake success',async()=>{for(const path of ['/anything/0/0/0','/railway_line_high'])assert.equal((await wire(f.origins['https://openrailwaymap.app']+path)).status,500);assert.equal(f.unknown.length,2);});
  await t.test('HEAD has no transmitted entity and preserves entity length',async()=>{const a=await wire(f.app+'/app.css',{method:'HEAD'});assert.equal(a.body.length,0);assert.ok(Number(a.headers['content-length'])>0);});
  await t.test('deny proxy rejects HTTP and CONNECT without forwarding',async()=>{assert.equal((await wire(f.proxy,{headers:{host:'synthetic.invalid'}})).status,403);const code=await new Promise((resolve,reject)=>{const q=request(f.proxy,{method:'CONNECT',path:'synthetic.invalid:443'});q.on('connect',(r,s)=>{s.destroy();resolve(r.statusCode);});q.on('error',reject);q.end();});assert.equal(code,403);assert.equal(f.denied.length,2);});
  await t.test('ledger retains status, body size and completed HTTP lifecycle',async()=>{await new Promise(r=>setImmediate(r));assert.ok(f.requests.length>15);for(const r of f.requests){assert.ok(Number.isFinite(r.finishMs));assert.equal(r.prematureClose,false);if(r.status!==500)assert.ok(Number.isFinite(r.bodyBytes));}});
 }finally{await f.close();}
});
