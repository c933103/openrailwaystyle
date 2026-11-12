// Urban rail services built from the assembled Geofabrik extract
// (scripts/assemble-extracts.mjs) instead of Overpass (#330, step 9):
//   node scripts/build-extract-service-routes.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>
// The same selection (isServiceRoute and the track ways of serviceView,
// scripts/railway-ways.mjs), conversion (tableBuilder, as toTable) and files
// (service-routes-files.mjs) as the Overpass build, so the same elements
// give the same tiles. The extract covers the whole world at once: one
// stage, `extract`, which only the downloadable table shows.
// Two passes, since an OSM file lists ways before relations: the route
// relations first, then only their member track ways, each converted as it
// is read.
// Each element is observed as of the oldest OSM time the assembled regions
// vouch for: an element edited later (in a newer region) is not certified
// as of that time, and its geometry is listed as of unknown provenance
// (geometrySummary), as an Overpass element newer than its answer would be.
// It writes source.json for the site's source switch
// (scripts/data-source.mjs); complete only when the assembly covers every
// planned region and gap tile.
import {readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkAssembly, coversWorld, EXTRACT_STAGE} from './build-extract-branch-lines.mjs';
import {readElements} from './extract-elements.mjs';
import {isServiceRoute} from './railway-ways.mjs';
import {MIN_ZOOM, MAX_ZOOM, SERVICE_TRACKS, addResult, commitStage, geometrySummary, routeView, tableBuilder} from './service-routes.mjs';
import {writeServiceFiles} from './service-routes-files.mjs';

const serviceTrack = new RegExp(SERVICE_TRACKS);

// The table from the extract's elements: `read` is called twice, for the
// relations and then for the ways.
export async function serviceTable(pbf, report, {read = readElements} = {}) {
  const relations = [], members = new Set();
  const first = await read(pbf, {keep: isServiceRoute, onElement: relation => {
    relations.push(relation);
    for (const m of relation.members || []) if (m.type === 'way') members.add(m.ref);
  }});
  const builder = tableBuilder({osm3s: {timestamp_osm_base: report.oldestTimestamp}},
    {endpoint: 'osm-extract', acquired: report.index, stage: EXTRACT_STAGE, pass: report.index});
  const second = await read(pbf, {keep: e => e.type === 'way' && members.has(e.id) && serviceTrack.test(e.tags?.railway ?? ''),
    onElement: way => builder.addWay(way)});
  for (const relation of relations) builder.addRelation(relation);
  const table = {routes: new Map(), ways: new Map()};
  addResult(table, builder.table(), EXTRACT_STAGE);
  commitStage(table, EXTRACT_STAGE);
  return {table, relations: first.kept, memberWays: members.size, ways: second.kept, waysWithoutGeometry: second.withoutGeometry};
}

export async function buildExtractServiceRoutes(pbf, report, out, {read = readElements, now = () => new Date()} = {}) {
  checkAssembly(report);
  const {table, ...counts} = await serviceTable(pbf, report, {read});
  await rm(out, {recursive: true, force: true});
  const {tiles, tileBytes} = await writeServiceFiles(out, table);
  const manifest = {geometry: geometrySummary(table), generated: now().toISOString(), oldestSource: report.oldestTimestamp, newestSource: report.newestTimestamp,
    routes: [...table.routes.values()].filter(r => routeView(r).active !== false).length, retainedRelations: table.routes.size, ways: table.ways.size,
    tiles, tileBytes, zooms: [MIN_ZOOM, MAX_ZOOM], source: 'extract', complete: coversWorld(report),
    extract: {index: report.index, regions: report.regions, missingRegions: report.missingRegions, ...counts},
    query: 'route relations (type=route) with route=subway, light_rail, tram or monorail, or route=train with service=commuter or urban, and their track ways, from the assembled Geofabrik extracts', license: 'ODbL-1.0',
    description: 'OpenStreetMap urban rail services (metro, light rail, tram, monorail and commuter rail routes) along the tracks they run on, for the Service view.'};
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(out, 'source.json'), `${JSON.stringify({schema: 1, dataset: 'service-routes', source: 'extract', complete: coversWorld(report), osmTimestamp: report.oldestTimestamp})}\n`);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [pbf, reportFile, out] = process.argv.slice(2);
  if (!pbf || !reportFile || !out) throw new Error('Usage: build-extract-service-routes.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>');
  const {geometry, ...manifest} = await buildExtractServiceRoutes(pbf, JSON.parse(await readFile(reportFile, 'utf8')), out);
  console.log(JSON.stringify({...manifest, geometry: Object.fromEntries(Object.entries(geometry).map(([k, v]) => [k, Array.isArray(v) ? v.length : v]))}));
}
