// Maintenance-only extraction. Facility v6 caches remain reusable; method v1
// files are retained separately from the optimized query's v2 checkpoints.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {powerMethodQuery,powerMethodsGeoJSON} from './power-method-data.mjs';
import {createStagedSnapshot,STAGED_LIMITS,STAGED_REGIONS} from './staged-overpass.mjs';

export const POWER_METHOD_LIMITS=STAGED_LIMITS;
export const POWER_METHOD_CACHE_VERSION=2;
export const POWER_METHOD_REGIONS=STAGED_REGIONS;
const snapshot=createStagedSnapshot({noun:'power-method',label:'conductor rails and railway chargers',userAgent:'RailwayAtlas-power-methods/1.0',
  query:powerMethodQuery,transform:powerMethodsGeoJSON,cachePrefix:'power-methods',cacheVersion:POWER_METHOD_CACHE_VERSION,
  files:{data:'power-methods.geojson',gzip:'power-methods.geojson.gz',manifest:'methods-manifest.json'},stagePrefix:'.methods-stage-',
  emptyMessage:'Refusing to publish empty worldwide conductor-rail and charging data',completeMessage:'Complete worldwide conductor rails and railway chargers:'});
export const validatePowerMethodsSnapshot=snapshot.validate;
export const buildPowerMethods=snapshot.build;

// Built from the stored railway-ways regions (build-railway-ways.mjs) once
// every stage is complete there: no Overpass request. Returns undefined, and
// publishes nothing, while the store is incomplete.
export async function buildPowerMethodsFromStore(store,{output=process.env.POWER_OUTPUT||'power-data',now=Date.now,log=console.log}={}) {
  const [{readFile},{join},{STAGES},{storedRegions},{powerView}]=await Promise.all([import('node:fs/promises'),import('node:path'),
    import('./download-stages.mjs'),import('./build-railway-ways.mjs'),import('./railway-ways.mjs')]);
  const stages=JSON.parse(await readFile(join(store,'state.json'),'utf8')).stages||{};
  const missing=STAGES.filter(stage=>!stages[stage.name]?.completed).map(stage=>stage.name);
  if(missing.length){log('Stored railway-ways regions incomplete; not built from the store:',missing.join(' '));return undefined;}
  const features=new Map(),coverage=[];
  for await(const region of storedRegions(store)) {
    const data=powerMethodsGeoJSON(powerView(region.response));
    for(const feature of data.features)features.set(feature.id,feature);
    coverage.push({stage:region.stage,part:region.part,bbox:region.box,timestamp:region.response.osm3s?.timestamp_osm_base||null,features:data.features.length});
  }
  if(!features.size)throw new Error('Refusing to publish empty worldwide conductor-rail and charging data');
  const data={type:'FeatureCollection',features:[...features.values()].sort((a,b)=>a.id.localeCompare(b.id))};
  return snapshot.publish(data,coverage,{output,requests:0,downloadedBytes:0,now,log,partition:'railway-ways-stages'});
}

// With RAILWAY_WAYS_STORE set, a complete store is used; otherwise (or while
// it is incomplete) the download, which stays the fallback.
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(!process.env.RAILWAY_WAYS_STORE||!await buildPowerMethodsFromStore(process.env.RAILWAY_WAYS_STORE))await buildPowerMethods();
}
