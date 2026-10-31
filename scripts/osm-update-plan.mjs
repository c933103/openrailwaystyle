// One scheduler for every Overpass-based dataset (osm-updates.yml). The public
// Overpass server asks regular users not to run several scripts in parallel,
// and GitHub starts scheduled runs hours late or skips them, so separate cron
// lines cannot keep the workflows apart. The scheduler starts the due
// workflows one after another instead.
//
// A dataset is due when its latest successful run on main started before its
// most recent due time, so a run GitHub starts late or
// skips is caught up by the next one instead of being lost. A dataset also
// runs when one of its builder files changed since the commit its last
// successful run used, so no builder change is missed, whenever it was pushed.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

// Order is the run order. `every` runs on each scheduler run (every 6 hours);
// `weekly` on the given UTC weekdays (0 = Sunday) from the given hour;
// `monthly` on the given day of the month from the given hour. `paths` are the
// builder files whose change also starts the dataset (the workflows
// themselves have no push trigger, so a rebuild queues here too). A
// workflow's own file and widely shared files such as styles/map-model.mjs
// (touched by every asset-version bump) are left out on purpose: those
// rebuilds are started by hand.
const STAGES = ['scripts/download-stages.mjs', 'scripts/overpass-errors.mjs'];
export const OSM_UPDATES = Object.freeze([
  {id:'lifecycle', workflow:'snapshot.yml', due:{weekly:[1,5], hour:3}, inputs:{refresh:'true'},
    paths:['scripts/build-snapshot.mjs', 'styles/pbf-utf8.mjs', 'scripts/lifecycle.mjs', 'scripts/snapshot-delta.mjs',
      'scripts/refresh-snapshot-cache.mjs', 'scripts/build-loading-gauge-list.mjs', 'styles/loading-gauge-list.mjs',
      'scripts/build-polar.mjs', 'scripts/polar-depth.mjs', 'styles/bathymetry.mjs', 'scripts/polar-contours.mjs',
      'scripts/polar-features.mjs', 'styles/polar.mjs', 'scripts/pack-snapshot.py']},
  {id:'crossings', workflow:'crossings.yml', due:{weekly:[0], hour:3},
    paths:['scripts/build-crossings.mjs', 'scripts/crossing-data.mjs', 'scripts/crossing-checkpoint.mjs', 'styles/pbf-utf8.mjs', 'styles/crossing-tags.mjs']},
  {id:'street-running', workflow:'street-running.yml', due:{weekly:[0], hour:3},
    paths:['scripts/build-street-running.mjs', 'styles/pbf-utf8.mjs', 'styles/street-running.mjs']},
  {id:'conveying', workflow:'conveying.yml', due:{weekly:[0], hour:3},
    paths:['scripts/build-conveying.mjs', 'scripts/conveying-data.mjs', 'styles/conveying.mjs']},
  {id:'aerialways', workflow:'aerialways.yml', due:{weekly:[0], hour:3},
    paths:['scripts/build-aerialways.mjs', 'scripts/conveying-data.mjs', 'styles/conveying.mjs']},
  {id:'heritage', workflow:'heritage.yml', due:{monthly:3, hour:21},
    paths:['scripts/build-heritage.mjs', 'scripts/heritage-data.mjs', 'styles/pbf-utf8.mjs', 'styles/tile-bundles.mjs']},
  {id:'station-points', workflow:'station-points.yml', due:{every:true},
    paths:['scripts/station-overview.mjs', 'scripts/station-acquisition.mjs', 'scripts/build-station-snapshot.mjs', 'styles/tile-bundles.mjs']},
  {id:'branch-lines', workflow:'branch-lines.yml', due:{every:true},
    paths:[...STAGES, 'scripts/build-branch-lines.mjs', 'scripts/branch-lines.mjs', 'styles/pbf-utf8.mjs']},
  {id:'service-routes', workflow:'service-routes.yml', due:{every:true},
    paths:[...STAGES, 'scripts/maintain-data-workflows.mjs', 'scripts/timetable-frequency.mjs', 'scripts/timetable-frequency-version.mjs',
      'scripts/timetable-operator-bindings.mjs', 'scripts/timetable-operator-bindings.json', 'scripts/service-acquisition-trigger.mjs',
      '.github/workflows/service-frequency.yml', 'scripts/build-service-routes.mjs', 'scripts/service-routes.mjs',
      'scripts/service-geometry.mjs', 'scripts/service-geometry-health.mjs', 'scripts/branch-lines.mjs', 'styles/pbf-utf8.mjs']},
].map(entry => Object.freeze({...entry, paths:Object.freeze(entry.paths)})));
// Every builder path, for the scheduler's push filter.
export const OSM_UPDATE_PATHS = Object.freeze([...new Set(OSM_UPDATES.flatMap(entry => entry.paths))].sort());

// The most recent due time at or before `now`, or null for every-run datasets.
export function lastDueTime(due, now) {
  if (due.every) return null;
  const at = (date, day) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), day, due.hour);
  if (due.weekly) {
    for (let back = 0; back <= 7; back++) {
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
      const time = at(day, day.getUTCDate());
      if (due.weekly.includes(day.getUTCDay()) && time <= now.getTime()) return new Date(time);
    }
    throw new Error('Weekly due time not found');
  }
  if (due.monthly) {
    const thisMonth = at(now, due.monthly);
    if (thisMonth <= now.getTime()) return new Date(thisMonth);
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, due.monthly, due.hour));
  }
  throw new Error('Unknown due rule');
}

// lastRuns: id -> {started: ISO start time, sha: commit} of the latest
// successful run on main (absent when there is none). rebuilt: ids whose
// builder files changed since that commit.
export function dueUpdates(now, lastRuns, {only = 'due', rebuilt = []} = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid time');
  if (only !== 'due' && only !== 'all' && !OSM_UPDATES.some(entry => entry.id === only)) throw new Error(`Unknown dataset: ${only}`);
  return OSM_UPDATES.filter(entry => {
    if (only === 'all') return true;
    if (only !== 'due') return entry.id === only;
    if (rebuilt.includes(entry.id)) return true;
    const dueAt = lastDueTime(entry.due, now);
    if (!dueAt) return true;
    const last = Date.parse(lastRuns[entry.id]?.started ?? '');
    return !Number.isFinite(last) || last < dueAt.getTime();
  }).map(({id, workflow, inputs = {}}) => ({id, workflow, inputs: Object.entries(inputs).map(([k, v]) => `${k}=${v}`).join(' ')}));
}

export async function latestRun(repo, token, workflow) {
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?branch=main&status=success&per_page=30`;
  const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: {authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28'}});
  if (!response.ok) throw new Error(`${workflow}: HTTP ${response.status}`);
  const {workflow_runs: runs} = await response.json();
  if (!Array.isArray(runs)) throw new Error(`${workflow}: invalid run list`);
  // Any successful run counts, including one started by a builder change on
  // main: it refreshed the data too, so it should not trigger another download.
  const run = runs[0];
  return run && {started: run.run_started_at || run.created_at, sha: run.head_sha};
}

// Whether any of `paths` differs between the commit a dataset last ran on and
// the current one. The old commit is fetched alone when the checkout lacks it.
export function builderChanged(sha, head, paths, git = (...args) => execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 2_000_000})) {
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^[a-f0-9]{40}$/.test(head || '')) throw new Error('Invalid commit');
  if (sha === head) return false;
  try { git('cat-file', '-e', sha + '^{commit}'); }
  catch { git('fetch', '--depth=1', 'origin', sha); }
  return git('diff', '--name-only', sha, head, '--', ...paths).trim() !== '';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {GITHUB_REPOSITORY: repo, GH_TOKEN: token, GITHUB_OUTPUT: output, DATASET: only = 'due', GITHUB_SHA: head} = process.env;
  if (!repo || !token || !output || !head) throw new Error('Missing repository, token, commit or output');
  const lastRuns = {}, rebuilt = [];
  for (const entry of OSM_UPDATES) {
    lastRuns[entry.id] = await latestRun(repo, token, entry.workflow);
    if (lastRuns[entry.id] && builderChanged(lastRuns[entry.id].sha, head, entry.paths)) rebuilt.push(entry.id);
  }
  const runs = dueUpdates(new Date(), lastRuns, {only: only || 'due', rebuilt});
  for (const entry of OSM_UPDATES) {
    const last = lastRuns[entry.id];
    console.log(`${entry.id}: last success ${last ? `${last.started} at ${last.sha.slice(0, 9)}` : 'none'}${rebuilt.includes(entry.id) ? ', builder changed since' : ''}; ${runs.some(r => r.id === entry.id) ? 'run' : 'not due'}`);
  }
  await appendFile(output, `runs=${JSON.stringify(runs)}\n`);
}
