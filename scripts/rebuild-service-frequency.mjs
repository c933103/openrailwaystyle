// Enrich the already published OSM snapshot. No Overpass or viewer requests.
// The Service view draws OSM routes only (service-routes.mjs): timetable
// feeds add no lines. The worldwide assembly supplies calendar-aware counts
// bound to matched OSM service sections; changed bindings remain unknown.
import {readFile,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createTimetableMatcher,bindTimetableSections} from './timetable-frequency.mjs';
import {buildTiles,geometrySummary,readTable} from './service-routes.mjs';
import {loadTimetableServices} from './gtfs-service.mjs';
import {writeFrequencyCredits} from './frequency-credits.mjs';
import {FREQUENCY_PROFILES} from '../styles/service-frequency.mjs';
const directory=process.argv[2] || 'styles/data/service-routes';
const catalog=JSON.parse(await readFile(new URL('../styles/service-headways.json',import.meta.url),'utf8'));
let raw;
try{raw=await readFile(`${directory}/service-routes.ndjson.gz`);}catch(error){if(error.code==='ENOENT'){raw=gzipSync('');}else throw error;}
const fixture=process.argv.includes('--fixtures');
const {registry,feeds}=await loadTimetableServices(fixture?new URL('../tests/fixtures/service-frequency/registry.json',import.meta.url):undefined);
const table=readTable(gunzipSync(raw).toString());
let applied={schema:1,records:[],sections:[],feeds:[],matching:{}};
let global;
if(!fixture){
  try{global=JSON.parse(await readFile('styles/data/service-frequency/manifest.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(global&&global.schema!==3)throw new Error('Invalid worldwide frequency snapshot');
  if(global?.applied_profiles){
    if(global.applied_profiles.file!=='profiles.json.gz')throw new Error('Invalid applied profile path');
    const bytes=await readFile('styles/data/service-frequency/profiles.json.gz');
    if(createHash('sha256').update(bytes).digest('hex')!==global.applied_profiles.sha256)throw new Error('Applied timetable digest mismatch');
    applied=JSON.parse(gunzipSync(bytes,{maxOutputLength:512_000_000}).toString());
    if(applied.osm_sha256!==global.applied_profiles.osm_sha256)throw new Error('Applied timetable OSM binding mismatch');
  }
}
if(fixture){const matcher=createTimetableMatcher(table);for(const feed of feeds)matcher.addFeed(feed);applied=matcher.finish();}
const bound=bindTimetableSections(table,applied),tiles=buildTiles(table,{headways:catalog,timetables:bound.sections});
const sources=new Set([...bound.sections.values()].flat().filter(s=>Object.keys(s.record.profiles).length&&s.record.properties.frequency_until*1000>=Date.now()).flatMap(s=>s.record.properties.frequency_sources.split(';')));
const timetable={summary:applied.feeds.filter(f=>sources.has(f.id))};
// A rebuild replaces the whole tile set: tiles from an earlier build (for
// example the fixture build) would otherwise stay servable without an index entry.
async function clearTileDirectories(root){
  let names;try{names=await readdir(root);}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const name of names)if(/^\d+$/.test(name))await rm(`${root}/${name}`,{recursive:true,force:true});
}
await clearTileDirectories(directory);
await mkdir(directory,{recursive:true});
const keys=[];let bytes=0;
for(const [key,data] of tiles){
  await mkdir(`${directory}/${key.slice(0,key.lastIndexOf('/'))}`,{recursive:true});
  const gz=gzipSync(data,{level:9});await writeFile(`${directory}/${key}.pbf.gz`,gz);keys.push(key);bytes+=gz.length;
}
await writeFile(`${directory}/index.json`,JSON.stringify({tiles:keys.sort()}));
const gaps=global?[{region:'Worldwide',status:global.applied_profiles?'Partial matched timetable coverage':'Awaiting matched timetable snapshot',reason:`${global.catalogue_entries} catalogue entries. Outcomes: ${JSON.stringify(global.counts)}. ${bound.sections.size} OSM ways have matched section evidence; ${bound.staleSections} changed section bindings were withheld. Unmatched and conflicting services remain unknown. Details: data/service-frequency/inventory.json.`}]:registry.gaps;
// The periods some applied source covers; the viewer offers only these.
const profiles=FREQUENCY_PROFILES.filter(p=>catalog.routes.some(r=>r.match&&r.profiles?.[p])||[...bound.sections.values()].some(rows=>rows.some(s=>s.record.properties.frequency_until*1000>=Date.now()&&s.record.profiles[p])));
await writeFile(`${directory}/frequency-manifest.json`,JSON.stringify({schema:3,matching:{...applied.matching,staleSections:bound.staleSections,appliedWays:bound.sections.size},geometry:geometrySummary(table),profiles,worldwide:global?{catalogue_entries:global.catalogue_entries,countries_scanned:global.countries_scanned,counts:global.counts,catalogue_sha256:global.catalogue_sha256}:null,headways:{source:catalog.source,auditedWholeRouteProfiles:catalog.routes.filter(r=>r.match).length},feeds:timetable.summary,gaps,tiles:keys.length,tileBytes:bytes,scope:global?.scope||'Worldwide snapshot not assembled; other routes unknown. No new extraction.'},null,2)+'\n');
console.log(`Rebuilt ${keys.length} service tiles from cached OSM routes (${bytes} bytes) with matched timetable counts and published headways; timetables add no lines; no extraction.`);

await writeFrequencyCredits(timetable.summary,gaps,catalog,process.argv[3],{global:!!global,fixtures:fixture});
