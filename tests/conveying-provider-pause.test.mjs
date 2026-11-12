import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {CONVEYING_QUERY,AERIALWAY_QUERY} from '../scripts/conveying-data.mjs';

const epoch=Date.parse('2026-11-06T12:00:00Z');
async function run(t,builder,{header='420',body='remark',previous=false,bodyMs=0,wallShift=0,earlyWake=false}={}) {
 const dir=await mkdtemp(join(tmpdir(),'conveying-provider-pause-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const query=builder==='conveying'?CONVEYING_QUERY:AERIALWAY_QUERY;
 const tags=builder==='conveying'?{highway:'elevator'}:{aerialway:'gondola'};
 const retained=gzipSync(JSON.stringify([{type:'way',id:1,tags,geometry:[{lon:0,lat:0},{lon:.001,lat:.001}]}]));
 await writeFile(join(dir,'elements.json.gz'),retained);
 await writeFile(join(dir,'manifest.json'),JSON.stringify({osmBase:'2026-11-01T00:00:00Z',query:builder==='conveying'?query.replace('way[highway=elevator];',''):query.replace('|platter','')}));
 const fixture=join(dir,'fake.mjs'),requests=join(dir,'requests');
 await writeFile(fixture,`import fs from 'node:fs';
 let elapsed=0,shift=0,calls=0,woke=false;
 Date.now=()=>${epoch}+elapsed+shift;
 Object.defineProperty(globalThis,'performance',{value:{now:()=>elapsed}});
 globalThis.setTimeout=(f,ms,...args)=>{elapsed+=${earlyWake}&&!woke&&ms?(woke=true,ms/2):ms;f(...args);return 0;};
 globalThis.fetch=async(url,{body:query})=>{
  fs.appendFileSync(${JSON.stringify(requests)},JSON.stringify({at:elapsed,query:query.get('data')})+'\\n');
  if(++calls>1)return new Response('busy',{status:503});
  const headers={'retry-after':${JSON.stringify(header)}};
  const response=${body==='http'?`new Response('busy',{status:503,headers})`:
   previous?`new Response('<osm><meta osm_base="2026-11-06T00:00:00Z"/></osm>',{headers})`:
   body==='read-error'?`new Response(new ReadableStream({start(c){c.error(new Error('body interrupted'));}}),{headers})`:
   `new Response(${JSON.stringify(body==='malformed'?'{':body==='empty'?' {"elements":[]}':JSON.stringify({remark:'runtime error: Query timed out'}))},{headers})`};
  let consumed=false;const consume=()=>{if(!consumed){consumed=true;elapsed+=${bodyMs};shift+=${wallShift};}};
  for(const method of ['text','json']){const original=response[method].bind(response);response[method]=()=>{consume();return original();};}
  const getReader=response.body.getReader.bind(response.body);response.body.getReader=()=>{const reader=getReader();return{
   read:()=>{consume();return reader.read();},cancel:()=>reader.cancel(),releaseLock:()=>reader.releaseLock(),
  };};return response;
 };
 `);
 const env={...process.env};delete env.PREVIOUS_DATA;if(previous)env.PREVIOUS_DATA=dir;
 const result=spawnSync(process.execPath,['--import',fixture,fileURLToPath(new URL(`../scripts/build-${builder==='conveying'?'conveying':'aerialways'}.mjs`,import.meta.url))],{env,encoding:'utf8',timeout:10000});
 assert.equal(result.error,undefined,result.error?.message);
 assert.notEqual(result.status,0,'deliberately unusable source must not publish');
 assert.deepEqual(await readFile(join(dir,'elements.json.gz')),retained,'retained source is unchanged');
 return {result,requests:(await readFile(requests,'utf8')).trim().split('\n').map(JSON.parse)};
}
for(const builder of ['conveying','aerialway']) {
 for(const body of ['remark','malformed','read-error'])test(`${builder}: successful headers pause retries after ${body}`,async t=>{
  const {requests}=await run(t,builder,{body});
  assert.equal(requests.length,3);
  assert.equal(requests[1].at,420000);
  assert.equal(requests[2].at,660000,'existing second admission backoff remains 240 seconds');
 });
 test(`${builder}: successful change headers pause the next selection request`,async t=>{
  const {requests}=await run(t,builder,{previous:true});
  assert.equal(requests.length,3);
  assert.match(requests[0].query,/^\[out:xml\]/);
  assert.match(requests[1].query,/out ids;/);
  assert.equal(requests[1].at,420000);
 });
 test(`${builder}: HTTP-date pause is measured at headers, including body time`,async t=>{
  const {requests}=await run(t,builder,{header:new Date(epoch+420000).toUTCString(),bodyMs:80000});
  assert.equal(requests[1].at,420000);
 });
 test(`${builder}: too-long successful response pause defers without another request`,async t=>{
  const {requests,result}=await run(t,builder,{header:'86400'});
  assert.equal(requests.length,1);
  assert.match(result.stderr,/52-minute budget/);
 });
 test(`${builder}: successful final body does not wait without another request`,async t=>{
  const {requests,result}=await run(t,builder,{header:'86400',body:'empty'});
  assert.equal(requests.length,1);
  assert.match(result.stderr,/Suspiciously small/,'normal content validation is preserved');
 });
 test(`${builder}: invalid and HTTP error headers retain existing retry behavior`,async t=>{
  assert.equal((await run(t,builder,{header:'soon'})).requests[1].at,120000);
  assert.equal((await run(t,builder,{body:'http'})).requests[1].at,420000);
 });
}

for(const builder of ['conveying','aerialway']) {
 for(const [name,header] of [['invalid day','Tue, 31 Nov 2026 12:00:00 GMT'],['invalid weekday','Foo, 06 Nov 2026 12:07:00 GMT']]) {
  for(const body of ['http','read-error']) test(`${builder}: ${name} cannot defer ${body} recovery`,async t=>{
   const {requests}=await run(t,builder,{header,body});
   assert.equal(requests.length,3,'malformed date does not prematurely exhaust the acquisition window');
   assert.equal(requests[1].at,120000,'only the existing retry backoff applies');
   assert.equal(requests[2].at,360000,'existing second admission backoff remains in place');
  });
 }
}

for(const builder of ['conveying','aerialway']) {
 for(const previous of [false,true]) {
  for(const bodyMs of [80000,500000])test(`${builder}: HTTP seconds pause is consumed, not restarted, after ${bodyMs}ms body (${previous?'change fallback':'full retry'})`,async t=>{
   const {requests}=await run(t,builder,{body:'http',previous,bodyMs});
   assert.equal(requests.length,3);assert.equal(requests[1].at,Math.max(420000,bodyMs+120000));
   assert.equal(requests[2].at,requests[1].at+(previous?120000:240000),'existing admission schedule is unchanged');
  });
  for(const wallShift of [-3600000,3600000])test(`${builder}: HTTP-date retry keeps its header deadline through ${wallShift}ms clock correction (${previous?'change fallback':'full retry'})`,async t=>{
   const {requests}=await run(t,builder,{body:'http',previous,header:new Date(epoch+420000).toUTCString(),bodyMs:80000,wallShift});
   assert.equal(requests.length,3);assert.equal(requests[1].at,420000);
  });
 }
 for(const path of ['HTTP retry','parse retry','change fallback'])test(`${builder}: early ${path} timer preserves local backoff without provider pause`,async t=>{
  const {requests}=await run(t,builder,{body:path==='parse retry'?'malformed':'http',previous:path==='change fallback',header:'soon',earlyWake:true});
  assert.equal(requests.length,3);assert.equal(requests[1].at,120000);
 });
}
