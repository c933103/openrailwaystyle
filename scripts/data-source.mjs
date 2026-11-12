// Which branch the site takes each dataset from (#330, step 8, C1/C3):
// the Overpass-built branch, or the branch an extract builder publishes from
// the Geofabrik working copies. Overpass is the default and the fallback, so
// a dataset can always go back to it.
//   DATA_SOURCES='{"heritage":"extract"}' node scripts/data-source.mjs resolve
// DATA_SOURCES is the repository variable of the same name: a JSON object of
// dataset → "overpass" | "extract"; datasets not named stay on Overpass.
// A dataset set to "extract" takes `<dataset>-extract-data` only when that
// branch exists and its source.json says the build is complete; otherwise it
// takes its Overpass branch, and the reason is reported. A configuration that
// names an unknown dataset or source fails, so a typo is never silently
// ignored.
// Writes DATA_BRANCH_<DATASET>=<branch> to $GITHUB_ENV for the staging steps,
// the choices to $GITHUB_STEP_SUMMARY, and data-sources.json (in $RUNNER_TEMP
// when set, so the checkout stays clean).
import {execFile} from 'node:child_process';
import {appendFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';

export const DATASETS = Object.freeze([
  ['lifecycle', 'rail-data'],
  ['traction', 'traction-data'],
  ['axle-load', 'axle-data'],
  ['street-running', 'street-data'],
  ['station-points', 'station-points-data'],
  ['crossings', 'crossing-data'],
  ['conveying', 'conveying-data'],
  ['aerialways', 'aerialway-data'],
  ['heritage', 'heritage-data'],
  ['branch-lines', 'branch-data'],
  ['service-routes', 'service-data'],
].map(([id, overpassBranch]) => Object.freeze({id, overpassBranch})));
export const SOURCES = Object.freeze(['overpass', 'extract']);

export const extractBranch = id => `${id}-extract-data`;
export const envName = id => `DATA_BRANCH_${id.toUpperCase().replaceAll('-', '_')}`;

export function parseConfig(text) {
  if (!String(text ?? '').trim()) return {};
  let config;
  try { config = JSON.parse(text); } catch (error) { throw new Error(`DATA_SOURCES is not JSON: ${error.message}`); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('DATA_SOURCES must be a JSON object of dataset → source');
  const ids = new Set(DATASETS.map(d => d.id));
  for (const [id, source] of Object.entries(config)) {
    if (!ids.has(id)) throw new Error(`DATA_SOURCES names an unknown dataset ${JSON.stringify(id)}; known: ${[...ids].join(', ')}`);
    if (!SOURCES.includes(source)) throw new Error(`DATA_SOURCES sets ${id} to ${JSON.stringify(source)}; use ${SOURCES.join(' or ')}`);
  }
  return config;
}

// The extract branch's own statement that it holds a complete build of
// this dataset; null when it does, else why not.
export function checkMarker(text, id) {
  let marker;
  try { marker = JSON.parse(text); } catch { return 'its source.json is not JSON'; }
  if (!marker || typeof marker !== 'object') return 'its source.json is not an object';
  if (marker.schema !== 1) return `its source.json has schema ${JSON.stringify(marker.schema)}, not 1`;
  if (marker.dataset !== id) return `its source.json is for ${JSON.stringify(marker.dataset)}`;
  if (marker.source !== 'extract') return `its source.json names source ${JSON.stringify(marker.source)}`;
  if (marker.complete !== true) return 'its build is not complete';
  if (typeof marker.osmTimestamp !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(marker.osmTimestamp) || !Number.isFinite(Date.parse(marker.osmTimestamp))) return 'its source.json has no valid osmTimestamp';
  return null;
}

// lsRemote(branch) → git's exit status (0 found, 2 absent, else failed);
// readMarker(branch) → the branch's source.json text, or throws.
export async function resolve(config, {lsRemote, readMarker}) {
  const choices = [];
  for (const {id, overpassBranch} of DATASETS) {
    const configured = config[id] || 'overpass';
    const fallback = reason => ({id, configured, source: 'overpass', branch: overpassBranch, reason});
    if (configured === 'overpass') { choices.push(fallback('configured')); continue; }
    const branch = extractBranch(id);
    const status = await lsRemote(branch);
    if (status === 2) { choices.push(fallback(`fell back: no branch ${branch}`)); continue; }
    if (status !== 0) { choices.push(fallback(`fell back: looking up ${branch} failed (git exit ${status})`)); continue; }
    let text;
    try { text = await readMarker(branch); } catch (error) { choices.push(fallback(`fell back: ${branch} has no readable source.json (${String(error.message || error).split('\n')[0]})`)); continue; }
    const problem = checkMarker(text, id);
    choices.push(problem ? fallback(`fell back: ${branch}: ${problem}`) : {id, configured, source: 'extract', branch, reason: 'configured', osmTimestamp: JSON.parse(text).osmTimestamp});
  }
  return choices;
}

export const envLines = choices => choices.map(c => `${envName(c.id)}=${c.branch}\n`).join('');

export function summary(choices) {
  const rows = choices.map(c => `| ${c.id} | ${c.configured} | ${c.source} | \`${c.branch}\` | ${c.reason} |`);
  const fallbacks = choices.filter(c => c.reason.startsWith('fell back'));
  return ['## Data sources', '', ...(fallbacks.length ? [`**${fallbacks.length} dataset(s) fell back to Overpass.**`, ''] : []),
    '| Dataset | Configured | Used | Branch | Why |', '| --- | --- | --- | --- | --- |', ...rows, ''].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv[2] !== 'resolve') throw new Error('Usage: data-source.mjs resolve');
  const git = promisify(execFile);
  const config = parseConfig(process.env.DATA_SOURCES);
  const choices = await resolve(config, {
    lsRemote: async branch => {
      try { await git('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch]); return 0; }
      catch (error) { return typeof error.code === 'number' ? error.code : -1; }
    },
    readMarker: async branch => {
      await git('git', ['fetch', '--depth=1', 'origin', `refs/heads/${branch}`]);
      return (await git('git', ['show', 'FETCH_HEAD:source.json'])).stdout;
    },
  });
  if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, envLines(choices));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary(choices));
  await writeFile(join(process.env.RUNNER_TEMP || '.', 'data-sources.json'), `${JSON.stringify(choices, null, 2)}\n`);
  process.stdout.write(summary(choices));
}
