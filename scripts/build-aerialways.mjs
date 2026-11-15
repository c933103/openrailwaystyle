// Build-time OSM extract of every aerial cableway and lift way, with the same
// bounded acquisition as the escalator build (build-conveying.mjs): at most
// three requests and their waits inside one 52-minute budget.
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeLineSnapshot} from './conveying-files.mjs';
import {updateElements} from './overpass-adiff.mjs';
import {AERIALWAY_QUERY as query,AERIALWAY_ZOOM,aerialwaysGeoJSON,conveyingHttpError,createConveyingProviderPause,conveyingFailureKind,conveyingRetryDelay,conveyingRequestFits,CONVEYING_REQUEST_MS,CONVEYING_ACQUISITION_MS} from './conveying-data.mjs';
const deadline = performance.now() + CONVEYING_ACQUISITION_MS;
const providerPause = createConveyingProviderPause(deadline);
// What the conversion reads of an element; the stored elements keep only this.
const pick=({type,id,tags,geometry})=>({type,id,tags,geometry});
const api='https://overpass-api.de/api/interpreter', headers={'User-Agent':'OpenRailwayAtlas snapshot (github.com/c933103/openrailwaystyle)'};
// Since the published snapshot (PREVIOUS_DATA: its elements.json.gz, the
// elements it was made from, and manifest.json, with their database time and
// query), only what changed and what a changed query selects differently;
// the full download below is the fallback. The features are converted from
// all elements on every run, so changed conversion code needs no download.
// Requests made, the change requests included: at most three in all.
let data, update=null, changeError=null, requests=0;
if(process.env.PREVIOUS_DATA) {
  let previous=null;
  try {
    const manifest=JSON.parse(await readFile(join(process.env.PREVIOUS_DATA,'manifest.json'),'utf8'));
    previous={elements:JSON.parse(gunzipSync(await readFile(join(process.env.PREVIOUS_DATA,'elements.json.gz')))),
      since:manifest.osmBase,previousQuery:manifest.query};
  } catch(error) { console.log('No usable published elements:', error.message); }
  // Elements the conversion cannot use mean the full download, not a failed run.
  if(previous) update=await updateElements({...previous,query,pick,validate:elements=>aerialwaysGeoJSON({elements}),maxRequests:3,
    fetchText:async request=>{
      await providerPause.wait();
      if (!conveyingRequestFits(deadline, 0)) throw new Error('No request fits the 52-minute budget');
      const startedAt=Date.now();
      if (requests >= 3) throw new Error('The three requests of this run are used');
      requests++;
      const response=await fetch(api,{method:'POST',body:new URLSearchParams({data:request}),signal:AbortSignal.timeout(CONVEYING_REQUEST_MS),headers});
      providerPause.observe(response);
      if(!response.ok) throw await conveyingHttpError(response, startedAt);
      return response.text();
    },failed:error=>{changeError=error;}});
}
// A server that refused the change request is given the wait it asked for
// (Retry-After) before the full download, as between full attempts. Headers
// were observed before body consumption: combine the remaining pause with
// local backoff, without reparsing or restarting the original header here.
if(!update && changeError?.status) {
  const wait = conveyingRetryDelay({kind:changeError.kind}, 0);
  if (!conveyingRequestFits(deadline, wait)) throw new Error('Aerialway acquisition deferred: required wait and full request do not fit the 52-minute budget', {cause:changeError});
  console.log(`Waiting at least ${wait / 60000} minutes before the full download`);
  await providerPause.wait(wait);
}
if(update) console.log(`Changes since ${update.since}: ${update.upserts} added or changed, ${update.deletes} removed; query change: ${update.added} added, ${update.dropped} dropped`);
else for(let attempt=0,attempts=3-requests;;attempt++) {
  // Reached only when the change requests used all three requests.
  if (attempt >= attempts) throw new Error('Aerialway acquisition deferred: no request left of the three for this run', {cause:changeError});
  await providerPause.wait();
  if (!conveyingRequestFits(deadline, 0)) throw new Error('Aerialway acquisition deferred: no full request fits the 52-minute budget');
  try {
    const startedAt = Date.now();
    const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(CONVEYING_REQUEST_MS),headers:{'User-Agent':'OpenRailwayAtlas snapshot (github.com/c933103/openrailwaystyle)'}});
    providerPause.observe(response);
    if(!response.ok) throw await conveyingHttpError(response, startedAt);
    data=await response.json();
    if(data.remark) throw new Error(`Overpass HTTP ${response.status} after ${Date.now()-startedAt}ms [${conveyingFailureKind(response.status,String(data.remark))}]: incomplete response`);
    if(!Array.isArray(data.elements)) throw new Error('Incomplete response');
    break;
  } catch(error) {
    if(attempt===attempts-1) throw error;
    const wait = conveyingRetryDelay({kind:error.kind}, attempt);
    if (!conveyingRequestFits(deadline, wait)) throw new Error('Aerialway acquisition deferred: required wait and full request do not fit the 52-minute budget', {cause:error});
    console.log(error.message, `— retrying no sooner than ${wait / 60000} minutes`);
    await providerPause.wait(wait);
  }
}
const elements=(update?update.elements:data.elements.map(pick)).sort((a,b)=>a.id-b.id);
const {features}=aerialwaysGeoJSON({elements});
// Taginfo counted about 3,200 cable car and gondola ways alone in October 2026.
if(features.length<5000) throw new Error(`Suspiciously small worldwide aerialway extract: ${features.length}`);
const manifest=await writeLineSnapshot(fileURLToPath(new URL('../aerialway-data/',import.meta.url)),{elements,features,file:'aerialways',layer:'aerialways',zoom:AERIALWAY_ZOOM,kindIds:['cableway','lift'],
 head:{generated:new Date().toISOString(),osmBase:update?update.osmBase:data.osm3s?.timestamp_osm_base,update:update?{changesSince:update.since,upserts:update.upserts,deletes:update.deletes,added:update.added,dropped:update.dropped}:'full'},
 tail:{source:'https://overpass-api.de/api/interpreter',query,license:'ODbL-1.0',description:'Every OSM aerial cableway and lift way (cable car, gondola, mixed lift, chair, drag, T-bar, J-bar and platter lifts), with names, owner and maxspeed.'}});
console.log(JSON.stringify(manifest));
