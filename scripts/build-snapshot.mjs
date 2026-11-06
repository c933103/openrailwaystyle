// Maintenance build only. Visitors never query Overpass.
import {readFile, writeFile, mkdir, unlink, rename} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {gzipSync} from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import '../styles/pbf-utf8.mjs'; // names beyond U+1FFFF intact
import {STATES, toGeoJSON} from './lifecycle.mjs';
import {DELTA_FILE, applyDelta, recordChanges} from './snapshot-delta.mjs';
import {updateElements} from './overpass-adiff.mjs';
import {quarters, worldRegions} from './world-regions.mjs';
import {stationQueryExceededLimits as queryExceededLimits} from './station-acquisition.mjs';
const api = 'https://overpass-api.de/api/interpreter';
// Do not log messages, stacks, URLs, headers or arbitrary error properties.
// Node's fetch hides the useful transport code in its cause; retain only
// bounded, known classifications and the measured time of the failed fetch.
const errorNames = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'TimeoutError', 'AggregateError']);
const errorCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_SSL_WRONG_VERSION_NUMBER']);
async function fetchOverpass(query, timeout, phase) {
  const started = performance.now();
  let stage = 'fetch';
  try {
    const response = await fetch(api, {method:'POST', body:new URLSearchParams({data:query}),
      headers:{'User-Agent':'OpenRailwayAtlas-snapshot/1.0 (+https://github.com/c933103/openrailwaystyle)'}, signal:AbortSignal.timeout(timeout)});
    stage = 'body';
    const text = phase === 'full' || response.ok ? await response.text() : '';
    return {response, text};
  } catch (error) {
    const causes = [];
    try {
      for (let current = error; current && causes.length < 3; current = current.cause) {
        const name = current.name, code = current.code;
        const item = {name:errorNames.has(name) ? name : 'UnknownError'};
        if (errorCodes.has(code)) item.code = code;
        causes.push(item);
      }
    } catch { /* A diagnostic getter must not expose arbitrary error data. */ }
    console.warn('OVERPASS_FETCH_FAILURE', JSON.stringify({phase, stage, elapsedMs:Math.max(0, Math.round(performance.now() - started)), causes}));
    // Existing callers print their error messages. Do not pass transport
    // messages or a raw cause through to those logs or the final stack.
    throw new Error('Overpass transport request failed');
  }
}
const tracks = 'rail|narrow_gauge|light_rail|subway|tram|monorail|funicular';
await mkdir('.snapshot-cache', {recursive:true});
await mkdir('snapshot', {recursive:true});
const features = new Map(), base = new Map(), parts = [];
const budgetFile=`.snapshot-cache/budget-${process.env.GITHUB_RUN_ID || 'local'}.json`;
let downloaded=0;
try {downloaded=JSON.parse(await readFile(budgetFile,'utf8')).bytes;} catch {}
// Disjoint world regions, serial requests with a quiet interval.
// Full way geometry is retained across quadrant boundaries and deduplicated.
// Whole quadrants in the south, 45-degree quarters in the denser north.
const boxes = worldRegions(([south]) => south < 0 ? 90 : 45);
// Start East Asia first among remaining regions, so the reported line is
// diagnosed early. Cached completed quadrants are reused without re-querying.
boxes.sort((a,b)=>(b[0]===0 && b[1]===90 ? 1:0)-(a[0]===0 && a[1]===90 ? 1:0));
const regionFile=box=>`.snapshot-cache/${box[0]===-90 && box[2]===0 && box[3]-box[1]===90 ? `${box[0]}_${box[1]}` : box.join('_')}.json`;
// A failed full replacement leaves .previous in the Actions cache. The
// release-cache merge can restore an older file at the now-missing ordinary
// name. It is not the replacement and must not retire the newer .previous.
function databaseTime(json) {
  const value = json?.osm3s?.timestamp_osm_base, time = Date.parse(value);
  // The change log compares these strings. Accept the provider's canonical
  // UTC form only, so offsets or invalid dates cannot reorder observations.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
      || !Number.isFinite(time) || new Date(time).toISOString() !== value.replace('Z', '.000Z'))
    throw new Error('Region replacement is older than preserved data or has no valid database time');
  return time;
}
async function preservedTime(file, minimum = -Infinity) {
  let previous;
  try { previous = JSON.parse(await readFile(file + '.previous', 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return minimum; throw error; }
  toGeoJSON(previous);
  return Math.max(minimum, databaseTime(previous));
}
function requireNotOlder(json, minimum) {
  if (databaseTime(json) < minimum)
    throw new Error('Region replacement is older than preserved data or has no valid database time');
  toGeoJSON(json); // Validate conversion before writing or retiring any source.
}
async function readRegion(file, minimum) {
  const json = JSON.parse(await readFile(file, 'utf8'));
  requireNotOlder(json, minimum);
  return json;
}
// The planned, construction and former ways of one region.
function regionQuery(box) {
  const selectors = [`way[railway~"^(${STATES.join('|')})$"](${box});`, ...STATES.map(s => `way["${s}:railway"~"^(${tracks})$"](${box});`)];
  return `[out:json][timeout:90][maxsize:134217728];(${selectors.join('')});out tags geom qt;`;
}
// A region downloaded again in full keeps its earlier data (`.previous`)
// until the differences are in the change log, as a region update logs
// them, so a stale neighbouring region cannot bring back what the download
// removed or changed. Removed only after the log is saved: a run stopped in
// between logs them again next time.
// `parts`: what the download gave, each with its box and database time (one
// part, or the parts of a region that split). Each part is compared with the
// earlier elements it would have selected (a node in its box) or still has,
// and logged at its own time, oldest first, so a newer part's observation is
// never dated earlier. An element with no node in a part is not that part's
// to remove: its bounding rectangle may cover a part it never entered.
const reaches=(element,[s,w,n,e])=>{
  if(!Array.isArray(element.geometry) || !element.geometry.length) return true;
  return element.geometry.some(p=>p && p.lat>=s && p.lat<=n && p.lon>=w && p.lon<=e);
};
async function reconcile(box, parts, log) {
  const previous=regionFile(box)+'.previous';
  let saved;
  try {saved=JSON.parse(await readFile(previous,'utf8'));}
  catch(error) {if(error.code==='ENOENT') return log; throw error;}
  const minimum=databaseTime(saved), before=saved.elements;
  toGeoJSON(saved);
  if(!parts.length) throw new Error('Region replacement has no complete parts');
  // Validate every leaf before recording any changes or retiring the parent.
  for(const part of parts) requireNotOlder({osm3s:{timestamp_osm_base:part.time},elements:part.elements},minimum);
  const usable=[...parts].sort((a,b)=>a.time<b.time ? -1 : a.time>b.time ? 1 : 0);
  if(usable.length) {
    if(log===undefined) try {log=JSON.parse(await readFile(DELTA_FILE,'utf8'));} catch {}
    for(const part of usable) {
      const ids=new Set(part.elements.map(e=>e.id));
      log=recordChanges(log,part.time,before.filter(e=>ids.has(e.id) || reaches(e,part.box)),part.elements,part.box);
    }
    await writeFile(DELTA_FILE,JSON.stringify(log));
  }
  await unlink(previous);
  return log;
}
async function collect(box, depth=0, minimum=-Infinity) {
  const file = regionFile(box);
  minimum = await preservedTime(file, minimum);
  let json;
  try {json = await readRegion(file, minimum);}
  catch {
    // Respect a saved split decision on later restarts.
    let split=false;
    try {await readFile(file+'.split');split=true;} catch {}
    if(!split) {
      const query = regionQuery(box);
      for(let attempt=0;attempt<3;attempt++) {
        await new Promise(r=>setTimeout(r,attempt ? 60000 : 15000));
        console.log('Fetching world region', box, 'attempt',attempt+1);
        try {
          const {response,text}=await fetchOverpass(query,130000,'full');
          // Only an executed-query limit, in a JSON remark or an HTTP 5xx
          // body, means the region is too large and splits it; a busy or
          // unreachable server (a network error, 429, 503, a gateway error)
          // says nothing about its size.
          if(!response.ok) {
            const detail=text.slice(0,65536);
            throw Object.assign(new Error(`HTTP ${response.status}`),{oversized:queryExceededLimits(response.status,detail)});
          }
          downloaded+=Buffer.byteLength(text);
          await writeFile(budgetFile,JSON.stringify({bytes:downloaded}));
          console.log('Downloaded bytes this run',downloaded);
          if(downloaded>500_000_000) throw new Error('One-off download budget exceeded');
          json=JSON.parse(text);
          if(json.remark || !Array.isArray(json.elements))
            throw Object.assign(new Error(json.remark || 'Incomplete response'),{oversized:typeof json.remark==='string'&&queryExceededLimits(200,json.remark)});
          // With its query, which the next change update compares with, and
          // when it was downloaded in full (first, so the refresh step reads
          // it without parsing the file; refresh-snapshot-cache.mjs).
          requireNotOlder(json,minimum);
          await writeFile(file,JSON.stringify({fetched:new Date().toISOString(),...json,query}));break;
        } catch(error) {
          console.warn(error.message);json=undefined;
          if(downloaded>500_000_000) throw error;
          // A query limit calls for a smaller area immediately. Anything else
          // keeps the region whole: it is asked again next run, and no split
          // is recorded, so an outage never leaves the world in more pieces.
          if(error.oversized) {split=true;break;}
          if(attempt===2) throw new Error(`Overpass stayed unavailable for region ${box}: ${error.message}`);
        }
      }
    }
    if(split) {
      if(depth>=5) throw new Error(`Could not complete region ${box}`);
      await writeFile(file+'.split','Oversized region; use complete child regions.');
      const leaves=[];
      for(const child of quarters(box)) leaves.push(...await collect(child,depth+1,minimum));
      await reconcile(box,leaves);
      return leaves;
    }
  }
  await reconcile(box,[{box,elements:json.elements,time:json.osm3s?.timestamp_osm_base}]);
  const data=toGeoJSON(json);
  for(const f of data.features) { features.set(f.id,f); base.set(f.id,json.osm3s?.timestamp_osm_base); }
  const part={bbox:box,timestamp:json.osm3s?.timestamp_osm_base,features:data.features.length};
  parts.push(part);console.log(JSON.stringify(part));
  // The parts this region's data came from, for a parent that split.
  return [{box,elements:json.elements,time:part.timestamp}];
}
// Split the already-observed eastern-US bottleneck before querying it again.
await writeFile('.snapshot-cache/0_-90_45_-45.json.split','Previous extraction timed out.');
await writeFile('.snapshot-cache/45_0_67.5_22.5.json.split','Dense European region; avoid repeating timed-out query.');
const region=process.env.SNAPSHOT_REGION;
// Each run brings every cached region up to date with only its changes
// since its own database time (an Overpass augmented diff of its query,
// and the difference when the query changed: updateElements). Unlike the
// earlier `changed` filter, this also removes ways deleted from OSM or no
// longer tagged as planned, construction or former, so no region needs to
// be downloaded again on a timer.
const pick=({type,id,tags,geometry})=>({type,id,tags,geometry});
// The changes of a dense region over weeks take longer than its full query.
const CHANGE_TIMEOUT='[timeout:300]';
async function updateRegion(box, minimum=-Infinity) {
  const file=regionFile(box);
  minimum=await preservedTime(file,minimum);
  let json;
  try {json=await readRegion(file,minimum);}
  catch {
    // Not cached: a split region is updated in its parts; otherwise the
    // region step downloads it in full.
    try {await readFile(file+'.split');} catch {return;}
    for(const child of quarters(box)) await updateRegion(child,minimum);
    return;
  }
  // Earlier data left by a full download stopped before it was logged.
  changeLog=await reconcile(box,[{box,elements:json.elements,time:json.osm3s?.timestamp_osm_base}],changeLog);
  const query=regionQuery(box);
  let failure;
  const update=await updateElements({elements:json.elements,since:json.osm3s?.timestamp_osm_base,
    // Responses cached before the query was recorded were all made by this
    // query: it has not changed since the cache began (2026-09-22).
    previousQuery:json.query||query,query,pick,warn:(...args)=>console.warn(String(box),...args),
    fetchText:async request=>{
      await new Promise(r=>setTimeout(r,5000));
      // A request that fails before its whole answer arrived (connection,
      // HTTP status, or the body cut off or timed out) says nothing about the
      // region: it keeps its data and is asked again next run.
      let response, text;
      try {
        ({response,text}=await fetchOverpass(request.replace('[timeout:90]',CHANGE_TIMEOUT),330000,'changes'));
      } catch(error) {throw Object.assign(new Error(`Network: ${error.message}`),{unanswered:true});}
      if(!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`),{unanswered:true});
      downloaded+=Buffer.byteLength(text);
      await writeFile(budgetFile,JSON.stringify({bytes:downloaded}));
      if(downloaded>500_000_000) throw Object.assign(new Error('Download budget exceeded'),{budget:true});
      return text;
    },failed:error=>{failure=error;}});
  if(failure?.budget) throw failure;
  if(update) {
    requireNotOlder({osm3s:{timestamp_osm_base:update.osmBase},elements:update.elements},Math.max(minimum,databaseTime(json)));
    // For ways this region shares with one whose update failed (see
    // snapshot-delta.mjs). Saved before the region advances, so a run stopped
    // in between never leaves a region past changes the log lacks.
    changeLog=recordChanges(changeLog,update.osmBase,json.elements,update.elements,box,
      update.deleted.filter(key=>key.startsWith('way/')).map(key=>key.slice(4)));
    await writeFile(DELTA_FILE,JSON.stringify(changeLog));
    await writeFile(file,JSON.stringify({...(json.fetched ? {fetched:json.fetched} : {}),osm3s:{timestamp_osm_base:update.osmBase},query,elements:update.elements}));
    updates.updated++; updates.changed+=update.upserts+update.deletes+update.added+update.dropped;
    return;
  }
  // A server that did not answer is asked again next run. Changes that
  // cannot be used (too large for the time limit, unreadable, removing over
  // 5% of the ways, or no database time) mean the region is downloaded in
  // full by the region step of this run; its data is kept to log the
  // differences (reconcile).
  if(failure?.unanswered) { updates.unanswered++; console.warn(String(box),'kept as cached; asked again next run'); return; }
  await rename(file,file+'.previous'); updates.redownload++;
}
const updates={updated:0,changed:0,unanswered:0,redownload:0};
let changeLog;
if(region==='delta') {
  try {changeLog=JSON.parse(await readFile(DELTA_FILE,'utf8'));} catch {}
  for(const box of boxes) await updateRegion(box);
  console.log('REGIONS UPDATED',JSON.stringify({...updates,downloaded}));
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
