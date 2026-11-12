// Branch and metro lines built from the assembled Geofabrik extract
// (scripts/assemble-extracts.mjs) instead of Overpass (#330, step 9):
//   node scripts/build-extract-branch-lines.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>
// The same selection (isBranchWay, scripts/railway-ways.mjs), conversion
// (toFeatures) and files (branch-lines-files.mjs) as the Overpass build, so
// its tiles are the same for the same elements. The extract covers the whole
// world at once, so there are no region stages: every line's stage is
// `extract`, which only the downloadable table shows.
// It writes source.json, which the site's source switch reads
// (scripts/data-source.mjs), with the oldest OSM time the assembled regions
// vouch for. It says complete only when the assembly covers every planned
// region and gap tile (`missingRegions` empty): a build missing some of the
// world is still published, for comparison, but the switch never takes it.
import {readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MIN_ZOOM, MAX_ZOOM, toFeatures} from './branch-lines.mjs';
import {writeBranchFiles} from './branch-lines-files.mjs';
import {readElements} from './extract-elements.mjs';
import {isBranchWay} from './railway-ways.mjs';

export const EXTRACT_STAGE = 'extract';

// The assembly report must name a complete build: regions, and the oldest
// and newest OSM times they hold.
export function checkAssembly(report) {
  if (report?.schema !== 1 || !Number.isSafeInteger(report.regions) || report.regions < 1) throw new Error('Not an assembly report with regions');
  for (const key of ['oldestTimestamp', 'newestTimestamp'])
    if (typeof report[key] !== 'string' || !Number.isFinite(Date.parse(report[key]))) throw new Error(`The assembly report has no ${key}`);
  if (report.missingNodeRefs !== 0) throw new Error(`The assembly is missing ${report.missingNodeRefs ?? 'an unknown number of'} way nodes`);
  return report;
}

// Every planned region and gap tile has a file: the world is covered.
export const coversWorld = report => Array.isArray(report.missingRegions) && report.missingRegions.length === 0;

// Each way becomes its line at once (toFeatures converts ways one by one),
// so only the simplified lines are held, never the ways' full geometry.
export function addBranchWay(table, way) {
  for (const feature of toFeatures({elements: [way]})) table.set(feature.id, {...feature, stage: EXTRACT_STAGE});
  return table;
}
export const branchTable = ways => ways.reduce(addBranchWay, new Map());

export async function buildExtractBranchLines(pbf, report, out, {read = readElements, now = () => new Date()} = {}) {
  checkAssembly(report);
  const table = new Map();
  const counts = await read(pbf, {keep: isBranchWay, onElement: way => addBranchWay(table, way)});
  await rm(out, {recursive: true, force: true});
  const {tiles, tileBytes} = await writeBranchFiles(out, table);
  const manifest = {generated: now().toISOString(), oldestSource: report.oldestTimestamp, newestSource: report.newestTimestamp,
    lines: table.size, tiles, tileBytes, zooms: [MIN_ZOOM, MAX_ZOOM], source: 'extract',
    complete: coversWorld(report), extract: {index: report.index, regions: report.regions, missingRegions: report.missingRegions, waysWithoutGeometry: counts.withoutGeometry},
    query: 'way[railway~"^(rail|narrow_gauge)$"][usage=branch][!service] and way[railway=subway][!service], from the assembled Geofabrik extracts', license: 'ODbL-1.0',
    description: 'OpenStreetMap operating branch lines (usage=branch) for zooms 4–6 and metro lines (railway=subway) for zooms 7–9, where OpenRailwayMap shows neither.'};
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(out, 'source.json'), `${JSON.stringify({schema: 1, dataset: 'branch-lines', source: 'extract', complete: coversWorld(report), osmTimestamp: report.oldestTimestamp})}\n`);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [pbf, reportFile, out] = process.argv.slice(2);
  if (!pbf || !reportFile || !out) throw new Error('Usage: build-extract-branch-lines.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>');
  const manifest = await buildExtractBranchLines(pbf, JSON.parse(await readFile(reportFile, 'utf8')), out);
  console.log(JSON.stringify(manifest));
}
