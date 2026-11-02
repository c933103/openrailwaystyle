// Scheduled maintenance-only station acquisition. Never called by map users.
// A run processes at most one bounded Overpass region and checkpoints progress;
// malformed or partial responses never make a completed region.
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {newStationAcquisition,checkStationAcquisition,stationRegionQuery,
 applyStationRegion,postponeStationRegion,stationWorldCoverage,nextStationAcquisitionCycle,
 stationQueryExceededLimits,stationChangesSince,stationChangesQuery,parseStationChanges,applyStationChanges,stationVersion,stationTilesDigest,
 stationRecords,stationWorldQuery,stationSelectionQueries,applyStationSelection} from './station-acquisition.mjs';
import {stationOverviewData} from './station-overview.mjs';

const endpoint=process.env.OVERPASS_URL||'https://overpass-api.de/api/interpreter';
const u=new URL(endpoint);
if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('Overpass must use trusted HTTPS origin');
// This host is not an export destination; never follow a redirect to another.
const input=process.env.PREVIOUS_DATA||'';
const output='station-snapshot';
const MAX_RESPONSE_BYTES=15*1024*1024;
const MAX_ERROR_BYTES=64*1024;
// The worldwide ids of a changed query: about 40 bytes an element.
const MAX_IDS_BYTES=64*1024*1024;
// GitHub refuses files over 100 MB on the work branch.
const MAX_ELEMENTS_BYTES=90*1024*1024;
// Requests a changed query may take in one run (its changes, its ids and
// the newly selected elements by 2,000); more start a new cycle instead.
const MAX_SELECTION_REQUESTS=8;
let state=newStationAcquisition(),records=[],elements=[],existing=false;
if(input){
  let loaded=0;
  try {
    state=JSON.parse(await readFile(join(input,'state.json'),'utf8'));loaded++;
    records=JSON.parse(gunzipSync(await readFile(join(input,'stations.json.gz'))).toString('utf8'));loaded++;
    // A cycle started before elements were kept has records only.
    elements=state.elements?JSON.parse(gunzipSync(await readFile(join(input,'elements.json.gz'))).toString('utf8')):null;
  }catch(err){throw Error('Refusing to overwrite an unreadable station checkpoint: '+err.message)}
  if(loaded!==2)throw Error('Station checkpoint incomplete');
  existing=true;
}
// A generation keeping elements has the records of the current conversion,
// whatever conversion made the stored ones.
let reconverted=false;
if(state.elements){
  const rows=stationRecords(elements);
  reconverted=existing&&JSON.stringify(rows)!==JSON.stringify(records);
  records=rows;
}
// A complete generation takes the changes since its database time instead
// of a new cycle. Otherwise generations are built in the work branch, never
// over the already-complete public station-points-data branch.
// A checkpoint saved before extraction versions were recorded was made by
// this same record conversion (it only moved to station-point.mjs), so it
// counts as the current version and records it once it takes changes; a
// cycle started from now on records its own.
// A complete generation keeping elements whose query changed takes the
// changes of its own query, then only the difference to the new one.
const extraction=stationVersion(state);
const worldQuery=stationWorldQuery();
const queryChanged=!!state.elements&&state.query!==worldQuery;
const changesSince=stationChangesSince(state,queryChanged?state.extraction:extraction);
if(changesSince)state.extraction??=extraction;
let refreshStarted=false,changedRecords=0,restart=false;
const rotate=()=>{
  const rotated=nextStationAcquisitionCycle(state,records,stationVersion(state));
  if(rotated.refreshed)elements=[];
  ({state,records}=rotated);
  refreshStarted=rotated.refreshed;
  // A new cycle keeps elements (newStationAcquisition), with their version.
  if(refreshStarted)state.extraction=stationVersion(state);
};
if(!changesSince)rotate();
const pending=state.pending[0];
const url=new URL(endpoint),query=pending&&stationRegionQuery(pending.box);
let accepted=false,status='already complete',received=0;
if(pending){
  status='retry next maintenance run';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
  try{
    // At most one upstream HTTP request in a scheduled run. A busy public
    // service is never punished by immediate retries or bursty subdivision.
    const response=await fetch(url,{method:'POST',redirect:'error',signal:controller.signal,
      headers:{'User-Agent':'RailwayAtlas-station-snapshot/1 (+https://github.com/c933103/openrailwaystyle)',
        'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({data:query})});
    let oversized=false,chunks=[];
    const limit=response.ok?MAX_RESPONSE_BYTES:MAX_ERROR_BYTES;
    for await(const chunk of response.body){
      received+=chunk.byteLength;
      if(received>limit){oversized=true;break;}
      chunks.push(chunk);
    }
    const body=Buffer.concat(chunks).toString('utf8');
    if(!response.ok){
      // Read only a small bounded diagnostic. An HTML HTTP 5xx can carry
      // the same executed-query limit as a JSON remark. Do not throw away
      // that evidence and retry the unchanged heavy region indefinitely.
      // An incomplete diagnostic is not sufficient evidence to subdivide.
      if(!oversized&&stationQueryExceededLimits(response.status,body)){
        state=postponeStationRegion(state,pending.box);
        status='split provider-rejected oversized region';
      }else throw Error(`Unexpected OSM HTTP ${response.status}`);
    }else if(oversized){
      await response.body?.cancel().catch(()=>{});
      state=postponeStationRegion(state,pending.box);
      status='split oversized region';
    }else{
      let json;
      try{json=JSON.parse(body)}catch{throw Error('Invalid or truncated OSM JSON response')}
      if(json?.remark){
        if(stationQueryExceededLimits(response.status,json.remark)){
          state=postponeStationRegion(state,pending.box);
          status='split provider-rejected oversized region';
        }else throw Error('OSM server could not complete the query');
      }else{
        const update=applyStationRegion(state,records,pending.box,json,elements);
        state=update.state;records=update.records;accepted=true;status='region complete';
        if(state.elements)elements=update.elements;
      }
    }
  }catch(error){
    // Cancellation, 429/503 and unexpected errors retain the entire region.
    // Operator can inspect logs before the next scheduled attempt.
    console.warn('Station acquisition deferred:',error.message);
  }finally{clearTimeout(timer)}
}
if(changesSince){
  status='changes deferred to the next maintenance run';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),360000);
  // One request for the changes; a failure keeps the generation as it is,
  // and the next run asks again from the same time.
  const post=async(data,max)=>{
    const response=await fetch(url,{method:'POST',redirect:'error',signal:controller.signal,
      headers:{'User-Agent':'RailwayAtlas-station-snapshot/1 (+https://github.com/c933103/openrailwaystyle)',
        'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({data})});
    const chunks=[],limit=response.ok?max:MAX_ERROR_BYTES;
    let size=0;
    for await(const chunk of response.body){
      received+=chunk.byteLength;size+=chunk.byteLength;
      if(size>limit)throw Error('Oversized station change response');
      chunks.push(chunk);
    }
    if(!response.ok)throw Error(`Unexpected OSM HTTP ${response.status}`);
    return Buffer.concat(chunks).toString('utf8');
  };
  const elementsOf=text=>{
    let json;
    try{json=JSON.parse(text)}catch{throw Error('Invalid or truncated OSM JSON response')}
    if(json?.remark||!Array.isArray(json?.elements))throw Error('OSM server could not complete the query');
    return json.elements;
  };
  try{
    const changes=parseStationChanges(await post(stationChangesQuery(changesSince,state.elements?state.query:undefined),MAX_RESPONSE_BYTES));
    const update=applyStationChanges(state,records,changes,state.elements?{elements}:{});
    state=update.state;records=update.records;changedRecords=update.changed;
    if(state.elements)elements=update.elements;
    status=`changes since ${changesSince} applied`;
    if(queryChanged){
      // Brought to the new query at the changes' database time: its ids, and
      // the elements it newly selects by id. A run that fails here has the
      // changes; the next one takes the difference from there.
      const at=state.changesSince,selection=stationSelectionQueries(state,at,worldQuery);
      if(!selection)restart=true;
      else if(!selection.ids)({state,records,elements}=applyStationSelection(state,records,elements,{ids:elements.map(e=>`${e.type}/${e.id}`),added:[]},worldQuery));
      else{
        const ids=elementsOf(await post(selection.ids,MAX_IDS_BYTES)).map(e=>`${e.type}/${e.id}`);
        const stored=new Set(elements.map(e=>`${e.type}/${e.id}`)),missing=ids.filter(key=>!stored.has(key));
        if(2+Math.ceil(missing.length/2000)>MAX_SELECTION_REQUESTS)restart=true;
        else{
          const added=[];
          for(let i=0;i<missing.length;i+=2000)added.push(...elementsOf(await post(selection.elements(missing.slice(i,i+2000)),MAX_RESPONSE_BYTES)));
          const update=applyStationSelection(state,records,elements,{ids,added},worldQuery);
          ({state,records,elements}=update);changedRecords+=update.changed;
        }
      }
      status=restart?'query changed beyond its difference: new cycle':`changes since ${changesSince} and the new query applied`;
    }
  }catch(error){
    console.warn('Station changes deferred:',error.message);
  }finally{clearTimeout(timer)}
  if(restart)rotate();
}
checkStationAcquisition(state,records);
const complete=!state.pending.length&&stationWorldCoverage(state.completed);
// The complete generation's tiles, and whether they are published: when this
// run's region completed the cycle, its changes altered stations, or the
// tiles differ from the last published ones (a change to the tile code).
const tiles=complete?stationOverviewData(records):null;
let tilesDigest=null,publication=false;
if(tiles){
  tilesDigest=stationTilesDigest(tiles.archives);
  publication=accepted||changedRecords>0||reconverted||tilesDigest!==state.publishedTiles;
  if(publication)state.publishedTiles=tilesDigest;
}
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
const publish=(path,data)=>writeFile(join(output,path),data);
await publish('state.json',JSON.stringify(state)+'\n');
await publish('stations.json.gz',gzipSync(JSON.stringify(records),{level:6}));
let elementBytes=null;
if(state.elements){
  const packed=gzipSync(JSON.stringify(elements),{level:9});
  if(packed.byteLength>MAX_ELEMENTS_BYTES)throw Error(`Station elements of ${packed.byteLength} bytes exceed the work-branch limit`);
  elementBytes=packed.byteLength;
  await publish('elements.json.gz',packed);
}
const manifest={schema:1,complete,source:'OpenStreetMap via Overpass',license:'ODbL-1.0',
  stations:records.length,pendingRegions:state.pending.length,completedRegions:state.completed.length,
  started:state.started,updated:state.lastUpdate,status,requestBytes:received,regionUpdated:accepted,
  changesSince:state.changesSince||null,changedRecords,tilesDigest,publish:publication,
  elements:state.elements?elements.length:null,elementBytes,reconverted};
if(complete){
  for(const [path,bytes] of tiles.archives){
    const target=join(output,path);
    await mkdir(join(target,'..'),{recursive:true});
    await writeFile(target,bytes);
  }
  await publish('index.json',JSON.stringify(tiles.index)+'\n');
  Object.assign(manifest,tiles.manifest,{complete:true,updated:state.lastUpdate});
}else await publish('index.json',JSON.stringify({tiles:[]})+'\n');
await publish('manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log('STATION_SNAPSHOT',JSON.stringify(manifest));
if(!existing)console.log('Initial snapshot: new independent station acquisition');
if(refreshStarted)console.log('Refreshing station source in a new unpublished generation');
