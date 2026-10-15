import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {summarizeServiceAcquisition} from '../styles/service-status.mjs';
import {needsServiceAcquisition} from '../scripts/service-acquisition-trigger.mjs';
import {REPOSITORY,SOURCE_URL,PUBLISHED_URL,MAX_BYTES,trustedStatusRun,sourceFacts,publishedFacts,readStatusJson,evaluateStatusDelivery} from '../scripts/service-status-delivery.mjs';
const sha='a'.repeat(64);
const event=()=>({repository:{full_name:REPOSITORY},workflow_run:{id:123,head_sha:'a'.repeat(40),repository:{full_name:REPOSITORY},head_repository:{full_name:REPOSITORY},name:'Build urban rail services',path:'.github/workflows/service-routes.yml',head_branch:'main',status:'completed',conclusion:'success'}});
const source=()=>({generated:'2026-10-15T00:00:00Z',run:{fetchedBoxes:0},stages:[{name:'world',label:'Rest of the world',completed:'2026-10-01T00:00:00Z',inProgress:false,lastAttempt:{status:'acquired',at:'2026-10-01T00:00:00Z'},geometry:{status:'complete',sourceStatus:'complete',sourceOutcome:{status:'complete'}},routes:2,retainedRelations:2}]});
const published=manifest=>({schema:3,profiles:['am'],osmSnapshotSha256:sha,acquisition:summarizeServiceAcquisition(manifest,sha)});
function fixture(current,served){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push(url);assert.ok([SOURCE_URL,PUBLISHED_URL].includes(url));
  assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.headers.authorization,undefined);
  return new Response(JSON.stringify(url===SOURCE_URL?current:served),{headers:{'content-type':'application/json'}});
 };
 return {calls,fetchImpl};
}
async function compare(current,served){const f=fixture(current,served);return {...f,...await evaluateStatusDelivery(event(),{fetchImpl:f.fetchImpl})};}

test('zero-box deferred transition requests delivery using only fixed first-party metadata',async()=>{
 const before=source(),after=structuredClone(before);Object.assign(after.stages[0],{inProgress:true,lastAttempt:{status:'deferred',at:'2026-10-15T01:00:00Z'}});
 const result=await compare(after,published(before));
 assert.equal(result.changed,true);assert.deepEqual(result.calls,[SOURCE_URL,PUBLISHED_URL]);
 assert.equal(MAX_BYTES,8*1024*1024);
});

test('identical retry timestamps, counters and error details do not redeploy',async()=>{
 const before=source();Object.assign(before.stages[0],{inProgress:true,lastAttempt:{status:'deferred',at:'2026-10-15T01:00:00Z'}});
 const after=structuredClone(before);after.generated='2026-10-15T02:00:00Z';
 Object.assign(after.stages[0].lastAttempt,{at:'2026-10-15T02:00:00Z',reason:'different synthetic transport failure',requests:5,downloadedBytes:1234});
 Object.assign(after.stages[0].geometry,{attempts:20,counts:{unknown:99},details:['not part of delivery facts']});
 after.stages[0].routes=3;after.stages[0].retainedRelations=3;
 assert.equal((await compare(after,published(before))).changed,false);
 assert.deepEqual(sourceFacts(after),publishedFacts(published(before)));
});

test('eligibility recovery, accepted-empty and retained-snapshot changes remain meaningful',async()=>{
 const before=source();Object.assign(before.stages[0].geometry,{status:'incomplete',sourceOutcome:{status:'incomplete'}});
 assert.equal((await compare(source(),published(before))).changed,true);
 const empty=source();empty.stages[0].routes=empty.stages[0].retainedRelations=0;
 assert.equal((await compare(empty,published(source()))).changed,true);
 const retained=source();retained.stages[0].completed=null;
 assert.equal((await compare(retained,published(source()))).changed,true);
});

test('legacy published status upgrades only for meaningful source facts, but known-to-unknown is delivered',async()=>{
 const legacy={schema:3,profiles:['am']},unknown=source();
 Object.assign(unknown.stages[0],{completed:null,inProgress:false,lastAttempt:null,geometry:null});
 assert.equal((await compare(source(),legacy)).changed,true);
 assert.equal((await compare(unknown,legacy)).changed,false);
 assert.equal((await compare(unknown,published(source()))).changed,true);
 const explicitUnknown={schema:3,profiles:[],acquisition:{schema:1,status:'unknown',stages:[]}};
 assert.equal((await compare(unknown,explicitUnknown)).changed,false);
});

test('positive fetched-box runs remain exclusively with the existing producer dispatch',async()=>{
 const current=source();current.run.fetchedBoxes=1;
 const result=await compare(current,null);
 assert.equal(result.changed,false);assert.equal(result.reason,'producer-already-handles-fetched-data');
 assert.deepEqual(result.calls,[SOURCE_URL]);
});

test('missing and malformed source/run/publication metadata fail closed',async()=>{
 for(const bad of [null,{}, {...source(),stages:null},{...source(),stages:[]}, {...source(),run:null},
  ...[null,undefined,'0',-1,0.5].map(fetchedBoxes=>({...source(),run:{fetchedBoxes}}))])
  await assert.rejects(compare(bad,published(source())));
 for(const mutate of [s=>s.stages.push(structuredClone(s.stages[0])),s=>s.stages[0].inProgress='true',s=>s.stages[0].routes=-1,s=>s.stages[0].completed='bad date',s=>s.stages[0].lastAttempt={status:'invented'}]){
  const bad=source();mutate(bad);await assert.rejects(compare(bad,published(source())));
 }
 for(const bad of [null,{}, {schema:3}, {...published(source()),osmSnapshotSha256:'b'.repeat(64)}, {...published(source()),acquisition:null}])
  await assert.rejects(compare(source(),bad));
});

test('HTTP, transport, malformed JSON and oversized bodies never yield a decision to dispatch',async()=>{
 for(const fetchImpl of [async()=>{throw new Error('synthetic transport failure');},async()=>new Response('',{status:503}),async()=>new Response('',{status:302,headers:{location:'https://provider.invalid/'}}),async()=>new Response('{')])
  await assert.rejects(evaluateStatusDelivery(event(),{fetchImpl}));
 for(const headers of [{},{'content-length':'9'}])
  await assert.rejects(readStatusJson(SOURCE_URL,{maxBytes:8,fetchImpl:async()=>new Response('123456789',{headers})}),/size limit/);
 await assert.rejects(readStatusJson('https://provider.invalid/metadata',{fetchImpl:async()=>{throw new Error('must not fetch');}}),/Unapproved/);
});

test('invalid UTF-8 and interrupted or truncated streams fail closed',async()=>{
 const invalidUtf8=new Uint8Array([0x7b,0x22,0x78,0x22,0x3a,0x22,0xc3,0x28,0x22,0x7d]);
 await assert.rejects(readStatusJson(SOURCE_URL,{fetchImpl:async()=>new Response(invalidUtf8)}),/Invalid JSON/);
 const encoder=new TextEncoder();
 for(const interrupted of [false,true]){
  let delivered=false;
  const stream=new ReadableStream({pull(controller){
   if(!delivered){delivered=true;controller.enqueue(encoder.encode('{"stages":['));return;}
   if(interrupted)controller.error(new DOMException('Synthetic aborted body','AbortError'));
   else controller.close();
  }});
  await assert.rejects(evaluateStatusDelivery(event(),{fetchImpl:async()=>new Response(stream)}),
   interrupted?{name:'AbortError'}:/Invalid JSON/);
 }
});

test('workflow trust checks reject forks, other workflows, unfinished/failed runs and non-main branches before any read',async()=>{
 const changes=[e=>e.repository.full_name='fork/repo',e=>e.workflow_run.repository.full_name='fork/repo',e=>e.workflow_run.head_repository.full_name='fork/repo',
  e=>e.workflow_run.head_branch='feature',e=>e.workflow_run.status='in_progress',e=>e.workflow_run.conclusion='failure',
  e=>e.workflow_run.name='Other workflow',e=>e.workflow_run.path='.github/workflows/other.yml',e=>e.workflow_run.head_sha='invalid',e=>e.workflow_run.id=0];
 assert.equal(trustedStatusRun(event()),true);
 for(const change of changes){
  const bad=event();change(bad);assert.equal(trustedStatusRun(bad),false);
  const result=await evaluateStatusDelivery(bad,{fetchImpl:async()=>{assert.fail('untrusted run cannot fetch');}});
  assert.equal(result.changed,false);
 }
 for(const options of [{eventName:'push'},{repository:'fork/repo'}]){
  const result=await evaluateStatusDelivery(event(),{...options,fetchImpl:async()=>{assert.fail('untrusted context cannot fetch');}});
  assert.equal(result.changed,false);
 }
});

test('independent observer has no acquisition command or altered producer trigger',async()=>{
 assert.equal(needsServiceAcquisition('push',[
  '.github/workflows/service-status.yml','scripts/service-status-delivery.mjs','tests/service-status-delivery.test.mjs',
  'styles/service-status.mjs','scripts/rebuild-service-frequency.mjs','scripts/service-status-manifest.mjs','tests/service-status.test.mjs'
 ]),false);
 // Positive control: this assertion uses the unchanged production selector.
 assert.equal(needsServiceAcquisition('push',['scripts/build-service-routes.mjs']),true);
 const workflow=await readFile(new URL('../.github/workflows/service-status.yml',import.meta.url),'utf8');
 assert.match(workflow,/workflow_run:/);assert.match(workflow,/workflows: \['Build urban rail services'\]/);
 assert.match(workflow,/branches: \[main\]/);assert.match(workflow,/types: \[completed\]/);
 assert.match(workflow,/cancel-in-progress: false/);assert.match(workflow,/persist-credentials: false/);
 assert.match(workflow,/node --test tests\/service-status-delivery\.test\.mjs/);
 assert.match(workflow,/node scripts\/service-status-delivery\.mjs/);
 assert.doesNotMatch(workflow,/schedule:|workflow_dispatch:|build-service-routes\.mjs|service-acquisition-trigger\.mjs|npm ci|curl |git (?:fetch|clone)/);
});
