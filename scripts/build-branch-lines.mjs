// Maintenance build only: visitors never query Overpass. Keeps the worldwide
// table of operating branch lines (branch-data branch) and writes its tiles.
//
// One region stage per run, least recently attempted first (Japan initially), each run
// capped at BUDGET_BYTES of downloads and every run six hours apart
// (branch-lines.yml), so the volume stays within the public Overpass
// server's guidance (under about 1 GB and 10,000 requests a day). A stage
// larger than one run's budget continues in the next run. Once every stage is
// in, each run refreshes the stage checked longest ago if it is older than
// REFRESH_DAYS, which also removes deleted and retagged lines.
import {mkdir, readFile, writeFile, rm, appendFile} from 'node:fs/promises';
import {gzipSync, gunzipSync} from 'node:zlib';
import {STAGES, MIN_ZOOM, MAX_ZOOM, migrateBranchState, migrateBranchDownloads, retireBranchEurope, branchStageOwner, buildTiles, partQuery, quarters, readTable, toFeatures, writeTable} from './branch-lines.mjs';

import {selectDownloadStage, startStagePass, recordStageRegion, finishStagePass} from './download-stages.mjs';
import {resolve} from 'node:path';
import {describeOverpassError, workflowWarning} from './overpass-errors.mjs';

const api = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const previous = process.env.PREVIOUS_DATA ? new URL(`file://${process.env.PREVIOUS_DATA.replace(/\/?$/, '/')}`) : null;
const out = new URL('../branch-data/', import.meta.url);
const RUN_BUDGET = Number(process.env.BUDGET_BYTES || 220_000_000);
// Downloads over any 24 hours, scheduled and manual runs together.
const DAY_BUDGET = Number(process.env.DAY_BUDGET_BYTES || 900_000_000);
const REFRESH_DAYS = Number(process.env.REFRESH_DAYS || 14);
// No new request after this long, so a run publishes its progress well
// before the job's 150-minute limit (one request with its retries can take
// about 35 minutes).
const TIME_BUDGET_MS = Number(process.env.TIME_BUDGET_MINUTES || 100) * 60000;
const started = Date.now();
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
let downloaded = 0, requests = 0;

let table = new Map(), state = {stages: {}};
if (previous) {
  try {
    table = readTable(gunzipSync(await readFile(new URL('branch-lines.ndjson.gz', previous))).toString());
    state = JSON.parse(await readFile(new URL('state.json', previous), 'utf8'));
  } catch (error) {
    // A published snapshot that cannot be read must not be replaced by a
    // fresh first stage (which would drop every other region's lines).
    throw new Error(`The previous snapshot could not be read: ${error.message}`);
  }
}

const info = name => (state.stages[name] ||= {completed: null, pending: null, seen: []});
// Writes the table, its tiles, state and manifest for publication.
async function publish({run, redeploy, source = api}) {
  retireBranchEurope(state, table);
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
    stages: STAGES.map(s => ({name: s.name, label: s.label, completed: info(s.name).completed, inProgress: Boolean(info(s.name).pending?.length), lastAttempt: info(s.name).lastAttempt || null,
      lines: [...table.values()].filter(f => f.stage === s.name).length})),
    run, source,
    query: 'way[railway~"^(rail|narrow_gauge)$"][usage=branch][!service] and way[railway=subway][!service], by region', license: 'ODbL-1.0',
    description: 'OpenStreetMap operating branch lines (usage=branch) for zooms 4–6 and metro lines (railway=subway) for zooms 7–9, where OpenRailwayMap shows neither.'};
  await writeFile(new URL('manifest.json', out), JSON.stringify(manifest, null, 2));
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `publish=true\nredeploy=${redeploy}\n`);
  console.log(JSON.stringify({...manifest, stages: undefined, progress: manifest.stages.map(s => `${s.name}:${s.completed ? 'done' : s.inProgress ? 'partial' : '-'}:${s.lines}`).join(' ')}));
}

// Format 3 retains concurrent train-protection systems. Old tiles/table only
// contain the primary code, so re-fetch every region through the existing
// staged refresh while keeping its previous geometries until it succeeds.
migrateBranchState(state);
migrateBranchDownloads(state, table);
// Built from the stored railway-ways regions (build-railway-ways.mjs), when
// given, instead of downloading: no Overpass request at all.
if (process.env.RAILWAY_WAYS_STORE) {
  const store = process.env.RAILWAY_WAYS_STORE;
  // Loaded only here: the download path needs none of it.
  const [{branchTableFromStore}, {storedRegions}] = await Promise.all([import('./railway-ways-branch.mjs'), import('./build-railway-ways.mjs')]);
  const stored = JSON.parse(await readFile(new URL(`file://${resolve(store)}/state.json`), 'utf8'));
  const completed = Object.fromEntries(Object.entries(stored.stages || {}).map(([name, s]) => [name, s.completed || null]));
  const before = writeTable(table);
  const result = await branchTableFromStore(table, storedRegions(store), completed);
  table = result.table;
  for (const item of result.applied) Object.assign(state.stages[item.stage] ||= {seen: []},
    {completed: item.completed, started: item.completed, pending: null, seen: [], lines: item.lines, kept: item.kept, source: 'railway-ways'});
  await publish({run: {source: 'railway-ways', stages: result.applied.map(item => item.stage)}, redeploy: writeTable(table) !== before, source: 'railway-ways-data'});
  process.exit(0);
}

state.runs = (state.runs || []).filter(run => Date.now() - Date.parse(run.at) < 86400_000);
const lastDay = state.runs.reduce((sum, run) => sum + run.bytes, 0);
const BUDGET_BYTES = Math.min(RUN_BUDGET, DAY_BUDGET - lastDay);
if (BUDGET_BYTES < 10_000_000) {
  console.log(`${lastDay} bytes downloaded in the last 24 hours; waiting for a later run.`);
  process.exit(0);
}
// Resume unfinished stages fairly, retaining each stage's accepted data and queue.
const stage = selectDownloadStage(state, {refreshDays: REFRESH_DAYS});
if (!stage) {
  console.log('Every stage is current; nothing to fetch.');
  process.exit(0);
}
const current = info(stage.name);
if (!current.pending?.length) { startStagePass(current, stage); current.seen = []; current.started = now; }
console.log(`Stage ${stage.name} (${stage.label}): ${current.pending.length} region(s) to fetch`);

const BUDGET = Symbol('budget');
async function overpass(query) {
  let lastFailure;
  for (let attempt = 0; attempt < 5; attempt++) {
    // A complete error body can consume the allowance exactly. Do not wait
    // for or start another request once its bytes have exhausted this run.
    if (downloaded >= BUDGET_BYTES) return BUDGET;
    // A quiet interval between requests, growing after each failure.
    await new Promise(r => setTimeout(r, attempt ? 60000 * attempt : requests ? 15000 : 0));
    requests++;
    try {
      const response = await fetch(api, {method: 'POST', body: new URLSearchParams({data: query}), signal: AbortSignal.timeout(300000),
        headers: {'User-Agent': 'OpenRailwayAtlas-branch-lines/1.0 (+https://github.com/c933103/openrailwaystyle)'}});
      // Stop at the remaining allowance, counting every received byte. A fresh
      // region is oversized only if this successful response alone exceeds a
      // full run's allowance. HTTP error bodies, earlier failed-response bytes
      // and a reduced daily balance cannot establish that; defer the same box.
      // After any fetched/split region, also defer until the next eligible run.
      const chunks = [], fresh = fetchedBoxes + splitBoxes === 0;
      let received = 0, over = false;
      for await (const chunk of response.body) {
        received += chunk.length; downloaded += chunk.length;
        if (downloaded > BUDGET_BYTES) { over = true; break; }
        chunks.push(chunk);
      }
      if (over) {
        await response.body.cancel().catch(() => {});
        return response.ok && fresh && received > RUN_BUDGET ? null : BUDGET;
      }
      const text = Buffer.concat(chunks).toString();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
      return toFeatures(JSON.parse(text));
    } catch (error) {
      lastFailure = describeOverpassError(error);
      console.warn(`Overpass attempt ${attempt + 1}/5: ${lastFailure}`);
      // A busy server calls for waiting; a query that ran out of time or
      // memory calls for a smaller area (null); anything else, try again.
      if (/Dispatcher|too busy|rate_limited|HTTP 429|HTTP 503/i.test(error.message)) continue;
      if (/timed? ?out|timeout|memory|maxsize|HTTP 504|Unexpected end|JSON/i.test(error.message)) return null;
    }
  }
  throw new Error(`Overpass stayed unavailable: ${lastFailure}`);
}

let fetchedBoxes = 0, splitBoxes = 0, stopped = null;
const seen = new Set(current.seen);
while (current.pending.length) {
  if (downloaded >= BUDGET_BYTES) { stopped = `download budget reached (${downloaded} bytes)`; break; }
  if (Date.now() - started > TIME_BUDGET_MS) { stopped = `time budget reached (${Math.round((Date.now() - started) / 60000)} minutes)`; break; }
  const item = current.pending[0], part = stage.parts[item.part];
  let features;
  try { features = await overpass(partQuery(part, item.box)); }
  catch (error) { stopped = error.message; break; }
  if (features === BUDGET) { stopped = `download budget reached (${downloaded} bytes)`; break; }
  current.pending.shift();
  if (!features) {
    // Too large for one request: its quarters go first in the queue. At the
    // finest split the region stays queued and the run stops, still
    // publishing its progress and the bytes it used.
    if (item.depth >= 6) { current.pending.unshift(item); stopped = `could not fetch region ${item.box}`; break; }
    current.pending.unshift(...quarters(item.box).map(box => ({part: item.part, box, depth: (item.depth || 0) + 1})));
    splitBoxes++;
    continue;
  }
  fetchedBoxes++;
  recordStageRegion(current, item);
  for (const feature of features) {
    // A line keeps the stage that first fetched it (stages overlap at edges).
    const owner = branchStageOwner(table.get(feature.id)?.stage, stage.name);
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
  // A refresh that would remove over a fifth of a stage's lines points to an
  // incomplete response: the lines stay, and the stage is tried again at its
  // next refresh (the run's downloads are still recorded).
  const suspicious = (current.completed || current.previousCompleted) && before > 100 && stale.length > before * 0.2;
  if (suspicious) console.warn(`Refresh of ${stage.name} would remove ${stale.length} of ${before} lines; keeping them`);
  else for (const f of stale) table.delete(f.id);
  finishStagePass(current, stage);
  Object.assign(current, {completed: now, previousCompleted: null, pending: null, seen: [], lines: before - (suspicious ? 0 : stale.length), ...(suspicious ? {kept: stale.length} : {kept: 0})});
  console.log(`Stage ${stage.name} complete: ${current.lines} lines (${suspicious ? 0 : stale.length} removed)`);
} else console.log(`Stage ${stage.name} continues next run (${current.pending.length} region(s) left): ${stopped}`);
// With nothing fetched and no region split, an unavailable server leaves the
// published data as it was; bytes it did download are still recorded (the
// state is published with the table unchanged, and the site not redeployed).
if (!fetchedBoxes && !splitBoxes && stopped) {
  console.warn(`Nothing fetched (${stopped}); recording ${downloaded} bytes downloaded`);
}

// Persist failed zero-byte attempts too: the next scheduled run can give a
// different region a turn. A deferred acquisition is never a completed box.
current.lastAttempt = {at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  status: !current.pending?.length ? 'acquired' : fetchedBoxes ? 'partial' : 'deferred',
  reason: stopped, fetchedBoxes, splitBoxes, requests, downloadedBytes: downloaded};
if (current.lastAttempt.status === 'deferred') console.warn(workflowWarning(`${stage.name} acquisition deferred: ${stopped}`));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
  `### ${stage.name}: ${current.lastAttempt.status}\n${fetchedBoxes} fetched boxes; ${current.pending?.length || 0} pending. ${stopped || ''}\n`);

// Stamped when the downloads end, so the bytes stay in the 24-hour window
// for a full day after they were last downloaded.
state.runs.push({at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), bytes: downloaded});
await publish({run: {stage: stage.name, ...current.lastAttempt}, redeploy: fetchedBoxes > 0});
