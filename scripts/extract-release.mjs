// The working copies of the extract pipeline (#330, B2/B3): one filtered PBF
// per planned Geofabrik region, kept as assets of the osm-extract release,
// with an index naming the current asset of every region.
//
// Regions refresh independently. A region measured and checked in this run
// (scripts/acquire-region-extract.mjs: size, MD5, replication timestamp, not
// older than its working copy, no more than 5% fewer objects) takes its new
// file; every other region, unchanged, failed, rejected or not measured,
// keeps its working copy, whatever its age.
//
// Nothing is replaced in place: a new file is a new, content-named asset
// (region-<key>-<date>-<sha256 prefix>.osm.pbf), the index naming it goes up
// after it (index-<generation>.json), and assets no kept index names are
// deleted only after that. Loading takes the newest index whose assets are
// all present, so a run that stopped half way leaves the previous index in
// use. The previous index is kept as well.
//
//   node scripts/extract-release.mjs load <index file>
//     writes the newest usable index there, or nothing on the first run
//   node scripts/extract-release.mjs publish <plan.json> <directory of extract outputs>
//     (one directory per region: extract.json, and filtered.osm.pbf when the
//     region was downloaded; failed.json when it failed)
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FILTER_HASH} from './acquire-region-extract.mjs';
import {GAP_FILTER_HASH} from './acquire-gap-tiles.mjs';
import {RETRY_MS, gh, ghRetrying, pause, releaseAssets} from './railway-ways-release.mjs';
import {regionKey} from './extract-run.mjs';

export const RELEASE = 'osm-extract';
const INDEX = /^index-(\d{8}T\d{6}Z-\d+)\.json$/;
const REGION = /^region-.+\.osm\.pbf$/;
const GENERATION = /^\d{8}T\d{6}Z-\d+$/;

export const assetName = (id, sourceDate, sha256) => `region-${regionKey(id)}-${sourceDate.replaceAll('-', '')}-${sha256.slice(0, 12)}.osm.pbf`;

// The newest index whose region assets are all among the release's assets.
export function usableIndex(names, readIndex) {
  const present = new Set(names);
  for (const name of names.filter(name => INDEX.test(name)).sort().reverse()) {
    const index = readIndex(name);
    if (Object.values(index.regions || {}).every(entry => present.has(entry.asset))) return {name, index};
  }
  return null;
}

// Assets no longer needed once the `keep` indexes are in place: other
// indexes, and region files none of the kept indexes names.
export function obsoleteAssets(names, keep, readIndex) {
  const kept = new Set(keep);
  for (const name of keep) for (const entry of Object.values(readIndex(name).regions || {})) kept.add(entry.asset);
  return names.filter(name => !kept.has(name) && (INDEX.test(name) || REGION.test(name)));
}

// Read whole: the largest filtered region measured is 69 MiB (#330).
const sha256File = path => createHash('sha256').update(readFileSync(path)).digest('hex');

// The next index from the previous one and this run's outputs. `outputs` are
// {dir, manifest, failed}; returns the index, the files to upload, and one
// line per region for the report. Pure apart from reading the filtered files.
// The filter a region's file must have been made with to be current: the
// osmium filter for a Geofabrik region, its Overpass form for a gap tile.
export const currentFilter = id => id.startsWith('gap/') ? GAP_FILTER_HASH : FILTER_HASH;

// The plan with the gap tiles (scripts/gap-tiles.mjs) as regions of their
// own, `gap/<tile key>`, each with its polygon.
export const withGaps = (plan, gaps) => !gaps?.tiles?.length ? plan
  : {...plan, regions: [...plan.regions, ...gaps.tiles.map(tile => ({id: `gap/${tile.key}`, kind: 'gap', polygon: tile.polygon}))]};

// Without this run's gap tiles, the stored ones stay planned, so they are
// kept, never dropped as no longer planned.
export const planWithGaps = (plan, gaps, previous) => withGaps(plan, gaps
  ?? {tiles: Object.keys(previous?.regions || {}).filter(id => id.startsWith('gap/')).map(id => ({key: id.slice(4), polygon: null}))});

export function nextIndex(plan, previous, outputs, generation, {hashFile = sha256File} = {}) {
  if (!GENERATION.test(generation)) throw new Error(`Invalid generation ${generation}`);
  if (plan?.valid !== true) throw new Error('The region plan is not valid');
  const planned = new Set(plan.regions.map(region => region.id));
  const regions = {...(previous?.regions || {})};
  const uploads = [], outcomes = new Map();
  for (const {dir, manifest, failed} of outputs) {
    const id = manifest?.region ?? failed?.region;
    if (!planned.has(id)) throw new Error(`Output for ${JSON.stringify(id)}, which the plan does not hold`);
    if (outcomes.has(id)) throw new Error(`Two outputs for ${id}`);
    const before = regions[id];
    if (failed || !manifest) { outcomes.set(id, {outcome: before ? 'kept' : 'missing', reason: failed?.error || 'no record'}); continue; }
    if (manifest.unchanged) {
      // The same file filtered the same way: the working copy stays.
      if (!before || before.sourceMd5 !== manifest.sourceMd5 || before.pbfBytes !== manifest.pbfBytes || before.filter !== manifest.filter) {
        outcomes.set(id, {outcome: before ? 'kept' : 'missing', reason: 'reported unchanged, but the working copy differs'});
        continue;
      }
      regions[id] = {...before, checkedDate: plan.sourceDate};
      outcomes.set(id, {outcome: 'unchanged'});
      continue;
    }
    // Checked again here, by the only writer: the file is the one measured,
    // made with the current filter, and not older than the working copy.
    const file = join(dir, 'filtered.osm.pbf');
    const problem = !existsSync(file) ? 'no filtered file'
      : manifest.filter !== currentFilter(id) ? `filter ${manifest.filter} is not the current ${currentFilter(id)}`
      : statSync(file).size !== manifest.filteredBytes ? 'filtered size does not match its record'
      : hashFile(file) !== manifest.filteredSha256 ? 'filtered SHA-256 does not match its record'
      : before?.sourceTimestamp && Date.parse(manifest.sourceTimestamp) < Date.parse(before.sourceTimestamp) ? `data from ${manifest.sourceTimestamp} is older than the working copy's ${before.sourceTimestamp}`
      : null;
    if (problem) { outcomes.set(id, {outcome: before ? 'kept' : 'missing', reason: problem}); continue; }
    const asset = assetName(id, manifest.sourceDate, manifest.filteredSha256);
    uploads.push({file, asset});
    regions[id] = {asset, region: id, sha256: manifest.filteredSha256, bytes: manifest.filteredBytes, sourceDate: manifest.sourceDate,
      checkedDate: manifest.sourceDate, sourceTimestamp: manifest.sourceTimestamp, url: manifest.url, sourceMd5: manifest.sourceMd5,
      pbfBytes: manifest.pbfBytes, counts: manifest.counts, filter: manifest.filter, ...(id.startsWith('gap/') ? {kind: 'gap'} : {})};
    outcomes.set(id, {outcome: 'updated'});
  }
  for (const id of planned) if (!outcomes.has(id)) outcomes.set(id, {outcome: regions[id] ? 'kept' : 'missing', reason: 'not measured'});
  // A region the plan no longer holds keeps its file until every planned
  // region has one, so a changed plan never leaves its area uncovered.
  const unplanned = Object.keys(regions).filter(id => !planned.has(id));
  const covered = [...planned].every(id => regions[id]);
  for (const id of unplanned) {
    if (covered) { delete regions[id]; outcomes.set(id, {outcome: 'dropped', reason: 'no longer planned'}); }
    else outcomes.set(id, {outcome: 'kept', reason: 'no longer planned; kept until every planned region has a file'});
  }
  // The polygon of each region's file, for the assembly. A file taken in
  // this run, or found unchanged (the same Geofabrik file, so the same
  // boundary), has the plan's polygon. A file kept from before keeps the
  // polygon it had, or none: a newer plan's polygon may cover more than that
  // file does, and the assembly would take objects missing there for deleted.
  const planPolygons = new Map(plan.regions.map(region => [region.id, region.polygon]));
  const current = id => ['updated', 'unchanged'].includes(outcomes.get(id)?.outcome);
  const polygons = Object.fromEntries(Object.keys(regions).sort()
    .map(id => [id, current(id) ? planPolygons.get(id) ?? null : previous?.polygons?.[id] ?? null]).filter(([, polygon]) => polygon));
  const stamps = Object.values(regions).map(entry => entry.sourceTimestamp).sort();
  const index = {schema: 1, generation, planSourceDate: plan.sourceDate, filter: FILTER_HASH,
    oldestTimestamp: stamps[0] || null, newestTimestamp: stamps.at(-1) || null,
    olderFilter: Object.values(regions).filter(entry => entry.filter !== currentFilter(entry.region)).map(entry => entry.region).sort(),
    missing: [...planned].filter(id => !regions[id]).sort(),
    regions: Object.fromEntries(Object.entries(regions).sort(([a], [b]) => a.localeCompare(b))), polygons};
  return {index, uploads, outcomes: [...outcomes].map(([region, o]) => ({region, ...o})).sort((a, b) => a.region.localeCompare(b.region))};
}

export function readOutputs(directory) {
  const outputs = [];
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const dir = join(directory, entry.name);
    const read = name => existsSync(join(dir, name)) ? JSON.parse(readFileSync(join(dir, name), 'utf8')) : null;
    const manifest = read('extract.json'), failed = read('failed.json');
    if (manifest || failed) outputs.push({dir, manifest, failed: manifest ? null : failed});
  }
  return outputs;
}

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

export function load(file) {
  const names = releaseAssets(RELEASE);
  if (!names) { console.log('No working copies yet: the first run'); return null; }
  const found = usableIndex(names, downloader(mkdtempSync(join(tmpdir(), 'extract-release-'))));
  if (!found) {
    if (names.some(name => INDEX.test(name))) throw new Error('No stored index has all its region files');
    console.log('No working copies yet: the first run');
    return null;
  }
  writeFileSync(file, JSON.stringify(found.index));
  console.log(`Loaded ${found.name}: ${Object.keys(found.index.regions).length} regions`);
  return found;
}

const deleteAsset = name => {
  for (let attempt = 0; ; attempt++) {
    try { gh('release', 'delete-asset', RELEASE, name, '--yes'); return true; }
    catch (error) {
      if (attempt >= 1) {
        console.log(`::warning::Could not delete old asset ${name} (${String(error.stderr || error.message).trim()}); the next publication removes it`);
        return false;
      }
      pause(RETRY_MS);
    }
  }
};

export function publish(plan, outputsDir, generation, gaps = null) {
  let names = releaseAssets(RELEASE);
  if (!names) {
    gh('release', 'create', RELEASE, '--prerelease', '--title', 'OSM extract working copies', '--notes',
      'Filtered OpenStreetMap extracts (ODbL; © OpenStreetMap contributors, via Geofabrik), one per planned region, and the index naming the current file of each. A cache that can be made again; see docs/data-maintenance.md.');
    names = [];
  }
  const work = mkdtempSync(join(tmpdir(), 'extract-release-'));
  const read = downloader(work);
  const previous = usableIndex(names, read);
  if (!previous && names.some(name => INDEX.test(name))) throw new Error('No stored index has all its region files; not starting from an empty store');
  const {index, uploads, outcomes} = nextIndex(planWithGaps(plan, gaps, previous?.index), previous?.index, readOutputs(outputsDir), generation);
  // The region files go up before the index that names them.
  const present = new Set(names);
  for (const {file, asset} of uploads) {
    if (present.has(asset)) continue; // the same content, already uploaded by a run that stopped before its index
    const named = join(work, asset);
    writeFileSync(named, readFileSync(file));
    gh('release', 'upload', RELEASE, named);
  }
  const indexName = `index-${generation}.json`;
  writeFileSync(join(work, indexName), JSON.stringify(index));
  gh('release', 'upload', RELEASE, join(work, indexName));
  console.log(`Published ${indexName}`);
  // Keep this index and the previous usable one; delete the rest.
  const all = [...names, ...uploads.map(upload => upload.asset), indexName];
  const keep = [indexName, ...(previous ? [previous.name] : [])];
  const readAny = name => name === indexName ? index : read(name);
  for (const name of obsoleteAssets([...new Set(all)], keep, readAny)) deleteAsset(name);
  return {indexName, index, outcomes};
}

export function publishReport({indexName, index, outcomes}) {
  const count = outcome => outcomes.filter(o => o.outcome === outcome).length;
  const lines = ['# Extract working copies', '',
    `- Index: ${indexName}; ${Object.keys(index.regions).length} regions with a file; OSM data from ${index.oldestTimestamp || '—'} to ${index.newestTimestamp || '—'}`,
    `- Updated ${count('updated')}, unchanged ${count('unchanged')}, kept from before ${count('kept')}, without any file ${count('missing')}, dropped ${count('dropped')}`,
    ...(index.olderFilter.length ? [`- Made with an older filter (refreshed when next downloaded): ${index.olderFilter.join(', ')}`] : []),
    '', '| Region | Outcome | Reason |', '| --- | --- | --- |',
    ...outcomes.filter(o => o.outcome !== 'updated' && o.outcome !== 'unchanged').map(o => `| ${o.region} | ${o.outcome} | ${String(o.reason || '').replaceAll('|', '\\|')} |`)];
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, first, second, third] = process.argv.slice(2);
  if (command === 'load' && first) load(first);
  else if (command === 'publish' && first && second) {
    // The gap tiles are optional: a run without them keeps the gap copies.
    const gaps = third && existsSync(third) ? JSON.parse(readFileSync(third, 'utf8')) : null;
    const result = publish(JSON.parse(readFileSync(first, 'utf8')), second,
      process.env.GENERATION || `${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}-${process.env.GITHUB_RUN_ID || 0}`, gaps);
    process.stdout.write(publishReport(result));
  } else throw new Error('Usage: extract-release.mjs load <index file> | publish <plan.json> <directory> [gaps.json]');
}
