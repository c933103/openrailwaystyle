import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createGunzip,gzipSync} from 'node:zlib';
import {createInterface} from 'node:readline';
import {join,dirname,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {normalizeMainlineWay,mainlineTiles} from './mainline-overview.mjs';
import {mainlineChains} from './mainline-chains.mjs';
import {sha256,validateMainlineSources,auditMainlineCoverage,MAINLINE_REGIONS} from './mainline-coverage.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output||resolve(input)===resolve(output))throw Error('Expected separate input/output directories');
const start=performance.now(),sources=[],byId=new Map();
for(const region of MAINLINE_REGIONS){
 const dir=join(input,'mainline-source-'+region),source=JSON.parse(await readFile(join(dir,'source.json')));
 if(source.region!==region)throw Error('Mismatched continent acquisition');
 sources.push(source);
 const path=join(dir,'ways.geojsonseq.gz'),bytes=await readFile(path);
 if(bytes.length!==source.exportBytes||sha256(bytes)!==source.exportSha256)throw Error('Changed continent export');
 const lines=createInterface({input:createReadStream(path).pipe(createGunzip()),crlfDelay:Infinity});
 let raw=0,kept=0,lineBytes=0;
 for await(const line of lines){
  lineBytes+=Buffer.byteLength(line);
  if(lineBytes>4*1024**3||line.length>8*1024**2||++raw>6000000)throw Error('Oversized continent feature stream');
  if(!line.trim())continue;
  const f=JSON.parse(line),p=f.properties;
  if(f.type!=='Feature'||p?.['@type']!=='way'||f.geometry?.type!=='LineString')throw Error('Invalid Osmium way export');
  const feature=normalizeMainlineWay({type:'way',id:p['@id'],version:p['@version'],
   timestamp:typeof p['@timestamp']==='number'?new Date(p['@timestamp']*1000).toISOString():p['@timestamp'],
   nodes:p['@way_nodes'],tags:p,geometry:f.geometry.coordinates.map(([lon,lat])=>({lon,lat}))});
  if(!feature)continue;kept++;
  const prior=byId.get(feature.id);
  if(prior&&JSON.stringify(prior)!==JSON.stringify(feature))throw Error(`Conflicting same-generation OSM way ${feature.id}`);
  byId.set(feature.id,feature);
  if(byId.size>3000000)throw Error('Worldwide way inventory exceeds bound');
 }
 source.exportedWays=raw;source.referenceWays=kept;
}
validateMainlineSources(sources);
const features=[...byId.values()].sort((a,b)=>a.id-b.id),audit=auditMainlineCoverage(features);
if(!features.length)throw Error('Empty worldwide railway reference');
const chained=mainlineChains(features),result=mainlineTiles(chained.features,{allowChains:true});
const generation=sha256(JSON.stringify(sources.map(s=>[s.region,s.pbfSha256]))).slice(0,24);
const target=join(output,'generations',generation);await mkdir(target,{recursive:true});
const tileDetails=[];
for(const [key,bytes] of result.tiles){
 const path=join(target,key+'.pbf.gz');await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);
 tileDetails.push({key,bytes:bytes.length,sha256:sha256(bytes)});
}
await writeFile(join(target,'index.json'),JSON.stringify({schema:1,generation,complete:true,tiles:tileDetails})+'\n');
await writeFile(join(target,'membership.ndjson.gz'),gzipSync(chained.membership.map(m=>JSON.stringify(m)).join('\n')+'\n'));
await writeFile(join(target,'ways.ndjson.gz'),gzipSync(features.map(f=>JSON.stringify(f)).join('\n')+'\n'));
await writeFile(join(target,'coverage-audit.json'),JSON.stringify(audit,null,2)+'\n');
const classes={};for(const f of features)classes[f.properties.classification]=(classes[f.properties.classification]||0)+1;
const manifest={...result.manifest,complete:true,generation,coverage:'all eight Geofabrik continent extracts; complete OSM ways',
 sourceDate:sources[0].date,oldestSource:new Date(Math.min(...sources.map(s=>Date.parse(s.sourceTimestamp)))).toISOString(),
 newestSource:new Date(Math.max(...sources.map(s=>Date.parse(s.sourceTimestamp)))).toISOString(),
 generated:new Date().toISOString(),sources,wayCount:features.length,chainCount:chained.features.length,classifications:classes,
 controls:audit.map(({feature,...c})=>({...c,osmId:feature.properties.id,osmVersion:feature.properties.osm_version})),
 downloadedBytes:sources.reduce((n,s)=>n+s.pbfBytes,0),tileBytes:tileDetails.reduce((n,t)=>n+t.bytes,0),
 largestTileBytes:Math.max(...tileDetails.map(t=>t.bytes)),buildSeconds:(performance.now()-start)/1000,
 peakRssBytes:process.resourceUsage().maxRSS*1024,
 indexSha256:sha256(await readFile(join(target,'index.json'))),
 acquisitionRequests:sources.length*3,providerTileRequests:0};
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('MAINLINE_REFERENCE',JSON.stringify(manifest));
