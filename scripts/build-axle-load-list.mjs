// Maintenance only: a compact way-ID lookup; no Overpass calls from viewers.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createAxlePartCache} from './axle-load-parts.mjs';
import {encodeLoadingGauges} from '../styles/loading-gauge-list.mjs';
const api='https://overpass-api.de/api/interpreter',cache='.snapshot-cache/axle-load.json',partsFile='.snapshot-cache/axle-load-parts.json',age=28*86400000;
await mkdir('.snapshot-cache',{recursive:true});await mkdir('snapshot',{recursive:true});
let previous,parts={};
try {previous=JSON.parse(await readFile(cache,'utf8'));}catch{}
try {parts=JSON.parse(await readFile(partsFile,'utf8'));}catch{}
if(previous && Date.now()-Date.parse(previous.updated)<age) {
  await writeFile('snapshot/axle-load.json',JSON.stringify(previous));console.log('Using axle-load snapshot within its 28-day refresh interval');process.exit(0);
}
async function query(text) {
 const response=await fetch(api,{method:'POST',body:new URLSearchParams({data:text}),headers:{'User-Agent':'RailwayAtlas-axle-snapshot/1.0 (+https://github.com/c933103/openrailwaystyle)'},signal:AbortSignal.timeout(300000)});
 if(!response.ok) throw new Error(`Overpass HTTP ${response.status}: ${(await response.text()).slice(0,1800)}`);
 const body=await response.text();
 return body;
}
let downloaded=0;
const loadPart=createAxlePartCache({parts,query,save:parts=>writeFile(partsFile,JSON.stringify(parts))});
async function part(key,text,fields=3){
 const value=await loadPart(key,text,fields);downloaded+=value.downloaded;
 console.log(`${value.downloaded?'Downloaded':'Reusing'} validated axle part ${key}: ${value.rows.length} ways, ${value.downloaded} bytes`);return value;
}
try {
 const rail='[railway~"^(rail|narrow_gauge|light_rail|subway|monorail|funicular)$"]';
 const datasets=[];
 for(const [key,selector] of [['capacity','[axle_load]'],['legal','[maxaxleload]'],['d4','["railway:track_class"="D4"]'],['other-classes','["railway:track_class"]["railway:track_class"!="D4"]']]){
  datasets.push(await part(key,`[out:csv(::type,::id,::count,axle_load,maxaxleload,"railway:track_class";false)][timeout:240];way${selector}${rail}->.tracks;.tracks out;.tracks out count;`));
 }
 const fi=await part('finland',`[out:csv(::type,::id,::count;false)][timeout:120];area["ISO3166-1"="FI"][admin_level=2]->.fi;way(area.fi)["railway:track_class"]${rail}->.tracks;.tracks out;.tracks out count;`,0);
 const finnish=new Set(fi.rows.map(([id])=>id)),byId=new Map();
 // Every part carries complete tags; if parts were recovered from different
 // attempts, the newest observation of a shared way wins, including deletions.
 for(const data of datasets.sort((a,b)=>Date.parse(a.updated)-Date.parse(b.updated)))for(const row of data.rows)byId.set(row[0],row);
 const rows=[...byId.values()].map(([id,capacity,maximum,category])=>[id,JSON.stringify({...(capacity&&{axle_load:capacity}),...(maximum&&{maxaxleload:maximum}),...(category&&{track_class:category}),axle_system:finnish.has(id)?'fi':'en'})]);
 const updated=new Date(Math.min(...[...datasets,fi].map(p=>Date.parse(p.updated)))).toISOString();
 const result={...encodeLoadingGauges(rows),updated,ways:rows.length,finnishWays:finnish.size,source:'OpenStreetMap via Overpass API; ODbL'};
 const data=JSON.stringify(result);await writeFile(cache,data);await writeFile('snapshot/axle-load.json',data);
 console.log(`Axle-load lookup: ${rows.length} railway ways, ${finnish.size} Finnish classes, ${Buffer.byteLength(data)} bytes; download ${downloaded} bytes`);
}catch(error){
 console.warn('Axle-load snapshot:',error.message);
 if(!previous){console.log('No previous axle-load snapshot; high-detail unambiguous categories remain available');process.exit(0);}
 await writeFile('snapshot/axle-load.json',JSON.stringify(previous));console.log('Published the previous axle-load lookup');
}
