// Scheduled maintenance-only station acquisition. Never called by map users.
// A run processes at most one bounded Overpass region and checkpoints progress;
// malformed or partial responses never make a completed region.
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {newStationAcquisition,checkStationAcquisition,stationRegionQuery,
 applyStationRegion,postponeStationRegion,stationWorldCoverage} from './station-acquisition.mjs';
import {stationOverviewData} from './station-overview.mjs';

const endpoint=process.env.OVERPASS_URL||'https://overpass-api.de/api/interpreter';
const u=new URL(endpoint);
if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('Overpass must use trusted HTTPS origin');
// This host is not an export destination; never follow a redirect to another.
const input=process.env.PREVIOUS_DATA||'';
const output='station-snapshot';
const MAX_RESPONSE_BYTES=15*1024*1024;
let state=newStationAcquisition(),records=[],existing=false;
if(input){
  let loaded=0;
  try {
    state=JSON.parse(await readFile(join(input,'state.json'),'utf8'));loaded++;
    records=JSON.parse(gunzipSync(await readFile(join(input,'stations.json.gz'))).toString('utf8'));loaded++;
  }catch(err){throw Error('Refusing to overwrite an unreadable station checkpoint: '+err.message)}
  if(loaded!==2)throw Error('Station checkpoint incomplete');
  existing=true;
}
checkStationAcquisition(state,records);
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
    if([429,502,503,504].includes(response.status))throw Error(`Provider temporarily unavailable (HTTP ${response.status})`);
    if(!response.ok)throw Error(`Unexpected OSM HTTP ${response.status}`);
    let oversized=false,chunks=[];
    for await(const chunk of response.body){
      received+=chunk.byteLength;
      if(received>MAX_RESPONSE_BYTES){oversized=true;break;}
      chunks.push(chunk);
    }
    if(oversized){
      await response.body?.cancel().catch(()=>{});
      state=postponeStationRegion(state,pending.box);
      status='split oversized region';
    }else{
      const body=Buffer.concat(chunks).toString('utf8');
      let json;
      try{json=JSON.parse(body)}catch{throw Error('Invalid or truncated OSM JSON response')}
      if(json?.remark){
        if(/too (?:many|large)|out of memory|timed out|maxsize/i.test(json.remark)){
          state=postponeStationRegion(state,pending.box);
          status='split provider-rejected oversized region';
        }else throw Error('OSM server could not complete the query');
      }else{
        const update=applyStationRegion(state,records,pending.box,json);
        state=update.state;records=update.records;accepted=true;status='region complete';
      }
    }
  }catch(error){
    // Cancellation, 429/503 and unexpected errors retain the entire region.
    // Operator can inspect logs before the next scheduled attempt.
    console.warn('Station acquisition deferred:',error.message);
  }finally{clearTimeout(timer)}
}
checkStationAcquisition(state,records);
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
const publish=(path,data)=>writeFile(join(output,path),data);
await publish('state.json',JSON.stringify(state)+'\n');
await publish('stations.json.gz',gzipSync(JSON.stringify(records),{level:6}));
const complete=!state.pending.length&&stationWorldCoverage(state.completed);
const manifest={schema:1,complete,source:'OpenStreetMap via Overpass',license:'ODbL-1.0',
  stations:records.length,pendingRegions:state.pending.length,completedRegions:state.completed.length,
  started:state.started,updated:state.lastUpdate,status,requestBytes:received,regionUpdated:accepted};
if(complete){
  const tiles=stationOverviewData(records);
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
