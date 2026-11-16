// Optional energy-context snapshot. No acquisition and no deployment cutover:
// this reads the shared, complete Geofabrik+gap assembly only.
import {access,mkdir,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
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
export async function buildExtractEnergyNetwork(pbf,report,out,{read=readElements,subset=osmiumSubset,now=()=>new Date()}={}) {
  checkAssembly(report);
  if(!coversWorld(report))return null;
  // A complete older report cannot certify tags its filter never selected.
  if(report.selectionFilters?.region!==currentFilter('region')||report.selectionFilters?.gap!==currentFilter('gap/0'))throw new Error('Energy network needs an assembly with current selection filters');
  const elements=[],relations=[];
  const counts=await read(pbf,{keep:isEnergyNetworkElement,onElement:e=>(e.type==='relation'?relations:elements).push(e)});
  const shaped=await shapeEnergyRelations(pbf,relations,{read,subset});
  if(counts.withoutGeometry||shaped.counts.memberWaysWithoutGeometry)throw new Error('Energy network has missing geometry');
  elements.push(...shaped.relations);
  const data=energyNetworkGeoJSON(elements);
  if(!data.features.length)throw new Error('Refusing empty worldwide energy network');
  const tiers=Object.entries(ENERGY_TIERS).map(([name,{minzoom,maxzoom,bundleZoom}])=>({name,zoom:bundleZoom,tiles:networkTiles({...data,features:data.features.filter(f=>f.properties.energy_minzoom<=maxzoom)},{minZoom:minzoom,maxZoom:maxzoom})}));
  const bundles=new Map(tiers.flatMap(tier=>[...heritageBundles(tier.tiles,tier.zoom)].map(([key,bytes])=>[`${tier.name}/${key}`,bytes])));
  const manifest={schema:2,dataset:'energy-network',complete:true,built:now().toISOString(),source:'OpenStreetMap via Geofabrik extracts and bounded gap tiles',license:'ODbL-1.0',oldestSource:report.oldestTimestamp,newestSource:report.newestTimestamp,features:data.features.length,format:BUNDLE_FORMAT,minzoom:5,maxzoom:14,tiers:tiers.map(({name,zoom})=>({name,bundleZoom:zoom})),bundles:bundles.size,bytes:[...bundles.values()].reduce((n,b)=>n+b.length,0),largestBundleBytes:Math.max(...[...bundles.values()].map(b=>b.length)),selectionFilters:report.selectionFilters};
  // Bound individual requests, never discard features to make a budget pass.
  // Viewport budgets require the later client integration's measured tile count.
  if(manifest.largestBundleBytes>=350000)throw new Error('Energy bundle exceeds 350 KB; increase spatial partitioning before publication');
  // Publish locally only after every file is written. An existing snapshot is
  // never overwritten in place or left with its old complete manifest.
  try {await access(out);throw new Error('Energy output already exists; use a fresh output directory');}catch(error){if(error.code!=='ENOENT')throw error;}
  const destination=out;
  await mkdir(dirname(out),{recursive:true});
  out=await mkdtemp(join(dirname(out),'.energy-network-'));
  try {
  for(const [key,bytes] of bundles){const path=join(out,key+'.bundle.gz');await mkdir(join(path,'..'),{recursive:true});await writeFile(path,bytes);}
  await writeFile(join(out,'energy-network.geojson.gz'),gzipSync(JSON.stringify(data)));
  for(const tier of tiers){
    await mkdir(join(out,tier.name),{recursive:true});
    await writeFile(join(out,tier.name,'index.json'),JSON.stringify({format:BUNDLE_FORMAT,zoom:tier.zoom,bundles:[...bundles.keys()].filter(k=>k.startsWith(tier.name+'/')).map(k=>k.split('/').slice(2).join('/'))}));
  }
  await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await rename(out,destination);
  return manifest;
  } finally {await rm(out,{recursive:true,force:true});}
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  const [pbf,report,out]=process.argv.slice(2);if(!pbf||!report||!out)throw new Error('Usage: build-extract-energy-network.mjs <assembly.pbf> <report.json> <output>');
  console.log(await buildExtractEnergyNetwork(pbf,JSON.parse(await readFile(report,'utf8')),out));
}
