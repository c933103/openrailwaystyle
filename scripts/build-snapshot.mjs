// Maintenance build only. Visitors never query Overpass.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {gzipSync} from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {STATES, toGeoJSON} from './lifecycle.mjs';
const api = 'https://overpass-api.de/api/interpreter';
const tracks = 'rail|narrow_gauge|light_rail|subway|tram|monorail|funicular';
await mkdir('.snapshot-cache', {recursive:true});
await mkdir('snapshot', {recursive:true});
const features = new Map(), parts = [];
let downloaded = 0;
// Eight disjoint world quadrants, serial requests with a quiet interval.
// Full way geometry is retained across quadrant boundaries and deduplicated.
for (const south of [-90, 0]) for (const west of [-180, -90, 0, 90]) {
  const box = [south,west,south+90,west+90], key = `${south}_${west}`;
  const file = `.snapshot-cache/${key}.json`;
  let json;
  try {json = JSON.parse(await readFile(file,'utf8'));}
  catch {
    const selectors = [`way[railway~"^(${STATES.join('|')})$"](${box});`, ...STATES.map(s => `way["${s}:railway"~"^(${tracks})$"](${box});`)];
    const query = `[out:json][timeout:180][maxsize:536870912];(${selectors.join('')});out tags geom;`;
    for (let attempt=0; attempt<3; attempt++) {
      if (parts.length || attempt) await new Promise(r => setTimeout(r, attempt ? 90000 : 15000));
      console.log('Fetching world quadrant', box, 'attempt', attempt+1);
      try {
        const response = await fetch(api, {method:'POST', body:new URLSearchParams({data:query}), headers:{'User-Agent':'OpenRailwayAtlas-snapshot/1.0 (+https://github.com/c933103/openrailwaystyle)'}, signal:AbortSignal.timeout(240000)});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text(); downloaded += Buffer.byteLength(text);
        if (downloaded > 950_000_000) throw new Error('One-off download budget exceeded');
        json = JSON.parse(text);
        if (json.remark || !Array.isArray(json.elements)) throw new Error(json.remark || 'Incomplete response');
        await writeFile(file, text);
        break;
      } catch (error) {console.warn(error.message); if (attempt===2 || downloaded>950_000_000) throw error;}
    }
  }
  const data = toGeoJSON(json);
  for (const f of data.features) features.set(f.id, f);
  const part = {bbox:box, timestamp:json.osm3s?.timestamp_osm_base, features:data.features.length};
  parts.push(part); console.log(JSON.stringify(part));
}
const data = {type:'FeatureCollection', features:[...features.values()]};
const nambu = data.features.filter(f => /남부내륙/.test(f.properties.name));
if (!nambu.length) throw new Error('Regression: 남부내륙선 missing from worldwide snapshot');
const coordinates = nambu.flatMap(f => f.geometry.type==='LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat());
const bbox = [Math.min(...coordinates.map(p=>p[0])), Math.min(...coordinates.map(p=>p[1])), Math.max(...coordinates.map(p=>p[0])), Math.max(...coordinates.map(p=>p[1]))];
if (bbox[3]-bbox[1] < 1) throw new Error('Regression: 남부내륙선 extent appears incomplete');
const counts = Object.fromEntries(STATES.map(s=>[s,data.features.filter(f=>f.properties.state===s).length]));
const manifest = {built:new Date().toISOString(), source:api, licence:'ODbL-1.0', parts, features:features.size, states:counts, regression:{name:'남부내륙선',ways:nambu.length,bbox,ids:nambu.map(f=>f.id)}};
console.log(JSON.stringify(manifest));
await writeFile('snapshot/manifest.json', JSON.stringify(manifest,null,2)+'\n');
// Source dump makes the derived ODbL database reusable independently of renderer.
await writeFile('snapshot/lifecycle.geojson.gz',gzipSync(JSON.stringify(data)));
const index = geojsonvt(data,{maxZoom:10,indexMaxZoom:4,indexMaxPoints:100000,tolerance:1,extent:4096,buffer:128});
const stream=createWriteStream('snapshot/tiles.jsonl'); let tileCount=0;
async function visit(z,x,y) {
  const tile=index.getTile(z,x,y);
  if (!tile?.features.length) return;
  if(z>=5) {
    const bytes=gzipSync(vtpbf.fromGeojsonVt({lifecycle:tile}));
    if(!stream.write(JSON.stringify([z,x,y,bytes.toString('base64')])+'\n')) await once(stream,'drain');
    tileCount++;
  }
  if(z<10) for(let dy=0;dy<2;dy++) for(let dx=0;dx<2;dx++) await visit(z+1,x*2+dx,y*2+dy);
}
await visit(0,0,0); stream.end(); await once(stream,'finish');
console.log('Generated tiles',tileCount);
