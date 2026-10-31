// Maintenance extraction only. The browser reads the published files, and
// the workflow is manual / code-change triggered rather than scheduled.
//
// One download serves both signal supplements: signals without a direction
// (signal-data/, for the shared signal dots) and electrification signals
// (power-data/electricity-signals.*, for the Power view). Region responses
// cached before the two were combined are reused: such a region only asks for
// the electrification signals that do have a direction.
import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startRegions, quarters} from './crossing-data.mjs';
import {signalQuery, combinedSignalQuery, electricWithDirectionQuery, signalFeatures, buildSignalTiles, SIGNAL_ZOOM, SIGNAL_OVERVIEW_ZOOM} from './signals-data.mjs';
import {electricitySignalsGeoJSON} from './electricity-signal-data.mjs';
import {publishElectricitySignals} from './build-electricity-signals.mjs';

const AGE = 28 * 86400000;
const timeoutLike = message => !/^Overpass HTTP \d+:/.test(message) && /timed? ?out|timeout|memory|maxsize/i.test(message);

export async function buildSignals({
  api = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  output = new URL('../signal-data/', import.meta.url),
  powerOutput = process.env.POWER_OUTPUT || 'power-data',
  cacheRoot = new URL('../.snapshot-cache/', import.meta.url),
  fetcher = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, regions = startRegions().map(({box}) => box), log = console.log, warn = console.warn,
} = {}) {
  let requests = 0, downloaded = 0;
  await mkdir(cacheRoot, {recursive: true});
  const read = async name => { try { return JSON.parse(await readFile(new URL(name, cacheRoot), 'utf8')); } catch { return undefined; } };
  // Both projections must accept a response before it is saved or reused, so
  // a malformed response is never checkpointed and a bad cached one is
  // fetched again instead of blocking every later build.
  const valid = elements => { signalFeatures({elements}); electricitySignalsGeoJSON({elements}); return elements; };
  const usable = saved => { if (saved.split) return true; try { valid(saved.response?.elements); return true; } catch { return false; } };
  const fresh = (saved, query) => saved?.query === query && now() - Date.parse(saved.generated) < AGE && usable(saved);

  async function fetchJson(query) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (requests) await sleep(attempt ? 30000 : 10000);
      requests++;
      try {
        const response = await fetcher(api, {method: 'POST', body: new URLSearchParams({data: query}), signal: AbortSignal.timeout(200000),
          headers: {'User-Agent': 'RailwayAtlas-signals/1.0 (+https://github.com/c933103/openrailwaystyle)'}});
        const text = await response.text(); downloaded += Buffer.byteLength(text);
        if (!response.ok) throw new Error(`Overpass HTTP ${response.status}: ${text.replace(/<[^>]*>/g, ' ').slice(0, 200)}`);
        const data = JSON.parse(text);
        if (data.remark || !Array.isArray(data.elements)) throw new Error(data.remark || 'Incomplete signal response');
        return data;
      } catch (error) {
        // An execution timeout or memory limit splits the region instead.
        if (timeoutLike(error.message) || attempt === 2) throw error;
        warn('Signal request retry:', error.message);
      }
    }
  }

  // The electrification signals with a direction in a region whose other
  // signals are already cached. A timeout or memory limit splits this request
  // alone; the cached response is kept.
  async function remainder(box, depth = 0) {
    const file = `signals-electric-v1-${box.join('_')}.json`, query = electricWithDirectionQuery(box);
    const saved = await read(file);
    const split = async () => {
      const elements = [];
      for (const child of quarters(box)) elements.push(...await remainder(child, depth + 1));
      return elements;
    };
    if (fresh(saved, query)) return saved.split ? split() : saved.response.elements;
    try {
      const response = await fetchJson(query);
      valid(response.elements);
      await writeFile(new URL(file, cacheRoot), JSON.stringify({query, generated: new Date(now()).toISOString(), response}));
      return response.elements;
    } catch (error) {
      warn('Signal remainder', box.join(','), error.message);
      if (!timeoutLike(error.message) || depth >= 5) throw error;
      await writeFile(new URL(file, cacheRoot), JSON.stringify({query, generated: new Date(now()).toISOString(), split: true}));
      return split();
    }
  }

  // Leaves of the world partition, each with the combined element set.
  async function collect(box, depth = 0) {
    const key = box.join('_'), combinedFile = `signals-v2-${key}.json`, directionFile = `signals-v1-${key}.json`;
    const combinedQuery = combinedSignalQuery(box), directionQuery = signalQuery(box);
    const split = async () => {
      const results = [];
      for (const child of quarters(box)) results.push(...await collect(child, depth + 1));
      return results;
    };
    const combined = await read(combinedFile);
    if (fresh(combined, combinedQuery)) {
      if (combined.split) return split();
      return [{box, timestamp: combined.response.osm3s?.timestamp_osm_base || null, elements: combined.response.elements}];
    }
    // A region answered before the downloads were combined keeps its response
    // and fetches only the remainder.
    const direction = await read(directionFile);
    if (fresh(direction, directionQuery)) {
      if (direction.split) return split();
      const added = await remainder(box);
      log('Signal region', box.join(','), 'reused; added', added.length, 'electrification signals with a direction');
      return [{box, timestamp: direction.response.osm3s?.timestamp_osm_base || null, elements: [...direction.response.elements, ...added]}];
    }
    try {
      const response = await fetchJson(combinedQuery);
      valid(response.elements);
      // Retain each completed region immediately: a stopped run resumes
      // without querying it again or publishing a partial map.
      await writeFile(new URL(combinedFile, cacheRoot), JSON.stringify({query: combinedQuery, generated: new Date(now()).toISOString(), response}));
      log('Signal region', box.join(','), response.elements.length, 'nodes');
      return [{box, timestamp: response.osm3s?.timestamp_osm_base || null, elements: response.elements}];
    } catch (error) {
      warn('Signal region', box.join(','), error.message);
      if (!timeoutLike(error.message) || depth >= 5) throw error;
      await writeFile(new URL(combinedFile, cacheRoot), JSON.stringify({query: combinedQuery, generated: new Date(now()).toISOString(), split: true}));
      return split();
    }
  }

  const leaves = [];
  for (const box of regions) leaves.push(...await collect(box));

  // Signals without a direction: deduplicated by OSM identity (adjacent
  // bounding boxes overlap on their edges).
  const byId = new Map();
  for (const leaf of leaves) for (const feature of signalFeatures({elements: leaf.elements})) byId.set(feature.id, feature);
  const features = [...byId.values()].sort((a, b) => a.id - b.id);
  // Completing every world partition is the publication condition.
  if (!features.length) throw new Error('Empty worldwide railway signal supplement');

  // Electrification signals, per leaf for the coverage record.
  const coverage = leaves.map(leaf => ({bbox: leaf.box, timestamp: leaf.timestamp, features: electricitySignalsGeoJSON({elements: leaf.elements}).features.length}));
  const electric = electricitySignalsGeoJSON({elements: leaves.flatMap(leaf => leaf.elements)});

  await rm(output, {recursive: true, force: true});
  await mkdir(output, {recursive: true});
  await writeFile(new URL('railway-signals.geojson.gz', output), gzipSync(JSON.stringify({type: 'FeatureCollection', features}), {level: 9}));
  const tiles = new Map([SIGNAL_OVERVIEW_ZOOM, SIGNAL_ZOOM].flatMap(z => [...buildSignalTiles(features, z)])), index = [];
  for (const [key, data] of tiles) {
    const [z, x] = key.split('/');
    await mkdir(new URL(`${z}/${x}/`, output), {recursive: true});
    await writeFile(new URL(`${key}.pbf.gz`, output), gzipSync(data, {level: 9}));
    index.push(key);
  }
  await writeFile(new URL('index.json', output), JSON.stringify({tiles: index.sort()}));
  const manifest = {complete: true, generated: new Date(now()).toISOString(), signals: features.length, tiles: tiles.size, requests, downloadedBytes: downloaded,
    regions: leaves.map(({box}) => ({box})), source: api, license: 'ODbL-1.0',
    description: 'Worldwide OSM railway=signal nodes without railway:signal:direction, supplementing the direction-dependent OpenRailwayMap signal source.'};
  await writeFile(new URL('manifest.json', output), JSON.stringify(manifest, null, 2));
  log(JSON.stringify(manifest));
  const power = await publishElectricitySignals(electric, coverage, {output: powerOutput, requests, downloadedBytes: downloaded, now});
  return {signals: manifest, electricity: power.manifest};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildSignals();
