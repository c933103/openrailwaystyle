// Maintenance build only. Visitors never query Overpass.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {gzipSync} from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import '../styles/pbf-utf8.mjs'; // names beyond U+1FFFF intact
import {STATES, toGeoJSON} from './lifecycle.mjs';
import {DELTA_FILE, deltaQueries, mergeDelta, applyDelta} from './snapshot-delta.mjs';
const api = 'https://overpass-api.de/api/interpreter';
const tracks = 'rail|narrow_gauge|light_rail|subway|tram|monorail|funicular';
await mkdir('.snapshot-cache', {recursive:true});
await mkdir('snapshot', {recursive:true});
const features = new Map(), base = new Map(), parts = [];
const budgetFile=`.snapshot-cache/budget-${process.env.GITHUB_RUN_ID || 'local'}.json`;
let downloaded=0;
try {downloaded=JSON.parse(await readFile(budgetFile,'utf8')).bytes;} catch {}
// Disjoint world regions, serial requests with a quiet interval.
// Full way geometry is retained across quadrant boundaries and deduplicated.
const boxes = [
  ...[-180,-90,0,90].map(w=>[-90,w,0,w+90]),
  ...[0,45].flatMap(s=>[-180,-135,-90,-45,0,45,90,135].map(w=>[s,w,s+45,w+45])),
];
// Start East Asia first among remaining regions, so the reported line is
// diagnosed early. Cached completed quadrants are reused without re-querying.
boxes.sort((a,b)=>(b[0]===0 && b[1]===90 ? 1:0)-(a[0]===0 && a[1]===90 ? 1:0));
async function collect(box, depth=0) {
  const key=box[0]===-90 && box[2]===0 && box[3]-box[1]===90 ? `${box[0]}_${box[1]}` : box.join('_');
  const file = `.snapshot-cache/${key}.json`;
  let json;
  try {json = JSON.parse(await readFile(file,'utf8'));}
  catch {
    // Respect a saved split decision on later restarts.
    let split=false;
    try {await readFile(file+'.split');split=true;} catch {}
    if(!split) {
      const selectors = [`way[railway~"^(${STATES.join('|')})$"](${box});`, ...STATES.map(s => `way["${s}:railway"~"^(${tracks})$"](${box});`)];
      const query = `[out:json][timeout:90][maxsize:134217728];(${selectors.join('')});out tags geom qt;`;
      for(let attempt=0;attempt<3;attempt++) {
        await new Promise(r=>setTimeout(r,attempt ? 60000 : 15000));
        console.log('Fetching world region', box, 'attempt',attempt+1);
        try {
          const response=await fetch(api,{method:'POST',body:new URLSearchParams({data:query}),headers:{'User-Agent':'OpenRailwayAtlas-snapshot/1.0 (+https://github.com/c933103/openrailwaystyle)'},signal:AbortSignal.timeout(130000)});
          if(!response.ok) throw new Error(`HTTP ${response.status}`);
          const text=await response.text();downloaded+=Buffer.byteLength(text);
          await writeFile(budgetFile,JSON.stringify({bytes:downloaded}));
          console.log('Downloaded bytes this run',downloaded);
          if(downloaded>500_000_000) throw new Error('One-off download budget exceeded');
          json=JSON.parse(text);
          if(json.remark || !Array.isArray(json.elements)) throw new Error(json.remark || 'Incomplete response');
          await writeFile(file,text);break;
        } catch(error) {
          console.warn(error.message);json=undefined;
          if(downloaded>500_000_000) throw error;
          // A timeout in extraction/output calls for a smaller area immediately.
          if(/timed out|memory|timeout/i.test(error.message) || attempt===2) {split=true;break;}
        }
      }
    }
    if(split) {
      if(depth>=5) throw new Error(`Could not complete region ${box}`);
      await writeFile(file+'.split','Oversized region; use complete child regions.');
      const [s,w,n,e]=box,lat=(s+n)/2,lon=(w+e)/2;
      for(const child of [[s,w,lat,lon],[s,lon,lat,e],[lat,w,n,lon],[lat,lon,n,e]]) await collect(child,depth+1);
      return;
    }
  }
  const data=toGeoJSON(json);
  for(const f of data.features) { features.set(f.id,f); base.set(f.id,json.osm3s?.timestamp_osm_base); }
  const part={bbox:box,timestamp:json.osm3s?.timestamp_osm_base,features:data.features.length};
  parts.push(part);console.log(JSON.stringify(part));
}
// Split the already-observed eastern-US bottleneck before querying it again.
await writeFile('.snapshot-cache/0_-90_45_-45.json.split','Previous extraction timed out.');
await writeFile('.snapshot-cache/45_0_67.5_22.5.json.split','Dense European region; avoid repeating timed-out query.');
const region=process.env.SNAPSHOT_REGION;
// Weekly incremental update: only ways changed since the previous run.
async function overpassQuery(query, label) {
  for(let attempt=0;attempt<3;attempt++) {
    await new Promise(r=>setTimeout(r,attempt ? 60000 : 5000));
    try {
      const response=await fetch(api,{method:'POST',body:new URLSearchParams({data:query}),headers:{'User-Agent':'OpenRailwayAtlas-snapshot/1.0 (+https://github.com/c933103/openrailwaystyle)'},signal:AbortSignal.timeout(330000)});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const text=await response.text();downloaded+=Buffer.byteLength(text);
      await writeFile(budgetFile,JSON.stringify({bytes:downloaded}));
      console.log(label,'bytes',Buffer.byteLength(text),'downloaded this run',downloaded);
      if(downloaded>500_000_000) throw new Error('Download budget exceeded');
      const json=JSON.parse(text);
      if(json.remark || !Array.isArray(json.elements)) throw new Error(json.remark || 'Incomplete response');
      return json;
    } catch(error) { console.warn(label,error.message); if(attempt===2) throw error; }
  }
}
if(region==='delta') {
  let delta;
  try {delta=JSON.parse(await readFile(DELTA_FILE,'utf8'));} catch {}
  let since=delta?.since;
  if(!since) {
    // First run: start from the oldest cached region response.
    const {readdir}=await import('node:fs/promises');
    const times=[];
    for(const name of await readdir('.snapshot-cache')) {
      if(!name.endsWith('.json') || name.startsWith('budget-') || name==='delta.json') continue;
      try {const t=JSON.parse(await readFile(`.snapshot-cache/${name}`,'utf8')).osm3s?.timestamp_osm_base; if(t) times.push(t);} catch {}
    }
    since=times.sort()[0];
  }
  if(!since) { console.log('No cached regions; nothing to update incrementally'); process.exit(0); }
  console.log('Changes since',since);
  // Region by region (a worldwide change query can exceed the server's time
  // limit); a region that fails is split into quarters.
  let next=delta, earliest, counts={lifecycle:0,opened:0};
  async function changes(box, depth=0) {
    const queries=deltaQueries(since, box.join(','));
    try {
      const lifecycle=await overpassQuery(queries.lifecycle,`Changed lifecycle ways ${box}`);
      const opened=await overpassQuery(queries.opened,`Changed operating ways ${box}`);
      next=mergeDelta(next,lifecycle,opened);
      counts.lifecycle+=lifecycle.elements.length; counts.opened+=opened.elements.length;
      if(!earliest || next.since<earliest) earliest=next.since;
    } catch(error) {
      // Split only when the query itself was too big; a busy server (HTTP
      // 429/503/504) is not helped by sending more queries.
      if(depth>=3 || !/timed out|out of memory|memory/i.test(error.message)) throw error;
      const [s,w,n,e]=box,lat=(s+n)/2,lon=(w+e)/2;
      for(const child of [[s,w,lat,lon],[s,lon,lat,e],[lat,w,n,lon],[lat,lon,n,e]]) await changes(child,depth+1);
    }
  }
  for(const box of boxes) await changes(box);
  // The next run starts from the earliest response time, so nothing between
  // region queries is missed (overlap is harmless).
  next={...next, since:earliest};
  await writeFile(DELTA_FILE,JSON.stringify(next));
  console.log('DELTA COMPLETE',JSON.stringify({since:next.since,changes:Object.keys(next.changes).length,...counts,downloaded}));
  process.exit(0);
}
if(region!==undefined && region!=='assemble') {
  const box=boxes[Number(region)];
  if(!box) throw new Error('Invalid extraction region');
  await collect(box);
  console.log('REGION COMPLETE',region,JSON.stringify(parts));
  process.exit(0);
}
for(const box of boxes) await collect(box);
const area=parts.reduce((sum,{bbox:[s,w,n,e]})=>sum+(n-s)*(e-w),0);
if(Math.abs(area-64800)>1e-6) throw new Error('Incomplete world coverage');
let delta, deltaResult={added:0,updated:0,removed:0};
try {delta=JSON.parse(await readFile(DELTA_FILE,'utf8'));} catch {}
if(delta) {
  const {delta:pruned,...counts}=applyDelta(features,base,delta);
  deltaResult=counts; console.log('Applied weekly changes',JSON.stringify(counts),'up to',delta.since);
  await writeFile(DELTA_FILE,JSON.stringify(pruned));
}
const data = {type:'FeatureCollection', features:[...features.values()]};
const nambu = data.features.filter(f => /남부내륙/.test(f.properties.name));
if (!nambu.length) throw new Error('Regression: 남부내륙선 missing from worldwide snapshot');
const coordinates = nambu.flatMap(f => f.geometry.type==='LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat());
const bbox = [Math.min(...coordinates.map(p=>p[0])), Math.min(...coordinates.map(p=>p[1])), Math.max(...coordinates.map(p=>p[0])), Math.max(...coordinates.map(p=>p[1]))];
if (bbox[3]-bbox[1] < 1) throw new Error('Regression: 남부내륙선 extent appears incomplete');
const counts = Object.fromEntries(STATES.map(s=>[s,data.features.filter(f=>f.properties.state===s).length]));
const manifest = {coverage:'world', built:new Date().toISOString(), source:api, licence:'ODbL-1.0', parts, changesUpTo:delta?.since, changesApplied:deltaResult, features:features.size, states:counts, regression:{name:'남부내륙선',ways:nambu.length,bbox,ids:nambu.map(f=>f.id)}};
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
