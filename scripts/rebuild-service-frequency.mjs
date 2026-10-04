// Enrich the already published OSM snapshot. No Overpass or viewer requests.
import {readFile,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';
import {buildTiles,readTable} from './service-routes.mjs';
import {loadTimetableServices,timetableFeatures} from './gtfs-service.mjs';
import {writeFrequencyCredits} from './frequency-credits.mjs';
import {mergeServiceTiles} from './merge-service-tiles.mjs';
const directory=process.argv[2] || 'styles/data/service-routes';
const catalog=JSON.parse(await readFile(new URL('../styles/service-headways.json',import.meta.url),'utf8'));
let raw;
try{raw=await readFile(`${directory}/service-routes.ndjson.gz`);}catch(error){if(error.code==='ENOENT'){raw=gzipSync('');}else throw error;}
const fixture=process.argv.includes('--fixtures');
const {registry,feeds}=await loadTimetableServices(fixture?new URL('../tests/fixtures/service-frequency/registry.json',import.meta.url):undefined),timetable=timetableFeatures(feeds);
const table=readTable(gunzipSync(raw).toString()),tiles=buildTiles(table,{headways:catalog,timetable});
let global;
if(!fixture){
  try{global=JSON.parse(await readFile('styles/data/service-frequency/manifest.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(global){
    const index=JSON.parse(await readFile('styles/data/service-frequency/tiles/index.json','utf8'));
    if(global.schema!==3||index.tiles.length!==global.tiles)throw new Error('Invalid worldwide frequency snapshot');
    for(const key of index.tiles){
      if(!/^\d+\/\d+\/\d+$/.test(key))throw new Error('Invalid frequency tile key');
      const bytes=gunzipSync(await readFile(`styles/data/service-frequency/tiles/${key}.pbf.gz`));
      tiles.set(key,tiles.has(key)?mergeServiceTiles([tiles.get(key),bytes]):bytes);
    }
    timetable.summary=global.feeds;
  }
}
// A rebuild replaces the whole tile set: tiles from an earlier build (for
// example the fixture build) would otherwise stay servable without an index entry.
async function clearTileDirectories(root){
  let names;try{names=await readdir(root);}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const name of names)if(/^\d+$/.test(name))await rm(`${root}/${name}`,{recursive:true,force:true});
}
await clearTileDirectories(directory);
const keys=[];let bytes=0;
for(const [key,data] of tiles){
  await mkdir(`${directory}/${key.slice(0,key.lastIndexOf('/'))}`,{recursive:true});
  const gz=gzipSync(data,{level:9});await writeFile(`${directory}/${key}.pbf.gz`,gz);keys.push(key);bytes+=gz.length;
}
await writeFile(`${directory}/index.json`,JSON.stringify({tiles:keys.sort()}));
const gaps=global?[{region:'Worldwide',status:'Catalogue-wide scan',reason:`${global.catalogue_entries} entries across ${global.countries_scanned.length} jurisdictions. Outcomes: ${JSON.stringify(global.counts)}. Details: data/service-frequency/inventory.json.`}]:registry.gaps;
await writeFile(`${directory}/frequency-manifest.json`,JSON.stringify({schema:3,worldwide:global?{catalogue_entries:global.catalogue_entries,countries_scanned:global.countries_scanned,counts:global.counts,catalogue_sha256:global.catalogue_sha256}:null,headways:{source:catalog.source,auditedWholeRouteProfiles:catalog.routes.filter(r=>r.match).length},feeds:timetable.summary,gaps,tiles:keys.length,tileBytes:bytes,scope:global?.scope||'Worldwide snapshot not assembled; other routes unknown. No new extraction.'},null,2)+'\n');
console.log(`Rebuilt ${keys.length} service tiles from cached OSM and official timetable shapes (${bytes} bytes) with peak/off-peak profiles; no extraction.`);

await writeFrequencyCredits(timetable.summary,gaps,catalog,process.argv[3],{global:!!global,fixtures:fixture});
