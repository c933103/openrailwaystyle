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
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildPowerMethods();
