// Pure world-coverage, checkpoint and bounded query logic for the scheduled
// OSM station-point acquisition. No network I/O occurs in this module.
import {parseStationRegion} from './station-overview.mjs';

export const REGION_SCHEMA=1;
export const FULL_WORLD_AREA=360*180;
export const MAX_PENDING_REGIONS=8192;
export const MAX_COMPLETED_REGIONS=8192;
export const MAX_STATION_RECORDS=750000;
export const MAX_QUERY_ELEMENTS=180000;

export function stationBaseRegions(){
 const result=[];
 // 45-degree disjoint geographic rectangles (8 columns × 4 rows).
 for(let s=-90;s<90;s+=45)for(let w=-180;w<180;w+=45)
   result.push([s,w,s+45,w+45]);
 return result;
}
export function validRegion(box){
 return Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&
   box[0]>=-90&&box[2]<=90&&box[0]<box[2]&&
   box[1]>=-180&&box[3]<=180&&box[1]<box[3];
}
export function splitStationRegion([s,w,n,e]){
 if(!validRegion([s,w,n,e]))throw new Error('Invalid station acquisition region');
 const a=(s+n)/2,b=(w+e)/2;
 return [[s,w,a,b],[s,b,a,e],[a,w,n,b],[a,b,n,e]];
}
export function stationRegionQuery(box){
 if(!validRegion(box))throw new Error('Invalid station acquisition bbox');
 const bounds=box.join(',');
 const queries=[
   `nwr[railway~"^(station|halt|tram_stop)$"](${bounds});`,
   ...['train','subway','light_rail','tram','monorail','funicular']
     .map(mode=>`nwr[public_transport=station][${mode}=yes](${bounds});`),
 ];
 return `[out:json][timeout:120][maxsize:67108864];(${queries.join('')});out body center qt;`;
}
export function centerInside(box,s){
 const {lat,lon}=s;
 return lat>=box[0]&&(lat<box[2]||box[2]===90&&lat===90)&&
   lon>=box[1]&&(lon<box[3]||box[3]===180&&lon===180);
}
const area=([s,w,n,e])=>(n-s)*(e-w);
const overlaps=(a,b)=>a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];
export function stationWorldCoverage(completed){
 if(!Array.isArray(completed)||completed.length>MAX_COMPLETED_REGIONS)return false;
 const boxes=completed.map(r=>r.box);
 if(!boxes.every(validRegion))return false;
 for(let i=0;i<boxes.length;i++)for(let j=0;j<i;j++)
   if(overlaps(boxes[i],boxes[j]))return false;
 return Math.abs(boxes.reduce((s,b)=>s+area(b),0)-FULL_WORLD_AREA)<1e-7;
}
export function newStationAcquisition(){
 return {schema:REGION_SCHEMA,pending:stationBaseRegions().map(box=>({box,depth:0})),completed:[],
   fetchedBytes:0,started:new Date().toISOString(),lastUpdate:null};
}
export function checkStationAcquisition(state,records){
 if(!state||state.schema!==REGION_SCHEMA||!Array.isArray(state.pending)||
   !Array.isArray(state.completed)||state.pending.length>MAX_PENDING_REGIONS||
   state.completed.length>MAX_COMPLETED_REGIONS||!Array.isArray(records)||records.length>MAX_STATION_RECORDS)
   throw new Error('Malformed or oversized station-acquisition checkpoint');
 const boxes=[...state.pending,...state.completed].map(x=>x?.box);
 if(!boxes.every(validRegion))throw new Error('Invalid checkpoint region');
 // Disjoint recorded rectangles (whether pending or complete) must cover
 // the entire world exactly. A lost region can never be marked complete.
 for(let i=0;i<boxes.length;i++)for(let j=0;j<i;j++)
   if(overlaps(boxes[i],boxes[j]))throw new Error('Overlapping station-acquisition regions');
 if(Math.abs(boxes.reduce((s,b)=>s+area(b),0)-FULL_WORLD_AREA)>1e-7)
   throw new Error('Missing station-acquisition geography');
 const ids=new Set();
 for(const s of records){
   if(!s||typeof s.id!=='string'||ids.has(s.id))throw new Error('Invalid or duplicate saved station record');
   ids.add(s.id);
 }
 if(!state.pending.length&&!stationWorldCoverage(state.completed))
   throw new Error('Incomplete station world coverage');
 return true;
}
export function applyStationRegion(state,records,region,json){
 checkStationAcquisition(state,records);
 const first=state.pending[0];
 if(!first||JSON.stringify(first.box)!==JSON.stringify(region))throw new Error('Unexpected station region completion');
 const additions=parseStationRegion(json,{maxElements:MAX_QUERY_ELEMENTS}).filter(p=>centerInside(region,p));
 // Never silently replace an independently fetched object with changed
 // coordinates from another region, or a saved record with conflicting tags.
 const byId=new Map(records.map(r=>[r.id,r]));
 for(const next of additions){
   const prior=byId.get(next.id);
   if(prior&&JSON.stringify(prior)!==JSON.stringify(next))
     throw new Error(`Conflicting station across regions: ${next.id}`);
   byId.set(next.id,next);
 }
 if(byId.size>MAX_STATION_RECORDS)throw new Error('Station inventory over configured limit');
 const updated={...state,pending:state.pending.slice(1),
   completed:[...state.completed,{box:region,at:new Date().toISOString(),count:additions.length}],
   lastUpdate:new Date().toISOString()};
 const nextRows=[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id));
 checkStationAcquisition(updated,nextRows);
 return {state:updated,records:nextRows};
}
export function postponeStationRegion(state,region,{maxDepth=6}={}){
 const first=state?.pending?.[0];
 if(!first||JSON.stringify(first.box)!==JSON.stringify(region))throw new Error('Unexpected station region split');
 if(first.depth>=maxDepth)throw new Error(`Station region remained unavailable after ${maxDepth} splits`);
 const next={...state,pending:[...splitStationRegion(region).map(box=>({box,depth:first.depth+1})),...state.pending.slice(1)]};
 if(next.pending.length>MAX_PENDING_REGIONS)throw new Error('Too many pending station regions');
 return next;
}
