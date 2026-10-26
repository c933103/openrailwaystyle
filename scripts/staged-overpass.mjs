// Maintenance-only staged worldwide Overpass acquisition shared by snapshot
// builders. Each snapshot supplies its own query, response transform, cache
// naming and published file names; the acquisition, retry, budget, checkpoint
// and publication rules are common and tested through every caller.
import {mkdir,readFile,writeFile,stat,mkdtemp,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

export const STAGED_LIMITS=Object.freeze({requests:96,bytes:100_000_000,elapsedMs:3600_000,depth:6,attempts:3,timeoutMs:300_000,pauseMs:10_000,retryMs:40_000,maxRetryAfterMs:300_000});
export const STAGED_REGIONS=Object.freeze(Array.from({length:8},(_,i)=>Object.freeze([i<4?-90:0,-180+(i%4)*90,i<4?0:90,-90+(i%4)*90])));
const CACHE_AGE=28*86400_000;
const children=([s,w,n,e])=>{const lat=(s+n)/2,lon=(w+e)/2;return [[s,w,lat,lon],[s,lon,lat,e],[lat,w,n,lon],[lat,lon,n,e]];};
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
// completeMessage, merge?}. noun is the lower-case name used in error
// messages. merge(previous, next) combines one feature returned by two
// regions; without it the later region's copy is kept.
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
    async function delay(ms) {
      checkTime();
      if(ms>=remaining())throw fatal(`${Noun} elapsed-time budget exceeded before retry`,'budget');
      if(ms)await sleep(ms);
      checkTime();
    }
    async function request(query) {
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
          // Discarding an error body can itself reject after a transport reset.
          // Preserve the authoritative HTTP category rather than reclassifying
          // that cleanup error as a query/body timeout.
          try {await response.body?.cancel?.();}catch{}
          const status=response.status,wait=retryAfter(response.headers?.get('retry-after'),now());
          if(status===429||status===408||[500,502,503,504].includes(status))throw new AcquisitionError(`HTTP ${status}`,status===429?'rate-limit':'http-transient',{retry:true,retryAfterMs:wait});
          throw fatal(`HTTP ${status}`,'http-permanent');
        }
        const chunks=[];
        try {
          for await(const chunk of response.body) {
            downloaded+=chunk.length;
            if(downloaded>policy.bytes)throw fatal(`${Noun} download budget exceeded`,'budget');
            checkTime();chunks.push(chunk);
          }
        }catch(error){throw transportError(error,signal);}
        let json;
        try {json=JSON.parse(Buffer.concat(chunks));}catch(error){throw fatal(`Malformed ${noun} JSON`,'parsing',error);}
        checkTime();completedResponse(json);return json;
      }catch(error){throw transportError(error,signal);}
    }
    async function checkpoint(file,query,split=false) {
      if(refresh)return undefined;
      try {
        const info=await stat(file),saved=JSON.parse(await readFile(file,'utf8'));
        if(saved.query!==query||now()-info.mtimeMs>=CACHE_AGE)return undefined;
        if(split)return saved.kind==='spatial-split'&&saved.version===1?true:undefined;
        completedResponse(saved.response);return saved.response;
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
      if(!json&&!split) {
        let failure;
        for(let attempt=0;attempt<policy.attempts;attempt++) {
          if(requests>=policy.requests)throw fatal(`${Noun} request budget exceeded`,'budget');
          if(attempt) {
            if(failure.retryAfterMs>policy.maxRetryAfterMs)throw fatal(`${Noun} Retry-After exceeds wait budget`,'budget');
            await delay(Math.max(policy.retryMs,failure.retryAfterMs));
          }else if(requests)await delay(policy.pauseMs);
          log(`Collecting ${config.label}`,box.join(','),'attempt',attempt+1);
          try {json=await request(query);break;}catch(error) {
            failure=error;log(box.join(','),error.category,error.message);
            if(!error.retry)throw error;
            // An explicit execution limit proves this box needs less work.
            // Split now rather than reissuing it and possibly losing that
            // evidence to a later transport failure. Transport alone never splits.
            if(error.split)break;
          }
        }
        if(!json) {
          if(!failure.split||depth>=policy.depth)throw failure;
          await save(splitFile,{query,kind:'spatial-split',version:1});split=true;
        }else await save(file,{query,response:json});
      }
      if(split) {
        if(depth>=policy.depth)throw fatal(`${Noun} split exceeds depth budget: ${box}`,'budget');
        for(const child of children(box))await collect(child,depth+1);
        return;
      }
      const data=completedResponse(json);
      for(const feature of data.features)features.set(feature.id,features.has(feature.id)&&config.merge?config.merge(features.get(feature.id),feature):feature);
      coverage.push({bbox:box,timestamp:json.osm3s?.timestamp_osm_base||null,features:data.features.length});
    }
    for(const box of STAGED_REGIONS)await collect(box);
    checkTime();
    if(!features.size)throw fatal(config.emptyMessage);
    const data={type:'FeatureCollection',features:[...features.values()].sort((a,b)=>a.id.localeCompare(b.id))},body=JSON.stringify(data);
    const manifest={version:1,complete:true,built:new Date(now()).toISOString(),features:features.size,coverage,requests,downloadedBytes:downloaded,sha256:digest(body),source:'OpenStreetMap via Overpass',license:'ODbL-1.0'};
    validate(data,manifest);
    // Stage only after complete acquisition. Publish the digest-bearing manifest
    // last; interrupted file replacement cannot pass the workflow validation.
    const {data:dataFile,gzip:gzipFile,manifest:manifestFile}=config.files;
    const stage=await mkdtemp(join(output,config.stagePrefix));
    try {
      await writeFile(join(stage,dataFile),body);
      await writeFile(join(stage,gzipFile),gzipSync(body));
      await writeFile(join(stage,manifestFile),JSON.stringify(manifest,null,2)+'\n');
      for(const name of [dataFile,gzipFile,manifestFile])await rename(join(stage,name),join(output,name));
    }finally{await rm(stage,{recursive:true,force:true});}
    log(config.completeMessage,features.size);
    return {data,manifest};
  }
  return {build,validate};
}
