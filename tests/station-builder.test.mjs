import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as zlib from 'node:zlib';
import vm from 'node:vm';
import * as acquisition from '../scripts/station-acquisition.mjs';
import * as overview from '../scripts/station-overview.mjs';

const source=await fs.readFile(new URL('../scripts/build-station-snapshot.mjs',import.meta.url),'utf8');
const node=(id,lon,lat)=>({type:'node',id,lon,lat,version:1,timestamp:'2026-10-19T00:00:00Z',tags:{railway:'station',name:'Synthetic station'}});
const response=(status,body)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status});
// Synthetic OSM3S diagnostic, not a captured response from a public service.
const html=message=>`<html><head><title>OSM3S Response</title></head><body><p>${'Synthetic preamble. '.repeat(20)}</p><p><strong>Error</strong>: ${message}</p></body></html>`;
const resourceErrors=[
 ['execution timeout','runtime error: Query timed out in "query" at line 1 after 120 seconds.'],
 ['memory limit','runtime error: Query run out of memory using about 64 MB of RAM.'],
];

// Execute the actual entrypoint with real query, checkpoint and tile modules.
// Only fetch, the filesystem root and wall-clock timers are controlled.
async function run(t,reply,{state,records}={}){
 const root=await fs.mkdtemp(join(tmpdir(),'station-builder-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const first=acquisition.newStationAcquisition();
 const seed=acquisition.applyStationRegion(first,[],first.pending[0].box,{elements:[node(1,-170,-80)]});
 state??=seed.state;records??=seed.records;
 await fs.mkdir(join(root,'previous'));
 await fs.writeFile(join(root,'previous/state.json'),JSON.stringify(state));
 await fs.writeFile(join(root,'previous/stations.json.gz'),zlib.gzipSync(JSON.stringify(records)));
 const calls=[],warnings=[],timers=new Set();
 const io=Object.fromEntries(['mkdir','readFile','writeFile','rm'].map(name=>[name,(path,...args)=>fs[name](join(root,path),...args)]));
 const context=vm.createContext({
  process:{env:{PREVIOUS_DATA:'previous',OVERPASS_URL:'https://overpass.fixture.invalid/api/interpreter'}},
  URL,URLSearchParams,Buffer,AbortController,
  setTimeout:(_callback,ms)=>{assert.equal(ms,180000);const id={};timers.add(id);return id;},
  clearTimeout:id=>assert.equal(timers.delete(id),true),
  console:{log(){},warn:(...args)=>warnings.push(args.join(' '))},
  fetch:async(url,options)=>{
   assert.equal(url.href,'https://overpass.fixture.invalid/api/interpreter');
   assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
   assert.equal(options.body.get('data'),acquisition.stationRegionQuery(state.pending[0].box));
   calls.push(options);assert.equal(calls.length,1,'at most one query per maintenance run');
   return reply();
  },
 });
 const dependencies={'node:fs/promises':io,'node:path':{join},'node:zlib':zlib,
  './station-acquisition.mjs':acquisition,'./station-overview.mjs':overview};
 const module=new vm.SourceTextModule(source,{context});
 await module.link(specifier=>{
  const values=dependencies[specifier];assert.ok(values,`unexpected import ${specifier}`);
  return new vm.SyntheticModule(Object.keys(values),function(){
   for(const [key,value] of Object.entries(values))this.setExport(key,value);
  },{context});
 });
 await module.evaluate();
 assert.equal(timers.size,0,'request deadline is cleared after every outcome');
 const read=async path=>JSON.parse(await fs.readFile(join(root,'station-snapshot',path),'utf8'));
 return {root,calls,warnings,initial:state,original:records,state:await read('state.json'),
  records:JSON.parse(zlib.gunzipSync(await fs.readFile(join(root,'station-snapshot/stations.json.gz')))),
  manifest:await read('manifest.json'),index:await read('index.json')};
}

function checkSplit(result,status){
 assert.equal(result.calls.length,1);
 assert.deepEqual(result.state,acquisition.postponeStationRegion(result.initial,result.initial.pending[0].box));
 assert.deepEqual(result.records,result.original);
 assert.equal(acquisition.checkStationAcquisition(result.state,result.records),true);
 assert.equal(result.manifest.complete,false);assert.equal(result.manifest.regionUpdated,false);
 assert.equal(result.manifest.status,status);
 assert.deepEqual(result.index,{tiles:[]},'a split cannot publish incomplete station tiles');
}
function checkDeferred(result){
 assert.equal(result.calls.length,1);
 assert.deepEqual(result.state,result.initial);
 assert.deepEqual(result.records,result.original);
 assert.equal(result.manifest.complete,false);assert.equal(result.manifest.regionUpdated,false);
 assert.equal(result.manifest.status,'retry next maintenance run');
 assert.deepEqual(result.index,{tiles:[]});
}

for(const [name,message] of resourceErrors)for(const status of [200,500,502,504]){
 test(`station builder checkpoints subdivision after HTTP ${status} ${name}`,async t=>{
  const body=status===200?JSON.stringify({elements:[],remark:message}):html(message);
  const result=await run(t,()=>response(status,body));
  checkSplit(result,'split provider-rejected oversized region');
  assert.equal(result.manifest.requestBytes,Buffer.byteLength(body));
 });
}

for(const [name,status,body] of [
 ['capacity gateway',502,html('Gateway Timeout. All query workers are busy and the request queue is full.')],
 ['generic gateway timeout',504,'Gateway Timeout'],
 ['dispatcher timeout',504,html('runtime error: open64: 0 Success /osm3s_osm_base Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy to handle your request.')],
 ['busy JSON remark',200,JSON.stringify({elements:[],remark:'runtime error: Dispatcher_Client timed out. The server is too busy.'})],
 ['capacity takes precedence',504,html('Request queue is full. runtime error: Query timed out in "query" at line 1 after 120 seconds.')],
 ['rate limit',429,html(resourceErrors[0][1])],
 ['unavailable',503,html(resourceErrors[1][1])],
 ['bad query',400,html(resourceErrors[1][1])],
 ['forbidden',403,html(resourceErrors[0][1])],
 ['invalid JSON',200,'{"elements":['],
 ['unrecognized remark',200,JSON.stringify({elements:[],remark:'Unexpected maxsize setting'})],
]){
 test(`station builder retains the region after ${name}`,async t=>{
  const result=await run(t,()=>response(status,body));
  checkDeferred(result);
  assert.equal(result.manifest.requestBytes,Buffer.byteLength(body));
 });
}

test('failed response bodies have a small independent limit and cancel their stream',async t=>{
 let chunks=0,cancelled=false;
 const result=await run(t,()=>new Response(new ReadableStream({
  pull(controller){chunks++;assert.ok(chunks<12,'error body must not consume the data-response allowance');controller.enqueue(new Uint8Array(16384).fill(65));},
  cancel(){cancelled=true;},
 }),{status:502}));
 checkDeferred(result);assert.equal(cancelled,true);
 assert.ok(result.manifest.requestBytes>64*1024&&result.manifest.requestBytes<=80*1024);
});

test('network abort preserves progress without splitting or immediate retry',async t=>{
 const result=await run(t,()=>{throw new DOMException('Synthetic deadline','AbortError');});
 checkDeferred(result);assert.equal(result.manifest.requestBytes,0);
});

test('subdivision at the depth limit preserves the original checkpoint',async t=>{
 const initial=acquisition.newStationAcquisition();
 for(const row of initial.pending)row.depth=6;
 const result=await run(t,()=>response(504,html(resourceErrors[0][1])),{state:initial,records:[]});
 checkDeferred(result);assert.match(result.warnings[0],/after 6 splits/);
});

test('a truncated HTTP diagnostic cannot justify a subdivision',async t=>{
 const result=await run(t,()=>new Response(new ReadableStream({
  start(controller){controller.enqueue(new TextEncoder().encode(html(resourceErrors[0][1])));controller.error(new Error('Synthetic response truncation'));},
 }),{status:504}));
 checkDeferred(result);assert.match(result.warnings[0],/Synthetic response truncation/);
});

test('the existing oversized-success limit still checkpoints a split without accepting rows',async t=>{
 let cancelled=false;
 const result=await run(t,()=>new Response(new ReadableStream({
  pull(controller){controller.enqueue(new Uint8Array(1024*1024).fill(65));},
  cancel(){cancelled=true;},
 }),{status:200}));
 checkSplit(result,'split oversized region');assert.equal(cancelled,true);
 assert.equal(result.manifest.requestBytes,16*1024*1024);
});

test('HTTP failure cannot complete the final pending region or replace the complete release',async t=>{
 const initial=acquisition.newStationAcquisition();
 const state={...initial,pending:initial.pending.slice(0,1),completed:initial.pending.slice(1).map(({box})=>({box,count:0}))};
 const result=await run(t,()=>response(504,html(resourceErrors[0][1])),{state,records:[]});
 checkSplit(result,'split provider-rejected oversized region');
 assert.equal(result.state.pending.length,4);
});

test('a successful final region still builds the real complete tile generation',async t=>{
 const initial=acquisition.newStationAcquisition();
 const state={...initial,pending:initial.pending.slice(0,1),completed:initial.pending.slice(1).map(({box})=>({box,count:0}))};
 const result=await run(t,()=>response(200,{elements:[node(2,-170,-80)]}),{state,records:[]});
 assert.equal(result.manifest.complete,true);assert.equal(result.manifest.regionUpdated,true);
 assert.equal(result.manifest.stations,1);assert.equal(result.state.pending.length,0);
 assert.equal(acquisition.stationWorldCoverage(result.state.completed),true);
 assert.equal(result.index.zoom,3);assert.ok(result.index.bundles.length>0);
 assert.ok(result.manifest.tiles>0&&result.manifest.bundles>0);
});
