// Maintenance extraction only. The browser reads the published files; the
// traction workflow runs it, started by osm-updates.yml.
//
// One download serves both signal supplements: signals without a direction
// (signal-data/, for the shared signal dots) and electrification signals
// (power-data/electricity-signals.*, for the Power view). Region responses
// cached before the two were combined are reused: such a region only asks for
// the electrification signals that do have a direction.
import {retryAfterMs} from './retry-after.mjs';
import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startRegions, quarters} from './crossing-data.mjs';
import {signalQuery, combinedSignalQuery, electricWithDirectionQuery, signalChangesQuery, parseSignalChanges, applySignalChanges, signalFeatures, signalFiles} from './signals-data.mjs';
import {electricitySignalsGeoJSON} from './electricity-signal-data.mjs';
import {publishElectricitySignals} from './build-electricity-signals.mjs';

// A stored region is brought up to date with the changes since its database
// timestamp (an Overpass augmented diff), never downloaded again. Signals
// change slowly, so a region is updated at most once a week.
const UPDATE_EVERY = Number(process.env.SIGNAL_UPDATE_DAYS || 7) * 86400000;
// Legacy direction-only responses and remainders count as current for 28
// days; they are folded into one stored region on first use.
const AGE = 28 * 86400000;
const MAX_RETRY_AFTER_MS = 300000;

class SignalTransportError extends Error {
  constructor(cause) { super(cause?.message || String(cause), {cause}); this.name = 'SignalTransportError'; }
}
// A transport deadline or malformed JSON says nothing about the spatial query's size.
// JSON.parse can quote words such as timeout from an invalid response in its error.
const timeoutLike = error => !(error instanceof SignalTransportError) && !(error instanceof SyntaxError)
  && !/^Overpass HTTP \d+:/.test(error.message) && /timed? ?out|timeout|memory|maxsize/i.test(error.message);

export async function buildSignals({
  api = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  output = new URL('../signal-data/', import.meta.url),
  powerOutput = process.env.POWER_OUTPUT || 'power-data',
  cacheRoot = new URL('../.snapshot-cache/', import.meta.url),
  fetcher = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, clock = () => performance.now(), regions = startRegions().map(({box}) => box), log = console.log, warn = console.warn,
} = {}) {
  let requests = 0, downloaded = 0, providerNotBefore = 0, providerStopped = false;
  async function pause(backoff) {
    if (providerStopped) throw new Error('Signal Retry-After exceeds the five-minute wait budget');
    const deadline = Math.max(clock() + backoff, providerNotBefore);
    do {
      const wait = Math.max(0, deadline - clock());
      if (wait > 0) await sleep(wait);
    } while (deadline > clock());
  }
  await mkdir(cacheRoot, {recursive: true});
  const read = async name => { try { return JSON.parse(await readFile(new URL(name, cacheRoot), 'utf8')); } catch { return undefined; } };
  // Both projections must accept a response before it is saved or reused, so
  // a malformed response is never checkpointed and a bad cached one is
  // fetched again instead of blocking every later build.
  const valid = elements => { signalFeatures({elements}); electricitySignalsGeoJSON({elements}); return elements; };
  const usable = saved => {
    if (saved.split) return true;
    // Cached responses must meet the same completion condition as fresh ones.
    // Valid elements alone do not certify a result cut short by an Overpass remark.
    if (saved.response?.remark) return false;
    try { valid(saved.response?.elements); return true; } catch { return false; }
  };
  const fresh = (saved, query) => saved?.query === query && now() - Date.parse(saved.generated) < AGE && usable(saved);

  async function fetchJson(query) {
    const data = JSON.parse(await fetchText(query));
    if (data.remark || !Array.isArray(data.elements)) throw new Error(data.remark || 'Incomplete signal response');
    return data;
  }
  async function fetchText(query) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (requests) await pause(attempt ? 30000 : 10000);
      requests++;
      try {
        let response, text;
        try {
          response = await fetcher(api, {method: 'POST', body: new URLSearchParams({data: query}), signal: AbortSignal.timeout(200000),
            headers: {'User-Agent': 'RailwayAtlas-signals/1.0 (+https://github.com/c933103/openrailwaystyle)'}});
        } catch (error) { throw new SignalTransportError(error); }
        // Retain every response's header-time pause, even if a successful
        // response body later fails. Subsequent wall-clock changes cannot shorten it.
        const received = clock(), wait = retryAfterMs(response.headers?.get?.('retry-after'), now());
        if (wait > MAX_RETRY_AFTER_MS) providerStopped = true;
        if (wait > 0) providerNotBefore = Math.max(providerNotBefore, received + wait);
        if (!response.ok) {
          // The status is authoritative. Reading or awaiting disposal of an
          // unused error body must not replace it or stall its retry/failure path.
          try { response.body?.cancel?.()?.catch(() => {}); } catch {}
          throw new Error(`Overpass HTTP ${response.status}: response body discarded`);
        }
        try { text = await response.text(); }
        catch (error) { throw new SignalTransportError(error); }
        downloaded += Buffer.byteLength(text);
        // A result cut short by a timeout or memory limit says so in a remark
        // (JSON) or <remark> (XML); report it as such, so the region splits.
        const remark = /"remark"\s*:\s*"([^"]*)"|<remark>([\s\S]*?)<\/remark>/.exec(text);
        if (remark && /timed? ?out|timeout|memory|maxsize/i.test(remark[1] || remark[2])) throw new Error((remark[1] || remark[2]).trim());
        return text;
      } catch (error) {
        // An execution timeout or memory limit splits the region instead.
        if (timeoutLike(error) || attempt === 2) throw error;
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
      if (!timeoutLike(error) || depth >= 5) throw error;
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
  // `parts` are the boxes that answered, recorded with the region so its next
  // update asks them directly instead of timing out on the whole region again.
  async function changesSince(box, since, until, depth = 0) {
    try {
      const changes = parseSignalChanges(await fetchText(signalChangesQuery(box, since, until)));
      // With an end time the response still carries the current database time.
      return {...changes, ...(until ? {timestamp: until} : {}), parts: [box]};
    } catch (error) {
      warn('Signal changes', box.join(','), error.message);
      if (!timeoutLike(error) || depth >= 5) throw error;
      return changesOver(quarters(box), since, until, () => depth + 1);
    }
  }
  // The changes over several boxes, all ending at the time the first gives;
  // depthOf gives each box's split depth.
  async function changesOver(boxes, since, until, depthOf) {
    const parts = [];
    for (const child of boxes) {
      const part = await changesSince(child, since, until, depthOf(child));
      until ||= part.timestamp;
      parts.push(part);
    }
    return {timestamp: until, upserts: parts.flatMap(part => part.upserts), deletes: parts.flatMap(part => part.deletes), parts: parts.flatMap(part => part.parts)};
  }
  // Reuse only leaves of the same bounded quarter tree that changesSince
  // creates. Equal total area alone can hide overlapping and missing boxes.
  // Each accepted box then retains its actual depth and remaining split allowance.
  const recordedParts = (box, parts) => {
    if (!Array.isArray(parts) || parts.length < 2 || parts.length > 4 ** 5
      || parts.some(p => !Array.isArray(p) || p.length !== 4 || !p.every(Number.isFinite))) return null;
    const leaves = new Set(parts.map(p => p.join(',')));
    if (leaves.size !== parts.length) return null;
    let visited = 0;
    const visit = (part, depth = 0) => {
      if (leaves.has(part.join(','))) { visited++; return true; }
      return depth < 5 && quarters(part).every(child => visit(child, depth + 1));
    };
    return visit(box) && visited === leaves.size ? parts : null;
  };

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
        const known = recordedParts(box, stored.changeParts);
        const changes = known
          ? await changesOver(known, since, undefined, part => Math.round(Math.log2((box[3] - box[1]) / (part[3] - part[1]))))
          : await changesSince(box, since);
        const elements = valid(applySignalChanges(stored.response.elements, changes));
        stored = {query: combinedQuery, generated: new Date(now()).toISOString(), response: {osm3s: {timestamp_osm_base: changes.timestamp}, elements},
          ...(changes.parts.length > 1 ? {changeParts: changes.parts} : {})};
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
      if (!timeoutLike(error) || depth >= 5) throw error;
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
  const {files, tiles} = signalFiles(features);
  for (const [path, data] of files) {
    await mkdir(new URL('./', new URL(path, output)), {recursive: true});
    await writeFile(new URL(path, output), data);
  }
  const manifest = {complete: true, generated: new Date(now()).toISOString(), signals: features.length, tiles, requests, downloadedBytes: downloaded,
    regions: leaves.map(({box}) => ({box})), source: api, license: 'ODbL-1.0',
    description: 'Worldwide OSM railway=signal nodes without railway:signal:direction, supplementing the direction-dependent OpenRailwayMap signal source.'};
  await writeFile(new URL('manifest.json', output), JSON.stringify(manifest, null, 2));
  log(JSON.stringify(manifest));
  const power = await publishElectricitySignals(electric, coverage, {output: powerOutput, requests, downloadedBytes: downloaded, now});
  return {signals: manifest, electricity: power.manifest};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildSignals();
