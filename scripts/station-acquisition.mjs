// Pure world-coverage, checkpoint and bounded query logic for the scheduled
// OSM station-point acquisition. No network I/O occurs in this module.
import {parseStationRegion,stationPoint} from './station-overview.mjs';
import {adiffQuery,parseAdiff,extractionVersion,selectionChangeQueries} from './overpass-adiff.mjs';
import {createHash} from 'node:crypto';
import {regionDepth as depthBelow, tilesWorld, worldRegions} from './world-regions.mjs';

export const REGION_SCHEMA=1;
export const FULL_WORLD_AREA=360*180;
export const MAX_PENDING_REGIONS=8192;
export const MAX_COMPLETED_REGIONS=8192;
export const MAX_STATION_RECORDS=750000;
export const MAX_QUERY_ELEMENTS=180000;
export const MAX_STATION_ELEMENTS=1000000;
const WORLD=[-90,-180,90,180];

export function stationBaseRegions(){
 // 45-degree disjoint geographic rectangles (8 columns × 4 rows).
 return worldRegions(45);
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
 return `[out:json][timeout:120][maxsize:67108864];(${queries.join('')});out meta center qt;`;
}
// Only an explicit executed-query limit justifies a smaller geographic query.
// Generic gateway failures and dispatcher/admission timeouts say nothing about
// this region's size. HTTP permission/syntax/rate-limit errors never subdivide.
export function stationQueryExceededLimits(status,detail){
 if(status!==200&&(!Number.isInteger(status)||status<500||status>599||status===503))return false;
 if(typeof detail!=='string'||detail.length>64*1024)return false;
 const text=detail.replace(/<[^<>]*>/g,' ').replace(/\s+/g,' ');
 if(/Dispatcher|too busy|rate.limited|at capacity|query workers (?:are )?busy|request queue (?:is )?full/i.test(text))return false;
 return /runtime error:\s*Query\s+(?:timed? ?out\b|(?:run|ran) out of memory\b)/i.test(text);
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
 return tilesWorld(completed.map(r=>r.box));
}
// A region's split depth below the 45-degree base regions.
const regionDepth=r=>Number.isInteger(r.depth)?r.depth:depthBelow(r.box,45);
// With the regions a complete cycle fetched, the next cycle asks for those
// regions: a region once split for exceeding the server's limits stays split
// instead of being requested whole again every cycle.
// A cycle keeps every element its query selects (`elements`: true), not only
// the station records made of them, and records the query (`query`, worldwide)
// and its version (`extraction`, see stationQueryVersion): the records are
// converted from the elements on every run, so changed conversion code needs
// no download, and a changed query needs only the difference.
export function newStationAcquisition(regions){
 const start=regions?.length?regions.map(r=>({box:[...r.box],depth:regionDepth(r)})):stationBaseRegions().map(box=>({box,depth:0}));
 return {schema:REGION_SCHEMA,pending:start,completed:[],
   fetchedBytes:0,started:new Date().toISOString(),lastUpdate:null,
   elements:true,query:stationWorldQuery(),extraction:stationQueryVersion()};
}
// What a cycle keeps of an element: what the conversion may read.
export function stationElement(element){
 if(!element||!['node','way','relation'].includes(element.type)||!Number.isSafeInteger(element.id)||element.id<1)
   throw new Error('Station source element without a valid OSM identity');
 if(!Number.isSafeInteger(element.version)||element.version<1)
   throw new Error(`OSM object ${element.type}-${element.id} lacks version metadata`);
 const kept={type:element.type,id:element.id,version:element.version};
 if(typeof element.timestamp==='string')kept.timestamp=element.timestamp;
 if(element.tags&&typeof element.tags==='object')kept.tags=element.tags;
 if(element.type==='node'){kept.lat=element.lat;kept.lon=element.lon;}
 else if(element.center)kept.center={lat:element.center.lat,lon:element.center.lon};
 return kept;
}
const elementKey=e=>`${e.type}-${e.id}`;
const byKey=elements=>[...elements].sort((a,b)=>elementKey(a).localeCompare(elementKey(b)));
// The station records of the kept elements, by the current conversion.
export function stationRecords(elements){
 if(!Array.isArray(elements)||elements.length>MAX_STATION_ELEMENTS)throw new Error('Malformed or oversized station element store');
 const rows=[];
 for(const element of elements){
   const point=stationPoint(element);
   if(!point)continue;
   if(point.osm_version===null)throw new Error(`OSM object ${point.id} lacks version metadata`);
   rows.push(point);
 }
 if(rows.length>MAX_STATION_RECORDS)throw new Error('Station inventory over configured limit');
 return rows.sort((a,b)=>a.id.localeCompare(b.id));
}
function checkStationElements(state,elements){
 if(!state.elements)return;
 if(!Array.isArray(elements)||elements.length>MAX_STATION_ELEMENTS)throw new Error('Malformed or oversized station element store');
 const keys=new Set();
 for(const e of elements){
   const key=e&&elementKey(e);
   if(!key||keys.has(key))throw new Error('Invalid or duplicate saved station element');
   keys.add(key);
 }
}
// One entire verified source generation is immutable to map readers.
// The next collection starts with an empty table; its progress stays in
// station-points-work until a *separate* complete-generation publication.
// An incomplete cycle made by another region query or record conversion
// (`extraction`, see stationExtraction) restarts, keeping its regions, so a
// generation never mixes records of two conversions. One without a recorded
// version predates them and counts as current.
export function nextStationAcquisitionCycle(state,records,extraction){
 checkStationAcquisition(state,records);
 if(state.pending.length&&extraction!==undefined&&state.extraction!==undefined&&state.extraction!==extraction)
   return {state:newStationAcquisition([...state.completed,...state.pending]),records:[],refreshed:true};
 if(state.pending.length)return {state,records,refreshed:false};
 if(!stationWorldCoverage(state.completed))throw new Error('Cannot refresh incomplete station inventory');
 return {state:newStationAcquisition(state.completed),records:[],refreshed:true};
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
export function applyStationRegion(state,records,region,json,elements){
 checkStationAcquisition(state,records);
 checkStationElements(state,elements);
 const first=state.pending[0];
 if(!first||JSON.stringify(first.box)!==JSON.stringify(region))throw new Error('Unexpected station region completion');
 if(state.elements)return applyRegionElements(state,region,json,elements);
 // Overpass returns intersecting ways/relations, whose bbox centre can be
 // outside the queried region and even outside *every* region intersected by
 // their actual geometry (concave/multipart OSM objects). Keep these records
 // wherever found and deduplicate globally using their typed OSM identity.
 // Nodes use strict half-open geographic ownership to avoid edge ambiguity.
 const additions=parseStationRegion(json,{maxElements:MAX_QUERY_ELEMENTS,requireVersion:true})
   .filter(p=>p.osm_type!=='node'||centerInside(region,p));
 // Ways and relations may occur in several regional queries. A source
 // object can change while a worldwide crawl is in progress. OSM version is
 // authoritative: keep the highest version observed, rather than stalling on
 // the changed tags/coordinates or silently accepting the last response.
 const byId=new Map(records.map(r=>[r.id,r]));
 for(const next of additions){
   const prior=byId.get(next.id);
   if(prior){
     const previousVersion=prior.osm_version??0;
     if(next.osm_version < previousVersion)continue;
     if(next.osm_version===previousVersion){
       if(JSON.stringify(prior)!==JSON.stringify(next))
         throw new Error(`OSM station ${next.id} differs at identical version`);
       continue;
     }
   }
   byId.set(next.id,next);
 }
 if(byId.size>MAX_STATION_RECORDS)throw new Error('Station inventory over configured limit');
 const updated={...state,pending:state.pending.slice(1),
   completed:[...state.completed,{box:region,depth:first.depth,at:new Date().toISOString(),count:additions.length}],
   lastUpdate:new Date().toISOString()};
 const nextRows=[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id));
 checkStationAcquisition(updated,nextRows);
 return {state:updated,records:nextRows};
}
// A cycle keeping elements keeps every selected element of the region (the
// highest version seen, as for records), whether or not the conversion makes
// a station of it, and converts all of them.
function applyRegionElements(state,region,json,elements){
 // The same checks as the records: a response the conversion refuses fails.
 const additions=parseStationRegion(json,{maxElements:MAX_QUERY_ELEMENTS,requireVersion:true})
   .filter(p=>p.osm_type!=='node'||centerInside(region,p));
 const stored=new Map(elements.map(e=>[elementKey(e),e]));
 for(const source of json.elements){
   const next=stationElement(source);
   if(next.type==='node'&&!centerInside(region,next))continue;
   // A way's centre can move at the same version (its nodes moved) between
   // two regions' responses; the first one read stays, and later changes
   // bring it up to date.
   const prior=stored.get(elementKey(next));
   if(prior&&prior.version>=next.version)continue;
   stored.set(elementKey(next),next);
 }
 if(stored.size>MAX_STATION_ELEMENTS)throw new Error('Station element store over configured limit');
 const first=state.pending[0];
 const updated={...state,pending:state.pending.slice(1),
   completed:[...state.completed,{box:region,depth:first.depth,at:new Date().toISOString(),count:additions.length}],
   lastUpdate:new Date().toISOString()};
 const nextElements=byKey(stored.values()),rows=stationRecords(nextElements);
 checkStationAcquisition(updated,rows);
 return {state:updated,records:rows,elements:nextElements};
}
export function postponeStationRegion(state,region,{maxDepth=6}={}){
 const first=state?.pending?.[0];
 if(!first||JSON.stringify(first.box)!==JSON.stringify(region))throw new Error('Unexpected station region split');
 if(first.depth>=maxDepth)throw new Error(`Station region remained unavailable after ${maxDepth} splits`);
 const next={...state,pending:[...splitStationRegion(region).map(box=>({box,depth:first.depth+1})),...state.pending.slice(1)]};
 if(next.pending.length>MAX_PENDING_REGIONS)throw new Error('Too many pending station regions');
 return next;
}

// What makes a station record of OSM data: the region query's selection and
// the record conversion (station-point.mjs with its imports). A generation
// made by another one starts a new cycle rather than taking changes, which
// the current code would convert alone.
export const stationExtraction=()=>extractionVersion(stationRegionQuery(WORLD),new URL('./station-point.mjs',import.meta.url));
// The worldwide selection, with the time and size a worldwide request needs.
export const stationWorldQuery=()=>stationRegionQuery(WORLD)
 .replace('[timeout:120][maxsize:67108864]','[timeout:300][maxsize:268435456]');
// A generation keeping its elements depends on its query alone: the records
// are converted from the elements on every run.
export const stationQueryVersion=()=>extractionVersion(stationWorldQuery());
// The version a generation is current to: its query's for one keeping
// elements, otherwise its query's and conversion's.
export const stationVersion=state=>state?.elements?stationQueryVersion():stationExtraction();
// A complete generation is kept up to date with the changes since its
// database time instead of being downloaded again region by region: the
// time it is current to (`changesSince`, at first its cycle's start), or
// null when there is no complete generation yet or it was made by another
// extraction. Its age is no reason for a new cycle: the changes since that
// time make it exact however old it is.
export function stationChangesSince(state,extraction=stationVersion(state)){
 if(!state||!Array.isArray(state.pending)||state.pending.length||!stationWorldCoverage(state.completed))return null;
 // A state without a version predates them and was made by this conversion.
 if((state.extraction??extraction)!==extraction)return null;
 const since=state.changesSince||(typeof state.started==='string'?state.started.replace(/\.\d+Z$/,'Z'):'');
 return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(since)?since:null;
}
// The changes worldwide, as one augmented diff of the region query, with the
// time and size a worldwide request needs.
export const stationChangesQuery=(since,query=stationWorldQuery())=>adiffQuery(query,since);
export const parseStationChanges=parseAdiff;
// The generation brought up to date: deleted elements and ones that are no
// longer stations leave, changed ones replace their record unless an older
// version, new ones join. A result losing over `maxDrop` of the stations
// throws, as does anything the full download would refuse.
//
// The first changes after a cycle start from the cycle's start, but the
// regions were read over days. A record edited after that start which the
// changes do not mention matched the query at neither end: it was created
// (or became a station) and went again while the regions were read, so it
// leaves too. Any other record edited since then is a created, changed or
// deleted element of the changes.
export function applyStationChanges(state,records,{timestamp,upserts,deletes},{now=new Date().toISOString(),maxDrop=0.05,elements}={}){
 checkStationAcquisition(state,records);
 checkStationElements(state,elements);
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(timestamp||''))throw new Error('Station changes without a database time');
 if(state.elements)return applyElementChanges(state,records,elements,{timestamp,upserts,deletes},{now,maxDrop});
 const byId=new Map(records.map(r=>[r.id,r]));
 let changed=0;
 if(!state.changesSince){
   const since=Date.parse(state.started),mentioned=new Set([...upserts.map(e=>`${e.type}-${e.id}`),...deletes.map(key=>key.replace('/','-'))]);
   if(!Number.isFinite(since))throw new Error('Station cycle without a start time');
   for(const [id,record] of byId)
     if(Date.parse(record.osm_timestamp)>since&&!mentioned.has(id)){byId.delete(id);changed++;}
 }
 for(const key of deletes)if(byId.delete(key.replace('/','-')))changed++;
 for(const element of upserts){
   const id=`${element.type}-${element.id}`,point=stationPoint(element);
   if(!point){if(byId.delete(id))changed++;continue;}
   if(point.osm_version===null)throw new Error(`OSM object ${id} lacks version metadata`);
   const prior=byId.get(id);
   if(prior&&(prior.osm_version??0)>point.osm_version)continue;
   if(JSON.stringify(prior)!==JSON.stringify(point)){byId.set(id,point);changed++;}
 }
 if(byId.size<records.length*(1-maxDrop))throw new Error(`Station changes would drop the stations from ${records.length} to ${byId.size}`);
 if(byId.size>MAX_STATION_RECORDS)throw new Error('Station inventory over configured limit');
 const updated={...state,changesSince:timestamp,lastUpdate:now};
 const rows=[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id));
 checkStationAcquisition(updated,rows);
 return {state:updated,records:rows,changed};
}

// The same rules for a generation keeping elements, applied to the elements:
// an element still selected stays even when it is no station.
function applyElementChanges(state,records,elements,{timestamp,upserts,deletes},{now,maxDrop}){
 const stored=new Map(elements.map(e=>[elementKey(e),e]));
 if(!state.changesSince){
   const since=Date.parse(state.started),mentioned=new Set([...upserts.map(elementKey),...deletes.map(key=>key.replace('/','-'))]);
   if(!Number.isFinite(since))throw new Error('Station cycle without a start time');
   for(const [key,element] of stored)
     if(Date.parse(element.timestamp)>since&&!mentioned.has(key))stored.delete(key);
 }
 for(const key of deletes)stored.delete(key.replace('/','-'));
 for(const source of upserts){
   const next=stationElement(source),prior=stored.get(elementKey(next));
   if(prior&&prior.version>next.version)continue;
   stored.set(elementKey(next),next);
 }
 const nextElements=byKey(stored.values());
 return withElements(state,records,nextElements,{changesSince:timestamp,lastUpdate:now},maxDrop);
}
// The generation with other elements, and how many station records changed.
function withElements(state,records,elements,fields,maxDrop){
 if(elements.length>MAX_STATION_ELEMENTS)throw new Error('Station element store over configured limit');
 const rows=stationRecords(elements);
 if(rows.length<records.length*(1-maxDrop))throw new Error(`Station changes would drop the stations from ${records.length} to ${rows.length}`);
 const before=new Map(records.map(r=>[r.id,JSON.stringify(r)])),after=new Set(rows.map(r=>r.id));
 let changed=rows.filter(r=>before.get(r.id)!==JSON.stringify(r)).length;
 for(const id of before.keys())if(!after.has(id))changed++;
 const updated={...state,...fields};
 checkStationAcquisition(updated,rows);
 return {state:updated,records:rows,elements,changed};
}
// The requests that bring a complete generation keeping elements, already
// brought by its changes to the database time `at`, to another query's
// selection: null when they cannot (a new cycle is due), {} when the
// selection is the same. See selectionChangeQueries in overpass-adiff.mjs.
export const stationSelectionQueries=(state,at,query=stationWorldQuery())=>
 state?.elements&&state.query?selectionChangeQueries(state.query,query,at):null;
// The generation at the selection of `query`: of the stored elements, those
// it selects (`ids`, its `type/id` keys at that time), with the elements it
// newly selects (`added`, every one of the missing ids). Any share of the
// stations may go: the query decides.
export function applyStationSelection(state,records,elements,{ids,added},query=stationWorldQuery()){
 checkStationAcquisition(state,records);
 checkStationElements(state,elements);
 if(!state.elements)throw new Error('A generation without elements cannot take another selection');
 const selected=new Set([...ids].map(key=>key.replace('/','-')));
 const stored=new Map(elements.filter(e=>selected.has(elementKey(e))).map(e=>[elementKey(e),e]));
 for(const source of added){const next=stationElement(source);stored.set(elementKey(next),next);}
 if(stored.size!==selected.size||[...selected].some(key=>!stored.has(key)))throw new Error('The selected station elements did not all come back');
 return withElements(state,records,byKey(stored.values()),{query,extraction:extractionVersion(query)},1);
}

// A digest of a generation's tile archives (path → bytes), to publish tiles
// that changed without any station changing (a change to the tile code).
export function stationTilesDigest(archives){
 const hash=createHash('sha256');
 for(const [path,bytes] of [...archives].sort(([a],[b])=>a.localeCompare(b)))hash.update(`${path}\n`).update(bytes);
 return hash.digest('hex');
}
