// Maintenance extraction only. The browser reads the published tiles, and
// the workflow is manual / code-change triggered rather than scheduled.
import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {startRegions, quarters} from './crossing-data.mjs';
import {signalQuery, signalFeatures, buildSignalTiles, SIGNAL_ZOOM, SIGNAL_OVERVIEW_ZOOM} from './signals-data.mjs';

const api = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const output = new URL('../signal-data/', import.meta.url);
const cacheRoot = new URL('../.snapshot-cache/', import.meta.url);
const age = 28 * 86400000;
let requests = 0, downloaded = 0;
await mkdir(cacheRoot, {recursive:true});

async function collect(box, depth = 0) {
  const key = box.join('_'), path = new URL(`signals-v1-${key}.json`, cacheRoot), query = signalQuery(box);
  let cached, cachedFeatures;
  try {
    cached = JSON.parse(await readFile(path, 'utf8'));
    if (cached?.query === query && !cached.split) cachedFeatures = signalFeatures(cached.response);
  } catch { cached = undefined; }
  if (cached?.query === query && Date.now() - Date.parse(cached.generated) < age) {
    if (cached.split) {
      const results = [];
      for (const child of quarters(box)) results.push(...await collect(child, depth + 1));
      return results;
    }
    return [{box, generated:cached.generated, features:cachedFeatures}];
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (requests) await new Promise(resolve => setTimeout(resolve, attempt ? 30000 : 10000));
    requests++;
    try {
      const response = await fetch(api, {method:'POST', body:new URLSearchParams({data:query}), signal:AbortSignal.timeout(200000),
        headers:{'User-Agent':'RailwayAtlas-signals/1.0 (+https://github.com/c933103/openrailwaystyle)'}});
      const text = await response.text(); downloaded += Buffer.byteLength(text);
      if (!response.ok) throw new Error(`Overpass HTTP ${response.status}: ${text.replace(/<[^>]*>/g, ' ').slice(0, 200)}`);
      const data = JSON.parse(text), features = signalFeatures(data), generated = new Date().toISOString();
      // Retain each completed region immediately: a stopped first run can
      // resume without querying those regions again or publishing a partial map.
      await writeFile(path, JSON.stringify({query, generated, response:data}));
      console.log('Signal region', box.join(','), features.length, 'nodes');
      return [{box, generated, features}];
    } catch (error) {
      console.warn('Signal region', box.join(','), error.message);
      // Admission HTTP errors can say "timeout" without executing the query.
      if (!/^Overpass HTTP \d+:/.test(error.message) && /timed? ?out|timeout|memory|maxsize/i.test(error.message) && depth < 5) {
        await writeFile(path, JSON.stringify({query, generated:new Date().toISOString(), split:true}));
        const results = [];
        for (const child of quarters(box)) results.push(...await collect(child, depth + 1));
        return results;
      }
      if (attempt === 2) throw error;
    }
  }
}

const regions = [];
for (const {box} of startRegions()) regions.push(...await collect(box));
const byId = new Map();
for (const region of regions) for (const feature of region.features) {
  // Adjacent bbox queries overlap on their boundaries. Deduplicate by OSM
  // identity rather than discarding the world's +180° or +90° outer edge.
  byId.set(feature.id, feature);
}
const features = [...byId.values()].sort((a,b) => a.id - b.id);
// Completing every world partition is the publication condition. Do not
// substitute a geographically selected sample if any partition failed.
if (!features.length) throw new Error('Empty worldwide railway signal supplement');
await rm(output, {recursive:true, force:true});
await mkdir(output, {recursive:true});
await writeFile(new URL('railway-signals.geojson.gz', output), gzipSync(JSON.stringify({type:'FeatureCollection', features}), {level:9}));
const tiles = new Map([SIGNAL_OVERVIEW_ZOOM, SIGNAL_ZOOM].flatMap(z => [...buildSignalTiles(features, z)])), index = [];
for (const [key, data] of tiles) {
  const [z,x] = key.split('/');
  await mkdir(new URL(`${z}/${x}/`, output), {recursive:true});
  await writeFile(new URL(`${key}.pbf.gz`, output), gzipSync(data, {level:9}));
  index.push(key);
}
await writeFile(new URL('index.json', output), JSON.stringify({tiles:index.sort()}));
const manifest = {complete:true, generated:new Date().toISOString(), signals:features.length, tiles:tiles.size, requests, downloadedBytes:downloaded,
  regions:regions.map(({box,generated}) => ({box,generated})), source:api, license:'ODbL-1.0',
  description:'Worldwide OSM railway=signal nodes without railway:signal:direction, supplementing the direction-dependent OpenRailwayMap signal source.'};
await writeFile(new URL('manifest.json', output), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
