// Maintenance only: visitors never query Overpass. Downloads the merged
// railway-ways response (scripts/railway-ways.mjs: branch lines, urban
// service routes and power-delivery methods in one request) stage by stage
// and keeps each region's response, so the three datasets can be built from
// the stored regions instead of three overlapping downloads.
//
// The stages, their order and the pacing are the branch lines' (one stage
// per run, a byte budget per run and per day, a refresh every REFRESH_DAYS).
// A region that exceeds the server's limits is split into quarters, and the
// next pass of the stage starts from the regions this one fetched. A stage's
// stored regions are replaced only when its new pass is complete; until then
// the previous pass's regions stay (`regions/` and `next/`).
import {mkdir, readFile, readdir, rename, rm, writeFile, cp} from 'node:fs/promises';
import {gzipSync, gunzipSync} from 'node:zlib';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {STAGES, selectDownloadStage, startStagePass, recordStageRegion, finishStagePass} from './download-stages.mjs';
import {quarters, toFeatures} from './branch-lines.mjs';
import {toTable} from './service-routes.mjs';
import {powerMethodsGeoJSON} from './power-method-data.mjs';
import {railwayWaysQuery, branchView, serviceView, powerView} from './railway-ways.mjs';

export const RAILWAY_WAYS_VERSION = 1;
export const regionKey = item => `${item.part}_${item.box.join('_')}`;
const iso = now => new Date(now()).toISOString().replace(/\.\d+Z$/, 'Z');

// Every dataset must accept a response before it is stored: a malformed or
// partial one never replaces a region.
export function validRailwayWays(json) {
  toFeatures(branchView(json));
  toTable(serviceView(json));
  powerMethodsGeoJSON(powerView(json));
  return json;
}

export async function buildRailwayWays({
  api = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  previous = process.env.PREVIOUS_DATA, output = process.env.RAILWAY_WAYS_OUTPUT || 'railway-ways-data',
  runBudget = Number(process.env.BUDGET_BYTES || 220_000_000), dayBudget = Number(process.env.DAY_BUDGET_BYTES || 900_000_000),
  refreshDays = Number(process.env.REFRESH_DAYS || 14), timeBudgetMs = Number(process.env.TIME_BUDGET_MINUTES || 100) * 60000,
  fetcher = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, log = console.log, warn = console.warn,
} = {}) {
  const started = now();
  // Start from the published store, never from nothing when one exists but
  // cannot be read (a fresh store would drop every stored region).
  await rm(output, {recursive: true, force: true});
  let state = {version: RAILWAY_WAYS_VERSION, stages: {}, runs: []};
  if (previous) {
    try {
      state = JSON.parse(await readFile(join(previous, 'state.json'), 'utf8'));
      if (state.version !== RAILWAY_WAYS_VERSION) throw new Error(`unknown store version ${state.version}`);
      await cp(previous, output, {recursive: true});
    } catch (error) { throw new Error(`The previous railway-ways store could not be read: ${error.message}`); }
  }
  await mkdir(output, {recursive: true});
  state.runs = (state.runs || []).filter(run => started - Date.parse(run.at) < 86400_000);
  const budget = Math.min(runBudget, dayBudget - state.runs.reduce((sum, run) => sum + run.bytes, 0));
  let downloaded = 0, requests = 0, fetched = 0, split = 0, stopped = null;
  const finish = async (stage, current) => {
    state.runs.push({at: iso(now), bytes: downloaded});
    if (current) current.lastAttempt = {at: iso(now), status: !current.pending?.length ? 'acquired' : fetched ? 'partial' : 'deferred',
      reason: stopped, fetchedBoxes: fetched, splitBoxes: split, requests, downloadedBytes: downloaded};
    await writeFile(join(output, 'state.json'), JSON.stringify(state));
    const manifest = {version: RAILWAY_WAYS_VERSION, generated: iso(now), source: api, license: 'ODbL-1.0',
      description: 'Raw OpenStreetMap responses, one per region, for branch lines, urban service routes and power-delivery methods (scripts/railway-ways.mjs).',
      stages: STAGES.map(s => ({name: s.name, completed: state.stages[s.name]?.completed || null, inProgress: Boolean(state.stages[s.name]?.pending?.length),
        regions: state.stages[s.name]?.leaves?.regions?.length || 0})),
      run: stage ? {stage: stage.name, ...current.lastAttempt} : null};
    await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
    log(JSON.stringify(manifest.run));
    return manifest;
  };
  if (budget < 10_000_000) { log('Daily download allowance used; waiting for a later run.'); return finish(null); }
  const stage = selectDownloadStage(state, {refreshDays, now: now()});
  if (!stage) { log('Every stage is current; nothing to fetch.'); return finish(null); }
  const current = state.stages[stage.name] ||= {completed: null, pending: null, seen: []};
  const nextDir = join(output, 'next', stage.name), regionsDir = join(output, 'regions', stage.name);
  if (!current.pending?.length) {
    startStagePass(current, stage);
    current.started = iso(now);
    await rm(nextDir, {recursive: true, force: true});
  }
  await mkdir(nextDir, {recursive: true});
  log(`Stage ${stage.name} (${stage.label}): ${current.pending.length} region(s) to fetch`);

  const BUDGET = Symbol('budget');
  async function overpass(query) {
    let lastFailure;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (downloaded >= budget) return BUDGET;
      await sleep(attempt ? 60000 * attempt : requests ? 15000 : 0);
      requests++;
      try {
        const response = await fetcher(api, {method: 'POST', body: new URLSearchParams({data: query}), signal: AbortSignal.timeout(300000),
          headers: {'User-Agent': 'RailwayAtlas-railway-ways/1.0 (+https://github.com/c933103/openrailwaystyle)'}});
        const chunks = [], fresh = fetched + split === 0;
        let received = 0, over = false;
        for await (const chunk of response.body) {
          received += chunk.length; downloaded += chunk.length;
          if (downloaded > budget) { over = true; break; }
          chunks.push(chunk);
        }
        if (over) {
          await response.body.cancel?.().catch(() => {});
          // Only a successful response larger than a whole run's allowance
          // shows the region itself is too large.
          return response.ok && fresh && received > runBudget ? null : BUDGET;
        }
        const text = Buffer.concat(chunks).toString();
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
        return validRailwayWays(JSON.parse(text));
      } catch (error) {
        lastFailure = error.message;
        warn(`Overpass attempt ${attempt + 1}/5: ${lastFailure}`);
        if (/Dispatcher|too busy|rate_limited|HTTP 429|HTTP 503/i.test(lastFailure)) continue;
        // A query that ran out of time or memory needs a smaller area.
        if (/timed? ?out|timeout|memory|maxsize|HTTP 504|Unexpected end|JSON/i.test(lastFailure)) return null;
      }
    }
    throw new Error(`Overpass stayed unavailable: ${lastFailure}`);
  }

  while (current.pending.length) {
    if (downloaded >= budget) { stopped = `download budget reached (${downloaded} bytes)`; break; }
    if (now() - started > timeBudgetMs) { stopped = 'time budget reached'; break; }
    const item = current.pending[0], part = stage.parts[item.part];
    let json;
    try { json = await overpass(railwayWaysQuery(part, item.box)); } catch (error) { stopped = error.message; break; }
    if (json === BUDGET) { stopped = `download budget reached (${downloaded} bytes)`; break; }
    current.pending.shift();
    if (!json) {
      if ((item.depth || 0) >= 6) { current.pending.unshift(item); stopped = `could not fetch region ${item.box}`; break; }
      current.pending.unshift(...quarters(item.box).map(box => ({part: item.part, box, depth: (item.depth || 0) + 1})));
      split++;
      continue;
    }
    // Retain each completed region at once: a stopped run resumes after it.
    await writeFile(join(nextDir, `${regionKey(item)}.json.gz`), gzipSync(JSON.stringify({version: RAILWAY_WAYS_VERSION, stage: stage.name,
      part: item.part, box: item.box, depth: item.depth || 0, query: railwayWaysQuery(part, item.box), generated: iso(now), response: json}), {level: 9}));
    recordStageRegion(current, item);
    fetched++;
    log(`Region ${item.box.join(',')}: ${json.elements.length} elements; ${downloaded} bytes, ${requests} requests this run`);
  }
  if (!current.pending.length) {
    // The complete pass replaces the stage's stored regions.
    await rm(regionsDir, {recursive: true, force: true});
    await mkdir(join(output, 'regions'), {recursive: true});
    await rename(nextDir, regionsDir);
    finishStagePass(current, stage);
    Object.assign(current, {completed: iso(now), pending: null});
    log(`Stage ${stage.name} complete: ${(await readdir(regionsDir)).length} regions`);
  } else log(`Stage ${stage.name} continues next run (${current.pending.length} region(s) left): ${stopped}`);
  return finish(stage, current);
}

// The stored regions of every stage, for the datasets built from them.
export async function* storedRegions(store) {
  for (const stage of STAGES) {
    const dir = join(store, 'regions', stage.name);
    let names = [];
    try { names = (await readdir(dir)).filter(name => name.endsWith('.json.gz')).sort(); } catch {}
    for (const name of names) yield JSON.parse(gunzipSync(await readFile(join(dir, name))));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildRailwayWays();
