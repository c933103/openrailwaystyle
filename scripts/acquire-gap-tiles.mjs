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
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {overpassFilters} from './extract-filter.mjs';
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
// The filter a gap tile's file was made with: the Overpass form of the
// extract filter. It differs from a Geofabrik region's, so the assembly
// never compares a gap tile with a region.
export const GAP_FILTER_HASH = `overpass:${createHash('sha256').update(JSON.stringify(overpassFilters())).digest('hex')}`;

export function gapQuery(polygon) {
  const statements = [];
  for (const [ring] of polygon) for (const {type, tag} of overpassFilters()) statements.push(`${type}${tag}(${polyFilter(ring)});`);
  return `[out:xml][timeout:180][maxsize:536870912];(${statements.join('')});(._;>;);out meta;`;
}

const boxPolygon = ([s, w, n, e]) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// One tile, split on an executed-query limit. Returns the OSM XML parts
// with their database times, or throws (the tile keeps its copy).
export async function fetchTile(tile, {fetcher = fetch, wait = sleep, budget, depth = 0} = {}) {
  const query = gapQuery(tile.polygon);
  for (let retry = 0; ; retry++) {
    if (budget.requests >= budget.maxRequests || budget.bytes >= budget.maxBytes) throw Object.assign(new Error('request or byte budget reached'), {budget: true});
    if (budget.requests) await wait(PAUSE_MS);
    budget.requests++;
    let response, text;
    try {
      response = await fetcher(API, {method: 'POST', body: new URLSearchParams({data: query}), headers: {'User-Agent': USER_AGENT}, signal: AbortSignal.timeout(360_000)});
      text = await response.text();
    } catch (error) {
      const failure = new Error(`fetch failed: ${error.message}`);
      if (retry < 3) { await wait(overpassRetryDelayMs(retry)); continue; }
      throw failure;
    }
    budget.bytes += Buffer.byteLength(text);
    const remark = /<remark>([\s\S]*?)<\/remark>/.exec(text)?.[1] ?? '';
    if (stationQueryExceededLimits(response.status, response.ok ? remark : text)) {
      if (depth >= MAX_SPLIT_DEPTH) throw new Error(`${tile.key}: too large for one query at depth ${depth}`);
      const parts = [];
      for (const box of quarters(tile.box)) {
        const inside = polygonClipping.intersection(tile.polygon, boxPolygon(box)).map(([outer]) => [outer]);
        if (inside.length) parts.push(...await fetchTile({key: box.join('_'), box, polygon: inside}, {fetcher, wait, budget, depth: depth + 1}));
      }
      return parts;
    }
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      if (overpassBusy(error) && retry < 3) { await wait(overpassRetryDelayMs(retry, response.headers.get('retry-after'))); continue; }
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

export async function acquireGapTiles(tiles, out, {index = null, fetcher = fetch, wait = sleep, run, maxRequests = MAX_REQUESTS, maxBytes = MAX_BYTES} = {}) {
  const budget = {requests: 0, bytes: 0, maxRequests, maxBytes};
  const results = [];
  for (const tile of tiles) {
    const dir = join(out, `gap-${tile.key}`);
    try {
      const parts = await fetchTile(tile, {fetcher, wait, budget});
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
