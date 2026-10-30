// Build-time OSM extracts of every escalator, moving walkway and elevator way
// (zoom-14 tiles at the root) and every aerial cableway and lift (zoom-12
// tiles under aerialways/). Browsers never query Overpass for them.
import {mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {CONVEYING_QUERY,conveyingGeoJSON,conveyingTiles,CONVEYING_ZOOM,AERIALWAY_QUERY,AERIALWAY_ZOOM,aerialwaysGeoJSON} from './conveying-data.mjs';
async function overpass(query) {
  for(let attempt=0;attempt<3;attempt++) {
    try {
      const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(960000),headers:{'User-Agent':'OpenRailwayAtlas snapshot (github.com/c933103/openrailwaystyle)'}});
      if(!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
      const data=await response.json();
      if(data.remark || !Array.isArray(data.elements)) throw new Error(data.remark || 'Incomplete response');
      return data;
    } catch(error) {if(attempt===2) throw error;console.log(error.message,'— retrying after two minutes');await new Promise(r=>setTimeout(r,120000));}
  }
}
async function publish(root,{features},{z,layer,query,minimum,download,description,osmBase,kinds}) {
  if(features.length<minimum) throw new Error(`Suspiciously small worldwide ${layer} extract: ${features.length}`);
  await mkdir(root,{recursive:true});
  await writeFile(new URL(download,root),gzipSync(JSON.stringify({type:'FeatureCollection',features}),{level:9}));
  const tiles=[];
  for(const [key,bytes] of conveyingTiles(features,{z,layer})) {
    const [tz,x]=key.split('/');
    await mkdir(new URL(`${tz}/${x}/`,root),{recursive:true});
    await writeFile(new URL(key+'.pbf.gz',root),gzipSync(bytes,{level:9}));tiles.push(key);
  }
  const counts=Object.fromEntries(kinds.map(kind=>[kind,features.filter(f=>f.properties.kind===kind).length]));
  const manifest={generated:new Date().toISOString(),osmBase,features:features.length,kinds:counts,zoom:z,tiles:tiles.length,source:'https://overpass-api.de/api/interpreter',query,license:'ODbL-1.0',description};
  await writeFile(new URL('manifest.json',root),JSON.stringify(manifest,null,2));
  await writeFile(new URL('index.json',root),JSON.stringify({tiles:tiles.sort()}));
  console.log(JSON.stringify(manifest));
}
const root=new URL('../conveying-data/',import.meta.url);
const conveying=await overpass(CONVEYING_QUERY);
// Taginfo counted about 44,000 such ways in October 2026.
await publish(root,conveyingGeoJSON(conveying),{z:CONVEYING_ZOOM,layer:'conveying',query:CONVEYING_QUERY,minimum:10000,download:'conveying.geojson.gz',osmBase:conveying.osm3s?.timestamp_osm_base,kinds:['escalator','travelator','elevator'],
  description:'Every OSM way with conveying=* (not no) or highway=elevator. Backward escalators are stored reversed so arrows follow the line.'});
const aerialways=await overpass(AERIALWAY_QUERY);
// Taginfo counted about 3,200 cable car and gondola ways alone in October 2026.
await publish(new URL('aerialways/',root),aerialwaysGeoJSON(aerialways),{z:AERIALWAY_ZOOM,layer:'aerialways',query:AERIALWAY_QUERY,minimum:5000,download:'aerialways.geojson.gz',osmBase:aerialways.osm3s?.timestamp_osm_base,kinds:['cableway','lift'],
  description:'Every OSM aerial cableway and lift way (cable car, gondola, mixed lift, chair, drag, T-bar, J-bar and platter lifts), with names, owner and maxspeed.'});
