// The date of each dataset the site deploys, for the Help panel (#330, B7:
// the site runs on old data when upstreams are unavailable, and says how old
// it is). Run by site.yml once the data is assembled:
//   node scripts/data-ages.mjs styles
// It reads each dataset's manifest and writes styles/data/data-ages.json:
//   {schema, generated, staleAfterDays, datasets: [{id, label, date, field, stale}]}
// The date is the OpenStreetMap database time when the manifest records one
// (osmBase), otherwise the time the snapshot was built: the data is at least
// that old. A missing manifest is listed with date null, never guessed.
// Old data is never refused here: `stale` only marks a dataset older than
// STALE_AFTER_DAYS so the page can say so.
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const STALE_AFTER_DAYS = 90;
export const DATASETS = [
  {id: 'lifecycle', label: 'Planned, construction and former lines', manifest: 'data/manifest.json'},
  {id: 'level-crossings', label: 'Level crossings', manifest: 'data/level-crossings/manifest.json'},
  {id: 'branch-lines', label: 'Branch and metro lines', manifest: 'data/branch-lines/manifest.json'},
  {id: 'service-routes', label: 'Urban rail services', manifest: 'data/service-routes/manifest.json'},
  {id: 'street-running', label: 'Street running', manifest: 'data/street-running/manifest.json'},
  {id: 'conveying', label: 'Escalators, moving walkways and elevators', manifest: 'data/conveying/manifest.json'},
  {id: 'aerialways', label: 'Aerial cableways and lifts', manifest: 'data/aerialways/manifest.json'},
  {id: 'heritage', label: 'Historic areas', manifest: 'data/heritage/manifest.json'},
  {id: 'power', label: 'Railway energy supplies', manifest: 'data/traction/power/manifest.json'},
  {id: 'signals', label: 'Railway signals', manifest: 'data/traction/signals/manifest.json'},
  {id: 'station-points', label: 'Station points', manifest: 'data/station-points/manifest.json'},
];
// Most specific first: the OSM database time, then build times.
const FIELDS = ['osmBase', 'updated', 'generated', 'built'];

export function datasetDate(manifest) {
  for (const field of FIELDS) {
    const value = manifest?.[field];
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return {date: new Date(Date.parse(value)).toISOString(), field};
  }
  return {date: null, field: null};
}

export async function dataAges(root, {now = new Date(), read = path => readFile(path, 'utf8')} = {}) {
  const datasets = [];
  for (const {id, label, manifest} of DATASETS) {
    let parsed = null;
    try { parsed = JSON.parse(await read(join(root, manifest))); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`${manifest}: ${error.message}`); }
    const {date, field} = datasetDate(parsed);
    datasets.push({id, label, date, field, stale: date !== null && now - Date.parse(date) > STALE_AFTER_DAYS * 86400_000});
  }
  return {schema: 1, generated: now.toISOString(), staleAfterDays: STALE_AFTER_DAYS, datasets};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const root = process.argv[2] || 'styles';
  const ages = await dataAges(root);
  await writeFile(join(root, 'data/data-ages.json'), `${JSON.stringify(ages, null, 1)}\n`);
  for (const d of ages.datasets) console.log(`${d.id}: ${d.date ?? 'no manifest'}${d.field ? ` (${d.field})` : ''}${d.stale ? ' STALE' : ''}`);
}
