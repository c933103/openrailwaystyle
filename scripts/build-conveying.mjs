// Build-time OSM extract of every escalator, moving walkway and elevator way.
import {mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {CONVEYING_QUERY as query,conveyingGeoJSON} from './conveying-data.mjs';
let data;
for(let attempt=0;attempt<3;attempt++) {
  try {
    const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(960000),headers:{'User-Agent':'OpenRailwayAtlas snapshot (github.com/c933103/openrailwaystyle)'}});
    if(!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
    data=await response.json();
    if(data.remark || !Array.isArray(data.elements)) throw new Error(data.remark || 'Incomplete response');
    break;
  } catch(error) {if(attempt===2) throw error;console.log(error.message,'— retrying after two minutes');await new Promise(r=>setTimeout(r,120000));}
}
const {features}=conveyingGeoJSON(data);
// Taginfo counted about 44,000 such ways in October 2026.
if(features.length<10000) throw new Error(`Suspiciously small worldwide extract: ${features.length}`);
const root=new URL('../conveying-data/',import.meta.url);await mkdir(root,{recursive:true});
await writeFile(new URL('conveying.geojson.gz',root),gzipSync(JSON.stringify({type:'FeatureCollection',features}),{level:9}));
const z=12,n=2**z,extent=8192;
const index=geojsonvt({type:'FeatureCollection',features},{maxZoom:z,indexMaxZoom:5,tolerance:0.5,extent,buffer:128});
const keys=new Set(), tileXY=([lng,lat])=>[(lng+180)/360*n,(1-Math.asinh(Math.tan(Math.max(-85.05,Math.min(85.05,lat))*Math.PI/180))/Math.PI)/2*n];
for(const f of features) {
 const points=f.geometry.coordinates.map(tileXY),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 // Include tile buffers so a line doesn't disappear at an edge.
 for(let x=Math.max(0,Math.floor(Math.min(...xs)-128/extent));x<=Math.min(n-1,Math.floor(Math.max(...xs)+128/extent));x++)
 for(let y=Math.max(0,Math.floor(Math.min(...ys)-128/extent));y<=Math.min(n-1,Math.floor(Math.max(...ys)+128/extent));y++) keys.add(`${z}/${x}/${y}`);
}
const tiles=[];
for(const key of keys) {
 const [tz,x,y]=key.split('/').map(Number),tile=index.getTile(tz,x,y);if(!tile?.features.length)continue;
 await mkdir(new URL(`${tz}/${x}/`,root),{recursive:true});
 await writeFile(new URL(key+'.pbf.gz',root),gzipSync(vtpbf.fromGeojsonVt({conveying:tile},{extent}),{level:9}));tiles.push(key);
}
const kinds=Object.fromEntries(['escalator','travelator','elevator'].map(kind=>[kind,features.filter(f=>f.properties.kind===kind).length]));
const manifest={generated:new Date().toISOString(),osmBase:data.osm3s?.timestamp_osm_base,features:features.length,kinds,tiles:tiles.length,source:'https://overpass-api.de/api/interpreter',query,license:'ODbL-1.0',description:'Every OSM way with conveying=* (not no) or highway=elevator. Backward escalators are stored reversed so arrows follow the line.'};
await writeFile(new URL('manifest.json',root),JSON.stringify(manifest,null,2));
await writeFile(new URL('index.json',root),JSON.stringify({tiles:tiles.sort()}));
console.log(JSON.stringify(manifest));
