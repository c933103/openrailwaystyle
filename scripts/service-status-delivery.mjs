// Observe existing metadata only. This workflow never acquires OSM/timetable data.
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {summarizeServiceAcquisition} from '../styles/service-status.mjs';

export const REPOSITORY='c933103/openrailwaystyle';
export const SOURCE_URL='https://raw.githubusercontent.com/c933103/openrailwaystyle/service-data/manifest.json';
export const PUBLISHED_URL='https://c933103.github.io/openrailwaystyle/data/service-routes/frequency-manifest.json';
export const MAX_BYTES=8*1024*1024;
const acquisitions=new Set(['partial','deferred','failed','acquired','unknown']);
const eligibilities=new Set(['unresolved','complete','unknown']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validDate=value=>value==null||typeof value==='string'&&Number.isFinite(Date.parse(value));
const validCount=value=>value==null||Number.isSafeInteger(value)&&value>=0;

export function trustedStatusRun(event,{eventName='workflow_run',repository=REPOSITORY}={}) {
 const run=event?.workflow_run;
 return eventName==='workflow_run'&&repository===REPOSITORY&&event?.repository?.full_name===REPOSITORY&&
  run?.repository?.full_name===REPOSITORY&&run?.head_repository?.full_name===REPOSITORY&&
  run.name==='Build urban rail services'&&run.path==='.github/workflows/service-routes.yml'&&
  run.head_branch==='main'&&run.status==='completed'&&run.conclusion==='success'&&
  Number.isSafeInteger(run.id)&&run.id>0&&/^[a-f0-9]{40}$/.test(run.head_sha||'');
}

function stableFacts(summary) {
 if(!Array.isArray(summary?.stages)||summary.stages.length>64)throw new Error('Invalid acquisition stages');
 const names=new Set();
 return summary.stages.map(stage=>{
  if(!object(stage)||typeof stage.name!=='string'||!stage.name||stage.name.length>100||names.has(stage.name)||
   typeof stage.label!=='string'||!stage.label||stage.label.length>100||!acquisitions.has(stage.acquisition)||
   !eligibilities.has(stage.eligibility)||!validDate(stage.completed)||!validCount(stage.routes)||!validCount(stage.retainedRelations))
   throw new Error('Invalid compact acquisition stage');
  names.add(stage.name);
  // These are the stage facts used by the legend. Exact timestamps, numeric
  // diagnostic counters and error text do not cause repeat deployments.
  return {name:stage.name,label:stage.label,acquisition:stage.acquisition,eligibility:stage.eligibility,
   retained:!!stage.completed,
   empty:stage.acquisition==='acquired'&&stage.eligibility==='complete'&&stage.routes===0&&stage.retainedRelations===0};
 }).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
}

export function sourceFacts(manifest) {
 if(!object(manifest)||!Array.isArray(manifest.stages)||!manifest.stages.length||manifest.stages.length>64)
  throw new Error('Missing or invalid source acquisition metadata');
 const names=new Set();
 for(const stage of manifest.stages){
  if(!object(stage)||typeof stage.name!=='string'||!stage.name||stage.name.length>100||names.has(stage.name)||
   !validDate(stage.completed)||!validCount(stage.routes)||!validCount(stage.retainedRelations)||
   (stage.inProgress!==undefined&&typeof stage.inProgress!=='boolean')||
   (stage.lastAttempt!=null&&(!object(stage.lastAttempt)||!['partial','deferred','failed','acquired'].includes(stage.lastAttempt.status)))||
   (stage.geometry!=null&&!object(stage.geometry)))throw new Error('Invalid source acquisition stage');
  names.add(stage.name);
 }
 return stableFacts(summarizeServiceAcquisition(manifest,'0'.repeat(64)));
}

export function publishedFacts(manifest) {
 if(!object(manifest)||manifest.schema!==3||!Array.isArray(manifest.profiles)||manifest.profiles.some(p=>typeof p!=='string'))
  throw new Error('Invalid published frequency metadata');
 if(manifest.acquisition===undefined)return null; // Known legacy format without status.
 const data=manifest.acquisition;
 if(!object(data)||data.schema!==1||!Array.isArray(data.stages))throw new Error('Invalid published acquisition metadata');
 if(data.status==='unknown')return null;
 if(data.status!=='available'||!/^[a-f0-9]{64}$/.test(manifest.osmSnapshotSha256||'')||data.snapshotSha256!==manifest.osmSnapshotSha256)
  throw new Error('Invalid published acquisition binding');
 return stableFacts(data);
}

export async function readStatusJson(url,{fetchImpl=fetch,maxBytes=MAX_BYTES,timeoutMs=15000}={}) {
 if(url!==SOURCE_URL&&url!==PUBLISHED_URL)throw new Error('Unapproved status metadata URL');
 const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{accept:'application/json','cache-control':'no-cache'}});
 if(!response.ok||!response.body)throw new Error('Status metadata request failed');
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>maxBytes){await response.body.cancel();throw new Error('Status metadata exceeds size limit');}
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>maxBytes)throw new Error('Status metadata exceeds size limit');chunks.push(value);
  }
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
 catch{throw new Error('Invalid JSON status metadata');}
}

export async function evaluateStatusDelivery(event,options={}) {
 if(!trustedStatusRun(event,options))return {changed:false,reason:'untrusted-or-unsuccessful-run'};
 const manifest=await readStatusJson(SOURCE_URL,options);
 if(!object(manifest?.run)||!Number.isSafeInteger(manifest.run.fetchedBoxes)||manifest.run.fetchedBoxes<0)
  throw new Error('Missing or invalid acquisition run outcome');
 // Positive acquisitions already request a site build in the producer.
 // This independent observer closes only its zero-box status-delivery gap.
 if(manifest.run.fetchedBoxes>0)return {changed:false,reason:'producer-already-handles-fetched-data'};
 const source=sourceFacts(manifest);
 const published=publishedFacts(await readStatusJson(PUBLISHED_URL,options));
 if(published===null&&!source.some(stage=>stage.acquisition!=='unknown'||stage.eligibility!=='unknown'))
  return {changed:false,reason:'no-meaningful-source-outcome'};
 return {changed:published===null||JSON.stringify(source)!==JSON.stringify(published),reason:'compared-stable-stage-facts'};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
 const result=await evaluateStatusDelivery(event,{eventName:process.env.GITHUB_EVENT_NAME,repository:process.env.GITHUB_REPOSITORY});
 if(result.changed){
  execFileSync('gh',['workflow','run','site.yml','--repo',REPOSITORY,'--ref','main'],
   {stdio:'pipe',timeout:30000,maxBuffer:100000,env:{...process.env,GH_HOST:'github.com'}});
  console.log('Acquisition status changed; requested a site rebuild from existing snapshots.');
 }else console.log(`No status rebuild requested: ${result.reason}.`);
}
