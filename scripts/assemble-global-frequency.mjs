// Assemble all completed worldwide shards: the inventory, the manifest and
// the compiled feeds, kept for matching timetable routes to OSM routes. No
// map tiles are built from them: the Service view draws OSM routes only
// (service-routes.mjs). Only one feed is held at a time.
import {readFile,readdir,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {timetableFeatures} from './gtfs-service.mjs';
import {readFrequencyFeed} from './read-frequency-feed.mjs';
import {projectReferenceRow,referenceUrlValid,referenceDisplayUrl} from './frequency-reference-metadata.mjs';
// Publication-only display URLs. Acquisition/cache identities and inputs stay
// unchanged. The sibling <field>_sha256 is SHA-256 of the exact original UTF-8
// URL, not the redacted display or a canonicalized endpoint. This is an audit
// fingerprint, not encryption; provider paths and parameter names remain public.
const urlFingerprint=value=>createHash('sha256').update(value,'utf8').digest('hex');
const urlStart=/^(?:[a-z][a-z0-9+.-]*:(?:\/|\\\/){1,2}|https?%3a(?:%2f){1,2}|\/\/)/i;
const urlInText=/(?:[a-z][a-z0-9+.-]*:(?:\/|\\\/){1,2}|https?%3a(?:%2f){1,2}|\/\/)[^\s<>"'`]+/gi;
export function redactedSourceUrl(value){
  try{
    let decoded=value.replace(/\\\//g,'/');
    if(/^https?%3a/i.test(decoded))decoded=decodeURIComponent(decoded);
    if(/[\u0000-\u0020\u007f]/.test(decoded))return '[invalid source URL]';
    const relative=decoded.startsWith('//'),url=new URL(relative?'https:'+decoded:decoded);
    if(!url.hostname)return '[invalid source URL]';
    url.username='';url.password='';url.hash='';
    const names=[...url.searchParams.keys()];
    url.search='';
    for(const name of names)url.searchParams.append(/^[A-Za-z0-9_.-]{1,80}$/.test(name)?name:'parameter','[redacted]');
    return relative?url.href.slice('https:'.length):url.href;
  }catch{return '[invalid source URL]';}
}
function redactText(value){
  // An entire URL may contain malformed whitespace. Fail closed rather than
  // leaving a credential suffix outside a token matched inside diagnostic prose.
  if(urlStart.test(value))return redactedSourceUrl(value);
  return value.replace(urlInText,url=>redactedSourceUrl(url));
}
export function publishedMetadata(value,referenceContext=false){
  if(typeof value==='string')return referenceContext&&referenceUrlValid(value)?referenceDisplayUrl(value):redactText(value);
  if(Array.isArray(value))return value.map(item=>publishedMetadata(item,referenceContext));
  if(!value||typeof value!=='object')return value;
  // Unusual URL-keyed audit maps must not collapse two raw identities onto
  // the same redacted key. Ordinary schema and accounting keys are unchanged.
  const publicKey=key=>{const redacted=redactText(key);return redacted===key?key:`[sha256:${urlFingerprint(key)}] ${redacted}`;};
  value=projectReferenceRow(value);
  const result=Object.fromEntries(Object.entries(value).map(([key,item])=>[publicKey(key),publishedMetadata(item,referenceContext||key==='source_resolution'||key==='lineage'&&Object.hasOwn(value,'source_resolution'))]));
  for(const [key,item] of Object.entries(value)){
    if(typeof item==='string'&&urlStart.test(item)){
      const hashKey=publicKey(key)+'_sha256';
      // Earlier pipeline stages may already have redacted a display URL while
      // retaining its original fingerprint. Never replace it with a display hash.
      if(!/^[a-f0-9]{64}$/.test(result[hashKey]||''))result[hashKey]=urlFingerprint(item);
    }else if(Array.isArray(item)&&item.some(x=>typeof x==='string'&&urlStart.test(x))){
      const hashKey=publicKey(key)+'_sha256';
      if(!Array.isArray(result[hashKey]))result[hashKey]=item.map(x=>typeof x==='string'&&urlStart.test(x)?urlFingerprint(x):null);
    }
  }
  return result;
}
// Outcome totals always come from the entries themselves: each shard's own
// counts cover only that shard.
export const countStatuses=entries=>{const counts={};for(const entry of entries)counts[entry.status]=(counts[entry.status]||0)+1;return counts;};
export const countOutcomeReasons=entries=>{
  const counts={};
  for(const entry of entries){
    if(!['excluded','failed','retry_pending','non_timetable','source_alias'].includes(entry.status))continue;
    const reason=entry.reason_code||'unclassified';
    counts[reason]=(counts[reason]||0)+1;
  }
  return counts;
};
const sourceFingerprints=row=>{
  const values=[row,...(Array.isArray(row?.lineage)?row.lineage:[])],result=new Set();
  for(const item of values){
    if(typeof item?.source!=='string'||!/^https?:\/\//.test(item.source))continue;
    result.add(/^[a-f0-9]{64}$/.test(item.source_sha256||'')?item.source_sha256:urlFingerprint(item.source));
  }
  return [...result].sort();
};
const ownerMetadataCompatible=row=>{
  const lineage=row?.lineage??[];
  return row?.lineage!==null&&Array.isArray(lineage)&&lineage.length<=64&&lineage.every(item=>item&&typeof item==='object'&&!Array.isArray(item)&&
    (item.catalogue!=='mobility-database'||item.authentication_type==null||['','0','none'].includes(String(item.authentication_type).trim().toLowerCase())));
};
export function mergeInventories(inventories){
  if(!inventories.length)throw new Error('No worldwide inventory');
  const first=inventories[0],ids=new Set(),shards=new Set(),entries=[];
  for(const inventory of inventories){
    for(const field of ['schema','shards','catalogue_url','catalogue_sha256','catalogue_entries','service_date'])if(inventory[field]!==first[field])throw new Error(`Inconsistent inventory ${field}`);
    if(!isDeepStrictEqual(inventory.catalogue_provenance,first.catalogue_provenance))throw new Error('Inconsistent inventory catalogue_provenance');
    if(shards.has(inventory.shard))throw new Error('Duplicate shard');shards.add(inventory.shard);
    for(const raw of inventory.entries){
      if(ids.has(raw.id))throw new Error('Duplicate feed');ids.add(raw.id);
      // Reconcile the graph that can actually be published, never raw alias
      // links whose owner/state would disappear at the projection boundary.
      const entry=raw.catalogue&&Object.hasOwn(raw.catalogue,'source_resolution')?
        {...raw,catalogue:projectReferenceRow(raw.catalogue)}:raw;
      entries.push(entry);
    }
  }
  if(shards.size!==first.shards||ids.size!==first.catalogue_entries)throw new Error('Incomplete worldwide scan; refusing to publish a partial shard collection');
  const byId=new Map(entries.map(entry=>[entry.id,entry]));
  for(const entry of entries){
    if(entry.status!=='source_alias')continue;
    const resolution=entry.catalogue?.source_resolution,target=byId.get(resolution?.acquisition_alias_of),targetResolution=target?.catalogue?.source_resolution;
    if(resolution?.schema!==1||resolution.state!=='schedule'||!resolution.specs?.includes('gtfs')||!target||target.id===entry.id||target.status==='source_alias'||
        targetResolution?.acquisition_alias_of||target.catalogue?.delivery!=='direct'||!ownerMetadataCompatible(target.catalogue)||
        (targetResolution&&(targetResolution.schema!==1||targetResolution.state!=='schedule'||!targetResolution.specs?.includes('gtfs')))||
        target.catalogue?.access_review||resolution.processed_filename!=null||
        !isDeepStrictEqual(sourceFingerprints(entry.catalogue),[resolution.alias_source_sha256])||
        !isDeepStrictEqual(sourceFingerprints(target.catalogue),[resolution.alias_source_sha256])||
        !/^[a-f0-9]{64}$/.test(resolution.alias_source_sha256||'')||
        resolution.alias_source_sha256!==target.catalogue?.source_sha256||entry.output||target.status==='excluded'||
        target.status==='non_timetable'||['source_access_review','unresolved_source_reference','ambiguous_source_reference','missing_source_url'].includes(target.reason_code))
      throw new Error('Invalid static source alias target');
  }
  entries.sort((a,b)=>a.id.localeCompare(b.id));
  // Old shards never bound their origins to this catalogue. Keep them readable
  // without retroactively certifying the old single-URL attribution.
  return {...first,catalogue_provenance:first.catalogue_provenance??{schema:1,kind:'legacy-unverified',sources:[]},
    shard:undefined,counts:countStatuses(entries),entries};
}
export async function pruneFrequencyOutputs(directory,entries){
  const wanted=new Set(entries.filter(e=>e.status==='compiled').map(e=>e.output));
  if([...wanted].some(path=>typeof path!=='string'||!/^feeds\/[A-Za-z0-9_.-]+\.json\.gz$/.test(path)))throw new Error('Invalid compiled feed path');
  let files;try{files=await readdir(join(directory,'feeds'));}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const file of files)if(!wanted.has('feeds/'+file))await rm(join(directory,'feeds',file),{recursive:true,force:true});
}
export async function assemble(directory){
  const names=(await readdir(directory)).filter(n=>/^inventory-\d+\.json$/.test(n));
  const shards=await Promise.all(names.map(async name=>JSON.parse(await readFile(join(directory,name),'utf8'))));
  const inventory=mergeInventories(shards);
  // Snapshot artifacts include staged shard copies as well as inventory.json.
  // Apply the same publication boundary to every copy, including held rows.
  await Promise.all(names.map((name,i)=>writeFile(join(directory,name),JSON.stringify(publishedMetadata(shards[i]))+'\n')));
  await pruneFrequencyOutputs(directory,inventory.entries);
  const tileRoot=join(directory,'tiles');await rm(tileRoot,{recursive:true,force:true});await mkdir(tileRoot,{recursive:true});
  const summary=[];
  for(const entry of inventory.entries){
    if(entry.status!=='compiled')continue;
    const feed=await readFrequencyFeed(join(directory,entry.output));
    if(feed.source.id!==entry.id||feed.source.sha256!==entry.sha256||feed.source.service_date!==inventory.service_date)throw new Error(`Unverified feed ${redactText(entry.id)}`);
    // No tiles are built, so a feed's size no longer fails it here.
    const data=timetableFeatures([feed],Date.now(),{summaryOnly:true});
    summary.push(...data.summary);
    console.log(redactText(entry.id),feed.routes.length,'rail services');
  }
  if(!summary.some(f=>f.mappedRoutes>0))throw new Error('Worldwide scan produced no mapped rail services; inspect inventory failures');
  await pruneFrequencyOutputs(directory,inventory.entries);
  // Totals recounted from the entries, as published.
  const counts=countStatuses(inventory.entries);
  const reasonCounts=countOutcomeReasons(inventory.entries);
  const countrySet=filter=>[...new Set(inventory.entries.filter(filter).map(e=>e.country).filter(Boolean))].sort();
  const compiledById=new Map(inventory.entries.filter(e=>e.status==='compiled').map(e=>[e.id,e]));
  const countriesMapped=[...new Set(summary.filter(f=>f.mappedRoutes>0).map(f=>compiledById.get(f.id)?.country).filter(Boolean))].sort();
  inventory.counts=counts;
  inventory.reason_codes=reasonCounts;
  const manifest=publishedMetadata({schema:3,service_date:inventory.service_date,catalogue_url:inventory.catalogue_url,catalogue_sha256:inventory.catalogue_sha256,catalogue_entries:inventory.catalogue_entries,
    catalogue_provenance:inventory.catalogue_provenance,
    countries_scanned:countrySet(()=>true),
    countries_compiled:countrySet(e=>e.status==='compiled'),
    countries_with_mapped_feed:countriesMapped,
    reason_codes:reasonCounts,
    counts,feeds:summary,tiles:0,
    scope:'Whole worldwide catalogue scanned. Compiled timetables are kept for matching to OSM routes and draw no lines; failed, excluded, unshaped and expired sources are explicitly reported. Coverage is not complete worldwide.'});
  await writeFile(join(tileRoot,'index.json'),JSON.stringify({tiles:[]}));
  await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(join(directory,'inventory.json'),JSON.stringify(publishedMetadata(inventory),null,2)+'\n');
  console.log(JSON.stringify(publishedMetadata({catalogue:manifest.catalogue_entries,counts,
    countriesScanned:manifest.countries_scanned.length,countriesCompiled:manifest.countries_compiled.length,
    countriesWithMappedFeed:manifest.countries_with_mapped_feed.length,
    mappedFeeds:summary.filter(f=>f.mappedRoutes>0).length,reasonCodes:reasonCounts})));
  return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname))await assemble(process.argv[2]||'frequency-output');
