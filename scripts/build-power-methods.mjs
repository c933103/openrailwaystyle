// Maintenance-only extraction. Facility v6 caches remain reusable; method v1
// files are retained separately from the optimized query's v2 checkpoints.
import {mkdir,readFile,writeFile,stat,mkdtemp,rename,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {powerMethodQuery,powerMethodsGeoJSON} from './power-method-data.mjs';

export const POWER_METHOD_LIMITS=Object.freeze({requests:96,bytes:100_000_000,elapsedMs:3600_000,depth:6,attempts:3,timeoutMs:300_000,pauseMs:10_000,retryMs:40_000,maxRetryAfterMs:300_000});
export const POWER_METHOD_CACHE_VERSION=2;
export const POWER_METHOD_REGIONS=Object.freeze(Array.from({length:8},(_,i)=>Object.freeze([i<4?-90:0,-180+(i%4)*90,i<4?0:90,-90+(i%4)*90])));
const CACHE_AGE=28*86400_000;
const children=([s,w,n,e])=>{const lat=(s+n)/2,lon=(w+e)/2;return [[s,w,lat,lon],[s,lon,lat,e],[lat,w,n,lon],[lat,lon,n,e]];};
const digest=body=>createHash('sha256').update(body).digest('hex');
class AcquisitionError extends Error {
  constructor(message,category,{retry=false,split=false,retryAfterMs=0,cause}={}) {super(message,{cause});Object.assign(this,{category,retry,split,retryAfterMs});}
}
const fatal=(message,category='validation',cause)=>new AcquisitionError(message,category,{cause});
function retryAfter(value,now) {
  if(!value)return 0;
  if(/^\d+$/.test(value.trim()))return Number(value)*1000;
  const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;
}
function transportError(error,signal) {
  if(error instanceof AcquisitionError)return error;
  const reason=signal?.aborted?signal.reason:error;
  const code=reason?.cause?.code||reason?.code;
  // Even a body deadline can be a stalled connection rather than an oversized
  // query. Only explicit Overpass execution-limit remarks establish a spatial
  // failure; transport deadlines never create durable split checkpoints.
  if(reason?.name==='TimeoutError'||['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(code))return new AcquisitionError('Power-method transport timed out','transport',{retry:true,cause:error});
  if(['ECONNRESET','ECONNREFUSED','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','UND_ERR_SOCKET'].includes(code)||error instanceof TypeError&&error.message==='fetch failed')return new AcquisitionError('Power-method transport failed','transport',{retry:true,cause:error});
  return fatal(error.message||'Power-method request failed','transport',error);
}
function completedResponse(json) {
  if(json?.remark) {
    const remark=String(json.remark);
    if(/\b(?:parse error|static error|syntax error|unauthorized|forbidden|permission denied)\b/i.test(remark))throw fatal(`Overpass rejected response: ${remark}`);
    if(/\b(?:query\s+)?timed?\s*out\b/i.test(remark))throw new AcquisitionError(remark,'timeout',{retry:true,split:true});
    if(/\b(?:ran?\s+out\s+of\s+memory|out\s+of\s+memory|memory\s+limit\s+(?:exceeded|reached))\b/i.test(remark))throw new AcquisitionError(remark,'resource',{retry:true,split:true});
    throw fatal(`Overpass rejected response: ${remark}`);
  }
  try {return powerMethodsGeoJSON(json);}catch(error){throw fatal(error.message,'validation',error);}
}

// Publication checks use the same partition tree as acquisition. A leaf count
// alone cannot detect a missing quadrant, overlap, duplicate or coverage gap.
export function validatePowerMethodsSnapshot(data,manifest) {
  if(manifest?.complete!==true||manifest.version!==1||data?.type!=='FeatureCollection'||!Array.isArray(data.features)||!data.features.length||manifest.features!==data.features.length)throw fatal('Incomplete or empty worldwide power-method snapshot');
  if(manifest.sha256!==digest(JSON.stringify(data)))throw fatal('Power-method snapshot digest mismatch');
  const ids=new Set(data.features.map(f=>f.id));
  if(ids.size!==data.features.length||data.features.some(f=>typeof f.id!=='string'||f.type!=='Feature'||!f.geometry||!f.properties))throw fatal('Invalid or duplicate power-method features');
  if(!Array.isArray(manifest.coverage))throw fatal('Missing worldwide power-method coverage');
  const leaves=new Map();
  for(const leaf of manifest.coverage) {
    powerMethodQuery(leaf.bbox);
    const key=leaf.bbox.join(',');
    if(leaves.has(key)||!Number.isSafeInteger(leaf.features)||leaf.features<0)throw fatal('Invalid or duplicate power-method coverage');
    leaves.set(key,leaf);
  }
  let visited=0;
  const visit=(box,depth=0)=>{
    if(leaves.has(box.join(','))){visited++;return;}
    if(depth===POWER_METHOD_LIMITS.depth)throw fatal(`Incomplete worldwide power-method coverage: ${box}`);
    for(const child of children(box))visit(child,depth+1);
  };
  for(const box of POWER_METHOD_REGIONS)visit(box);
  if(visited!==leaves.size)throw fatal('Overlapping or non-partition power-method coverage');
  return manifest;
}

export async function buildPowerMethods({api=process.env.OVERPASS_URL||'https://overpass-api.de/api/interpreter',output=process.env.POWER_OUTPUT||'power-data',cache='.snapshot-cache',refresh=process.env.POWER_REFRESH==='1',fetcher=globalThis.fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now,limits={},log=console.log}={}) {
  const policy={...POWER_METHOD_LIMITS,...limits};
  for(const [key,value] of Object.entries(policy))if(!Number.isSafeInteger(value)||value<0||['attempts','requests','bytes','elapsedMs','timeoutMs'].includes(key)&&value===0||value>POWER_METHOD_LIMITS[key])throw fatal(`Invalid power-method limit: ${key}`,'budget');
  await mkdir(cache,{recursive:true});await mkdir(output,{recursive:true});
  const started=now(),features=new Map(),coverage=[];let downloaded=0,requests=0;
  const remaining=()=>policy.elapsedMs-(now()-started);
  const checkTime=()=>{if(remaining()<=0)throw fatal('Power-method elapsed-time budget exceeded','budget');};
  async function delay(ms) {
    checkTime();
    if(ms>=remaining())throw fatal('Power-method elapsed-time budget exceeded before retry','budget');
    if(ms)await sleep(ms);
    checkTime();
  }
  async function request(query) {
    checkTime();
    if(requests>=policy.requests)throw fatal('Power-method request budget exceeded','budget');
    const signal=AbortSignal.timeout(Math.max(1,Math.min(policy.timeoutMs,remaining())));
    requests++;
    let response;
    try {
      response=await fetcher(api,{method:'POST',body:new URLSearchParams({data:query}),headers:{'User-Agent':'RailwayAtlas-power-methods/1.0 (+https://github.com/c933103/openrailwaystyle)'},signal,redirect:'error'});
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
          if(downloaded>policy.bytes)throw fatal('Power-method download budget exceeded','budget');
          checkTime();chunks.push(chunk);
        }
      }catch(error){throw transportError(error,signal);}
      let json;
      try {json=JSON.parse(Buffer.concat(chunks));}catch(error){throw fatal('Malformed power-method JSON','parsing',error);}
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
    const query=powerMethodQuery(box),file=join(cache,`power-methods-v${POWER_METHOD_CACHE_VERSION}-${box.join('_')}.json`),splitFile=`${file}.split`;
    let json=await checkpoint(file,query),split=!json&&await checkpoint(splitFile,query,true);
    if(!json&&!split) {
      let failure;
      for(let attempt=0;attempt<policy.attempts;attempt++) {
        if(requests>=policy.requests)throw fatal('Power-method request budget exceeded','budget');
        if(attempt) {
          if(failure.retryAfterMs>policy.maxRetryAfterMs)throw fatal('Power-method Retry-After exceeds wait budget','budget');
          await delay(Math.max(policy.retryMs,failure.retryAfterMs));
        }else if(requests)await delay(policy.pauseMs);
        log('Collecting conductor rails and railway chargers',box.join(','),'attempt',attempt+1);
        try {json=await request(query);break;}catch(error) {
          failure=error;log(box.join(','),error.category,error.message);
          if(!error.retry)throw error;
        }
      }
      if(!json) {
        if(!failure.split||depth>=policy.depth)throw failure;
        await save(splitFile,{query,kind:'spatial-split',version:1});split=true;
      }else await save(file,{query,response:json});
    }
    if(split) {
      if(depth>=policy.depth)throw fatal(`Power-method split exceeds depth budget: ${box}`,'budget');
      for(const child of children(box))await collect(child,depth+1);
      return;
    }
    const data=completedResponse(json);
    for(const feature of data.features)features.set(feature.id,feature);
    coverage.push({bbox:box,timestamp:json.osm3s?.timestamp_osm_base||null,features:data.features.length});
  }
  for(const box of POWER_METHOD_REGIONS)await collect(box);
  checkTime();
  if(!features.size)throw fatal('Refusing to publish empty worldwide conductor-rail and charging data');
  const data={type:'FeatureCollection',features:[...features.values()].sort((a,b)=>a.id.localeCompare(b.id))},body=JSON.stringify(data);
  const manifest={version:1,complete:true,built:new Date(now()).toISOString(),features:features.size,coverage,requests,downloadedBytes:downloaded,sha256:digest(body),source:'OpenStreetMap via Overpass',license:'ODbL-1.0'};
  validatePowerMethodsSnapshot(data,manifest);
  // Stage only after complete acquisition. Publish the digest-bearing manifest
  // last; interrupted file replacement cannot pass the workflow validation.
  const stage=await mkdtemp(join(output,'.methods-stage-'));
  try {
    await writeFile(join(stage,'power-methods.geojson'),body);
    await writeFile(join(stage,'power-methods.geojson.gz'),gzipSync(body));
    await writeFile(join(stage,'methods-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    for(const name of ['power-methods.geojson','power-methods.geojson.gz','methods-manifest.json'])await rename(join(stage,name),join(output,name));
  }finally{await rm(stage,{recursive:true,force:true});}
  log('Complete worldwide conductor rails and railway chargers:',features.size);
  return {data,manifest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildPowerMethods();
