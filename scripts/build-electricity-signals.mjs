// Maintenance only. Validates and publishes the worldwide electrification-
// signal snapshot. The traction workflow builds it in scripts/build-signals.mjs,
// from the same download as the signal-direction supplement; running this
// file directly still builds it on its own (a manual fallback). Visitors fetch
// the published GeoJSON rather than querying Overpass.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {electricitySignalQuery,electricitySignalsGeoJSON} from './electricity-signal-data.mjs';
import {createStagedSnapshot} from './staged-overpass.mjs';

export const ELECTRICITY_SIGNAL_CACHE_VERSION=1;
const snapshot=createStagedSnapshot({noun:'electricity-signal',label:'electrification signals',userAgent:'RailwayAtlas-electricity-signals/1.0',
  query:electricitySignalQuery,transform:electricitySignalsGeoJSON,cachePrefix:'electricity-signals',cacheVersion:ELECTRICITY_SIGNAL_CACHE_VERSION,
  files:{data:'electricity-signals.geojson',gzip:'electricity-signals.geojson.gz',manifest:'electricity-signals-manifest.json'},stagePrefix:'.electricity-signals-stage-',
  emptyMessage:'Refusing to publish empty worldwide electrification signal data',completeMessage:'Complete worldwide electrification signals:'});
export const validateElectricitySignalsSnapshot=snapshot.validate;
export const buildElectricitySignals=snapshot.build;
export const publishElectricitySignals=snapshot.publish;
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildElectricitySignals();
