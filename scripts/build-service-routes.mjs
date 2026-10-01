// Maintenance build only: visitors never query Overpass. Keeps the worldwide
// table of urban rail services (service-data branch) and writes its tiles.
//
// One region stage per run, in the order of STAGES (Japan first), each run
// capped at BUDGET_BYTES of downloads and every run six hours apart
// (service-routes.yml), so the volume, with the branch lines' (which share
// the server), stays within the public Overpass server's guidance (under
// about 1 GB and 10,000 requests a day). A stage
// larger than one run's budget continues in the next run. Once every stage is
// in, each run refreshes the stage checked longest ago if it is older than
// REFRESH_DAYS, which also removes deleted and retagged routes.
import {mkdir, readFile, writeFile, rm, appendFile} from 'node:fs/promises';
import {gzipSync, gunzipSync} from 'node:zlib';
import {STAGES, quarters} from './branch-lines.mjs';
import {MIN_ZOOM, MAX_ZOOM, buildTiles, mergeWay, partQuery, readTable, toTable, writeTable} from './service-routes.mjs';

const api = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const previous = process.env.PREVIOUS_DATA ? new URL(`file://${process.env.PREVIOUS_DATA.replace(/\/?$/, '/')}`) : null;
const out = new URL('../service-data/', import.meta.url);
const RUN_BUDGET = Number(process.env.BUDGET_BYTES || 50_000_000);
// Downloads over any 24 hours, scheduled and manual runs together.
// With the branch lines' 900 MB, within the public server's guidance of
// about 1 GB a day (both use it).
const DAY_BUDGET = Number(process.env.DAY_BUDGET_BYTES || 100_000_000);
const REFRESH_DAYS = Number(process.env.REFRESH_DAYS || 14);
// No new request after this long, so a run publishes its progress well
// before the job's 150-minute limit (one request with its retries can take
// about 35 minutes).
const TIME_BUDGET_MS = Number(process.env.TIME_BUDGET_MINUTES || 100) * 60000;
const started = Date.now();
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
let downloaded = 0, requests = 0;

let table = {routes: new Map(), ways: new Map()}, state = {stages: {}};
if (previous) {
  try {
    table = readTable(gunzipSync(await readFile(new URL('service-routes.ndjson.gz', previous))).toString());
    state = JSON.parse(await readFile(new URL('state.json', previous), 'utf8'));
  } catch (error) {
    // A published snapshot that cannot be read must not be replaced by a
    // fresh first stage (which would drop every other region's routes).
    throw new Error(`The previous snapshot could not be read: ${error.message}`);
  }
}

const VERSION = 1;
if (state.version !== VERSION) {
  for (const s of Object.values(state.stages)) Object.assign(s, {completed: null, pending: null, seen: []});
  state.version = VERSION;
}
state.runs = (state.runs || []).filter(run => Date.now() - Date.parse(run.at) < 86400_000);
const lastDay = state.runs.reduce((sum, run) => sum + run.bytes, 0);
const BUDGET_BYTES = Math.min(RUN_BUDGET, DAY_BUDGET - lastDay);
if (BUDGET_BYTES < 10_000_000) {
  console.log(`${lastDay} bytes downloaded in the last 24 hours; waiting for a later run.`);
  process.exit(0);
}
// The stage to work on: one in progress, else the first never completed,
// else the one completed longest ago if due for a refresh.
const info = name => (state.stages[name] ||= {completed: null, pending: null, seen: []});
let stage = STAGES.find(s => info(s.name).pending?.length) || STAGES.find(s => !info(s.name).completed);
if (!stage) {
  const oldest = [...STAGES].sort((a, b) => info(a.name).completed.localeCompare(info(b.name).completed))[0];
  if (Date.now() - Date.parse(info(oldest.name).completed) >= REFRESH_DAYS * 86400_000) stage = oldest;
}
if (!stage) {
  console.log('Every stage is current; nothing to fetch.');
  process.exit(0);
}
const current = info(stage.name);
if (!current.pending?.length) { current.pending = stage.parts.map((part, index) => ({part: index, box: part.box})); current.seen = []; current.started = now; }
console.log(`Stage ${stage.name} (${stage.label}): ${current.pending.length} region(s) to fetch`);

const BUDGET = Symbol('budget');
async function overpass(query) {
  for (let attempt = 0; attempt < 5; attempt++) {
    // A quiet interval between requests, growing after each failure.
    await new Promise(r => setTimeout(r, attempt ? 60000 * attempt : requests ? 15000 : 0));
    requests++;
    try {
      const response = await fetch(api, {method: 'POST', body: new URLSearchParams({data: query}), signal: AbortSignal.timeout(300000),
        headers: {'User-Agent': 'OpenRailwayAtlas-service-routes/1.0 (+https://github.com/c933103/openrailwaystyle)'}});
      // Read within the run's budget: a response that would pass it is cut
      // off (its bytes still count). Cut off before any region is done this run, the
      // region is too large for any run and is split; later, the run stops
      // and the region is fetched first in the next run.
      // Fresh: no region fetched or split yet this run (bytes of earlier
      // error responses do not count).
      const chunks = [], fresh = fetchedBoxes + splitBoxes === 0;
      let received = 0, over = false;
      for await (const chunk of response.body) {
        received += chunk.length; downloaded += chunk.length;
        if (downloaded > BUDGET_BYTES) { over = true; break; }
        chunks.push(chunk);
      }
      if (over) { await response.body.cancel().catch(() => {}); return fresh ? null : BUDGET; }
      const text = Buffer.concat(chunks).toString();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
      return toTable(JSON.parse(text));
    } catch (error) {
      console.warn(error.message);
      // A busy server calls for waiting; a query that ran out of time or
      // memory calls for a smaller area (null); anything else, try again.
      if (/Dispatcher|too busy|rate_limited|HTTP 429|HTTP 503/i.test(error.message)) continue;
      if (/timed? ?out|timeout|memory|maxsize|HTTP 504|Unexpected end|JSON/i.test(error.message)) return null;
    }
  }
  throw new Error('Overpass stayed unavailable');
}

let fetchedBoxes = 0, splitBoxes = 0, stopped = null;
const seen = new Set(current.seen);
while (current.pending.length) {
  if (downloaded >= BUDGET_BYTES) { stopped = `download budget reached (${downloaded} bytes)`; break; }
  if (Date.now() - started > TIME_BUDGET_MS) { stopped = `time budget reached (${Math.round((Date.now() - started) / 60000)} minutes)`; break; }
  const item = current.pending[0], part = stage.parts[item.part];
  let result;
  try { result = await overpass(partQuery(part, item.box)); }
  catch (error) { stopped = error.message; break; }
  if (result === BUDGET) { stopped = `download budget reached (${downloaded} bytes)`; break; }
  current.pending.shift();
  if (!result) {
    // Too large for one request: its quarters go first in the queue. At the
    // finest split the region stays queued and the run stops, still
    // publishing its progress and the bytes it used.
    if (item.depth >= 6) { current.pending.unshift(item); stopped = `could not fetch region ${item.box}`; break; }
    current.pending.unshift(...quarters(item.box).map(box => ({part: item.part, box, depth: (item.depth || 0) + 1})));
    splitBoxes++;
    continue;
  }
  fetchedBoxes++;
  // A route or way keeps the stage that first fetched it (stages overlap at
  // edges, and routes cross them).
  for (const [map, items, id, prefix] of [[table.routes, result.routes, r => r.key, 'r'], [table.ways, result.ways, w => w.id, 'w']]) for (const item of items) {
    const key = id(item), previous = map.get(key), owner = previous?.stage || stage.name;
    map.set(key, prefix === 'w' ? mergeWay(previous, item, {stage: stage.name, seenThisPass: seen.has(`w:${key}`)}) : {...item, relation: Math.min(previous?.relation ?? Infinity, item.relation), stage: owner});
    if (owner === stage.name) seen.add(`${prefix}:${key}`);
  }
  console.log(`Region ${item.box.join(',')}: ${result.routes.length} routes, ${result.ways.length} ways; ${downloaded} bytes, ${requests} requests this run`);
}
current.seen = [...seen];
if (!current.pending.length) {
  // A complete stage: its routes and ways not returned this time were
  // deleted or retagged.
  const mine = (map, prefix) => [...map.entries()].filter(([, v]) => v.stage === stage.name).map(([k]) => [map, k, `${prefix}:${k}`]);
  const items = [...mine(table.routes, 'r'), ...mine(table.ways, 'w')];
  const stale = items.filter(([, , k]) => !seen.has(k));
  // A refresh that would remove over a fifth of a stage's routes and ways
  // points to an incomplete response: they stay, and the stage is tried
  // again at its next refresh (the run's downloads are still recorded).
  const suspicious = current.completed && items.length > 100 && stale.length > items.length * 0.2;
  if (suspicious) console.warn(`Refresh of ${stage.name} would remove ${stale.length} of ${items.length} items; keeping them`);
  else for (const [map, k] of stale) map.delete(k);
  const routes = [...table.routes.values()].filter(r => r.stage === stage.name).length;
  Object.assign(current, {completed: now, pending: null, seen: [], routes, kept: suspicious ? stale.length : 0});
  console.log(`Stage ${stage.name} complete: ${routes} routes (${suspicious ? 0 : stale.length} items removed)`);
} else console.log(`Stage ${stage.name} continues next run (${current.pending.length} region(s) left): ${stopped}`);
// With nothing fetched and no region split, an unavailable server leaves the
// published data as it was; bytes it did download are still recorded (the
// state is published with the table unchanged, and the site not redeployed).
if (!fetchedBoxes && !splitBoxes && stopped) {
  if (!downloaded) throw new Error(`Nothing fetched: ${stopped}`);
  console.warn(`Nothing fetched (${stopped}); recording ${downloaded} bytes downloaded`);
}

// Stamped when the downloads end, so the bytes stay in the 24-hour window
// for a full day after they were last downloaded.
state.runs.push({at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), bytes: downloaded});
await rm(out, {recursive: true, force: true});
await mkdir(out, {recursive: true});
await writeFile(new URL('service-routes.ndjson.gz', out), gzipSync(writeTable(table), {level: 9}));
await writeFile(new URL('state.json', out), JSON.stringify(state));
const index = [];
let tileBytes = 0;
for (const [key, data] of buildTiles(table)) {
  const [z, x] = key.split('/');
  await mkdir(new URL(`${z}/${x}/`, out), {recursive: true});
  const gz = gzipSync(data, {level: 9});
  tileBytes += gz.length;
  await writeFile(new URL(`${key}.pbf.gz`, out), gz);
  index.push(key);
}
await writeFile(new URL('index.json', out), JSON.stringify({tiles: index.sort()}));
const manifest = {generated: new Date().toISOString(), routes: table.routes.size, ways: table.ways.size, tiles: index.length, tileBytes, zooms: [MIN_ZOOM, MAX_ZOOM],
  stages: STAGES.map(s => ({name: s.name, label: s.label, completed: info(s.name).completed, inProgress: Boolean(info(s.name).pending?.length),
    routes: [...table.routes.values()].filter(r => r.stage === s.name).length})),
  run: {stage: stage.name, requests, downloadedBytes: downloaded}, source: api,
  query: 'route relations (type=route) with route=subway, light_rail, tram or monorail, or route=train with service=commuter or urban, and their track ways, by region', license: 'ODbL-1.0',
  description: 'OpenStreetMap urban rail services (metro, light rail, tram, monorail and commuter rail routes) along the tracks they run on, for the Service view.'};
await writeFile(new URL('manifest.json', out), JSON.stringify(manifest, null, 2));
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `publish=true\nredeploy=${fetchedBoxes > 0}\n`);
console.log(JSON.stringify({...manifest, stages: undefined, progress: manifest.stages.map(s => `${s.name}:${s.completed ? 'done' : s.inProgress ? 'partial' : '-'}:${s.routes}`).join(' ')}));
