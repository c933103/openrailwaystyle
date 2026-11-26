// Which branch the site takes each dataset from (#330, step 8, C1/C3):
// the Overpass-built branch, or the branch an extract builder publishes from
// the Geofabrik working copies. Overpass is the default and the fallback, so
// a dataset can always go back to it.
//   node scripts/data-source.mjs resolve
// The choice is checked in: scripts/data-sources.json, a JSON object naming
// every dataset → "overpass" | "extract". A switch is therefore a reviewed
// change, and a pull request that makes it builds and checks the site on the
// new branch before anything deploys.
// The repository variable DATA_SOURCES, the same JSON object for some
// datasets, overrides the file for the datasets it names: an emergency
// switch back to Overpass needs no commit. Unset, it changes nothing.
// DATA_SOURCES_DRILL, a JSON list of datasets set to "extract" (site.yml's
// `drill` input), makes this run treat their extract branches as unusable,
// so the fallback can be exercised while every extract branch is complete.
// A dataset set to "extract" takes `<dataset>-extract-data` only when that
// branch exists and its source.json says the build is complete; otherwise it
// takes its Overpass branch, and the reason is reported. A configuration that
// names an unknown dataset or source fails, so a typo is never silently
// ignored.
// Writes DATA_BRANCH_<DATASET>=<branch> to $GITHUB_ENV for the staging steps,
// the choices to $GITHUB_STEP_SUMMARY, and data-sources.json (in $RUNNER_TEMP
// when set, so the checkout stays clean).
import {execFile} from 'node:child_process';
import {appendFile, readFile, writeFile} from 'node:fs/promises';
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

export const SOURCES_FILE = new URL('./data-sources.json', import.meta.url);
export const extractBranch = id => `${id}-extract-data`;
export const envName = id => `DATA_BRANCH_${id.toUpperCase().replaceAll('-', '_')}`;

export function parseConfig(text, name = 'DATA_SOURCES') {
  if (!String(text ?? '').trim()) return {};
  let config;
  try { config = JSON.parse(text); } catch (error) { throw new Error(`${name} is not JSON: ${error.message}`); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${name} must be a JSON object of dataset → source`);
  const ids = new Set(DATASETS.map(d => d.id));
  for (const [id, source] of Object.entries(config)) {
    if (!ids.has(id)) throw new Error(`${name} names an unknown dataset ${JSON.stringify(id)}; known: ${[...ids].join(', ')}`);
    if (!SOURCES.includes(source)) throw new Error(`${name} sets ${id} to ${JSON.stringify(source)}; use ${SOURCES.join(' or ')}`);
  }
  return config;
}

// The checked-in choice must name every dataset, so a new dataset, or a
// dataset dropped by mistake, is a decision rather than a silent default.
export function parseFile(text) {
  const name = 'scripts/data-sources.json';
  if (!String(text ?? '').trim()) throw new Error(`${name} is empty`);
  const config = parseConfig(text, name);
  const missing = DATASETS.map(d => d.id).filter(id => !Object.hasOwn(config, id));
  if (missing.length) throw new Error(`${name} must name every dataset; missing: ${missing.join(', ')}`);
  return config;
}

// Each dataset's setting and where it came from: the variable where it names
// the dataset, else the file.
export function settings(file, override = {}) {
  return Object.fromEntries(DATASETS.map(({id}) => [id, Object.hasOwn(override, id)
    ? {source: override[id], setBy: 'variable'}
    : {source: file[id] || 'overpass', setBy: Object.hasOwn(file, id) ? 'file' : 'default'}]));
}

// The drill's datasets: known, and each set to "extract" (a drill on a
// dataset already on Overpass would show nothing).
export function parseDrill(text, chosen) {
  if (!String(text ?? '').trim()) return [];
  let drill;
  try { drill = JSON.parse(text); } catch (error) { throw new Error(`DATA_SOURCES_DRILL is not JSON: ${error.message}`); }
  if (!Array.isArray(drill) || !drill.length) throw new Error('DATA_SOURCES_DRILL must be a nonempty JSON list of datasets');
  for (const id of drill) {
    if (!Object.hasOwn(chosen, id)) throw new Error(`DATA_SOURCES_DRILL names an unknown dataset ${JSON.stringify(id)}`);
    if (chosen[id].source !== 'extract') throw new Error(`DATA_SOURCES_DRILL names ${id}, which is set to ${chosen[id].source}; a drill needs a dataset set to extract`);
  }
  return drill;
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
// `chosen` is settings()' result; `drill` lists datasets whose extract branch
// this run treats as unusable.
export async function resolve(chosen, {lsRemote, readMarker}, drill = []) {
  const choices = [];
  for (const {id, overpassBranch} of DATASETS) {
    const setting = chosen[id] ?? {source: 'overpass', setBy: 'default'};
    const configured = setting.source;
    const fallback = reason => ({id, configured, setBy: setting.setBy, source: 'overpass', branch: overpassBranch, reason});
    if (configured === 'overpass') { choices.push(fallback('configured')); continue; }
    const branch = extractBranch(id);
    if (drill.includes(id)) { choices.push(fallback(`fell back: drill: ${branch} treated as unusable for this run`)); continue; }
    const status = await lsRemote(branch);
    if (status === 2) { choices.push(fallback(`fell back: no branch ${branch}`)); continue; }
    if (status !== 0) { choices.push(fallback(`fell back: looking up ${branch} failed (git exit ${status})`)); continue; }
    let text;
    try { text = await readMarker(branch); } catch (error) { choices.push(fallback(`fell back: ${branch} has no readable source.json (${String(error.message || error).split('\n')[0]})`)); continue; }
    const problem = checkMarker(text, id);
    choices.push(problem ? fallback(`fell back: ${branch}: ${problem}`) : {id, configured, setBy: setting.setBy, source: 'extract', branch, reason: 'configured', osmTimestamp: JSON.parse(text).osmTimestamp});
  }
  return choices;
}

export const envLines = choices => choices.map(c => `${envName(c.id)}=${c.branch}\n`).join('');

export function summary(choices) {
  const rows = choices.map(c => `| ${c.id} | ${c.configured} | ${c.setBy} | ${c.source} | \`${c.branch}\` | ${c.reason} |`);
  const fallbacks = choices.filter(c => c.reason.startsWith('fell back'));
  return ['## Data sources', '', ...(fallbacks.length ? [`**${fallbacks.length} dataset(s) fell back to Overpass.**`, ''] : []),
    '| Dataset | Configured | Set by | Used | Branch | Why |', '| --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv[2] !== 'resolve') throw new Error('Usage: data-source.mjs resolve');
  const git = promisify(execFile);
  const chosen = settings(parseFile(await readFile(SOURCES_FILE, 'utf8')), parseConfig(process.env.DATA_SOURCES));
  const drill = parseDrill(process.env.DATA_SOURCES_DRILL, chosen);
  const choices = await resolve(chosen, {
    lsRemote: async branch => {
      try { await git('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch]); return 0; }
      catch (error) { return typeof error.code === 'number' ? error.code : -1; }
    },
    readMarker: async branch => {
      await git('git', ['fetch', '--depth=1', 'origin', `refs/heads/${branch}`]);
      return (await git('git', ['show', 'FETCH_HEAD:source.json'])).stdout;
    },
  }, drill);
  if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, envLines(choices));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary(choices));
  await writeFile(join(process.env.RUNNER_TEMP || '.', 'data-sources.json'), `${JSON.stringify(choices, null, 2)}\n`);
  process.stdout.write(summary(choices));
}
