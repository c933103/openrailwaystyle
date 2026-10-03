// Enrich the already published OSM snapshot. No Overpass or viewer requests.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';
import {buildTiles,readTable} from './service-routes.mjs';
import {loadTimetableServices,timetableFeatures} from './gtfs-service.mjs';
import {writeFrequencyCredits} from './frequency-credits.mjs';
const directory=process.argv[2] || 'styles/data/service-routes';
const catalog=JSON.parse(await readFile(new URL('../styles/service-headways.json',import.meta.url),'utf8'));
let raw;
try{raw=await readFile(`${directory}/service-routes.ndjson.gz`);}catch(error){if(error.code==='ENOENT'){raw=gzipSync('');}else throw error;}
const {registry,feeds}=await loadTimetableServices(),timetable=timetableFeatures(feeds);
const table=readTable(gunzipSync(raw).toString()),tiles=buildTiles(table,{headways:catalog,timetable});
const keys=[];let bytes=0;
for(const [key,data] of tiles){
  await mkdir(`${directory}/${key.slice(0,key.lastIndexOf('/'))}`,{recursive:true});
  const gz=gzipSync(data,{level:9});await writeFile(`${directory}/${key}.pbf.gz`,gz);keys.push(key);bytes+=gz.length;
}
await writeFile(`${directory}/index.json`,JSON.stringify({tiles:keys.sort()}));
await writeFile(`${directory}/frequency-manifest.json`,JSON.stringify({schema:2,headways:{source:catalog.source,matchedWholeRouteProfiles:catalog.routes.filter(r=>r.match).length},feeds:timetable.summary,gaps:registry.gaps,tiles:keys.length,tileBytes:bytes,scope:'Scheduled path profiles along supplied rail shapes plus audited published headways. Regional coverage is partial; other routes unknown. No new extraction.'},null,2)+'\n');
console.log(`Rebuilt ${keys.length} service tiles from cached OSM and official timetable shapes (${bytes} bytes) with peak/off-peak profiles; no extraction.`);

await writeFrequencyCredits(timetable.summary,registry.gaps,catalog,process.argv[3]);
