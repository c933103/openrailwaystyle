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
import {signalQuery, combinedSignalQuery, electricWithDirectionQuery, signalChangesQuery, parseSignalChanges, applySignalChanges, signalFeatures, buildSignalTiles, SIGNAL_ZOOM, SIGNAL_OVERVIEW_ZOOM} from './signals-data.mjs';
import {electricitySignalsGeoJSON} from './electricity-signal-data.mjs';
import {publishElectricitySignals} from './build-electricity-signals.mjs';

// A stored region is brought up to date with the changes since its database
// timestamp (an Overpass augmented diff), never downloaded again. Signals
// change slowly, so a region is updated at most once a week.
const UPDATE_EVERY = Number(process.env.SIGNAL_UPDATE_DAYS || 7) * 86400000;
// Legacy direction-only responses and remainders count as current for 28
// days; they are folded into one stored region on first use.
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
    const data = JSON.parse(await fetchText(query));
    if (data.remark || !Array.isArray(data.elements)) throw new Error(data.remark || 'Incomplete signal response');
    return data;
  }
  async function fetchText(query) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (requests) await sleep(attempt ? 30000 : 10000);
      requests++;
      try {
        const response = await fetcher(api, {method: 'POST', body: new URLSearchParams({data: query}), signal: AbortSignal.timeout(200000),
          headers: {'User-Agent': 'RailwayAtlas-signals/1.0 (+https://github.com/c933103/openrailwaystyle)'}});
        const text = await response.text(); downloaded += Buffer.byteLength(text);
        if (!response.ok) throw new Error(`Overpass HTTP ${response.status}: ${text.replace(/<[^>]*>/g, ' ').slice(0, 200)}`);
        // A result cut short by a timeout or memory limit says so in a remark
        // (JSON) or <remark> (XML); report it as such, so the region splits.
        const remark = /"remark"\s*:\s*"([^"]*)"|<remark>([\s\S]*?)<\/remark>/.exec(text);
        if (remark && /timed? ?out|timeout|memory|maxsize/i.test(remark[1] || remark[2])) throw new Error((remark[1] || remark[2]).trim());
        return text;
      } catch (error) {
        // An execution timeout or memory limit splits the region instead.
        if (timeoutLike(error.message) || attempt === 2) throw error;
        warn('Signal request retry:', error.message);
      }
    }
  }

  // The electrification signals with a direction in a region whose other
  // signals are already cached, as they were at that response's database
  // time: the two are stored as one region with that time, where its next
  // change request starts, so a signal added and removed since then is never
  // left behind. A timeout or memory limit splits this request alone; the
  // cached response is kept.
  async function remainder(box, date, depth = 0) {
    const file = `signals-electric-v1-${box.join('_')}.json`, query = electricWithDirectionQuery(box, date);
    const saved = await read(file);
    const split = async () => {
      const elements = [];
      for (const child of quarters(box)) elements.push(...await remainder(child, date, depth + 1));
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

  // The changes in a region since `since`. A timeout or memory limit splits
  // this request into quarters. The first quarter to answer fixes the end
  // time and the others ask up to that same time, so the region's stored
  // elements are exactly its state then: a diff compares two moments only,
  // so a signal that appeared and went again between different quarter end
  // times would otherwise never be removed.
  async function changesSince(box, since, until, depth = 0) {
    try {
      const changes = parseSignalChanges(await fetchText(signalChangesQuery(box, since, until)));
      // With an end time the response still carries the current database time.
      return until ? {...changes, timestamp: until} : changes;
    } catch (error) {
      warn('Signal changes', box.join(','), error.message);
      if (!timeoutLike(error.message) || depth >= 5) throw error;
      const parts = [];
      for (const child of quarters(box)) {
        const part = await changesSince(child, since, until, depth + 1);
        until ||= part.timestamp;
        parts.push(part);
      }
      return {timestamp: until, upserts: parts.flatMap(part => part.upserts), deletes: parts.flatMap(part => part.deletes)};
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
    const save = record => writeFile(new URL(combinedFile, cacheRoot), JSON.stringify(record));
    let stored = await read(combinedFile);
    if (!(stored?.query === combinedQuery && usable(stored))) {
      stored = undefined;
      // A region answered before the downloads were combined keeps its
      // response: the remainder is added and the two are stored as one.
      const direction = await read(directionFile), base = direction?.response?.osm3s?.timestamp_osm_base;
      if (direction?.query === directionQuery && now() - Date.parse(direction.generated) < AGE && usable(direction)
        && (direction.split || /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(base || ''))) {
        if (direction.split) return split();
        const added = await remainder(box, base);
        log('Signal region', box.join(','), 'reused; added', added.length, 'electrification signals with a direction');
        stored = {query: combinedQuery, generated: direction.generated,
          response: {osm3s: {timestamp_osm_base: base}, elements: applySignalChanges(direction.response.elements, {upserts: added, deletes: []})}};
        await save(stored);
      }
    }
    if (stored?.split) return split();
    const since = stored?.response?.osm3s?.timestamp_osm_base;
    if (stored && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(since || '')) {
      if (now() - Date.parse(stored.generated) >= UPDATE_EVERY) {
        const changes = await changesSince(box, since);
        const elements = valid(applySignalChanges(stored.response.elements, changes));
        stored = {query: combinedQuery, generated: new Date(now()).toISOString(), response: {osm3s: {timestamp_osm_base: changes.timestamp}, elements}};
        await save(stored);
        log('Signal region', box.join(','), 'updated:', changes.upserts.length, 'added or changed,', changes.deletes.length, 'removed since', since);
      }
      return [{box, timestamp: stored.response.osm3s.timestamp_osm_base, elements: stored.response.elements}];
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
