// Keeps the railway-ways store (build-railway-ways.mjs) as the assets of the
// railway-ways-store release, one consistent generation at a time.
//
// Nothing is replaced in place (an upload with --clobber deletes the old
// asset first, so a failed upload would lose it): every run uploads new,
// generation-named assets, the stage archive it changed and then its state,
// which names every stage's archive. Loading takes the newest state whose
// archives are all present, so a run that stopped half way leaves the
// previous generation in use. Older generations are deleted only after the
// new state is uploaded; the previous one is kept as well.
//
//   node scripts/railway-ways-release.mjs load <directory> [VARIABLE]
//     (VARIABLE, PREVIOUS_DATA by default, names the directory in GITHUB_ENV)
//   node scripts/railway-ways-release.mjs publish <store directory>
import {execFileSync} from 'node:child_process';
import {appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const RELEASE = 'railway-ways-store';
const STATE = /^state-(\d{8}T\d{6}Z-\d+)\.json$/;

// The newest state whose archives are all among the release's assets.
export function usableState(names, readState) {
  const present = new Set(names);
  for (const name of names.filter(name => STATE.test(name)).sort().reverse()) {
    const state = readState(name);
    if (Object.values(state.archives || {}).every(archive => present.has(archive))) return {name, state};
  }
  return null;
}

// Assets no longer needed once `keep` (the newest state names, newest first)
// are in place: older states, and archives none of the kept states names.
export function obsoleteAssets(names, keep, readState) {
  const kept = new Set(keep);
  for (const name of keep) for (const archive of Object.values(readState(name).archives || {})) kept.add(archive);
  return names.filter(name => !kept.has(name) && (STATE.test(name) || /^stage-.+\.tar\.zst$/.test(name)));
}

export const gh = (...args) => execFileSync('gh', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
// GitHub has answered 404 for this release while it existed (run
// 41644692570, 2026-11-03: "release not found" 8 s after the release was
// read). gh reports that as "release not found", the same words as a
// release that was never made. A request answered so is asked again after
// RETRY_MS, up to RETRIES times.
const NOT_FOUND = /release not found/i;
const setting = (name, fallback) => { const n = Number(process.env[name] ?? fallback); return Number.isSafeInteger(n) && n >= 0 ? n : fallback; };
export const RETRIES = setting('RAILWAY_WAYS_RELEASE_RETRIES', 2), RETRY_MS = setting('RAILWAY_WAYS_RELEASE_RETRY_MS', 15_000);
export const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function ghRetrying(...args) {
  for (let attempt = 0; ; attempt++) {
    try { return gh(...args); }
    catch (error) {
      if (!NOT_FOUND.test(String(error.stderr)) || attempt >= RETRIES) throw error;
      console.warn(`gh ${args.slice(0, 2).join(' ')}: release not found; asking again in ${RETRY_MS / 1000} s`);
      pause(RETRY_MS);
    }
  }
}
// The asset names of a release (scripts/extract-release.mjs keeps its store
// the same way), or null when there is no release yet.
export function releaseAssets(release) {
  try { return JSON.parse(ghRetrying('release', 'view', release, '--json', 'assets')).assets.map(asset => asset.name); }
  catch (error) {
    // No release yet is the first run, but only when the release list agrees:
    // taking a store that exists for an empty one would start every stage
    // again from Overpass. Anything else stops, so an unreachable store is
    // never taken for an empty one either.
    if (!NOT_FOUND.test(String(error.stderr))) throw error;
    const tags = JSON.parse(gh('release', 'list', '--limit', '1000', '--json', 'tagName')).map(release => release.tagName);
    if (tags.includes(release)) throw new Error(`${release} is listed but cannot be read; not starting from an empty store`);
    return null;
  }
}
const assets = () => releaseAssets(RELEASE);
function downloader(directory) {
  const cache = new Map();
  return name => {
    if (!cache.has(name)) {
      ghRetrying('release', 'download', RELEASE, '--pattern', name, '--dir', directory, '--clobber');
      cache.set(name, JSON.parse(readFileSync(join(directory, name), 'utf8')));
    }
    return cache.get(name);
  };
}

export function load(directory, variable = 'PREVIOUS_DATA') {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(variable)) throw new Error(`Invalid variable name ${variable}`);
  const names = assets();
  if (!names) { console.log('No stored regions yet: the first run'); return null; }
  const work = mkdtempSync(join(tmpdir(), 'railway-ways-release-'));
  const found = usableState(names, downloader(work));
  if (!found) {
    if (names.some(name => STATE.test(name))) throw new Error('No stored state has all its archives');
    console.log('No stored regions yet: the first run');
    return null;
  }
  mkdirSync(directory, {recursive: true});
  for (const archive of Object.values(found.state.archives || {})) {
    ghRetrying('release', 'download', RELEASE, '--pattern', archive, '--dir', work, '--clobber');
    execFileSync('tar', ['--zstd', '-xf', join(work, archive), '-C', directory]);
  }
  writeFileSync(join(directory, 'state.json'), JSON.stringify(found.state));
  console.log(`Loaded ${found.name}`);
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${variable}=${resolve(directory)}\n`);
  return found;
}

export function publish(store, generation) {
  if (!/^\d{8}T\d{6}Z-\d+$/.test(generation)) throw new Error(`Invalid generation ${generation}`);
  let names = assets();
  if (!names) {
    gh('release', 'create', RELEASE, '--prerelease', '--title', 'Stored railway-ways regions', '--notes',
      'Raw OpenStreetMap Overpass responses (ODbL), one per region, for branch lines, urban service routes and power-delivery methods. A cache that can be downloaded again; see docs/data-maintenance.md.');
    names = [];
  }
  const state = JSON.parse(readFileSync(join(store, 'state.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(store, 'manifest.json'), 'utf8'));
  state.archives ||= {};
  const stage = manifest.run?.stage;
  const work = mkdtempSync(join(tmpdir(), 'railway-ways-release-'));
  if (stage) {
    const paths = [`regions/${stage}`, `next/${stage}`].filter(path => existsSync(join(store, path)));
    if (paths.length) {
      const archive = `stage-${stage}-${generation}.tar.zst`;
      execFileSync('tar', ['--zstd', '-cf', join(work, archive), '-C', store, ...paths]);
      gh('release', 'upload', RELEASE, join(work, archive));
      state.archives[stage] = archive;
    } else delete state.archives[stage];
  }
  // The state goes up after the archive it names.
  const stateName = `state-${generation}.json`;
  writeFileSync(join(work, stateName), JSON.stringify(state));
  gh('release', 'upload', RELEASE, join(work, stateName));
  console.log(`Published ${stateName}`);
  // Keep this generation and the previous usable one; delete the rest.
  const all = [...names, stateName];
  const read = downloader(work);
  const previous = usableState(names, read);
  const keep = [stateName, ...(previous ? [previous.name] : [])];
  // Removing old generations is clean-up: the new state is already up and
  // names everything it needs. A deletion GitHub refuses (HTTP 502 in run
  // 41808912606) is asked again once, then left for the next publication,
  // which finds the asset obsolete again; it never fails the run, since a
  // failed run leaves the dataset due and starts another Overpass download.
  const left = [];
  for (const name of obsoleteAssets(all, keep, read)) {
    for (let attempt = 0; ; attempt++) {
      try { gh('release', 'delete-asset', RELEASE, name, '--yes'); break; }
      catch (error) {
        if (attempt < 1) { pause(RETRY_MS); continue; }
        left.push(name);
        console.log(`::warning::Could not delete old asset ${name} (${String(error.stderr || error.message).trim()}); the next publication removes it`);
        break;
      }
    }
  }
  if (left.length) console.log(`Left ${left.length} old assets for the next publication`);
  return {stateName, state};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory, variable] = process.argv.slice(2);
  if (command === 'load') load(directory, variable);
  else if (command === 'publish') publish(directory, process.env.GENERATION || `${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}-${process.env.GITHUB_RUN_ID || 0}`);
  else throw new Error('Usage: railway-ways-release.mjs load <directory> [VARIABLE] | publish <directory>');
}
