// Build-time OSM extract. Browsers never query Overpass for street running.
import {mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import '../styles/pbf-utf8.mjs'; // names beyond U+1FFFF intact
import {streetRunning} from '../styles/street-running.mjs';
const query='[out:json][timeout:600][maxsize:536870912];(way[embedded=yes];way[embedded_rails];);out tags geom;';
let data;
for(let attempt=0;attempt<3;attempt++) {
  try {
    const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(660000),headers:{'User-Agent':'OpenRailwayAtlas snapshot (github.com/c933103/openrailwaystyle)'}});
    if(!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
    data=await response.json();
    if(data.remark || !Array.isArray(data.elements)) throw new Error(data.remark || 'Incomplete response');
    break;
  } catch(error) {if(attempt===2) throw error;console.log(error.message,'— retrying after two minutes');await new Promise(r=>setTimeout(r,120000));}
}
const features=data.elements.flatMap(e=>{
  const description=streetRunning(e.tags||{});
  if(!description || e.geometry?.length<2) return [];
  if(!e.geometry.every(p=>Number.isFinite(p.lon)&&Number.isFinite(p.lat))) throw new Error(`Incomplete geometry for ${e.id}`);
  return [{type:'Feature',id:e.id,properties:{...e.tags,osm_id:e.id,evidence:description},geometry:{type:'LineString',coordinates:e.geometry.map(p=>[p.lon,p.lat])}}];
});
if(features.length<100) throw new Error(`Suspiciously small worldwide extract: ${features.length}`);
const root=new URL('../street-data/',import.meta.url);await mkdir(root,{recursive:true});
await writeFile(new URL('street-running.geojson.gz',root),gzipSync(JSON.stringify({type:'FeatureCollection',features}),{level:9}));
const z=12,n=2**z,extent=8192;
const index=geojsonvt({type:'FeatureCollection',features},{maxZoom:z,indexMaxZoom:5,tolerance:0.5,extent,buffer:128});
const keys=new Set(), tileXY=([lng,lat])=>[(lng+180)/360*n,(1-Math.asinh(Math.tan(Math.max(-85.05,Math.min(85.05,lat))*Math.PI/180))/Math.PI)/2*n];
for(const f of features) {
 const points=f.geometry.coordinates.map(tileXY);
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 // Include tile buffers so a line doesn't disappear at an edge.
 for(let x=Math.max(0,Math.floor(Math.min(...xs)-128/extent));x<=Math.min(n-1,Math.floor(Math.max(...xs)+128/extent));x++)
 for(let y=Math.max(0,Math.floor(Math.min(...ys)-128/extent));y<=Math.min(n-1,Math.floor(Math.max(...ys)+128/extent));y++) keys.add(`${z}/${x}/${y}`);
}
const tiles=[];
for(const key of keys) {
 const [z,x,y]=key.split('/').map(Number),tile=index.getTile(z,x,y);if(!tile?.features.length)continue;
 await mkdir(new URL(`${z}/${x}/`,root),{recursive:true});
 await writeFile(new URL(key+'.pbf.gz',root),gzipSync(vtpbf.fromGeojsonVt({street_running:tile},{extent}),{level:9}));tiles.push(key);
}
const manifest={generated:new Date().toISOString(),osmBase:data.osm3s?.timestamp_osm_base,features:features.length,tiles:tiles.length,source:'https://overpass-api.de/api/interpreter',query,license:'ODbL-1.0',description:'Explicit OSM embedded / embedded_rails tags. Not inferred from tram type or proximity. Missing tags imply unknown coverage.'};
await writeFile(new URL('manifest.json',root),JSON.stringify(manifest,null,2));
await writeFile(new URL('index.json',root),JSON.stringify({tiles:tiles.sort()}));
console.log(JSON.stringify(manifest));
