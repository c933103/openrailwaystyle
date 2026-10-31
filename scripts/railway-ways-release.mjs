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
//   node scripts/railway-ways-release.mjs load <directory>
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

const gh = (...args) => execFileSync('gh', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
function assets() {
  try { return JSON.parse(gh('release', 'view', RELEASE, '--json', 'assets')).assets.map(asset => asset.name); }
  catch (error) {
    // No release yet is the first run; anything else stops, so an unreachable
    // store is never taken for an empty one.
    if (/release not found/i.test(String(error.stderr))) return null;
    throw error;
  }
}
function downloader(directory) {
  const cache = new Map();
  return name => {
    if (!cache.has(name)) {
      gh('release', 'download', RELEASE, '--pattern', name, '--dir', directory, '--clobber');
      cache.set(name, JSON.parse(readFileSync(join(directory, name), 'utf8')));
    }
    return cache.get(name);
  };
}

export function load(directory) {
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
    gh('release', 'download', RELEASE, '--pattern', archive, '--dir', work, '--clobber');
    execFileSync('tar', ['--zstd', '-xf', join(work, archive), '-C', directory]);
  }
  writeFileSync(join(directory, 'state.json'), JSON.stringify(found.state));
  console.log(`Loaded ${found.name}`);
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `PREVIOUS_DATA=${resolve(directory)}\n`);
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
  for (const name of obsoleteAssets(all, keep, read)) gh('release', 'delete-asset', RELEASE, name, '--yes');
  return {stateName, state};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory] = process.argv.slice(2);
  if (command === 'load') load(directory);
  else if (command === 'publish') publish(directory, process.env.GENERATION || `${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}-${process.env.GITHUB_RUN_ID || 0}`);
  else throw new Error('Usage: railway-ways-release.mjs load|publish <directory>');
}
