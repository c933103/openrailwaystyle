// Maintenance build only: visitors never query Overpass. Keeps the worldwide
// level-crossing table (crossing-data branch) current and writes its tiles.
//
// First run: every region in full (about 1.2 million crossings, some 45 MB
// of CSV), one request at a time. Later runs: the changes since each
// region's own time, by augmented diff over the crossings and the railway
// ways through them, deletions included; the crossings that may have changed
// are read again by id.
import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {gzipSync, gunzipSync} from 'node:zlib';
import {DETAIL_ZOOM, OVERVIEW_ZOOM, applyChanges, buildTiles, parseCsv, quarters, readTable, regionQuery, replaceRegion, crossingChangesQuery, crossingChanges, crossingRowsQuery, crossingExtraction, startRegions, updateRegionChanges, writeTable} from './crossing-data.mjs';
import {openCrossingCheckpoint} from './crossing-checkpoint.mjs';

const api = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const previous = process.env.PREVIOUS_DATA ? new URL(`file://${process.env.PREVIOUS_DATA.replace(/\/?$/, '/')}`) : null;
const out = new URL('../crossing-data/', import.meta.url);
let downloaded = 0, requests = 0;
let checkpoint = null, lastObservation;

// Pinned to the run's database time (startedAt), as every request of the run.
const overpass = box => request(regionQuery(box, startedAt), parseCsv, rows => `Region ${box.join(',')} ${rows.length} crossings`, box);
// One query, with retries; null when the query ran out of time or memory.
async function request(query, parse, describe, box) {
  for (let attempt = 0; attempt < 5; attempt++) {
    // A quiet interval between requests, growing after each failure.
    await new Promise(r => setTimeout(r, attempt ? 60000 * attempt : requests ? 10000 : 0));
    requests++;
    let failureText;
    try {
      const requestStartedAt = new Date().toISOString();
      const response = await fetch(api, {method: 'POST', body: new URLSearchParams({data: query}), signal: AbortSignal.timeout(240000),
        headers: {'User-Agent': 'OpenRailwayAtlas-crossings/1.0 (+https://github.com/c933103/openrailwaystyle)'}});
      const text = await response.text();
      downloaded += Buffer.byteLength(text);
      if (!response.ok) {
        // Keep the whole diagnostic for classification, but keep logs compact.
        failureText = `HTTP ${response.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}`;
        throw new Error(failureText.slice(0, 210));
      }
      const rows = parse(text);
      lastObservation = {requestStartedAt, observedAt: new Date().toISOString()};
      console.log(`${describe(rows)};`, downloaded, 'bytes this run');
      return rows;
    } catch (error) {
      console.warn(box.join(','), error.message);
      if (downloaded > 200_000_000) throw new Error('Download budget exceeded');
      // A busy server calls for waiting, never for more (smaller) requests;
      // a query that ran out of time or memory calls for a smaller area.
      // A capacity page can also say "Gateway Timeout". Check admission
      // failures first, including wording after the shortened log excerpt.
      const message = failureText || error.message;
      if (/Dispatcher|too busy|rate_limited|HTTP 429|HTTP 503|at capacity|query workers (?:are )?busy|request queue (?:is )?full/i.test(message)) continue;
      if (/timed? ?out|timeout|memory|no end marker|HTTP 504/i.test(message)) return null;
    }
  }
  throw new Error(`Overpass stayed unavailable for region ${box}`);
}
// The changes of a region since `since`: crossings deleted or no longer
// tagged go, and every crossing that may have changed (its own change, or a
// change to a railway way through it, deletion included) is read again by
// id. A region too big for one change request is replaced by its quarters.
// Changes end at the run's database time (startedAt), the time saved as the
// region's watermark, and the rows read again are of that time too: a
// crossing created after it and deleted before the next run is never stored.
// The changes of a top-level region are staged (`stage`) and applied to the
// table only when every request for it succeeded: a region deferred midway
// keeps its old watermark, so none of its changes may be published yet.
function staging() {
  const ops = [];
  return {set: rows => ops.push(['set', rows]), delete: id => ops.push(['delete', id]),
    applyTo: table => { for (const [op, value] of ops) op === 'set' ? applyChanges(table, value) : table.delete(value); }};
}
async function fetchChanges(stage, region, since, depth = 0) {
  if (since >= startedAt) return;
  const changes = await request(crossingChangesQuery(region.box, since, startedAt), crossingChanges,
    c => `Changes ${region.box.join(',')} ${c.deleted.length} removed, ${c.affected.length} to read again`, region.box);
  if (!changes) {
    if (depth >= 5) throw new Error(`Could not fetch region ${region.box}`);
    for (const box of quarters(region.box)) await fetchChanges(stage, {box}, since, depth + 1);
    return;
  }
  // A server whose data does not reach that time yet cannot give it.
  if (changes.timestamp < startedAt) throw new Error(`Overpass stayed unavailable for region ${region.box}: its data ends at ${changes.timestamp}`);
  for (const id of changes.deleted) stage.delete(id);
  await readCrossings(stage, changes.affected, region.box, new Set(changes.recheck));
}
// Rows for the given crossing ids, in groups; a group too big for one request
// is halved. A node no longer a crossing returns no row (and was reported
// deleted).
// A rechecked node that returns no row is no crossing anywhere and goes.
async function readCrossings(stage, ids, box, recheck = new Set()) {
  for (let i = 0; i < ids.length; i += 2000) await readGroup(stage, ids.slice(i, i + 2000), box, recheck);
}
async function readGroup(stage, ids, box, recheck) {
  const rows = await request(crossingRowsQuery(ids, startedAt), parseCsv, r => `Crossings ${ids.length} read again, ${r.length} rows`, box);
  if (rows) {
    stage.set(rows);
    const found = new Set(rows.map(row => row.id));
    for (const id of ids) if (recheck.has(id) && !found.has(id)) stage.delete(id);
    return;
  }
  if (ids.length === 1) throw new Error(`Could not read crossing ${ids[0]}`);
  const half = Math.ceil(ids.length / 2);
  await readGroup(stage, ids.slice(0, half), box, recheck);
  await readGroup(stage, ids.slice(half), box, recheck);
}
// Fetches a region in full; a region too big for one request is replaced by
// its quarters. Returns the leaf regions fetched.
async function fetchRegion(table, region, depth = 0) {
  const cached = checkpoint ? await checkpoint.get(region.box) : null;
  const rows = cached?.kind === 'leaf' ? cached.rows : cached?.kind === 'split' ? null : await overpass(region.box);
  if (rows) {
    if (checkpoint && !cached) await checkpoint.leaf(region.box, rows, lastObservation);
    replaceRegion(table, region.box, rows);
    return [{box: region.box, fetched: startedAt}];
  }
  if (depth >= 5) throw new Error(`Could not fetch region ${region.box}`);
  if (checkpoint && !cached) await checkpoint.split(region.box);
  const leaves = [];
  for (const box of quarters(region.box)) leaves.push(...await fetchRegion(table, {box}, depth + 1));
  return leaves;
}

// Overpass timestamps: the change query covers from a little before the
// previous run began, so nothing edited while it ran is missed.
let startedAt = new Date(Date.now() - 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
// Table format version: 2 adds the minor-track flag and 3 the crossing tags,
// which a change query cannot fill in for unchanged crossings, so an older
// table is fetched anew.
const VERSION = 3, extraction = crossingExtraction();
let table = new Map(), regions = startRegions(), since, changes, changesFrom, deferred = [];
if (previous) {
  try {
    const saved = JSON.parse(await readFile(new URL('regions.json', previous), 'utf8'));
    // A table without a recorded extraction was kept by the earlier change
    // query, which missed deletions that only a rolling full refresh then
    // repaired: it is rebuilt once, so the exact changes start from an exact
    // table.
    if (saved.version === VERSION && saved.extraction === extraction) {
      table = readTable(gunzipSync(await readFile(new URL('crossings.tsv.gz', previous))).toString());
      ({regions, since, changes} = saved);
    } else console.log('Previous table has an older format or was made by other code: fetching everything');
  } catch (error) { console.log('No usable previous data:', error.message); table = new Map(); regions = startRegions(); since = undefined; changes = undefined; }
}
const before = table.size;
if (!since) {
  // Full rebuild only: validated staging survives an ordinary failed run.
  // Keep the original epoch's watermark when replaying older observations.
  if (process.env.CROSSING_CHECKPOINT_DIR) {
    checkpoint = await openCrossingCheckpoint({directory: process.env.CROSSING_CHECKPOINT_DIR,
      source: api, parentSnapshot: process.env.PREVIOUS_SNAPSHOT_ID, tableVersion: VERSION});
    startedAt = checkpoint.watermark;
    regions = startRegions();
    if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, 'checkpoint=true\n', {flag: 'a'});
    console.log('Full-rebuild acquisition epoch', checkpoint.epoch);
  }
  const leaves = [];
  for (const region of regions) leaves.push(...await fetchRegion(table, region));
  regions = leaves;
} else {
  // Changes, by top-level 45° region (a worldwide change query can exceed
  // the server's time limit), each from its own time: a region the server
  // stayed unavailable for waits for the next run without losing the others.
  // The changes are exact, deletions included, so no region is downloaded
  // again on a schedule.
  const update = await updateRegionChanges({regions: startRegions(), changes, since, startedAt,
    fetch: async (region, from) => { const stage = staging(); await fetchChanges(stage, region, from); stage.applyTo(table); }});
  ({changes, deferred, since, from: changesFrom} = update);
}
// Guards against publishing a partial table.
if (table.size < 900_000) throw new Error(`Suspiciously few crossings worldwide: ${table.size}`);
if (before && table.size < before * 0.95) throw new Error(`Crossings dropped from ${before} to ${table.size}`);

await rm(out, {recursive: true, force: true});
await mkdir(out, {recursive: true});
await writeFile(new URL('crossings.tsv.gz', out), gzipSync(writeTable(table), {level: 9}));
await writeFile(new URL('regions.json', out), JSON.stringify({version: VERSION, extraction, since: changes ? since : startedAt, ...(changes ? {changes} : {}), regions,
  ...(checkpoint ? {acquisition: checkpoint.summary()} : {})}));
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
const counts = {road: 0, foot: 0, minor: 0};
for (const [, [, , kind, minor]] of table) { counts[kind]++; if (minor) counts.minor++; }
// tags: the detail tiles carry the crossing tags (tables from version 3).
const manifest = {generated: new Date().toISOString(), changesSince: changesFrom || null, deferredRegions: deferred, tags: true, crossings: table.size, road: counts.road, pedestrian: counts.foot, onMinorTracksOnly: counts.minor,
  ...(checkpoint ? {tableVersion: VERSION, acquisition: checkpoint.summary()} : {}),
  tiles: index.length, tileBytes: bytes, regions: regions.length, requests, downloadedBytes: downloaded, source: api,
  query: 'node[railway=level_crossing] and node[railway=crossing], by region; minor: only on tram, light rail, funicular, miniature, service or street-running tracks', license: 'ODbL-1.0',
  description: 'OpenStreetMap railway level crossings (road: railway=level_crossing; pedestrian: railway=crossing). Coverage follows OSM mapping.'};
await writeFile(new URL('manifest.json', out), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
// Published with every other region's changes; the run still ends red so the
// scheduler asks again for the deferred regions.
if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `deferred=${deferred.length}\n`, {flag: 'a'});
