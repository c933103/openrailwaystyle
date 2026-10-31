// Build-time OSM extract of every aerial cableway and lift way, with the same
// bounded acquisition as the escalator build (build-conveying.mjs): at most
// three requests and their waits inside one 52-minute budget.
import {mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {AERIALWAY_QUERY as query,AERIALWAY_ZOOM,aerialwaysGeoJSON,conveyingTiles,conveyingHttpError,conveyingFailureKind,conveyingRetryDelay,conveyingRequestFits,CONVEYING_REQUEST_MS,CONVEYING_ACQUISITION_MS} from './conveying-data.mjs';
const deadline = performance.now() + CONVEYING_ACQUISITION_MS;
let data;
for(let attempt=0;attempt<3;attempt++) {
  if (!conveyingRequestFits(deadline, 0)) throw new Error('Aerialway acquisition deferred: no full request fits the 52-minute budget');
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
    if (!conveyingRequestFits(deadline, wait)) throw new Error('Aerialway acquisition deferred: required wait and full request do not fit the 52-minute budget', {cause:error});
    console.log(error.message, `— retrying after ${wait / 60000} minutes`);
    await new Promise(r=>setTimeout(r,wait));
  }
}
const {features}=aerialwaysGeoJSON(data);
// Taginfo counted about 3,200 cable car and gondola ways alone in October 2026.
if(features.length<5000) throw new Error(`Suspiciously small worldwide aerialway extract: ${features.length}`);
const root=new URL('../aerialway-data/',import.meta.url);await mkdir(root,{recursive:true});
await writeFile(new URL('aerialways.geojson.gz',root),gzipSync(JSON.stringify({type:'FeatureCollection',features}),{level:9}));
const tiles=[];
for(const [key,bytes] of conveyingTiles(features,{z:AERIALWAY_ZOOM,layer:'aerialways'})) {
 const [z,x]=key.split('/');
 await mkdir(new URL(`${z}/${x}/`,root),{recursive:true});
 await writeFile(new URL(key+'.pbf.gz',root),gzipSync(bytes,{level:9}));tiles.push(key);
}
const kinds=Object.fromEntries(['cableway','lift'].map(kind=>[kind,features.filter(f=>f.properties.kind===kind).length]));
const manifest={generated:new Date().toISOString(),osmBase:data.osm3s?.timestamp_osm_base,features:features.length,kinds,zoom:AERIALWAY_ZOOM,tiles:tiles.length,source:'https://overpass-api.de/api/interpreter',query,license:'ODbL-1.0',description:'Every OSM aerial cableway and lift way (cable car, gondola, mixed lift, chair, drag, T-bar, J-bar and platter lifts), with names, owner and maxspeed.'};
await writeFile(new URL('manifest.json',root),JSON.stringify(manifest,null,2));
await writeFile(new URL('index.json',root),JSON.stringify({tiles:tiles.sort()}));
console.log(JSON.stringify(manifest));
