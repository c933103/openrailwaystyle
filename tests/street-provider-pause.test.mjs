import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
const epoch=Date.parse('2026-11-07T00:00:00Z');
const source=await readFile(new URL('../scripts/build-street-running.mjs',import.meta.url),'utf8');
const query=/const query='([^']+)'/.exec(source)[1];
async function run(t,{header='420',body='remark',previous=false,bodyMs=0,wallShift=0,oversleep=0}={}){
 const dir=await mkdtemp(join(tmpdir(),'street-provider-pause-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const retained=gzipSync(JSON.stringify([{type:'way',id:1,tags:{embedded:'yes'},geometry:[{lon:0,lat:0},{lon:.001,lat:.001}]}]));
 await writeFile(join(dir,'elements.json.gz'),retained);
 await writeFile(join(dir,'manifest.json'),JSON.stringify({osmBase:'2026-11-01T00:00:00Z',query:query.replace('way[embedded_rails];','')}));
 const fixture=join(dir,'fake.mjs'),log=join(dir,'requests');
 await writeFile(fixture,`import fs from 'node:fs';
 let elapsed=0,shift=0,calls=0,oversleep=${oversleep};Date.now=()=>${epoch}+elapsed+shift;
 Object.defineProperty(performance,'now',{value:()=>elapsed});
 globalThis.setTimeout=(f,ms,...args)=>{elapsed+=ms+oversleep;oversleep=0;f(...args);return 0;};
 globalThis.fetch=async(url,{body:query})=>{
  fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({url:String(url),at:elapsed,query:query.get('data')})+'\\n');
  if(++calls>1)return new Response('busy',{status:503});
  const headers={'retry-after':${JSON.stringify(header)}};
  ${previous?`return new Response('<osm><meta osm_base="2026-11-06T00:00:00Z"/></osm>',{headers});`:
  body==='http'?`return new Response('busy',{status:503,headers});`:
  body==='read-error'?`return new Response(new ReadableStream({start(c){c.error(new Error('body interrupted'));}}),{headers});`:
  `const response=new Response(${JSON.stringify(body==='malformed'?'{':body==='empty'?' {"elements":[]}':JSON.stringify({remark:'runtime error: Query timed out'}))},{headers});
   const json=response.json.bind(response);response.json=()=>{elapsed+=${bodyMs};shift+=${wallShift};return json();};return response;`}
 };
 `);
 const env={...process.env};delete env.PREVIOUS_DATA;if(previous)env.PREVIOUS_DATA=dir;
 const result=spawnSync(process.execPath,['--import',fixture,fileURLToPath(new URL('../scripts/build-street-running.mjs',import.meta.url))],{env,encoding:'utf8',timeout:10000});
 assert.equal(result.error,undefined,result.error?.message);assert.notEqual(result.status,0,'unusable input must not publish');
 assert.deepEqual(await readFile(join(dir,'elements.json.gz')),retained,'previous source is unchanged');
 return {result,requests:(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse)};
}
for(const body of ['remark','malformed','read-error','http'])test(`street retry respects headers after ${body}`,async t=>{
 const {requests}=await run(t,{body});assert.equal(requests.length,3);assert.equal(requests[1].at,420000);assert.equal(requests[2].at,540000);
 assert.ok(requests.every(r=>r.query===query));
});
test('street HTTP-date pause includes body time without resetting at failure',async t=>{
 const {requests}=await run(t,{header:new Date(epoch+420000).toUTCString(),bodyMs:80000});assert.equal(requests[1].at,420000);
});
test('street wall-clock correction cannot shorten an observed pause',async t=>{
 const {requests}=await run(t,{wallShift:3600000});assert.equal(requests[1].at,420000);
});
test('street successful change headers pause the next selection within the six-minute change window',async t=>{
 const {requests}=await run(t,{previous:true,header:'120'});assert.equal(requests.length,5);
 assert.match(requests[0].query,/^\[out:xml\]/);assert.match(requests[1].query,/out ids;/);
 assert.equal(requests[1].at,120000);assert.equal(requests[2].at,240000);
});
test('street a pause beyond the change window defers selection and is retained by full fallback',async t=>{
 const {requests}=await run(t,{previous:true});assert.equal(requests.length,4);
 assert.equal(requests[1].query,query);assert.equal(requests[1].at,420000);
});
for(const previous of [false,true])test(`street excessive pause stops all further provider requests (previous=${previous})`,async t=>{
 const {requests,result}=await run(t,{header:'86400',previous});assert.equal(requests.length,1);assert.match(result.stderr,/budget|time/i);
});
test('street a pause and full request must fit the existing 45-minute acquisition envelope',async t=>{
 const {requests}=await run(t,{header:'2041'});assert.equal(requests.length,1);
});
test('street exact 45-minute pause-plus-request boundary permits one next request',async t=>{
 const {requests}=await run(t,{header:'2040'});assert.equal(requests[1].at,2040000);
});
test('street rechecks the envelope after an overslept timer',async t=>{
 const {requests}=await run(t,{oversleep:2400000});assert.equal(requests.length,1);
});
for(const header of ['soon','-1','Fri, 06 Nov 2026 00:00:00 GMT'])test(`street invalid or past pause retains the two-minute backoff: ${header}`,async t=>{
 const {requests}=await run(t,{header});assert.deepEqual(requests.map(r=>r.at),[0,120000,240000]);
});
test('street final complete response requires no future-request wait',async t=>{
 const {requests,result}=await run(t,{header:'86400',body:'empty'});assert.equal(requests.length,1);assert.match(result.stderr,/Suspiciously small/);
});
