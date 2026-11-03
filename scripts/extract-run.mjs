// The two ends of an extract run (`.github/workflows/osm-extract.yml`, #330
// B2): the job matrix from a region plan, and the report of what the jobs
// measured.
//   node scripts/extract-run.mjs matrix <plan.json>
//     writes `matrix=` and `count=` to $GITHUB_OUTPUT (or prints them);
//     refuses a plan that is not valid, has a region over the limit, more
//     regions than one matrix holds, or more bytes than one run may download.
//   node scripts/extract-run.mjs report <plan.json> <directory of extract.json files>
//     prints a Markdown report; regions without a manifest are listed as
//     not measured.
import {appendFile, readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkRegion} from './acquire-region-extract.mjs';

// GitHub runs at most 256 jobs from one matrix.
export const MAX_JOBS = 256;
// What one run may download from Geofabrik: the measured plan is 77.6 GiB
// (#330), the eight continent files about 80 GiB.
export const MAX_RUN_BYTES = 100 * 1024 ** 3;

// An artifact name cannot hold `/`; `--` never occurs in a Geofabrik id.
export const regionKey = id => id.replaceAll('/', '--');

export function extractMatrix(plan, {maxJobs = MAX_JOBS, maxRunBytes = MAX_RUN_BYTES} = {}) {
  if (plan?.valid !== true) throw new Error(`The region plan is not valid: ${(plan?.problems || ['no plan']).join('; ')}`);
  const regions = plan.regions;
  if (!Array.isArray(regions) || !regions.length) throw new Error('The region plan has no regions');
  const over = regions.filter(region => region.oversized || region.bytes > plan.maxBytes);
  if (over.length) throw new Error(`Regions over the limit: ${over.map(region => region.id).join(', ')}`);
  if (regions.length > maxJobs) throw new Error(`${regions.length} regions; one run holds ${maxJobs}`);
  const entries = regions.map(region => ({...checkRegion({...region, sourceDate: plan.sourceDate}), key: regionKey(region.id)}));
  if (new Set(entries.map(entry => entry.key)).size !== entries.length) throw new Error('Two regions share an id');
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (total > maxRunBytes) throw new Error(`The plan downloads ${total} bytes; one run may download ${maxRunBytes}`);
  // Largest first: the longest jobs start while both parallel slots are free.
  return entries.sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));
}

const GiB = 1024 ** 3, MiB = 1024 ** 2;
export function extractReport(plan, manifests) {
  const byId = new Map(manifests.map(manifest => [manifest.region, manifest]));
  const measured = plan.regions.filter(region => byId.has(region.id)).map(region => byId.get(region.id));
  const missing = plan.regions.filter(region => !byId.has(region.id)).map(region => region.id);
  const sum = key => measured.reduce((total, manifest) => total + manifest[key], 0);
  const raw = sum('pbfBytes'), filtered = sum('filteredBytes');
  const slowest = measured.reduce((max, m) => Math.max(max, m.downloadSeconds + m.filterSeconds), 0);
  const leastFree = measured.reduce((min, m) => Math.min(min, m.freeBytesBefore), Infinity);
  const lines = [
    '# Extract measurement', '',
    `- Source date: ${plan.sourceDate}`,
    `- Regions measured: ${measured.length} of ${plan.regions.length}${missing.length ? `; not measured: ${missing.join(', ')}` : ''}`,
    `- Downloaded: ${(raw / GiB).toFixed(2)} GiB; filtered: ${(filtered / GiB).toFixed(3)} GiB (${raw ? (100 * filtered / raw).toFixed(2) : '—'}% of the download)`,
    `- Objects kept: ${sum2(measured, 'nodes')} nodes, ${sum2(measured, 'ways')} ways, ${sum2(measured, 'relations')} relations`,
    `- Slowest region (download and filter): ${Math.round(slowest)} s; least free disk before a download: ${Number.isFinite(leastFree) ? (leastFree / GiB).toFixed(1) : '—'} GiB`,
    `- Filter: ${[...new Set(measured.map(m => m.filter))].join(', ') || '—'}`,
    '', '| Region | Download GiB | Filtered MiB | Kept | Nodes | Ways | Relations | Download s | Filter s | OSM time |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...measured.sort((a, b) => b.pbfBytes - a.pbfBytes).map(m => `| ${m.region} | ${(m.pbfBytes / GiB).toFixed(2)} | ${(m.filteredBytes / MiB).toFixed(1)} | ${(100 * m.filteredBytes / m.pbfBytes).toFixed(2)}% | ${m.counts.nodes} | ${m.counts.ways} | ${m.counts.relations} | ${Math.round(m.downloadSeconds)} | ${Math.round(m.filterSeconds)} | ${m.sourceTimestamp} |`),
  ];
  return {markdown: `${lines.join('\n')}\n`, measured: measured.length, missing};
}
const sum2 = (manifests, key) => manifests.reduce((total, m) => total + m.counts[key], 0);

async function manifestsIn(dir) {
  const found = [];
  for (const entry of await readdir(dir, {withFileTypes: true, recursive: true})) {
    if (entry.isFile() && entry.name === 'extract.json') found.push(JSON.parse(await readFile(join(entry.parentPath ?? entry.path, entry.name), 'utf8')));
  }
  return found;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [command, planFile, dir] = process.argv.slice(2);
  const plan = JSON.parse(await readFile(planFile, 'utf8'));
  if (command === 'matrix') {
    const entries = extractMatrix(plan);
    const output = `matrix=${JSON.stringify(entries)}\ncount=${entries.length}\n`;
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output); else process.stdout.write(output);
    console.log(`${entries.length} regions, ${(entries.reduce((sum, e) => sum + e.bytes, 0) / GiB).toFixed(2)} GiB`);
  } else if (command === 'report') {
    const {markdown} = extractReport(plan, await manifestsIn(dir));
    process.stdout.write(markdown);
  } else {
    throw new Error('Usage: extract-run.mjs matrix <plan.json> | report <plan.json> <directory>');
  }
}
