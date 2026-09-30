// Maintenance build only: visitors never query Overpass. Keeps the worldwide
// table of operating branch lines (branch-data branch) and writes its tiles.
//
// One region stage per run, in the order of STAGES (Japan first), each run
// capped at BUDGET_BYTES of downloads and every run six hours apart
// (branch-lines.yml), so the volume stays within the public Overpass
// server's guidance (under about 1 GB and 10,000 requests a day). A stage
// larger than one run's budget continues in the next run. Once every stage is
// in, each run refreshes the stage checked longest ago if it is older than
// REFRESH_DAYS, which also removes deleted and retagged lines.
import {mkdir, readFile, writeFile, rm, appendFile} from 'node:fs/promises';
import {gzipSync, gunzipSync} from 'node:zlib';
import {STAGES, MIN_ZOOM, MAX_ZOOM, buildTiles, partQuery, quarters, readTable, toFeatures, writeTable} from './branch-lines.mjs';

const api = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const previous = process.env.PREVIOUS_DATA ? new URL(`file://${process.env.PREVIOUS_DATA.replace(/\/?$/, '/')}`) : null;
const out = new URL('../branch-data/', import.meta.url);
const BUDGET_BYTES = Number(process.env.BUDGET_BYTES || 220_000_000);
const REFRESH_DAYS = Number(process.env.REFRESH_DAYS || 14);
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
let downloaded = 0, requests = 0;

let table = new Map(), state = {stages: {}};
if (previous) {
  try {
    table = readTable(gunzipSync(await readFile(new URL('branch-lines.ndjson.gz', previous))).toString());
    state = JSON.parse(await readFile(new URL('state.json', previous), 'utf8'));
  } catch (error) { console.log('No usable previous data:', error.message); table = new Map(); state = {stages: {}}; }
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

async function overpass(query) {
  for (let attempt = 0; attempt < 5; attempt++) {
    // A quiet interval between requests, growing after each failure.
    await new Promise(r => setTimeout(r, attempt ? 60000 * attempt : requests ? 15000 : 0));
    requests++;
    try {
      const response = await fetch(api, {method: 'POST', body: new URLSearchParams({data: query}), signal: AbortSignal.timeout(300000),
        headers: {'User-Agent': 'OpenRailwayAtlas-branch-lines/1.0 (+https://github.com/c933103/openrailwaystyle)'}});
      const text = await response.text();
      downloaded += Buffer.byteLength(text);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
      return toFeatures(JSON.parse(text));
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

let fetchedBoxes = 0, stopped = null;
const seen = new Set(current.seen);
while (current.pending.length) {
  if (downloaded >= BUDGET_BYTES) { stopped = `download budget reached (${downloaded} bytes)`; break; }
  const item = current.pending[0], part = stage.parts[item.part];
  let features;
  try { features = await overpass(partQuery(part, item.box)); }
  catch (error) { stopped = error.message; break; }
  current.pending.shift();
  if (!features) {
    // Too large for one request: its quarters go first in the queue.
    if (item.depth >= 6) throw new Error(`Could not fetch region ${item.box}`);
    current.pending.unshift(...quarters(item.box).map(box => ({part: item.part, box, depth: (item.depth || 0) + 1})));
    continue;
  }
  fetchedBoxes++;
  for (const feature of features) {
    // A line keeps the stage that first fetched it (stages overlap at edges).
    const owner = table.get(feature.id)?.stage || stage.name;
    table.set(feature.id, {...feature, stage: owner});
    if (owner === stage.name) seen.add(feature.id);
  }
  console.log(`Region ${item.box.join(',')}: ${features.length} lines; ${downloaded} bytes, ${requests} requests this run`);
}
current.seen = [...seen];
if (!current.pending.length) {
  // A complete stage: its lines not returned this time were deleted or retagged.
  const before = [...table.values()].filter(f => f.stage === stage.name).length;
  const stale = [...table.values()].filter(f => f.stage === stage.name && !seen.has(f.id));
  if (current.completed && before > 100 && stale.length > before * 0.2) throw new Error(`Refresh of ${stage.name} would remove ${stale.length} of ${before} lines`);
  for (const f of stale) table.delete(f.id);
  Object.assign(current, {completed: now, pending: null, seen: [], lines: before - stale.length});
  console.log(`Stage ${stage.name} complete: ${current.lines} lines (${stale.length} removed)`);
} else console.log(`Stage ${stage.name} continues next run (${current.pending.length} region(s) left): ${stopped}`);
if (!fetchedBoxes) {
  if (stopped) throw new Error(`Nothing fetched: ${stopped}`);
}

await rm(out, {recursive: true, force: true});
await mkdir(out, {recursive: true});
await writeFile(new URL('branch-lines.ndjson.gz', out), gzipSync(writeTable(table), {level: 9}));
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
const manifest = {generated: new Date().toISOString(), lines: table.size, tiles: index.length, tileBytes, zooms: [MIN_ZOOM, MAX_ZOOM],
  stages: STAGES.map(s => ({name: s.name, label: s.label, completed: info(s.name).completed, inProgress: Boolean(info(s.name).pending?.length),
    lines: [...table.values()].filter(f => f.stage === s.name).length})),
  run: {stage: stage.name, requests, downloadedBytes: downloaded}, source: api,
  query: 'way[railway~"^(rail|narrow_gauge)$"][usage=branch][!service], by region', license: 'ODbL-1.0',
  description: 'OpenStreetMap operating branch lines (usage=branch) for the overview zooms, where OpenRailwayMap shows main lines only.'};
await writeFile(new URL('manifest.json', out), JSON.stringify(manifest, null, 2));
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'publish=true\n');
console.log(JSON.stringify({...manifest, stages: undefined, progress: manifest.stages.map(s => `${s.name}:${s.completed ? 'done' : s.inProgress ? 'partial' : '-'}:${s.lines}`).join(' ')}));
