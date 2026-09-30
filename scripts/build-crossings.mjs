// Maintenance build only: visitors never query Overpass. Keeps the worldwide
// level-crossing table (crossing-data branch) current and writes its tiles.
//
// First run: every region in full (about 1.2 million crossings, some 45 MB
// of CSV), one request at a time. Later runs: the crossings changed since the
// previous run, region by region, plus a full refresh of the longest-unchecked
// regions up to REFRESH_BYTES, which removes deleted and retagged crossings.
import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {gzipSync, gunzipSync} from 'node:zlib';
import {DETAIL_ZOOM, OVERVIEW_ZOOM, applyChanges, buildTiles, parseCsv, quarters, readTable, regionQuery, replaceRegion, startRegions, writeTable} from './crossing-data.mjs';

const api = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const previous = process.env.PREVIOUS_DATA ? new URL(`file://${process.env.PREVIOUS_DATA.replace(/\/?$/, '/')}`) : null;
const out = new URL('../crossing-data/', import.meta.url);
const refreshBytes = Number(process.env.REFRESH_BYTES || 5_000_000);
let downloaded = 0, requests = 0;

async function overpass(box, since) {
  const query = regionQuery(box, since);
  for (let attempt = 0; attempt < 5; attempt++) {
    // A quiet interval between requests, growing after each failure.
    await new Promise(r => setTimeout(r, attempt ? 60000 * attempt : requests ? 10000 : 0));
    requests++;
    try {
      const response = await fetch(api, {method: 'POST', body: new URLSearchParams({data: query}), signal: AbortSignal.timeout(240000),
        headers: {'User-Agent': 'OpenRailwayAtlas-crossings/1.0 (+https://github.com/c933103/openrailwaystyle)'}});
      const text = await response.text();
      downloaded += Buffer.byteLength(text);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
      const rows = parseCsv(text);
      console.log(since ? 'Changes' : 'Region', box.join(','), rows.length, 'crossings;', downloaded, 'bytes this run');
      return rows;
    } catch (error) {
      console.warn(box.join(','), error.message);
      if (downloaded > 200_000_000) throw new Error('Download budget exceeded');
      // A busy server calls for waiting, never for more (smaller) requests;
      // a query that ran out of time or memory calls for a smaller area.
      if (/Dispatcher|too busy|rate_limited|HTTP 429|HTTP 503/i.test(error.message)) continue;
      if (/timed? ?out|timeout|memory|no end marker|HTTP 504/i.test(error.message)) return null;
    }
  }
  throw new Error(`Overpass stayed unavailable for region ${box}`);
}
// Fetches a region in full (since unset) or its changes; a region too big for
// one request is replaced by its quarters. Returns the leaf regions fetched.
async function fetchRegion(table, region, since, depth = 0) {
  const rows = await overpass(region.box, since);
  if (rows) {
    if (since) applyChanges(table, rows); else replaceRegion(table, region.box, rows);
    return [{box: region.box, fetched: startedAt}];
  }
  if (depth >= 5) throw new Error(`Could not fetch region ${region.box}`);
  const leaves = [];
  for (const box of quarters(region.box)) leaves.push(...await fetchRegion(table, {box}, since, depth + 1));
  return leaves;
}

// Overpass timestamps: the change query covers from a little before the
// previous run began, so nothing edited while it ran is missed.
const startedAt = new Date(Date.now() - 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
let table = new Map(), regions = startRegions(), since;
if (previous) {
  try {
    table = readTable(gunzipSync(await readFile(new URL('crossings.tsv.gz', previous))).toString());
    ({regions, since} = JSON.parse(await readFile(new URL('regions.json', previous), 'utf8')));
  } catch (error) { console.log('No usable previous data:', error.message); table = new Map(); regions = startRegions(); since = undefined; }
}
const before = table.size;
if (!since) {
  // First run: everything.
  const leaves = [];
  for (const region of regions) leaves.push(...await fetchRegion(table, region));
  regions = leaves;
} else {
  // Changes, by top-level 45° region (a worldwide change query can exceed
  // the server's time limit).
  for (const region of startRegions()) await fetchRegion(table, region, since);
  // Then refresh the regions checked longest ago.
  const start = downloaded;
  regions.sort((a, b) => a.fetched.localeCompare(b.fetched));
  const refreshed = [];
  while (regions.length && downloaded - start < refreshBytes) refreshed.push(...await fetchRegion(table, regions.shift()));
  regions.push(...refreshed);
}
// Guards against publishing a partial table.
if (table.size < 900_000) throw new Error(`Suspiciously few crossings worldwide: ${table.size}`);
if (before && table.size < before * 0.95) throw new Error(`Crossings dropped from ${before} to ${table.size}`);

await rm(out, {recursive: true, force: true});
await mkdir(out, {recursive: true});
await writeFile(new URL('crossings.tsv.gz', out), gzipSync(writeTable(table), {level: 9}));
await writeFile(new URL('regions.json', out), JSON.stringify({since: startedAt, regions}));
const index = [];
let bytes = 0;
for (const [z, detail] of [[OVERVIEW_ZOOM, false], [DETAIL_ZOOM, true]]) {
  for (const [key, data] of buildTiles(table, z, {detail})) {
    const [, x] = key.split('/');
    await mkdir(new URL(`${z}/${x}/`, out), {recursive: true});
    const gz = gzipSync(data, {level: 9});
    bytes += gz.length;
    await writeFile(new URL(`${key}.pbf.gz`, out), gz);
    index.push(key);
  }
}
await writeFile(new URL('index.json', out), JSON.stringify({tiles: index.sort()}));
const counts = {road: 0, foot: 0};
for (const [, [, , kind]] of table) counts[kind]++;
const manifest = {generated: new Date().toISOString(), changesSince: since || null, crossings: table.size, road: counts.road, pedestrian: counts.foot,
  tiles: index.length, tileBytes: bytes, regions: regions.length, requests, downloadedBytes: downloaded, source: api,
  query: 'node[railway=level_crossing] and node[railway=crossing], by region', license: 'ODbL-1.0',
  description: 'OpenStreetMap railway level crossings (road: railway=level_crossing; pedestrian: railway=crossing). Coverage follows OSM mapping.'};
await writeFile(new URL('manifest.json', out), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
