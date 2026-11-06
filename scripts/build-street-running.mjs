// Build-time OSM extract. Browsers never query Overpass for street running.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {updateElements} from './overpass-adiff.mjs';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import '../styles/pbf-utf8.mjs'; // names beyond U+1FFFF intact
import {streetRunning} from '../styles/street-running.mjs';
const query='[out:json][timeout:600][maxsize:536870912];(way[embedded=yes];way[embedded_rails];);out tags geom;';
const CHANGE_MS=360000;
const api='https://overpass-api.de/api/interpreter', headers={'User-Agent':'OpenRailwayAtlas snapshot (github.com/c933103/openrailwaystyle)'};
const toFeatures=elements=>elements.flatMap(e=>{
  if(e.type!==undefined&&e.type!=='way') return [];
  const description=streetRunning(e.tags||{});
  if(!description || e.geometry?.length<2) return [];
  if(!e.geometry.every(p=>Number.isFinite(p.lon)&&Number.isFinite(p.lat))) throw new Error(`Incomplete geometry for ${e.id}`);
  return [{type:'Feature',id:e.id,properties:{...e.tags,osm_id:e.id,evidence:description},geometry:{type:'LineString',coordinates:e.geometry.map(p=>[p.lon,p.lat])}}];
});
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
  const changesUntil=Date.now()+CHANGE_MS;
  if(previous) update=await updateElements({...previous,query,pick,validate:toFeatures,fetchText:async request=>{
    const left=changesUntil-Date.now();
    if(left<=0) throw new Error('The change requests\' six minutes are used');
    const response=await fetch(api,{method:'POST',body:new URLSearchParams({data:request}),signal:AbortSignal.timeout(left),headers});
    if(!response.ok) throw Object.assign(new Error(`Overpass HTTP ${response.status}`),{status:response.status});
    return response.text();
  },failed:error=>{changeError=error;}});
}
// A server that refused the change request gets the same two-minute pause
// as between full attempts before the full download.
if(!update && changeError?.status) { console.log('Waiting two minutes before the full download'); await new Promise(r=>setTimeout(r,120000)); }
if(update) console.log(`Changes since ${update.since}: ${update.upserts} added or changed, ${update.deletes} removed; query change: ${update.added} added, ${update.dropped} dropped`);
else for(let attempt=0;attempt<3;attempt++) {
  try {
    const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(660000),headers:{'User-Agent':'OpenRailwayAtlas snapshot (github.com/c933103/openrailwaystyle)'}});
    if(!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
    data=await response.json();
    if(data.remark || !Array.isArray(data.elements)) throw new Error(data.remark || 'Incomplete response');
    break;
  } catch(error) {if(attempt===2) throw error;console.log(error.message,'— retrying after two minutes');await new Promise(r=>setTimeout(r,120000));}
}
const elements=(update?update.elements:data.elements.map(pick)).sort((a,b)=>a.id-b.id);
const features=toFeatures(elements);
if(features.length<100) throw new Error(`Suspiciously small worldwide extract: ${features.length}`);
const root=new URL('../street-data/',import.meta.url);await mkdir(root,{recursive:true});
await writeFile(new URL('elements.json.gz',root),gzipSync(JSON.stringify(elements),{level:9}));
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
const manifest={generated:new Date().toISOString(),osmBase:update?update.osmBase:data.osm3s?.timestamp_osm_base,update:update?{changesSince:update.since,upserts:update.upserts,deletes:update.deletes,added:update.added,dropped:update.dropped}:'full',features:features.length,tiles:tiles.length,source:'https://overpass-api.de/api/interpreter',query,license:'ODbL-1.0',description:'Explicit OSM embedded / embedded_rails tags. Not inferred from tram type or proximity. Missing tags imply unknown coverage.'};
await writeFile(new URL('manifest.json',root),JSON.stringify(manifest,null,2));
await writeFile(new URL('index.json',root),JSON.stringify({tiles:tiles.sort()}));
console.log(JSON.stringify(manifest));
