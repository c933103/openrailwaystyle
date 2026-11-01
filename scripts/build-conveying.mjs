// Build-time OSM extract of every escalator, moving walkway and elevator way.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {updateFromChanges,extractionVersion} from './overpass-adiff.mjs';
import {CONVEYING_QUERY as query,conveyingGeoJSON,conveyingTiles,CONVEYING_ZOOM,conveyingHttpError,conveyingFailureKind,conveyingRetryDelay,conveyingRequestFits,CONVEYING_REQUEST_MS,CONVEYING_ACQUISITION_MS} from './conveying-data.mjs';
const deadline = performance.now() + CONVEYING_ACQUISITION_MS;
// The query and conversion code this snapshot is made with (manifest.extraction).
const extraction=extractionVersion(query,new URL('./conveying-data.mjs',import.meta.url));
const api='https://overpass-api.de/api/interpreter', headers={'User-Agent':'OpenRailwayAtlas snapshot (github.com/c933103/openrailwaystyle)'};
// Since the published snapshot (PREVIOUS_DATA: its conveying.geojson.gz and
// manifest.json), only what changed; the full download below is the fallback.
let data, update=null, changeError=null;
if(process.env.PREVIOUS_DATA) {
  let previous=null;
  try {
    const manifest=JSON.parse(await readFile(join(process.env.PREVIOUS_DATA,'manifest.json'),'utf8'));
    previous={features:JSON.parse(gunzipSync(await readFile(join(process.env.PREVIOUS_DATA,'conveying.geojson.gz')))).features,
      since:manifest.osmBase,previousVersion:manifest.extraction};
  } catch(error) { console.log('No usable published snapshot:', error.message); }
  if(previous) update=await updateFromChanges({...previous,query,version:extraction,toFeatures:elements=>conveyingGeoJSON({elements}).features,
    fetchText:async changeQuery=>{
      if (!conveyingRequestFits(deadline, 0)) throw new Error('No request fits the 52-minute budget');
      const startedAt=Date.now();
      const response=await fetch(api,{method:'POST',body:new URLSearchParams({data:changeQuery}),signal:AbortSignal.timeout(CONVEYING_REQUEST_MS),headers});
      if(!response.ok) throw await conveyingHttpError(response, startedAt);
      return response.text();
    },failed:error=>{changeError=error;}});
}
// A server that refused the change request is given the wait it asked for
// (Retry-After) before the full download, as between full attempts.
if(!update && changeError?.status) {
  const wait = conveyingRetryDelay(changeError, 0);
  if (!conveyingRequestFits(deadline, wait)) throw new Error('Conveying acquisition deferred: required wait and full request do not fit the 52-minute budget', {cause:changeError});
  console.log(`Waiting ${wait / 60000} minutes before the full download`);
  await new Promise(r=>setTimeout(r,wait));
}
if(update) console.log(`Changes since ${update.since}: ${update.upserts} added or changed, ${update.deletes} removed`);
else for(let attempt=0;attempt<3;attempt++) {
  if (!conveyingRequestFits(deadline, 0)) throw new Error('Conveying acquisition deferred: no full request fits the 52-minute budget');
  try {
    const startedAt = Date.now();
    const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(CONVEYING_REQUEST_MS),headers:{'User-Agent':'OpenRailwayAtlas snapshot (github.com/c933103/openrailwaystyle)'}});
    if(!response.ok) throw await conveyingHttpError(response, startedAt);
    data=await response.json();
    if(data.remark) throw new Error(`Overpass HTTP ${response.status} after ${Date.now()-startedAt}ms [${conveyingFailureKind(response.status,String(data.remark))}]: incomplete response`);
    if(!Array.isArray(data.elements)) throw new Error('Incomplete response');
    break;
  } catch(error) {
    if(attempt===2) throw error;
    const wait = conveyingRetryDelay(error, attempt);
    if (!conveyingRequestFits(deadline, wait)) throw new Error('Conveying acquisition deferred: required wait and full request do not fit the 52-minute budget', {cause:error});
    console.log(error.message, `— retrying after ${wait / 60000} minutes`);
    await new Promise(r=>setTimeout(r,wait));
  }
}
const {features}=update||conveyingGeoJSON(data);
// Taginfo counted about 44,000 such ways in October 2026.
if(features.length<10000) throw new Error(`Suspiciously small worldwide extract: ${features.length}`);
const root=new URL('../conveying-data/',import.meta.url);await mkdir(root,{recursive:true});
await writeFile(new URL('conveying.geojson.gz',root),gzipSync(JSON.stringify({type:'FeatureCollection',features}),{level:9}));
const tiles=[];
for(const [key,bytes] of conveyingTiles(features)) {
 const [z,x]=key.split('/');
 await mkdir(new URL(`${z}/${x}/`,root),{recursive:true});
 await writeFile(new URL(key+'.pbf.gz',root),gzipSync(bytes,{level:9}));tiles.push(key);
}
const kinds=Object.fromEntries(['escalator','travelator','elevator'].map(kind=>[kind,features.filter(f=>f.properties.kind===kind).length]));
const manifest={generated:new Date().toISOString(),osmBase:update?update.osmBase:data.osm3s?.timestamp_osm_base,extraction,update:update?{changesSince:update.since,upserts:update.upserts,deletes:update.deletes}:'full',features:features.length,kinds,zoom:CONVEYING_ZOOM,tiles:tiles.length,source:'https://overpass-api.de/api/interpreter',query,license:'ODbL-1.0',description:'Every OSM way with conveying=* (not no) or highway=elevator. Backward escalators are stored reversed so arrows follow the line.'};
await writeFile(new URL('manifest.json',root),JSON.stringify(manifest,null,2));
await writeFile(new URL('index.json',root),JSON.stringify({tiles:tiles.sort()}));
console.log(JSON.stringify(manifest));

