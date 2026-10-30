// Build-time OSM extract of every escalator, moving walkway and elevator way.
import {mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {CONVEYING_QUERY as query,conveyingGeoJSON,conveyingTiles,CONVEYING_ZOOM} from './conveying-data.mjs';
import {overpassRetryDelayMs,describeOverpassError,OVERPASS_RETRY_MINUTES} from './overpass-errors.mjs';
let data;
// A busy server waits minutes: 2, 5, then 10 (or its Retry-After).
for(let attempt=0;attempt<=OVERPASS_RETRY_MINUTES.length;attempt++) {
  try {
    const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(960000),headers:{'User-Agent':'OpenRailwayAtlas snapshot (github.com/c933103/openrailwaystyle)'}});
    if(!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`),{retryAfter:response.headers.get('retry-after')});
    data=await response.json();
    if(data.remark || !Array.isArray(data.elements)) throw new Error(data.remark || 'Incomplete response');
    break;
  } catch(error) {
    if(attempt===OVERPASS_RETRY_MINUTES.length) throw error;
    const wait=overpassRetryDelayMs(attempt,error.retryAfter);
    console.log(describeOverpassError(error),`— retrying in ${Math.round(wait/60000)} min`);await new Promise(r=>setTimeout(r,wait));
  }
}
const {features}=conveyingGeoJSON(data);
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
const manifest={generated:new Date().toISOString(),osmBase:data.osm3s?.timestamp_osm_base,features:features.length,kinds,zoom:CONVEYING_ZOOM,tiles:tiles.length,source:'https://overpass-api.de/api/interpreter',query,license:'ODbL-1.0',description:'Every OSM way with conveying=* (not no) or highway=elevator. Backward escalators are stored reversed so arrows follow the line.'};
await writeFile(new URL('manifest.json',root),JSON.stringify(manifest,null,2));
await writeFile(new URL('index.json',root),JSON.stringify({tiles:tiles.sort()}));
console.log(JSON.stringify(manifest));
