import {responseChunks} from './response-chunks.mjs';
// Maintenance-only staged worldwide Overpass acquisition shared by snapshot
// builders. Each snapshot supplies its own query, response transform, cache
// naming and published file names; the acquisition, retry, budget, checkpoint
// and publication rules are common and tested through every caller.
import {STAGES} from './download-stages.mjs';
import {updateElements,requireGeometry} from './overpass-adiff.mjs';
import {mkdir,readFile,writeFile,stat,mkdtemp,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {WORLD_QUADRANTS,quarters} from './world-regions.mjs';

export const STAGED_LIMITS=Object.freeze({requests:96,bytes:100_000_000,elapsedMs:3600_000,depth:6,attempts:3,timeoutMs:300_000,pauseMs:10_000,retryMs:40_000,maxRetryAfterMs:300_000});
export const STAGED_REGIONS=WORLD_QUADRANTS;
// A cached response a week old is brought up to date with the changes since
// its database time. It has no age limit: the changes make it exact however
// old it is, so it is downloaded again only when its query changes or on a
// refresh.
export const STAGED_UPDATE_EVERY=7*86400_000;
const children=quarters;
const digest=body=>createHash('sha256').update(body).digest('hex');
export class AcquisitionError extends Error {
  constructor(message,category,{retry=false,split=false,retryAfterMs=0,cause}={}) {super(message,{cause});Object.assign(this,{category,retry,split,retryAfterMs});}
}
const fatal=(message,category='validation',cause)=>new AcquisitionError(message,category,{cause});
function retryAfter(value,now) {
  if(!value)return 0;
  if(/^\d+$/.test(value.trim()))return Number(value)*1000;
  const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;
}

// config: {noun, label, userAgent, query(box), transform(json), cachePrefix,
// cacheVersion, files:{data,gzip,manifest}, stagePrefix, emptyMessage,
// completeMessage}. noun is the lower-case name used in error messages.
export function createStagedSnapshot(config) {
  const {noun,query:snapshotQuery,transform}=config;
  const Noun=noun[0].toUpperCase()+noun.slice(1);
  function transportError(error,signal) {
    if(error instanceof AcquisitionError)return error;
    const reason=signal?.aborted?signal.reason:error;
    const code=reason?.cause?.code||reason?.code;
    // Even a body deadline can be a stalled connection rather than an oversized
    // query. Only explicit Overpass execution-limit remarks establish a spatial
    // failure; transport deadlines never create durable split checkpoints.
    if(reason?.name==='TimeoutError'||['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(code))return new AcquisitionError(`${Noun} transport timed out`,'transport',{retry:true,cause:error});
    if(['ECONNRESET','ECONNREFUSED','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','UND_ERR_SOCKET'].includes(code)||error instanceof TypeError&&error.message==='fetch failed')return new AcquisitionError(`${Noun} transport failed`,'transport',{retry:true,cause:error});
    return fatal(error.message||`${Noun} request failed`,'transport',error);
  }
  function completedResponse(json) {
    if(json?.remark) {
      const remark=String(json.remark);
      if(/\b(?:parse error|static error|syntax error|unauthorized|forbidden|permission denied)\b/i.test(remark))throw fatal(`Overpass rejected response: ${remark}`);
      if(/\b(?:query\s+)?timed?\s*out\b/i.test(remark))throw new AcquisitionError(remark,'timeout',{retry:true,split:true});
      if(/\b(?:ran?\s+out\s+of\s+memory|out\s+of\s+memory|memory\s+limit\s+(?:exceeded|reached))\b/i.test(remark))throw new AcquisitionError(remark,'resource',{retry:true,split:true});
      throw fatal(`Overpass rejected response: ${remark}`);
    }
    try {return transform(json);}catch(error){throw fatal(error.message,'validation',error);}
  }

  // Publication checks use the same partition tree as acquisition. A leaf count
  // alone cannot detect a missing quadrant, overlap, duplicate or coverage gap.
  function validate(data,manifest) {
    if(manifest?.complete!==true||manifest.version!==1||data?.type!=='FeatureCollection'||!Array.isArray(data.features)||!data.features.length||manifest.features!==data.features.length)throw fatal(`Incomplete or empty worldwide ${noun} snapshot`);
    if(manifest.sha256!==digest(JSON.stringify(data)))throw fatal(`${Noun} snapshot digest mismatch`);
    const ids=new Set(data.features.map(f=>f.id));
    if(ids.size!==data.features.length||data.features.some(f=>typeof f.id!=='string'||f.type!=='Feature'||!f.geometry||!f.properties))throw fatal(`Invalid or duplicate ${noun} features`);
    if(!Array.isArray(manifest.coverage))throw fatal(`Missing worldwide ${noun} coverage`);
    if(manifest.partition==='railway-ways-stages')return validateStageCoverage(manifest);
    if(manifest.partition!==undefined)throw fatal(`Unknown ${noun} coverage partition`);
    const leaves=new Map();
    for(const leaf of manifest.coverage) {
      snapshotQuery(leaf.bbox);
      const key=leaf.bbox.join(',');
      if(leaves.has(key)||!Number.isSafeInteger(leaf.features)||leaf.features<0)throw fatal(`Invalid or duplicate ${noun} coverage`);
      leaves.set(key,leaf);
    }
    let visited=0;
    const visit=(box,depth=0)=>{
      if(leaves.has(box.join(','))){visited++;return;}
      if(depth===STAGED_LIMITS.depth)throw fatal(`Incomplete worldwide ${noun} coverage: ${box}`);
      for(const child of children(box))visit(child,depth+1);
    };
    for(const box of STAGED_REGIONS)visit(box);
    if(visited!==leaves.size)throw fatal(`Overlapping or non-partition ${noun} coverage`);
    return manifest;
  }

  async function build({api=process.env.OVERPASS_URL||'https://overpass-api.de/api/interpreter',output=process.env.POWER_OUTPUT||'power-data',cache='.snapshot-cache',refresh=process.env.POWER_REFRESH==='1',fetcher=globalThis.fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now,limits={},log=console.log}={}) {
    const policy={...STAGED_LIMITS,...limits};
    for(const [key,value] of Object.entries(policy))if(!Number.isSafeInteger(value)||value<0||['attempts','requests','bytes','elapsedMs','timeoutMs'].includes(key)&&value===0||value>STAGED_LIMITS[key])throw fatal(`Invalid ${noun} limit: ${key}`,'budget');
    await mkdir(cache,{recursive:true});await mkdir(output,{recursive:true});
    const started=now(),features=new Map(),coverage=[];let downloaded=0,requests=0;
    const remaining=()=>policy.elapsedMs-(now()-started);
    const checkTime=()=>{if(remaining()<=0)throw fatal(`${Noun} elapsed-time budget exceeded`,'budget');};
    // A wait the server asked for (Retry-After) on a change request that
    // failed, kept for the next request of the run, whichever it is.
    let serverWait=0;
    const pause=async()=>{const ms=Math.max(policy.pauseMs,serverWait);serverWait=0;await delay(ms);};
    async function delay(ms) {
      checkTime();
      if(ms>=remaining())throw fatal(`${Noun} elapsed-time budget exceeded before retry`,'budget');
      if(ms)await sleep(ms);
      checkTime();
    }
    async function request(query,{text=false}={}) {
      checkTime();
      if(requests>=policy.requests)throw fatal(`${Noun} request budget exceeded`,'budget');
      const signal=AbortSignal.timeout(Math.max(1,Math.min(policy.timeoutMs,remaining())));
      requests++;
      let response;
      try {
        response=await fetcher(api,{method:'POST',body:new URLSearchParams({data:query}),headers:{'User-Agent':`${config.userAgent} (+https://github.com/c933103/openrailwaystyle)`},signal,redirect:'error'});
        // HTTP classification precedes parsing; a 403 saying "timeout" is not
        // evidence that a spatial query executed or can benefit from subdivision.
        if(!response.ok) {
          // Discarding an error body may reject or never settle. Initiate it
          // without awaiting cleanup, preserving the authoritative HTTP category
          // and its bounded retry/failure path rather than a cleanup timeout.
          try {response.body?.cancel?.()?.catch(()=>{});}catch{}
          const status=response.status,wait=retryAfter(response.headers?.get('retry-after'),now());
          if(status===429||status===408||[500,502,503,504].includes(status))throw new AcquisitionError(`HTTP ${status}`,status===429?'rate-limit':'http-transient',{retry:true,retryAfterMs:wait});
          throw fatal(`HTTP ${status}`,'http-permanent');
        }
        const chunks=[];
        try {
          for await(const chunk of responseChunks(response)) {
            downloaded+=chunk.length;
            if(downloaded>policy.bytes)throw fatal(`${Noun} download budget exceeded`,'budget');
            checkTime();chunks.push(chunk);
          }
        }catch(error){throw transportError(error,signal);}
        if(text){checkTime();return Buffer.concat(chunks).toString('utf8');}
        let json;
        try {json=JSON.parse(Buffer.concat(chunks));}catch(error){throw fatal(`Malformed ${noun} JSON`,'parsing',error);}
        checkTime();completedResponse(json);return json;
      }catch(error){throw transportError(error,signal);}
    }
    // A response is reused while its query is unchanged, never on a
    // refresh. A split decision stays for as long as the query is unchanged:
    // the region is known to exceed the server's limits, so a refresh asks
    // for its parts, never the whole region again.
    async function checkpoint(file,query,split=false) {
      if(refresh&&!split)return undefined;
      try {
        const info=await stat(file),saved=JSON.parse(await readFile(file,'utf8'));
        if(saved.query!==query)return undefined;
        if(split)return saved.kind==='spatial-split'&&saved.version===1?true:undefined;
        completedResponse(saved.response);return saved.response;
      }catch{return undefined;}
    }
    // A cached response of another query: brought to the current query by
    // only the difference, rather than downloaded again.
    async function earlier(file) {
      if(refresh)return undefined;
      try {
        const saved=JSON.parse(await readFile(file,'utf8'));
        return typeof saved.query==='string'&&Array.isArray(saved.response?.elements)?saved:undefined;
      }catch{return undefined;}
    }
    async function save(file,value) {
      const temporary=`${file}.tmp`;
      await writeFile(temporary,JSON.stringify(value));await rename(temporary,file);
    }
    async function collect(box,depth=0) {
      checkTime();
      const query=snapshotQuery(box),file=join(cache,`${config.cachePrefix}-v${config.cacheVersion}-${box.join('_')}.json`),splitFile=`${file}.split`;
      let json=await checkpoint(file,query),split=!json&&await checkpoint(splitFile,query,true);
      // A cached response a week old takes its changes since its database
      // time, and one made by another query also the difference between the
      // two selections (updateElements), never on a refresh, which downloads
      // again. A failure keeps a current response for next time; one of
      // another query is then downloaded in full. Only a run budget stops the build.
      const stale=!json&&!split?await earlier(file):undefined;
      if((json||stale)&&!refresh) {
        const base=json||stale.response,since=base.osm3s?.timestamp_osm_base;
        let due=!!stale;
        if(json)try {due=now()-(await stat(file)).mtimeMs>=STAGED_UPDATE_EVERY;}catch{}
        if(due&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(since||'')) {
          log(`Collecting ${config.label} changes`,box.join(','),'since',since);
          const update=await updateElements({elements:base.elements,since,previousQuery:json?query:stale.query,query,maxDrop:1,
            pick:element=>requireGeometry([element])[0],warn:(...args)=>log(box.join(','),...args),
            fetchText:async body=>{if(requests)await pause();return request(body,{text:true});},
            failed:error=>{
              if(error.category==='budget')throw error;
              if(error.retryAfterMs>policy.maxRetryAfterMs)throw fatal(`${Noun} Retry-After exceeds wait budget`,'budget');
              serverWait=Math.max(serverWait,error.retryAfterMs||0);
            }});
          if(update) {
            const next={...base,osm3s:{...base.osm3s,timestamp_osm_base:update.osmBase},elements:update.elements};
            completedResponse(next);
            await save(file,{query,response:next});
            json=next;
          }
        }
      }
      // One request with retries. Returns the response, or the execution-limit
      // failure that proves this box needs less work.
      const attempt=async body=>{
        let failure;
        for(let attempt=0;attempt<policy.attempts;attempt++) {
          if(requests>=policy.requests)throw fatal(`${Noun} request budget exceeded`,'budget');
          if(attempt) {
            if(failure.retryAfterMs>policy.maxRetryAfterMs)throw fatal(`${Noun} Retry-After exceeds wait budget`,'budget');
            await delay(Math.max(policy.retryMs,failure.retryAfterMs));
          }else if(requests)await pause();
          log(`Collecting ${config.label}`,box.join(','),'attempt',attempt+1);
          try {return {json:await request(body)};}catch(error) {
            failure=error;log(box.join(','),error.category,error.message);
            if(!error.retry)throw error;
            // An explicit execution limit proves this box needs less work.
            // Split now rather than reissuing it and possibly losing that
            // evidence to a later transport failure. Transport alone never splits.
            if(error.split)break;
          }
        }
        if(!failure.split||depth>=policy.depth)throw failure;
        return {split:true};
      };
      if(!json&&!split) {
        const result=await attempt(query);
        if(result.split) {
          await save(splitFile,{query,kind:'spatial-split',version:1});split=true;
        }else {json=result.json;await save(file,{query,response:json});}
      }
      if(split) {
        if(depth>=policy.depth)throw fatal(`${Noun} split exceeds depth budget: ${box}`,'budget');
        for(const child of children(box))await collect(child,depth+1);
        return;
      }
      const data=completedResponse(json);
      for(const feature of data.features)features.set(feature.id,feature);
      coverage.push({bbox:box,timestamp:json.osm3s?.timestamp_osm_base||null,features:data.features.length});
    }
    for(const box of STAGED_REGIONS)await collect(box);
    checkTime();
    if(!features.size)throw fatal(config.emptyMessage);
    const data={type:'FeatureCollection',features:[...features.values()].sort((a,b)=>a.id.localeCompare(b.id))};
    return publish(data,coverage,{output,requests,downloadedBytes:downloaded,now,log});
  }
  // Built from the stored railway-ways regions (build-railway-ways.mjs): every
  // stage part's regions must tile its box exactly (quarters, at most six
  // levels deep), as the quadrant leaves must tile the world above.
  function validateStageCoverage(manifest) {
    const leaves=new Map();
    for(const leaf of manifest.coverage) {
      const part=STAGES.find(stage=>stage.name===leaf.stage)?.parts[leaf.part];
      if(!part||!Array.isArray(leaf.bbox)||leaf.bbox.length!==4||!leaf.bbox.every(Number.isFinite))throw fatal(`Invalid ${noun} stage coverage`);
      const key=`${leaf.stage}|${leaf.part}|${leaf.bbox.join(',')}`;
      if(leaves.has(key)||!Number.isSafeInteger(leaf.features)||leaf.features<0)throw fatal(`Invalid or duplicate ${noun} coverage`);
      leaves.set(key,leaf);
    }
    let visited=0;
    for(const stage of STAGES)stage.parts.forEach((part,index)=>{
      const visit=(box,depth=0)=>{
        if(leaves.has(`${stage.name}|${index}|${box.join(',')}`)){visited++;return;}
        if(depth===STAGED_LIMITS.depth)throw fatal(`Incomplete worldwide ${noun} coverage: ${stage.name} ${box}`);
        for(const child of children(box))visit(child,depth+1);
      };
      visit(part.box);
    });
    if(visited!==leaves.size)throw fatal(`Overlapping or non-partition ${noun} coverage`);
    return manifest;
  }
  // Validate and publish a complete worldwide snapshot. Also used by a builder
  // that acquires the same features as part of a combined download.
  async function publish(data,coverage,{output,requests,downloadedBytes,now=Date.now,log=console.log,partition}) {
    const body=JSON.stringify(data);
    const manifest={version:1,complete:true,built:new Date(now()).toISOString(),features:data.features.length,coverage,requests,downloadedBytes,sha256:digest(body),source:'OpenStreetMap via Overpass',license:'ODbL-1.0',...(partition?{partition}:{})};
    validate(data,manifest);
    // Stage only after complete acquisition. Publish the digest-bearing manifest
    // last; interrupted file replacement cannot pass the workflow validation.
    await mkdir(output,{recursive:true});
    const {data:dataFile,gzip:gzipFile,manifest:manifestFile}=config.files;
    const stage=await mkdtemp(join(output,config.stagePrefix));
    try {
      await writeFile(join(stage,dataFile),body);
      await writeFile(join(stage,gzipFile),gzipSync(body));
      await writeFile(join(stage,manifestFile),JSON.stringify(manifest,null,2)+'\n');
      for(const name of [dataFile,gzipFile,manifestFile])await rename(join(stage,name),join(output,name));
    }finally{await rm(stage,{recursive:true,force:true});}
    log(config.completeMessage,data.features.length);
    return {data,manifest};
  }
  return {build,validate,publish};
}
