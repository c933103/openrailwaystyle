// Maintenance build only: visitors never query Overpass. Keeps the worldwide
// table of urban rail services (service-data branch) and writes its tiles.
//
// One region stage per run, least recently attempted first (Japan initially), each run
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
import {MIN_ZOOM, MAX_ZOOM, migrateServiceDownloads, retireServiceEurope, addResult, buildTiles, geometrySummary, commitStage, discardStage, partQuery, readTable, routeStages, routeView, stageChange, suspiciousChange, toTable, writeTable} from './service-routes.mjs';
import {createHash} from 'node:crypto';
import {stageGeometryHealth, refreshRelationDependencyHealth} from './service-geometry-health.mjs';

import {selectDownloadStage, startStagePass, recordStageRegion, finishStagePass} from './download-stages.mjs';
import {describeOverpassError, workflowWarning} from './overpass-errors.mjs';

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
migrateServiceDownloads(state, table);
state.runs = (state.runs || []).filter(run => Date.now() - Date.parse(run.at) < 86400_000);
const lastDay = state.runs.reduce((sum, run) => sum + run.bytes, 0);
const BUDGET_BYTES = Math.min(RUN_BUDGET, DAY_BUDGET - lastDay);
if (BUDGET_BYTES < 10_000_000) {
  console.log(`${lastDay} bytes downloaded in the last 24 hours; waiting for a later run.`);
  process.exit(0);
}
// Resume unfinished stages fairly, retaining each stage's accepted data and queue.
const info = name => (state.stages[name] ||= {completed: null, pending: null, seen: []});
const stage = selectDownloadStage(state, {refreshDays: REFRESH_DAYS});
if (!stage) {
  console.log('Every stage is current; nothing to fetch.');
  process.exit(0);
}
const current = info(stage.name);
// A new pass starts from nothing of its own in progress.
if (!current.pending?.length) { startStagePass(current, stage); current.seen = []; current.started = now; discardStage(table, stage.name); }
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
    let failureText;
    try {
      const response = await fetch(api, {method: 'POST', body: new URLSearchParams({data: query}), signal: AbortSignal.timeout(300000),
        headers: {'User-Agent': 'OpenRailwayAtlas-service-routes/1.0 (+https://github.com/c933103/openrailwaystyle)'}});
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
      if (!response.ok) {
        // Classify the whole diagnostic, while keeping logged errors compact.
        failureText = `HTTP ${response.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}`;
        throw new Error(failureText.slice(0, 210));
      }
      return toTable(JSON.parse(text), {endpoint: api, acquired: new Date().toISOString(), stage: stage.name, pass: current.started, query: createHash('sha256').update(query).digest('hex')});
    } catch (error) {
      lastFailure = describeOverpassError(error);
      console.warn(`Overpass attempt ${attempt + 1}/5: ${lastFailure}`);
      // Admission failures can also say "Gateway Timeout". Wait on the same
      // box before considering smaller areas, even when the capacity wording
      // follows the shortened log excerpt. Genuine query time/memory limits
      // and incomplete JSON still call for a smaller area (null).
      const message = failureText || error.message;
      if (/Dispatcher|too busy|rate_limited|HTTP 429|HTTP 503|at capacity|query workers (?:are )?busy|request queue (?:is )?full/i.test(message)) continue;
      if (/timed? ?out|timeout|memory|maxsize|HTTP 504|Unexpected end|JSON/i.test(message)) return null;
    }
  }
  throw new Error(`Overpass stayed unavailable: ${lastFailure}`);
}

let fetchedBoxes = 0, splitBoxes = 0, stopped = null;
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
  recordStageRegion(current, item);
  addResult(table, result, stage.name);
  console.log(`Region ${item.box.join(',')}: ${result.routes.length} routes, ${result.ways.length} ways; ${downloaded} bytes, ${requests} requests this run`);
}
if (!current.pending.length) {
  // A complete stage: what it found replaces its part, so routes and
  // memberships it no longer found go (other stages' parts stay). A refresh
  // that would remove over a fifth of the stage's items points to an
  // incomplete response: it is dropped whole, the previous part stays, and
  // the stage is tried again at its next refresh (the run's downloads are
  // still recorded).
  const observed = stageGeometryHealth(table, stage.name, {pending: true});
  const change = stageChange(table, stage.name), {stale, total} = change;
  const suspicious = Boolean(current.completed || current.previousCompleted) && suspiciousChange(change);
  if (suspicious) { console.warn(`Refresh of ${stage.name} would remove ${stale} of ${total} items; keeping the previous data`); discardStage(table, stage.name); }
  else commitStage(table, stage.name);
  // Acquisition finished, but source gaps/conflicts are not a fully covered
  // refresh. Keep a bounded, persisted repair record; retry on the existing
  // stage refresh cadence, without increasing the public-server budgets.
  const health = stageGeometryHealth(table, stage.name);
  if (observed.status !== 'complete' || suspicious) health.status = 'incomplete';
  const sourceIncomplete = suspicious || observed.status !== 'complete' || health.sourceStatus !== 'complete';
  const sourceOutcome = {status: sourceIncomplete ? 'incomplete' : 'complete', retry: sourceIncomplete ? 'next-stage-refresh' : null,
    lastFailure: suspicious ? 'membership-refresh-rejected' : observed.counts.unknown || observed.relationCounts.unknown ? 'unverified-source'
      : [observed, health].some(item => item.relationCounts.partial + item.relationCounts.conflict + item.relationCounts.unknown) ? 'unresolved-source-relations'
        : sourceIncomplete ? 'unresolved-source-geometry' : null};
  const relationProblem = [observed, health].some(item => item.relationCounts.partial + item.relationCounts.conflict + item.relationCounts.unknown);
  current.geometry = {...health, sourceOutcome, observed, observedUnknown: observed.counts.unknown, observedUnknownRelations: observed.relationCounts.unknown, checked: now,
    lastFailure: suspicious ? 'membership-refresh-rejected' : observed.counts.unknown || observed.relationCounts.unknown ? 'unverified-source' : relationProblem ? 'unresolved-source-relations' : health.status === 'incomplete' ? 'unresolved-source-geometry' : null, attempts: (current.geometry?.attempts || 0) + 1,
    retry: health.status === 'complete' ? null : 'next-stage-refresh'};
  const declarations = [...table.routes.values()].filter(r => routeStages(r).includes(stage.name));
  const routes = declarations.filter(r => routeView(r).active !== false).length, retainedRelations = declarations.length;
  finishStagePass(current, stage);
  Object.assign(current, {completed: now, previousCompleted: null, pending: null, seen: [], routes, retainedRelations, kept: suspicious ? stale : 0});
  console.log(`Stage ${stage.name} acquisition complete (${health.status} geometry): ${routes} active routes (${retainedRelations} retained declarations; ${suspicious ? 0 : stale} items removed)`);
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
retireServiceEurope(state, table);
refreshRelationDependencyHealth(state, table, now);
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
const manifest = {geometry: geometrySummary(table), generated: new Date().toISOString(), routes: [...table.routes.values()].filter(r => routeView(r).active !== false).length, retainedRelations: table.routes.size, ways: table.ways.size, tiles: index.length, tileBytes, zooms: [MIN_ZOOM, MAX_ZOOM],
  stages: STAGES.map(s => ({name: s.name, label: s.label, completed: info(s.name).completed, inProgress: Boolean(info(s.name).pending?.length), lastAttempt: info(s.name).lastAttempt || null, geometry: info(s.name).geometry || null,
    routes: [...table.routes.values()].filter(r => routeStages(r).includes(s.name) && routeView(r).active !== false).length,
    retainedRelations: [...table.routes.values()].filter(r => routeStages(r).includes(s.name)).length})),
  run: {stage: stage.name, ...current.lastAttempt}, source: api,
  query: 'route relations (type=route) with route=subway, light_rail, tram or monorail, or route=train with service=commuter or urban, and their track ways, by region', license: 'ODbL-1.0',
  description: 'OpenStreetMap urban rail services (metro, light rail, tram, monorail and commuter rail routes) along the tracks they run on, for the Service view.'};
await writeFile(new URL('manifest.json', out), JSON.stringify(manifest, null, 2));
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `publish=true\nredeploy=${fetchedBoxes > 0}\n`);
console.log(JSON.stringify({...manifest, stages: undefined, progress: manifest.stages.map(s => `${s.name}:${s.completed ? 'done' : s.inProgress ? 'partial' : '-'}:${s.routes}`).join(' ')}));
