import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,open} from 'node:fs/promises';
import {createGunzip,createGzip,gunzipSync} from 'node:zlib';
import {Readable} from 'node:stream';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {createInterface} from 'node:readline';
import {join,dirname,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {normalizeMainlineWay,mainlineTiles,MAINLINE_LAYER} from './mainline-overview.mjs';
import {mainlineChains} from './mainline-chains.mjs';
import {referenceInputDigest} from './mainline-provenance.mjs';
import {sha256,validateMainlineSources,auditMainlineCoverage,MAINLINE_REGIONS,featureInBox} from './mainline-coverage.mjs';
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
  if(lineBytes>4*1024**3||line.length>8*1024**2)throw Error('Oversized continent feature stream');
  if(!line.trim())continue;
  if(++raw>6000000)throw Error('Oversized continent feature stream');
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
const rowDigest=rows=>{const hash=createHash('sha256');for(const row of rows)hash.update(JSON.stringify(row)).update('\n');return hash.digest('hex')};
const normalizedWaysSha256=rowDigest(features),membershipSha256=rowDigest(chained.membership);
const tileDetails=[...result.tiles].map(([key,bytes])=>({key,bytes:bytes.length,sha256:sha256(bytes)}));
if(tileDetails.reduce((n,t)=>n+t.bytes,0)>256*1024**2)throw Error('Reference tile-set exceeds publication bandwidth budget');
// Independent source-vs-tile audit: retained source ways are not proof that
// the simplifier emitted their corresponding chain in any low zoom tile.
const byZoom=new Map();
for(const [key,bytes] of result.tiles){
 const z=Number(key.split('/')[0]);if(!byZoom.has(z))byZoom.set(z,new Set());
 const layer=new VectorTile(new Pbf(gunzipSync(bytes))).layers[MAINLINE_LAYER];
 for(let i=0;i<layer.length;i++)byZoom.get(z).add(layer.feature(i).properties.id);
}
for(const control of audit){
 const candidates=chained.features.filter(f=>f.properties.classification!=='branch'&&featureInBox(f,control.box));
 control.chainIdsByZoom={};
 for(let z=0;z<=6;z++){
  const ids=candidates.filter(f=>byZoom.get(z)?.has(f.properties.id)).map(f=>f.properties.id);
  if(!ids.length)throw Error(`OSM source exists but tile geometry is missing: ${control.name} z${z}`);
  control.chainIdsByZoom[z]=ids.slice(0,16);
 }
}
const coverageAuditBytes=JSON.stringify(audit,null,2)+'\n',coverageAuditSha256=sha256(coverageAuditBytes);
// Audits are immutable render assets too: changing controls or their emitted
// membership must produce a new URL rather than overwrite a prior generation.
const generation=sha256(JSON.stringify([sources.map(s=>[s.region,s.pbfSha256]),normalizedWaysSha256,membershipSha256,coverageAuditSha256,tileDetails])).slice(0,24);
const sourceCoverageByZoom={};
for(let z=0;z<=6;z++){
 const classifications={};let ways=0,chains=0;
 for(let i=0;i<chained.features.length;i++){
  const f=chained.features[i];if(!byZoom.get(z)?.has(f.properties.id))continue;
  const count=chained.membership[i].ways.length;ways+=count;chains++;
  classifications[f.properties.classification]=(classifications[f.properties.classification]||0)+count;
 }
 sourceCoverageByZoom[z]={uniqueChains:chains,representedSourceWays:ways,totalSourceWays:features.length,
  sourceWayFraction:ways/features.length,classifications};
}
const target=join(output,'generations',generation);await mkdir(target,{recursive:true});
for(const [key,bytes] of result.tiles){
 const path=join(target,key+'.pbf.gz');await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);
}
await writeFile(join(target,'index.json'),JSON.stringify({schema:1,generation,complete:true,tiles:tileDetails})+'\n');
// GitHub rejects blobs over 100 MB. Archive exact source membership in small
// ordered parts and stream compression without a worldwide JSON string.
async function archive(name,rows){
 const compressed=Readable.from((function*(){for(const row of rows)yield JSON.stringify(row)+'\n'})()).pipe(createGzip());
 const parts=[];let part,partSize=0,total=0,number=0;
 try{for await(const chunk of compressed){
  if(!part){const path=`${name}.ndjson.gz.part-${String(number++).padStart(4,'0')}`;parts.push(path);part=await open(join(target,path),'w');partSize=0}
  await part.writeFile(chunk);partSize+=chunk.length;total+=chunk.length;
  if(total>512*1024**2)throw Error('Source archive exceeds publication size budget');
  if(partSize>=40*1024**2){await part.close();part=undefined}
 }}finally{await part?.close()}
 return {parts,bytes:total};
}
const archives={membership:await archive('membership',chained.membership),ways:await archive('ways',features)};
if(archives.membership.bytes+archives.ways.bytes>512*1024**2)throw Error('Combined reference source archives exceed publication size budget');
await writeFile(join(target,'coverage-audit.json'),coverageAuditBytes);
const classes={};for(const f of features)classes[f.properties.classification]=(classes[f.properties.classification]||0)+1;
const manifest={...result.manifest,complete:true,generation,inputSha256:await referenceInputDigest(),coverage:'all eight Geofabrik continent extracts; complete OSM ways',
 sourceDate:sources[0].date,oldestSource:new Date(Math.min(...sources.map(s=>Date.parse(s.sourceTimestamp)))).toISOString(),
 newestSource:new Date(Math.max(...sources.map(s=>Date.parse(s.sourceTimestamp)))).toISOString(),
 generated:new Date().toISOString(),sources,wayCount:features.length,chainCount:chained.features.length,classifications:classes,
 controls:audit.map(({feature,...c})=>({...c,osmId:feature.properties.id,osmVersion:feature.properties.osm_version})),
 downloadedBytes:sources.reduce((n,s)=>n+s.pbfBytes,0),tileBytes:tileDetails.reduce((n,t)=>n+t.bytes,0),
 largestTileBytes:Math.max(...tileDetails.map(t=>t.bytes)),buildSeconds:(performance.now()-start)/1000,
 peakRssBytes:process.resourceUsage().maxRSS*1024,archives,normalizedWaysSha256,membershipSha256,coverageAuditSha256,
 indexSha256:sha256(await readFile(join(target,'index.json'))),
 fullAcquisitionRequests:sources.length*5,preflightMetadataRequests:sources.length*2,providerTileRequests:0,
 tileFeatureInstancesByZoom:result.manifest.drawnFeaturesByZoom,sourceCoverageByZoom};
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('MAINLINE_REFERENCE',JSON.stringify(manifest));
