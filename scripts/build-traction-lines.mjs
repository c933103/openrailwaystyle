// Maintenance only. Produce a complete worldwide snapshot of railway traction
// power lines. Visitors fetch the published GeoJSON rather than querying Overpass.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tractionLineQuery,tractionLineFollowUp,tractionLinesGeoJSON,mergeTractionLine} from './traction-line-data.mjs';
import {createStagedSnapshot} from './staged-overpass.mjs';

export const TRACTION_LINE_CACHE_VERSION=2;
const snapshot=createStagedSnapshot({noun:'traction-line',label:'railway traction power lines',userAgent:'RailwayAtlas-traction-lines/1.0',
  query:tractionLineQuery,transform:tractionLinesGeoJSON,merge:mergeTractionLine,followUp:tractionLineFollowUp,cachePrefix:'traction-lines',cacheVersion:TRACTION_LINE_CACHE_VERSION,
  files:{data:'traction-lines.geojson',gzip:'traction-lines.geojson.gz',manifest:'traction-lines-manifest.json'},stagePrefix:'.traction-lines-stage-',
  emptyMessage:'Refusing to publish empty worldwide traction power line data',completeMessage:'Complete worldwide railway traction power lines:'});
export const validateTractionLinesSnapshot=snapshot.validate;
export const buildTractionLines=snapshot.build;
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildTractionLines();
