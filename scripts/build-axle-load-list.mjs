// Maintenance only: a compact way-ID lookup; no Overpass calls from viewers.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {axleRows} from './axle-load-csv.mjs';
import {encodeLoadingGauges} from '../styles/loading-gauge-list.mjs';
const api='https://overpass-api.de/api/interpreter',cache='.snapshot-cache/axle-load.json',age=28*86400000;
await mkdir('.snapshot-cache',{recursive:true});await mkdir('snapshot',{recursive:true});
let previous;
try {previous=JSON.parse(await readFile(cache,'utf8'));}catch{}
if(previous && Date.now()-Date.parse(previous.updated)<age) {
  await writeFile('snapshot/axle-load.json',JSON.stringify(previous));console.log('Using axle-load snapshot within its 28-day refresh interval');process.exit(0);
}
async function query(text) {
 const response=await fetch(api,{method:'POST',body:new URLSearchParams({data:text}),headers:{'User-Agent':'RailwayAtlas-axle-snapshot/1.0 (+https://github.com/c933103/openrailwaystyle)'},signal:AbortSignal.timeout(300000)});
 if(!response.ok) throw new Error(`Overpass HTTP ${response.status}: ${(await response.text()).slice(0,1800)}`);
 const body=await response.text();
 return body;
}
try {
 const rail='[railway~"^(rail|narrow_gauge|light_rail|subway|monorail|funicular)$"]';
 const world=await query(`[out:csv(::type,::id,::count,axle_load,maxaxleload,"railway:track_class";false)][timeout:240];(way${rail}[axle_load];way${rail}[maxaxleload];way${rail}["railway:track_class"];)->.tracks;.tracks out;.tracks out count;`);
 const fi=await query(`[out:csv(::type,::id,::count;false)][timeout:120];area["ISO3166-1"="FI"][admin_level=2]->.fi;way(area.fi)${rail}["railway:track_class"]->.tracks;.tracks out;.tracks out count;`);
 const finnish=new Set(axleRows(fi,0).map(([id])=>id));
 const rows=axleRows(world,3).map(([id,capacity,maximum,category])=>[id,JSON.stringify({...(capacity&&{axle_load:capacity}),...(maximum&&{maxaxleload:maximum}),...(category&&{track_class:category}),axle_system:finnish.has(id)?'fi':'en'})]);
 const result={...encodeLoadingGauges(rows),updated:new Date().toISOString(),ways:rows.length,finnishWays:finnish.size,source:'OpenStreetMap via Overpass API; ODbL'};
 const data=JSON.stringify(result);await writeFile(cache,data);await writeFile('snapshot/axle-load.json',data);
 console.log(`Axle-load lookup: ${rows.length} railway ways, ${finnish.size} Finnish classes, ${Buffer.byteLength(data)} bytes; download ${Buffer.byteLength(world)+Buffer.byteLength(fi)} bytes`);
}catch(error){
 console.warn('Axle-load snapshot:',error.message);
 if(!previous){console.log('No previous axle-load snapshot; high-detail unambiguous categories remain available');process.exit(0);}
 await writeFile('snapshot/axle-load.json',JSON.stringify(previous));console.log('Published the previous axle-load lookup');
}
