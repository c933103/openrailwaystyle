// Maintenance only. Produce a complete worldwide, tag-backed energy supply
// snapshot. Visitors fetch the published GeoJSON rather than querying Overpass.
import {mkdir, readFile, writeFile, stat} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {powerFacilityQuery,powerFacilitiesGeoJSON,powerFacilitySplitAccepted,powerFacilityCachedResponse,powerFacilityChangesSince} from './power-facility-data.mjs';
import {updateElements,requireGeometry} from './overpass-adiff.mjs';
import {quarters,worldRegions} from './world-regions.mjs';
import {overpassRetryDelayMs,overpassBusy,describeOverpassError,OVERPASS_RETRY_MINUTES} from './overpass-errors.mjs';

const api=process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const output=process.env.POWER_OUTPUT || 'power-data';
const cache='.snapshot-cache';
// v6 caches remain valid for the reviewed equivalent key-presence prefilter.
// Exact query/digest, original age and payload validation protect their reuse.
const VERSION=6;
const regions=worldRegions(90);
await mkdir(cache,{recursive:true});
await mkdir(output,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let requests=0,downloaded=0;
// One provider clock for changes, full requests, retries and subdivisions.
// Capture at headers: an interrupted body must not discard the server pause.
const MAX_PROVIDER_WAIT_MS=15*60_000;
let retryNotBefore=0,providerWaitExceeded=false;
const providerPauseError=()=>new Error('Energy facility Retry-After wait budget exceeded; data retained');
function rememberProviderPause(response) {
  const value=String(response.headers.get('retry-after')??'').trim(),receivedAt=Date.now();
  let delay=0;
  if(/^\d+$/.test(value))delay=Number(value)*1000;
  else if(value){const date=Date.parse(value);if(Number.isFinite(date))delay=Math.max(0,date-receivedAt);}
  if(delay>MAX_PROVIDER_WAIT_MS)providerWaitExceeded=true;
  if(delay>0)retryNotBefore=Math.max(retryNotBefore,receivedAt+delay);
}
async function waitForRequest(delay) {
  if(providerWaitExceeded)throw providerPauseError();
  await sleep(delay);
  while(retryNotBefore>Date.now())await sleep(retryNotBefore-Date.now());
}
const features=new Map(),coverage=[];

async function collect(box,depth=0) {
  const query=powerFacilityQuery(box);
  const file=`${cache}/power-facilities-v${VERSION}-${box.join('_')}.json`;
  const splitFile=`${file}.split`;
  let json,since=null,stored=null;
  try {
    const info=await stat(file);
    const saved=JSON.parse(await readFile(file,'utf8'));
    json=powerFacilityCachedResponse(box,query,saved,{mtimeMs:info.mtimeMs,refresh:process.env.POWER_REFRESH==='1'});
    if(json){since=powerFacilityChangesSince(box,query,saved,{mtimeMs:info.mtimeMs});stored=saved;}
    else if(process.env.POWER_REFRESH!=='1'&&typeof saved?.query==='string') {
      // Made by another query: its own changes, then only what the current
      // query selects differently (updateElements), not a new download.
      powerFacilitiesGeoJSON(saved.response);
      since=saved.response.osm3s?.timestamp_osm_base||null;stored=saved;
    }
  } catch {json=undefined;}
  // A cached region a week old, or made by another query, takes the changes
  // since its database time. For the current query a failure keeps the
  // cached response, and the next run asks again from the same time; for
  // another query the region is downloaded in full.
  if(stored&&since) {
    let failure=null;
    const update=await updateElements({elements:stored.response.elements,since,previousQuery:stored.query,query,
      pick:element=>requireGeometry([element])[0],validate:elements=>powerFacilitiesGeoJSON({...stored.response,elements}),
      warn:(...args)=>console.warn('Energy supply changes',box.join(','),...args),failed:error=>{failure=error;},
      fetchText:async body=>{
        await waitForRequest(requests?10000:0);
        requests++;
        const response=await fetch(api,{method:'POST',body:new URLSearchParams({data:body}),
          headers:{'User-Agent':'RailwayAtlas-energy-supplies/1.0 (+https://github.com/c933103/openrailwaystyle)'},signal:AbortSignal.timeout(300000)});
        rememberProviderPause(response);
        const text=await response.text();downloaded+=Buffer.byteLength(text);
        if(downloaded>100_000_000)throw new Error('Energy facility download budget exceeded');
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        return text;
      }});
    if(failure&&/budget exceeded/.test(failure.message))throw failure;
    if(update) {
      json={...stored.response,osm3s:{...stored.response.osm3s,timestamp_osm_base:update.osmBase},elements:update.elements};
      await writeFile(file,JSON.stringify({query,response:json}));
      console.log('Energy supply region',box.join(','),'changes since',since+':',update.upserts,'added or changed,',update.deletes,'removed; query change:',update.added,'added,',update.dropped,'dropped');
    } else if(stored.query!==query) json=undefined;
    if(providerWaitExceeded)throw providerPauseError();
  }
  let split=false,cachedSplit=false;
  if (!json) {
    try {
      // A region split under another query keeps its parts, which then take
      // their own changes and the query difference; never a refresh.
      const saved=JSON.parse(await readFile(splitFile,'utf8'));
      split=powerFacilitySplitAccepted(query,saved)||(process.env.POWER_REFRESH!=='1'&&typeof saved?.query==='string');
      cachedSplit=powerFacilitySplitAccepted(query,saved);
    } catch {}
    // A busy server waits minutes (overpassRetryDelayMs); other retries keep
    // the short pause. Completed regions are cached, so a later run resumes.
    let wait=requests?10000:0;const attempts=OVERPASS_RETRY_MINUTES.length+1;
    if(!split)for(let attempt=0;attempt<attempts;attempt++) {
      await waitForRequest(wait);
      requests++;
      let readingResponse=true;
      try {
        console.log('Fetching railway energy supplies',box.join(','),'attempt',attempt+1);
        const response=await fetch(api,{method:'POST',body:new URLSearchParams({data:query}),
          headers:{'User-Agent':'RailwayAtlas-energy-supplies/1.0 (+https://github.com/c933103/openrailwaystyle)'},signal:AbortSignal.timeout(300000)});
        rememberProviderPause(response);
        const text=await response.text();downloaded+=Buffer.byteLength(text);
        readingResponse=false;
        if(downloaded>100_000_000)throw new Error('Energy facility download budget exceeded');
        if(!response.ok)throw Object.assign(new Error(`HTTP ${response.status}: ${text.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,160)}`),{retryAfter:response.headers.get('retry-after')});
        json=JSON.parse(text);
        powerFacilitiesGeoJSON(json);
        await writeFile(file,JSON.stringify({query,response:json}));
        if(providerWaitExceeded)throw providerPauseError();
        break;
      } catch(error) {
        // Fetch/header/body failures do not prove the query exceeded a limit,
        // even when their message says timeout or memory. Preserve the cause.
        if(readingResponse)error=Object.assign(new Error(`fetch failed: ${describeOverpassError(error)}`,{cause:error}),{transport:true});
        json=undefined;
        console.warn(box.join(','),describeOverpassError(error));
        if(providerWaitExceeded)throw providerPauseError();
        if(/budget exceeded/.test(error.message))throw error;
        // Admission HTTP errors can say "timeout" without executing the query.
        if(!error.transport && !/^HTTP \d+:/.test(error.message) && /timed? ?out|out of memory|memory/i.test(error.message)){split=true;break;}
        if(attempt===attempts-1)throw error;
        wait=Math.max(overpassBusy(error)?overpassRetryDelayMs(attempt):Math.min(60000,20000*(attempt+2)),retryNotBefore-Date.now());
        if(overpassBusy(error))console.warn(`Overpass busy or unreachable; retrying in ${Math.round(wait/60000)} min`);
      }
    }
  }
  if(split) {
    if(depth>=6)throw new Error(`Energy facility region could not complete: ${box}`);
    if(!cachedSplit)await writeFile(splitFile,JSON.stringify({query}));
    for(const child of quarters(box))await collect(child,depth+1);
    return;
  }
  const data=powerFacilitiesGeoJSON(json);
  for(const feature of data.features)features.set(feature.id,feature);
  coverage.push({bbox:box,timestamp:json.osm3s?.timestamp_osm_base || null,features:data.features.length});
  console.log('Energy supply region',box.join(','),data.features.length,'facilities');
}
for(const box of regions)await collect(box);
if(!features.size)throw new Error('Refusing to publish an empty worldwide railway energy supply snapshot');
const data={type:'FeatureCollection',features:[...features.values()].sort((a,b)=>a.id.localeCompare(b.id))};
const counts={};
for(const feature of data.features)counts[feature.properties.power_kind]=(counts[feature.properties.power_kind] || 0)+1;
const manifest={version:VERSION,built:new Date().toISOString(),source:'OpenStreetMap via Overpass',license:'ODbL-1.0',
  complete:true,features:features.size,counts,coverage,downloadedBytes:downloaded,
  selection:'Explicit railway supplies, traction substations, railway-tagged power/storage facilities and 16.7/16.67 Hz traction power facilities. Ordinary utility, road fuel and general water facilities are excluded.'};
await writeFile(`${output}/power-facilities.geojson`,JSON.stringify(data));
await writeFile(`${output}/power-facilities.geojson.gz`,gzipSync(JSON.stringify(data)));
await writeFile(`${output}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
console.log('Complete worldwide energy supply snapshot:',features.size,'facilities',counts);
