// Maintenance only. Produce a complete worldwide snapshot of rail-served fuel
// and coal sites. Visitors fetch the published GeoJSON rather than querying Overpass.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {energySiteQuery,energySitesGeoJSON,mergeEnergySite} from './energy-site-data.mjs';
import {createStagedSnapshot} from './staged-overpass.mjs';

export const ENERGY_SITE_CACHE_VERSION=1;
const snapshot=createStagedSnapshot({noun:'energy-site',label:'rail-served fuel and coal sites',userAgent:'RailwayAtlas-energy-sites/1.0',
  query:energySiteQuery,transform:energySitesGeoJSON,merge:mergeEnergySite,cachePrefix:'energy-sites',cacheVersion:ENERGY_SITE_CACHE_VERSION,
  files:{data:'energy-sites.geojson',gzip:'energy-sites.geojson.gz',manifest:'energy-sites-manifest.json'},stagePrefix:'.energy-sites-stage-',
  emptyMessage:'Refusing to publish empty worldwide rail-served energy site data',completeMessage:'Complete worldwide rail-served fuel and coal sites:'});
export const validateEnergySitesSnapshot=snapshot.validate;
export const buildEnergySites=snapshot.build;
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildEnergySites();
