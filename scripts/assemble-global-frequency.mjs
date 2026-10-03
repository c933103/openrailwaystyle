// Assemble all completed worldwide shards. Only one feed's geometry and one
// encoded tile are held at a time; browser assets stay normal static tiles.
import {readFile,readdir,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {buildTiles,readTable} from './service-routes.mjs';
import {timetableFeatures} from './gtfs-service.mjs';
import {mergeServiceTiles} from './merge-service-tiles.mjs';
import {readFrequencyFeed} from './read-frequency-feed.mjs';
export function mergeInventories(inventories){
  if(!inventories.length)throw new Error('No worldwide inventory');
  const first=inventories[0],ids=new Set(),shards=new Set(),entries=[];
  for(const inventory of inventories){
    for(const field of ['schema','shards','catalogue_sha256','catalogue_entries','service_date'])if(inventory[field]!==first[field])throw new Error(`Inconsistent inventory ${field}`);
    if(shards.has(inventory.shard))throw new Error('Duplicate shard');shards.add(inventory.shard);
    for(const entry of inventory.entries){if(ids.has(entry.id))throw new Error('Duplicate feed');ids.add(entry.id);entries.push(entry);}
  }
  if(shards.size!==first.shards||ids.size!==first.catalogue_entries)throw new Error('Incomplete worldwide scan; refusing to publish a partial shard collection');
  return {...first,shard:undefined,entries:entries.sort((a,b)=>a.id.localeCompare(b.id))};
}
export async function pruneFrequencyOutputs(directory,entries){
  const wanted=new Set(entries.filter(e=>e.status==='compiled').map(e=>e.output));
  if([...wanted].some(path=>typeof path!=='string'||!/^feeds\/[A-Za-z0-9_.-]+\.json\.gz$/.test(path)))throw new Error('Invalid compiled feed path');
  let files;try{files=await readdir(join(directory,'feeds'));}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const file of files)if(!wanted.has('feeds/'+file))await rm(join(directory,'feeds',file),{recursive:true,force:true});
}
export async function assemble(directory){
  const names=(await readdir(directory)).filter(n=>/^inventory-\d+\.json$/.test(n));
  const inventory=mergeInventories(await Promise.all(names.map(async name=>JSON.parse(await readFile(join(directory,name),'utf8')))));
  await pruneFrequencyOutputs(directory,inventory.entries);
  const tileRoot=join(directory,'tiles');await rm(tileRoot,{recursive:true,force:true});await mkdir(tileRoot,{recursive:true});
  const keys=new Set(),summary=[],counts={};
  for(const entry of inventory.entries){
    counts[entry.status]=(counts[entry.status]||0)+1;
    if(entry.status!=='compiled')continue;
    const feed=await readFrequencyFeed(join(directory,entry.output));
    if(feed.source.id!==entry.id||feed.source.sha256!==entry.sha256||feed.source.service_date!==inventory.service_date)throw new Error(`Unverified feed ${entry.id}`);
    const data=timetableFeatures([feed]),tiles=buildTiles(readTable(''),{timetable:data});
    summary.push(...data.summary);
    for(const [key,bytes]of tiles){
      const file=join(tileRoot,key+'.pbf.gz');let previous;
      try{previous=gunzipSync(await readFile(file));}catch(error){if(error.code!=='ENOENT')throw error;}
      await mkdir(join(tileRoot,key.slice(0,key.lastIndexOf('/'))),{recursive:true});
      await writeFile(file,gzipSync(previous?mergeServiceTiles([previous,bytes]):bytes,{level:9}));keys.add(key);
    }
    console.log(entry.id,feed.routes.length,'rail services',tiles.size,'tiles');
  }
  if(!summary.some(f=>f.mappedRoutes>0))throw new Error('Worldwide scan produced no mapped rail services; inspect inventory failures');
  const manifest={schema:3,service_date:inventory.service_date,catalogue_url:inventory.catalogue_url,catalogue_sha256:inventory.catalogue_sha256,catalogue_entries:inventory.catalogue_entries,
    countries_scanned:[...new Set(inventory.entries.map(e=>e.country))].sort(),counts,feeds:summary,tiles:keys.size,
    scope:'Whole worldwide catalogue scanned. Timetable shapes and conservative matches to published rail geometry; failed, excluded, unshaped and expired sources are explicitly reported. Coverage is not complete worldwide.'};
  await writeFile(join(tileRoot,'index.json'),JSON.stringify({tiles:[...keys].sort()}));
  await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(join(directory,'inventory.json'),JSON.stringify(inventory,null,2)+'\n');
  console.log(JSON.stringify({catalogue:manifest.catalogue_entries,counts,countries:manifest.countries_scanned.length,mappedFeeds:summary.filter(f=>f.mappedRoutes>0).length,tiles:keys.size}));
  return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname))await assemble(process.argv[2]||'frequency-output');
