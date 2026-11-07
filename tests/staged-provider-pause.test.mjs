import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync, gunzipSync} from 'node:zlib';
import {STAGES, quarters, toFeatures, writeTable as writeBranches} from '../scripts/branch-lines.mjs';
import {addResult, commitStage, toTable, writeTable as writeServices} from '../scripts/service-routes.mjs';
import {OSM_UPDATES} from '../scripts/osm-update-plan.mjs';
const epoch = Date.parse('2026-11-07T00:00:00Z');
const body = {osm3s: {timestamp_osm_base: '2026-11-06T00:00:00Z'}, elements: [
  {type:'relation', id:1, version:1, tags:{route:'subway', ref:'1'}, members:[{type:'way', ref:10, role:''}]},
  {type:'way', id:10, version:1, tags:{railway:'subway'}, nodes:[1,2], geometry:[{lon:139.7,lat:35.68},{lon:139.71,lat:35.69}]},
]};
const queue = quarters(STAGES[0].parts[0].box).slice(0,2).map(box => ({part:0,box,depth:1}));
const pipelines = [
  {name:'branch', script:'build-branch-lines.mjs', folder:'branch-data', file:'branch-lines.ndjson.gz', version:3,
    table:()=>writeBranches(new Map(toFeatures(body).map(f=>[f.id,{...f,stage:'japan'}])))},
  {name:'service', script:'build-service-routes.mjs', folder:'service-data', file:'service-routes.ndjson.gz', version:1,
    table:()=>{const t={routes:new Map(),ways:new Map()};addResult(t,toTable(body),'japan');commitStage(t,'japan');return writeServices(t);}},
];
async function run(t,pipeline,responses,{budget=100,oversleep=0,priorQueue=queue}={}) {
  const root=await mkdtemp(join(tmpdir(),'atlas-staged-pause-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await cp('scripts',join(root,'scripts'),{recursive:true});await mkdir(join(root,'styles'));
  for(const file of ['pbf-utf8.mjs','service-frequency.mjs'])await cp(`styles/${file}`,join(root,'styles',file));
  await symlink(resolve('node_modules'),join(root,'node_modules'),'dir');await mkdir(join(root,'previous'));
  const initial=pipeline.table(),state={version:pipeline.version,downloadStages:3,runs:[],stages:{
    ...Object.fromEntries(STAGES.map(s=>[s.name,{completed:new Date().toISOString(),pending:null,seen:[]}])),
    japan:{completed:'2026-10-01T00:00:00Z',started:'2026-11-06T00:00:00Z',pending:priorQueue,seen:[]},
  }};
  await writeFile(join(root,'previous/state.json'),JSON.stringify(state));
  await writeFile(join(root,'previous',pipeline.file),gzipSync(initial));
  await writeFile(join(root,'mock.mjs'),`import fs from 'node:fs';
let elapsed=0,shift=0,calls=0,oversleep=${oversleep};const rows=${JSON.stringify(responses)};
Date.now=()=>${epoch}+elapsed+shift;Object.defineProperty(performance,'now',{value:()=>elapsed});
globalThis.setTimeout=(callback,ms)=>{fs.appendFileSync(${JSON.stringify(join(root,'sleeps'))},JSON.stringify(ms)+'\\n');elapsed+=ms;if(ms){elapsed+=oversleep;oversleep=0;}callback();return 0;};
globalThis.fetch=async(url,options)=>{
 fs.appendFileSync(${JSON.stringify(join(root,'requests'))},JSON.stringify({url,query:options.body.get('data'),at:elapsed})+'\\n');
 const next=rows[calls++];if(!next)throw Error('Unexpected fixture request');
 const response=new Response(next.text??JSON.stringify(next.body??${JSON.stringify(body)}),{status:next.status??200,headers:next.header===undefined?{}:{'retry-after':next.header}});
 const original=response.body.getReader.bind(response.body);response.body.getReader=()=>{const reader=original();let first=true;return{
  async read(){if(first){first=false;elapsed+=next.bodyMs??0;shift+=next.wallShift??0;if(next.readError)throw Error('interrupted body');}return reader.read();},
  cancel:()=>reader.cancel(),releaseLock:()=>reader.releaseLock(),
 };};return response;
};`);
  const env={...process.env,PREVIOUS_DATA:join(root,'previous'),OVERPASS_URL:'https://overpass.invalid/test',TIME_BUDGET_MINUTES:String(budget),GITHUB_OUTPUT:join(root,'output')};delete env.RAILWAY_WAYS_STORE;
  const child=spawnSync(process.execPath,['--import',join(root,'mock.mjs'),join(root,'scripts',pipeline.script)],{cwd:root,env,encoding:'utf8',timeout:15000});
  assert.equal(child.error,undefined,child.error?.message);assert.equal(child.status,0,child.stderr);
  const saved=JSON.parse(await readFile(join(root,pipeline.folder,'state.json'),'utf8'));
  return {initial,saved,attempt:saved.stages.japan.lastAttempt,requests:(await readFile(join(root,'requests'),'utf8')).trim().split('\n').map(JSON.parse),
    sleeps:(await readFile(join(root,'sleeps'),'utf8')).trim().split('\n').map(JSON.parse),table:gunzipSync(await readFile(join(root,pipeline.folder,pipeline.file))).toString(),output:await readFile(join(root,'output'),'utf8')};
}
for(const pipeline of pipelines){
 test(`${pipeline.name} provider pause carries successful headers to the next queued region`,async t=>{
  const r=await run(t,pipeline,[{header:'420'},{}]);assert.deepEqual(r.requests.map(x=>x.at),[0,420000]);assert.equal(r.attempt.status,'acquired');
 });
 for(const failure of [{status:503,text:'busy'},{readError:true}])test(`${pipeline.name} provider pause survives ${failure.status?'HTTP error':'interrupted successful body'}`,async t=>{
  const r=await run(t,pipeline,[{...failure,header:'420'},{},{}]);assert.deepEqual(r.requests.map(x=>x.at),[0,420000,435000]);
  assert.equal(r.requests[0].query,r.requests[1].query);assert.equal(r.attempt.splitBoxes,0);assert.equal(r.attempt.status,'acquired');
 });
 test(`${pipeline.name} provider pause survives query subdivision`,async t=>{
  const r=await run(t,pipeline,[{header:'420',status:504,text:'runtime error: Query timed out'},...Array(5).fill({})]);
  assert.equal(r.requests[1].at,420000);assert.equal(r.attempt.splitBoxes,1);assert.equal(r.attempt.fetchedBoxes,5);assert.equal(r.attempt.status,'acquired');
 });
 for(const header of [new Date(epoch+420000).toUTCString(),'Saturday, 07-Nov-26 00:07:00 GMT','Sat Nov  7 00:07:00 2026'])test(`${pipeline.name} provider HTTP date includes body time: ${header}`,async t=>{
  const r=await run(t,pipeline,[{header,bodyMs:80000},{}]);assert.deepEqual(r.requests.map(x=>x.at),[0,420000]);
 });
 test(`${pipeline.name} wall-clock correction cannot shorten an observed provider pause`,async t=>{
  const r=await run(t,pipeline,[{header:'420',wallShift:3600000},{}]);assert.equal(r.requests[1].at,420000);
 });
 for(const status of [200,503])test(`${pipeline.name} excessive provider pause checkpoints without further requests (HTTP ${status})`,async t=>{
  const r=await run(t,pipeline,[{header:'86400',status,text:status===503?'busy':JSON.stringify(body)}]);
  assert.equal(r.requests.length,1);assert.deepEqual(r.sleeps,[0]);assert.match(r.attempt.reason,/acquisition time budget/);
  assert.equal(r.attempt.splitBoxes,0);assert.equal(r.attempt.status,status===200?'partial':'deferred');
  assert.deepEqual(r.saved.stages.japan.pending,status===200?[queue[1]]:queue);
  if(status===503){assert.equal(r.table,r.initial);assert.equal(r.output,'publish=true\nredeploy=false\n');}
  assert.ok(r.attempt.downloadedBytes>0);assert.equal(r.saved.runs.at(-1).bytes,r.attempt.downloadedBytes);
 });
 test(`${pipeline.name} full next request must fit the configured acquisition window`,async t=>{
  const r=await run(t,pipeline,[{header:'421'}],{budget:12});assert.equal(r.requests.length,1);assert.match(r.attempt.reason,/time budget/);
 });
 test(`${pipeline.name} exact pause-plus-request boundary is allowed`,async t=>{
  const r=await run(t,pipeline,[{header:'420'},{}],{budget:12});assert.equal(r.requests[1].at,420000);assert.equal(r.attempt.status,'acquired');
 });
 test(`${pipeline.name} overslept timer rechecks the acquisition window`,async t=>{
  const r=await run(t,pipeline,[{header:'420'}],{budget:12,oversleep:1});assert.equal(r.requests.length,1);assert.match(r.attempt.reason,/time budget/);
 });
 for(const header of ['soon','-1','Fri, 06 Nov 2026 00:00:00 GMT'])test(`${pipeline.name} invalid or past provider pause preserves minimum quiet interval: ${header}`,async t=>{
  const r=await run(t,pipeline,[{header},{}]);assert.deepEqual(r.requests.map(x=>x.at),[0,15000]);assert.equal(r.attempt.status,'acquired');
 });
 test(`${pipeline.name} final successful response needs no future-request wait`,async t=>{
  const r=await run(t,pipeline,[{}, {header:'86400'}]);assert.equal(r.attempt.status,'acquired');assert.deepEqual(r.requests.map(x=>x.at),[0,15000]);
 });
}
test('shared provider-pause changes rebuild only their two fallback consumers',()=>{
 assert.deepEqual(OSM_UPDATES.filter(x=>x.paths.includes('scripts/staged-provider-pause.mjs')).map(x=>x.id),['branch-lines','service-routes']);
});
