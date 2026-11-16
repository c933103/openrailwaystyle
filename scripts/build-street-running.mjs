// Build-time OSM extract. Browsers never query Overpass for street running.
import {retryAfterMs} from './retry-after.mjs';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {updateElements} from './overpass-adiff.mjs';
import {fileURLToPath} from 'node:url';
import {STREET_QUERY as query,streetFeatures as toFeatures,writeStreetSnapshot} from './street-running-files.mjs';
const CHANGE_MS=360000;
const acquisitionUntil=performance.now()+45*60000;
let providerNotBefore=0;
// Keep a provider pause across change/selection/full requests, even when a
// successful response body later fails. Wall time is used only for HTTP dates.
function observePause(response){
  const receivedAt=performance.now(),pause=retryAfterMs(response.headers.get('retry-after'),Date.now());
  providerNotBefore=Math.max(providerNotBefore,receivedAt+pause);
}
function requireRequestTime(requestMs,scheduledWait=0,limit=acquisitionUntil){
  const now=performance.now(),wait=Math.max(scheduledWait,providerNotBefore-now);
  if(!Number.isFinite(wait)||now+wait+requestMs>Math.min(limit,acquisitionUntil))
    throw new Error('Street-running acquisition deferred: provider pause and request do not fit the available time budget');
}
async function waitForProvider(requestMs,limit=acquisitionUntil,scheduledWait=0){
  const notBefore=Math.max(performance.now()+scheduledWait,providerNotBefore);
  while(true){
    const remaining=notBefore-performance.now();
    requireRequestTime(requestMs,Math.max(0,remaining),limit);
    if(remaining<=0)return;
    await new Promise(resolve=>setTimeout(resolve,remaining));
  }
}
// Release unused HTTP-error bodies without letting cleanup delay retries or
// replace the HTTP error. Header-time provider pauses are already retained.
function discardResponse(response){
  try{response.body?.cancel().catch(()=>{});}catch{}
}
const api='https://overpass-api.de/api/interpreter', headers={'User-Agent':'OpenRailwayAtlas snapshot (github.com/c933103/openrailwaystyle)'};
// What the conversion reads of an element; the stored elements keep only this.
const pick=({type,id,tags,geometry})=>({type,id,tags,geometry});
// Since the published snapshot (PREVIOUS_DATA: its elements.json.gz, the
// elements it was made from, and manifest.json, with their database time and
// query), only what changed and what a changed query selects differently;
// the full download is the fallback. The features are converted from all
// elements on every run, so changed conversion code needs no download.
let data, update=null, changeError=null;
if(process.env.PREVIOUS_DATA) {
  let previous=null;
  try {
    const manifest=JSON.parse(await readFile(join(process.env.PREVIOUS_DATA,'manifest.json'),'utf8'));
    previous={elements:JSON.parse(gunzipSync(await readFile(join(process.env.PREVIOUS_DATA,'elements.json.gz')))),
      since:manifest.osmBase,previousQuery:manifest.query};
  } catch(error) { console.log('No usable published elements:', error.message); }
  // A week's changes are small: the change requests (the changes, and for a
  // changed query its ids and new elements) share six minutes, then give
  // way to the full download. Worst case before the build: 6 + 2 (pause) +
  // 3 × 11 (full attempts) + 2 × 2 (pauses) = 45 minutes, within the
  // workflow's time limit.
  const changesUntil=performance.now()+CHANGE_MS;
  if(previous) update=await updateElements({...previous,query,pick,validate:toFeatures,fetchText:async request=>{
    await waitForProvider(1,changesUntil);
    const left=Math.floor(changesUntil-performance.now());
    if(left<=0) throw new Error('The change requests\' six minutes are used');
    const response=await fetch(api,{method:'POST',body:new URLSearchParams({data:request}),signal:AbortSignal.timeout(left),headers});
    observePause(response);
    if(!response.ok){discardResponse(response);throw Object.assign(new Error(`Overpass HTTP ${response.status}`),{status:response.status});}
    return response.text();
  },failed:error=>{changeError=error;}});
}
// A server that refused the change request gets the same two-minute pause
// as between full attempts before the full download.
if(!update && changeError?.status) { console.log('Waiting at least two minutes before the full download'); await waitForProvider(660000,acquisitionUntil,120000); }
if(update) console.log(`Changes since ${update.since}: ${update.upserts} added or changed, ${update.deletes} removed; query change: ${update.added} added, ${update.dropped} dropped`);
else for(let attempt=0;attempt<3;attempt++) {
  await waitForProvider(660000);
  try {
    const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(660000),headers:{'User-Agent':'OpenRailwayAtlas snapshot (github.com/c933103/openrailwaystyle)'}});
    observePause(response);
    if(!response.ok){discardResponse(response);throw new Error(`Overpass HTTP ${response.status}`);}
    data=await response.json();
    if(data.remark || !Array.isArray(data.elements)) throw new Error(data.remark || 'Incomplete response');
    break;
  } catch(error) {if(attempt===2) throw error;console.log(error.message,'— retrying after at least two minutes');await waitForProvider(660000,acquisitionUntil,120000);}
}
const elements=(update?update.elements:data.elements.map(pick)).sort((a,b)=>a.id-b.id);
const features=toFeatures(elements);
if(features.length<100) throw new Error(`Suspiciously small worldwide extract: ${features.length}`);
const manifest=await writeStreetSnapshot(fileURLToPath(new URL('../street-data/',import.meta.url)),{elements,features,
 head:{generated:new Date().toISOString(),osmBase:update?update.osmBase:data.osm3s?.timestamp_osm_base,update:update?{changesSince:update.since,upserts:update.upserts,deletes:update.deletes,added:update.added,dropped:update.dropped}:'full'},
 tail:{source:'https://overpass-api.de/api/interpreter',query,license:'ODbL-1.0',description:'Explicit OSM embedded / embedded_rails tags. Not inferred from tram type or proximity. Missing tags imply unknown coverage.'}});
console.log(JSON.stringify(manifest));
