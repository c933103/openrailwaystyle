// Maintenance only. Produce a complete worldwide, tag-backed energy supply
// snapshot. Visitors fetch the published GeoJSON rather than querying Overpass.
import {mkdir, readFile, writeFile, stat} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {powerFacilityQuery,powerFacilitiesGeoJSON} from './power-facility-data.mjs';

const api=process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const output=process.env.POWER_OUTPUT || 'power-data';
const cache='.snapshot-cache';
// v1 omitted node coordinates; v3 added token/lifecycle selectors. v4 factors
// lifecycle key scans and can overfetch extra key case variants. Use a fresh
// cache epoch so completed v3 regions cannot omit newly selected facilities.
// Bind every raw response to its exact query too,
// so later selection changes cannot accidentally reuse an incomplete cache.
const VERSION=4, MAX_AGE=28*86400_000;
const regions=[];
for (let south=-90;south<90;south+=90) for(let west=-180;west<180;west+=90) regions.push([south,west,south+90,west+90]);
await mkdir(cache,{recursive:true});
await mkdir(output,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let requests=0,downloaded=0;
const features=new Map(),coverage=[];

async function collect(box,depth=0) {
  const query=powerFacilityQuery(box);
  const file=`${cache}/power-facilities-v${VERSION}-${box.join('_')}.json`;
  const splitFile=`${file}.split`;
  let json;
  try {
    const info=await stat(file);
    if(process.env.POWER_REFRESH!=='1' && Date.now()-info.mtimeMs<MAX_AGE) {
      const saved=JSON.parse(await readFile(file,'utf8'));
      if(saved.query===query) {
        powerFacilitiesGeoJSON(saved.response); // Reject cached partial/error responses too.
        json=saved.response;
      }
    }
  } catch {json=undefined;}
  let split=false;
  if (!json) {
    try{split=JSON.parse(await readFile(splitFile,'utf8')).query===query;}catch{}
    if(!split)for(let attempt=0;attempt<3;attempt++) {
      await sleep(requests ? Math.min(60000,attempt?20000*(attempt+1):10000) : 0);
      requests++;
      try {
        console.log('Fetching railway energy supplies',box.join(','),'attempt',attempt+1);
        const response=await fetch(api,{method:'POST',body:new URLSearchParams({data:query}),
          headers:{'User-Agent':'RailwayAtlas-energy-supplies/1.0 (+https://github.com/c933103/openrailwaystyle)'},signal:AbortSignal.timeout(300000)});
        const text=await response.text();downloaded+=Buffer.byteLength(text);
        if(downloaded>100_000_000)throw new Error('Energy facility download budget exceeded');
        if(!response.ok)throw new Error(`HTTP ${response.status}: ${text.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,160)}`);
        json=JSON.parse(text);
        powerFacilitiesGeoJSON(json);
        await writeFile(file,JSON.stringify({query,response:json}));
        break;
      } catch(error) {
        json=undefined;
        console.warn(box.join(','),error.message);
        if(/budget exceeded/.test(error.message))throw error;
        if(/timed? ?out|out of memory|memory/i.test(error.message)){split=true;break;}
        if(attempt===2)throw error;
      }
    }
  }
  if(split) {
    if(depth>=4)throw new Error(`Energy facility region could not complete: ${box}`);
    await writeFile(splitFile,JSON.stringify({query}));
    const [s,w,n,e]=box,lat=(s+n)/2,lon=(w+e)/2;
    for(const child of [[s,w,lat,lon],[s,lon,lat,e],[lat,w,n,lon],[lat,lon,n,e]])await collect(child,depth+1);
    return;
  }
  const data=powerFacilitiesGeoJSON(json);
  for(const feature of data.features)features.set(feature.id,feature);
  coverage.push({bbox:box,timestamp:json.osm3s?.timestamp_osm_base || null,features:data.features.length});
  console.log('Energy supply region',box.join(','),data.features.length,'facilities');
}
for(const box of regions)await collect(box);
if(!features.size)throw new Error('Refusing to publish an empty worldwide railway energy supply snapshot');
const data={type:'FeatureCollection',features:[...features.values()].sort((a,b)=>a.id.localeCompare(b.id))};
const counts={};
for(const feature of data.features)counts[feature.properties.power_kind]=(counts[feature.properties.power_kind] || 0)+1;
const manifest={version:VERSION,built:new Date().toISOString(),source:'OpenStreetMap via Overpass',license:'ODbL-1.0',
  complete:true,features:features.size,counts,coverage,downloadedBytes:downloaded,
  selection:'Explicit railway supplies, traction substations, railway-tagged power/storage facilities and 16.7/16.67 Hz traction power facilities. Ordinary utility, road fuel and general water facilities are excluded.'};
await writeFile(`${output}/power-facilities.geojson`,JSON.stringify(data));
await writeFile(`${output}/power-facilities.geojson.gz`,gzipSync(JSON.stringify(data)));
await writeFile(`${output}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
console.log('Complete worldwide energy supply snapshot:',features.size,'facilities',counts);
