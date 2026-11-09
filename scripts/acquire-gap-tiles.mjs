import {retryAfterMs} from './retry-after.mjs';
// The gap tiles (scripts/gap-tiles.mjs) from Overpass, one request each,
// with the extract filter's selection in Overpass QL (#330, B0b). Run by
// `.github/workflows/osm-extract.yml`:
//   node --import ./scripts/overpass-meter.mjs scripts/acquire-gap-tiles.mjs <gaps.json> <output directory> [index.json]
// For each tile it writes <output>/gap-<key>/ with extract.json and
// filtered.osm.pbf, the same hand-over as a Geofabrik region, or failed.json
// with the reason; a tile that fails keeps its working copy.
//
// Requests: one per tile to overpass-api.de, 10 s apart, never in parallel.
// A tile is split into its quarters only when Overpass says the query itself
// ran out of time or memory (stationQueryExceededLimits); a busy or
// unreachable server is asked again after 2, 5 and 10 minutes, then the run
// moves on and that tile keeps its copy. The run stops asking past its
// request or byte budget; the tiles not reached keep their copies.
// Retry-After remains binding across retries, failed tiles and subdivisions.
// A pause over 15 minutes stops further requests in this run instead of
// shortening the provider's minimum; all unreached tiles keep their copies.
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {GAP_FILTER_HASH, overpassFilters} from './extract-filter.mjs';
export {GAP_FILTER_HASH} from './extract-filter.mjs';
import {polyFilter} from './gap-tiles.mjs';
import {quarters} from './world-regions.mjs';
import {stationQueryExceededLimits} from './station-acquisition.mjs';
import {overpassBusy, overpassRetryDelayMs} from './overpass-errors.mjs';
import polygonClipping from 'polygon-clipping';

export const API = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
export const USER_AGENT = 'RailwayAtlas-extract-gaps/1 (+https://github.com/c933103/openrailwaystyle/issues/330)';
export const MAX_REQUESTS = 400;
export const MAX_BYTES = 1024 ** 3;
export const PAUSE_MS = 10_000;
export const MAX_SPLIT_DEPTH = 6;
const MAX_PROVIDER_WAIT_MS = 15 * 60_000;

// Per part of the tile: the selection inside its outer ring, less what lies
// in its holes (islands a planned region covers), so their data is not sent
// again. Each part has its own sets, so a hole of one part never removes
// another part lying inside it. Then complete downward recursion (>>).
export function gapQuery(polygon) {
  const parts = polygon.map(([outer, ...holes], i) => {
    const select = `(${overpassFilters().map(({type, tag}) => `${type}${tag}(${polyFilter(outer)});`).join('')})->.p${i};`;
    const cut = holes.map((hole, j) => `nwr.p${i}(${polyFilter(hole)})->.h${i}_${j};(.p${i}; - .h${i}_${j};)->.p${i};`).join('');
    return select + cut;
  });
  return `[out:xml][timeout:180][maxsize:536870912];${parts.join('')}(${polygon.map((_, i) => `.p${i};`).join('')})->.g;(.g;.g >>;);out meta;`;
}

const boxPolygon = ([s, w, n, e]) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(deadline, wait, clock) {
  do { await wait(Math.max(0, deadline - clock())); } while (clock() < deadline);
}

const providerPauseError = () => new Error('Overpass Retry-After exceeds this run’s wait limit; working copies retained');

// Shared by every tile and subdivision in this run. Capture at headers so
// an interrupted body or a final failed attempt cannot discard the pause.
function rememberProviderPause(response, budget, now, clock) {
  const receivedAt = clock();
  const delay = retryAfterMs(response.headers.get('retry-after'), now());
  if (delay > MAX_PROVIDER_WAIT_MS) budget.providerWaitExceeded = true;
  if (delay > 0) budget.retryNotBefore = Math.max(budget.retryNotBefore || 0, receivedAt + delay);
}

// Keep bytes already consumed even if reading fails. Stop the current body
// at the cap rather than buffering an unbounded final response. A transport
// chunk can cross the boundary; count all of it and cancel immediately.
async function readBudgetedBody(response, budget) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) return Buffer.concat(chunks).toString('utf8');
      budget.bytes += value.byteLength;
      if (budget.bytes >= budget.maxBytes) {
        throw Object.assign(new Error('byte budget reached while reading response'), {budget: true});
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    // Cleanup cannot hold the budget/transport error or reader lock open.
    try { reader.cancel(error).catch(() => {}); } catch {}
    throw error;
  } finally {
    reader.releaseLock();
  }
}

// One tile, split on an executed-query limit. Returns the OSM XML parts
// with their database times, or throws (the tile keeps its copy).
export async function fetchTile(tile, {fetcher = fetch, wait = sleep, now = Date.now, clock = () => performance.now(), budget, depth = 0} = {}) {
  const query = gapQuery(tile.polygon);
  for (let retry = 0; ; retry++) {
    if (budget.requests >= budget.maxRequests || budget.bytes >= budget.maxBytes) throw Object.assign(new Error('request or byte budget reached'), {budget: true});
    if (budget.providerWaitExceeded) throw providerPauseError();
    if (budget.requests) await waitUntil(clock() + PAUSE_MS, wait, clock);
    if ((budget.retryNotBefore || 0) > clock()) await waitUntil(budget.retryNotBefore, wait, clock);
    budget.requests++;
    let response, text;
    try {
      response = await fetcher(API, {method: 'POST', body: new URLSearchParams({data: query}), headers: {'User-Agent': USER_AGENT}, signal: AbortSignal.timeout(360_000)});
      rememberProviderPause(response, budget, now, clock);
      text = await readBudgetedBody(response, budget);
    } catch (error) {
      if (error.budget) throw error;
      if (budget.providerWaitExceeded) throw providerPauseError();
      const failure = new Error(`fetch failed: ${error.message}`);
      if (retry < 3) { await waitUntil(clock() + overpassRetryDelayMs(retry), wait, clock); continue; }
      throw failure;
    }
    const remark = /<remark>([\s\S]*?)<\/remark>/.exec(text)?.[1] ?? '';
    if (stationQueryExceededLimits(response.status, response.ok ? remark : text)) {
      if (depth >= MAX_SPLIT_DEPTH) throw new Error(`${tile.key}: too large for one query at depth ${depth}`);
      const parts = [];
      for (const box of quarters(tile.box)) {
        const inside = polygonClipping.intersection(tile.polygon, boxPolygon(box));
        if (inside.length) parts.push(...await fetchTile({key: box.join('_'), box, polygon: inside}, {fetcher, wait, now, clock, budget, depth: depth + 1}));
      }
      return parts;
    }
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      if (overpassBusy(error) && budget.providerWaitExceeded) throw providerPauseError();
      if (overpassBusy(error) && retry < 3) { await waitUntil(Math.max(clock() + overpassRetryDelayMs(retry), budget.retryNotBefore || 0), wait, clock); continue; }
      throw error;
    }
    if (remark) throw new Error(`${tile.key}: Overpass remark: ${remark.trim().slice(0, 200)}`);
    const osmBase = /<meta osm_base="([^"]+)"/.exec(text)?.[1];
    if (!osmBase || !/<\/osm>\s*$/.test(text)) throw new Error(`${tile.key}: incomplete answer`);
    return [{text, osmBase}];
  }
}

const fileSha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');

// A tile's answer as a sorted PBF and its record, in the shape publish takes.
export async function writeTile(tile, parts, out, {run = promisify(execFile), previous = null} = {}) {
  await mkdir(out, {recursive: true});
  const inputs = [];
  for (const [i, part] of parts.entries()) { const file = join(out, `part-${i}.osm`); await writeFile(file, part.text); inputs.push(file); }
  const filtered = join(out, 'filtered.osm.pbf');
  try {
    // Parts of a split tile can share objects at their edges: sort, then
    // merge keeps one copy of each.
    await run('osmium', ['merge', ...await Promise.all(inputs.map(async (file, i) => {
      const sorted = join(out, `part-${i}.osm.pbf`);
      await run('osmium', ['sort', file, '-o', sorted, '--overwrite']);
      return sorted;
    })), '-o', filtered, '--overwrite']);
  } finally {
    for (const [i, file] of inputs.entries()) { await rm(file, {force: true}); await rm(join(out, `part-${i}.osm.pbf`), {force: true}); }
  }
  // The oldest database time of the parts: the tile is current to it.
  const sourceTimestamp = parts.map(part => part.osmBase).sort()[0];
  if (previous?.sourceTimestamp && Date.parse(sourceTimestamp) < Date.parse(previous.sourceTimestamp)) {
    await rm(filtered, {force: true});
    throw new Error(`${tile.key}: data from ${sourceTimestamp} is older than the working copy's ${previous.sourceTimestamp}`);
  }
  // Counted from the objects themselves: `osmium fileinfo -e` fails on a
  // file without any (an empty answer, the usual case at sea).
  const {stdout} = await run('osmium', ['cat', filtered, '-f', 'opl', '-o', '-'], {maxBuffer: 1024 ** 3});
  const count = prefix => stdout.split('\n').filter(line => line.startsWith(prefix)).length;
  const nodes = count('n'), ways = count('w'), relations = count('r');
  const manifest = {schema: 1, region: `gap/${tile.key}`, kind: 'gap', sourceDate: sourceTimestamp.slice(0, 10), url: API, sourceTimestamp,
    pbfBytes: 0, sourceMd5: null, filteredBytes: (await stat(filtered)).size, filteredSha256: await fileSha256(filtered),
    counts: {nodes, ways, relations}, filter: GAP_FILTER_HASH, parts: parts.length, source: 'OpenStreetMap via Overpass API', license: 'ODbL-1.0'};
  await writeFile(join(out, 'extract.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function acquireGapTiles(tiles, out, {index = null, fetcher = fetch, wait = sleep, now = Date.now, clock = () => performance.now(), run, maxRequests = MAX_REQUESTS, maxBytes = MAX_BYTES} = {}) {
  const budget = {requests: 0, bytes: 0, maxRequests, maxBytes};
  const results = [];
  for (const tile of tiles) {
    const dir = join(out, `gap-${tile.key}`);
    try {
      const parts = await fetchTile(tile, {fetcher, wait, now, clock, budget});
      results.push(await writeTile(tile, parts, dir, {run, previous: index?.regions?.[`gap/${tile.key}`]}));
    } catch (error) {
      await mkdir(dir, {recursive: true});
      await writeFile(join(dir, 'failed.json'), `${JSON.stringify({region: `gap/${tile.key}`, error: String(error.message || error)})}\n`);
      results.push({region: `gap/${tile.key}`, failed: String(error.message || error)});
    }
  }
  return {results, requests: budget.requests, bytes: budget.bytes};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [gapsFile, out, indexFile] = process.argv.slice(2);
  if (!gapsFile || !out) throw new Error('Usage: acquire-gap-tiles.mjs <gaps.json> <output directory> [index.json]');
  const {tiles} = JSON.parse(await readFile(gapsFile, 'utf8'));
  let index = null;
  try { if (indexFile) index = JSON.parse(await readFile(indexFile, 'utf8')); } catch {}
  const {results, requests, bytes} = await acquireGapTiles(tiles, out, {index});
  const failed = results.filter(r => r.failed);
  console.log(`${tiles.length} gap tiles: ${results.length - failed.length} fetched, ${failed.length} kept their copy; ${requests} requests, ${bytes} bytes`);
  for (const f of failed) console.log(`::warning::${f.region}: ${f.failed}`.replace(/[\r\n]/g, ' '));
}
