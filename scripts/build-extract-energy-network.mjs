// Optional energy-context snapshot. No acquisition and no deployment cutover:
// this reads the shared, complete Geofabrik+gap assembly only.
import {access,mkdir,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {checkAssembly,coversWorld} from './build-extract-branch-lines.mjs';
import {currentFilter} from './extract-release.mjs';
import {readElements} from './extract-elements.mjs';
import {osmiumSubset} from './build-extract-station-points.mjs';
import {shapeEnergyRelations} from './energy-site-relations.mjs';
import {isEnergyNetworkElement,energyNetworkGeoJSON} from './energy-network-data.mjs';
import {heritageBundles} from './heritage-data.mjs';
import {ENERGY_TIERS} from './energy-network-schema.mjs';
import {BUNDLE_FORMAT} from '../styles/tile-bundles.mjs';
export function networkTiles(data,{minZoom=6,maxZoom=8}={}) {
  const index=geojsonvt(data,{maxZoom,indexMaxZoom:maxZoom,indexMaxPoints:0,tolerance:2,extent:4096,buffer:64});
  const tiles=new Map();
  for(const {z,x,y} of index.tileCoords){
    if(z<minZoom)continue;
    const tile=index.getTile(z,x,y);if(tile?.features.length)tiles.set(`${z}/${x}/${y}`,Buffer.from(vtpbf.fromGeojsonVt({atlas_energy_network:tile},{version:2})));
  }
  return tiles;
}
function* featureCollectionJson(features) {
  yield '{"type":"FeatureCollection","features":[';
  for (let i=0;i<features.length;i++) {
    if(i)yield ',';
    yield JSON.stringify(features[i]);
  }
  yield ']}';
}

export async function buildExtractEnergyNetwork(pbf,report,out,{
  read=readElements,subset=osmiumSubset,now=()=>new Date(),observe=()=>{}
}={}) {
  checkAssembly(report);
  if(!coversWorld(report))return null;
  if(report.selectionFilters?.region!==currentFilter('region')||report.selectionFilters?.gap!==currentFilter('gap/0'))throw new Error('Energy network needs an assembly with current selection filters');
  // Keep the previous candidate intact, even if a later tier or the export fails.
  try {await access(out);throw new Error('Energy output already exists; use a fresh output directory');}catch(error){if(error.code!=='ENOENT')throw error;}
  const phase=(stage,counts={})=>observe({stage,...counts,...process.memoryUsage()});
  const elements=[],relations=[];
  phase('input:start');
  const counts=await read(pbf,{keep:isEnergyNetworkElement,onElement:e=>(e.type==='relation'?relations:elements).push(e)});
  phase('input:done',{elements:elements.length,relations:relations.length});
  phase('relations:start');
  const shaped=await shapeEnergyRelations(pbf,relations,{read,subset});
  if(counts.withoutGeometry||shaped.counts.memberWaysWithoutGeometry)throw new Error('Energy network has missing geometry');
  for(const relation of shaped.relations)elements.push(relation);
  relations.length=0;
  phase('relations:done',{shaped:shaped.relations.length});
  shaped.relations.length=0;
  phase('classification:start');
  const data=energyNetworkGeoJSON(elements);
  elements.length=0;
  phase('classification:done',{features:data.features.length});
  if(!data.features.length)throw new Error('Refusing empty worldwide energy network');
  const destination=out;
  await mkdir(dirname(out),{recursive:true});
  const staging=await mkdtemp(join(dirname(out),'.energy-network-'));
  const tiers=[];
  let bundles=0,bytes=0,largestBundleBytes=0;
  try {
    // Retain at most one tier of PBF plus compressed bundles, instead of
    // retaining three tiers while serializing and compressing the world.
    for(const [name,{minzoom,maxzoom,bundleZoom}] of Object.entries(ENERGY_TIERS)) {
      phase('tier:start',{tier:name});
      const tiles=networkTiles({...data,features:data.features.filter(f=>f.properties.energy_minzoom<=maxzoom)},{minZoom:minzoom,maxZoom:maxzoom});
      phase('tier:tiles',{tier:name,tiles:tiles.size});
      const grouped=heritageBundles(tiles,bundleZoom);
      tiles.clear();
      phase('tier:bundles',{tier:name,bundles:grouped.size});
      const index=[];
      for(const [key,body] of grouped) {
        // Bound individual requests without dropping features to fit.
        if(body.length>=350000)throw new Error('Energy bundle exceeds 350 KB; increase spatial partitioning before publication');
        const path=join(staging,name,key+'.bundle.gz');
        await mkdir(dirname(path),{recursive:true});
        await writeFile(path,body);
        index.push(key.slice(key.indexOf('/')+1));
        bundles++;
        bytes+=body.length;
        largestBundleBytes=Math.max(largestBundleBytes,body.length);
      }
      grouped.clear();
      await mkdir(join(staging,name),{recursive:true});
      await writeFile(join(staging,name,'index.json'),JSON.stringify({format:BUNDLE_FORMAT,zoom:bundleZoom,bundles:index}));
      tiers.push({name,bundleZoom});
      phase('tier:done',{tier:name,bundles:index.length});
    }
    phase('export:start');
    await pipeline(Readable.from(featureCollectionJson(data.features)),createGzip(),createWriteStream(join(staging,'energy-network.geojson.gz')));
    phase('export:done');
    const manifest={schema:2,dataset:'energy-network',complete:true,built:now().toISOString(),source:'OpenStreetMap via Geofabrik extracts and bounded gap tiles',license:'ODbL-1.0',oldestSource:report.oldestTimestamp,newestSource:report.newestTimestamp,features:data.features.length,format:BUNDLE_FORMAT,minzoom:5,maxzoom:14,tiers,bundles,bytes,largestBundleBytes,selectionFilters:report.selectionFilters};
    await writeFile(join(staging,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    await rename(staging,destination);
    return manifest;
  } finally {await rm(staging,{recursive:true,force:true});}
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  const [pbf,report,out]=process.argv.slice(2);if(!pbf||!report||!out)throw new Error('Usage: build-extract-energy-network.mjs <assembly.pbf> <report.json> <output>');
  console.log(await buildExtractEnergyNetwork(pbf,JSON.parse(await readFile(report,'utf8')),out,{observe:record=>console.error(JSON.stringify(record))}));
}
