// Independent bounded extraction preserves all existing v6 facility caches.
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {powerMethodQuery,powerMethodsGeoJSON} from './power-method-data.mjs';
const api=process.env.OVERPASS_URL||'https://overpass-api.de/api/interpreter',output=process.env.POWER_OUTPUT||'power-data';
await mkdir('.snapshot-cache',{recursive:true});await mkdir(output,{recursive:true});
const features=new Map(),coverage=[];let downloaded=0,requests=0;
async function collect(box,depth=0) {
  const query=powerMethodQuery(box),file=`.snapshot-cache/power-methods-v1-${box.join('_')}.json`;
  let json;
  try {const info=await stat(file),saved=JSON.parse(await readFile(file));if(saved.query===query&&Date.now()-info.mtimeMs<28*86400_000&&process.env.POWER_REFRESH!=='1'){powerMethodsGeoJSON(saved.response);json=saved.response;}}catch{}
  if(!json) {
    for(let attempt=0;attempt<3;attempt++) {
      if(requests)await new Promise(resolve=>setTimeout(resolve,attempt?40000:10000));requests++;
      try {
        console.log('Collecting conductor rails and railway chargers',box.join(','),'attempt',attempt+1);
        const response=await fetch(api,{method:'POST',body:new URLSearchParams({data:query}),headers:{'User-Agent':'RailwayAtlas-power-methods/1.0 (+https://github.com/c933103/openrailwaystyle)'},signal:AbortSignal.timeout(300000)});
        const chunks=[];
        for await(const chunk of response.body){downloaded+=chunk.length;if(downloaded>100_000_000)throw new Error('Power-method download budget exceeded');chunks.push(chunk);}
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        json=JSON.parse(Buffer.concat(chunks));powerMethodsGeoJSON(json);
        await writeFile(file,JSON.stringify({query,response:json}));break;
      }catch(error) {
        if(downloaded>100_000_000)throw error;
        if(attempt<2)continue;
        if(depth>=6)throw error;
        const [s,w,n,e]=box,m=(s+n)/2,l=(w+e)/2;
        for(const child of [[s,w,m,l],[s,l,m,e],[m,w,n,l],[m,l,n,e]])await collect(child,depth+1);
        return;
      }
    }
  }
  const data=powerMethodsGeoJSON(json);for(const feature of data.features)features.set(feature.id,feature);
  coverage.push({bbox:box,timestamp:json.osm3s?.timestamp_osm_base||null,features:data.features.length});
}
for(let s=-90;s<90;s+=90)for(let w=-180;w<180;w+=90)await collect([s,w,s+90,w+90]);
if(!features.size)throw new Error('Refusing to publish empty worldwide conductor-rail and charging data');
const data={type:'FeatureCollection',features:[...features.values()].sort((a,b)=>a.id.localeCompare(b.id))},body=JSON.stringify(data);
await writeFile(`${output}/power-methods.geojson`,body);await writeFile(`${output}/power-methods.geojson.gz`,gzipSync(body));
await writeFile(`${output}/methods-manifest.json`,JSON.stringify({version:1,complete:true,built:new Date().toISOString(),features:features.size,coverage,requests,downloadedBytes:downloaded,source:'OpenStreetMap via Overpass',license:'ODbL-1.0'},null,2)+'\n');
console.log('Complete worldwide conductor rails and railway chargers:',features.size);
