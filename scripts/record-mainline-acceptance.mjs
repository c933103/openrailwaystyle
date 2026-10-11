import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {MAINLINE_CONTROLS,sha256} from './mainline-coverage.mjs';
const [root,reportPath]=process.argv.slice(2);
if(!root||!reportPath)throw Error('Expected snapshot directory and renderer acceptance report');
const manifest=JSON.parse(await readFile(join(root,'manifest.json'))),bytes=await readFile(reportPath),report=JSON.parse(bytes);
if(!manifest.complete||report.generation!==manifest.generation||
 report.scope!=='Actual published OSM generation; exact chain identities')throw Error('Synthetic or mismatched renderer evidence cannot certify OSM coverage');
const keys=new Set();
for(const s of report.samples||[]){
 const control=manifest.controls.find(c=>c.name===s.name),z=Math.min(6,Math.max(0,Math.floor(s.zoom)));
 const key=JSON.stringify([s.profile,s.projection,s.name,s.zoom]);
 if(keys.has(key)||!control||!['desktop','android','safari'].includes(s.profile)||
  !['mercator','globe'].includes(s.projection)||![-.1,0,3,4,5,6,7].includes(s.zoom)||
  !Number.isFinite(s.cameraZoom)||Math.abs(s.cameraZoom-s.zoom)>.001||!(s.painted>0)||
  !s.ids?.length||!s.ids.every(id=>control.chainIdsByZoom[z].includes(id)))throw Error('Invalid or incomplete actual renderer evidence');
 keys.add(key);
}
if(keys.size!==MAINLINE_CONTROLS.length*3*2*7||report.appSamples?.length!==18)
 throw Error('Missing geographic, engine, projection, zoom or Atlas integration acceptance');
for(const s of report.appSamples)if(!s.ids?.length||Math.abs(s.cameraZoom-s.zoom)>.001)throw Error('Atlas handoff acceptance failed');
const path=join('generations',manifest.generation,'renderer-acceptance.json');
await writeFile(join(root,path),bytes);
manifest.rendererAcceptance={complete:true,path,sha256:sha256(bytes),samples:keys.size,appSamples:report.appSamples.length,
 assetRequests:report.assetRequests,assetBytes:report.requestBytes,timing:report.timing};
await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('PASS: retained actual OSM renderer acceptance',JSON.stringify(manifest.rendererAcceptance));
