// The axle-load lookup built from the assembled Geofabrik extract (#330, step 9):
//   node scripts/build-extract-axle-load.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <index.json> <output directory>
// The selection of build-axle-load-list.mjs's queries, way by way: railway
// ways of the AXLE_RAILWAYS values with axle_load, maxaxleload or
// railway:track_class, made into the same lookup (axle-load-lookup.mjs),
// with source.json for the site's source switch (scripts/data-source.mjs),
// complete only when the assembly covers the world.
//
// Overpass marks a way Finnish when it lies in Finland's admin_level=2 area
// (`way(area.fi)`: a way with a node in it). The extract has no boundaries,
// so this build takes the `finland` polygon of the region plan (Geofabrik's,
// in the index the assembly read) and marks a way with a node inside it.
// Geofabrik's polygon reaches a little beyond the border; on the 2026-11-10
// index both give the same 8,278 Finnish ways (the comparison in the PR).
import {readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkAssembly, coversWorld} from './build-extract-branch-lines.mjs';
import {readElements} from './extract-elements.mjs';
import {AXLE_RAILWAYS, axleLookup} from './axle-load-lookup.mjs';

const RAILWAYS = new Set(AXLE_RAILWAYS);
const KEYS = ['axle_load', 'maxaxleload', 'railway:track_class'];
export const isAxleWay = ({type, tags = {}}) => type === 'way' && RAILWAYS.has(tags.railway) && KEYS.some(key => tags[key] !== undefined);

// Even-odd point in ring; a polygon is [outer, ...holes] of [lon, lat] rings.
const inRing = (lon, lat, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
// polygons: a GeoJSON MultiPolygon's coordinates, as the index holds them.
export const inPolygons = (polygons, lon, lat) => polygons.some(([outer, ...holes]) => inRing(lon, lat, outer) && !holes.some(hole => inRing(lon, lat, hole)));

export function finlandPolygon(index) {
  const polygon = index?.polygons?.finland;
  if (!Array.isArray(polygon) || !polygon.length || !polygon.every(p => Array.isArray(p) && Array.isArray(p[0]) && p[0].length >= 4))
    throw new Error('The extract index has no finland polygon: the Finnish axle system cannot be told apart');
  return polygon;
}

// The rows and Finnish ways, as the Overpass build gathers them: values
// trimmed (axleRows); Finnish only for a way with a track class.
export async function extractAxleRows(pbf, finland, {read = readElements} = {}) {
  const rows = [], finnish = new Set();
  const counts = await read(pbf, {keep: isAxleWay, onElement: ({id, tags, geometry}) => {
    const [capacity, maximum, category] = KEYS.map(key => tags[key]?.trim() ?? '');
    rows.push([id, capacity, maximum, category]);
    if (tags['railway:track_class'] !== undefined && geometry.some(({lon, lat}) => inPolygons(finland, lon, lat))) finnish.add(id);
  }});
  return {rows, finnish, counts: {read: counts.read, kept: counts.kept, waysWithoutGeometry: counts.withoutGeometry}};
}

// The Overpass build's lookup had 425,848 ways on 2026-11-07; a worldwide
// result far below that is a broken read, not the world.
export const MINIMUM = 100000;

export async function buildExtractAxleLoad(pbf, report, index, out, {read = readElements} = {}) {
  checkAssembly(report);
  const complete = coversWorld(report);
  const {rows, finnish, counts} = await extractAxleRows(pbf, finlandPolygon(index), {read});
  if (complete && rows.length < MINIMUM) throw new Error(`Suspiciously small worldwide axle-load extract: ${rows.length} ways`);
  const lookup = axleLookup(rows, finnish, {updated: report.oldestTimestamp, source: 'OpenStreetMap via the Geofabrik extracts; ODbL'});
  await rm(out, {recursive: true, force: true});
  await mkdir(out, {recursive: true});
  await writeFile(join(out, 'axle-load.json'), JSON.stringify(lookup));
  const manifest = {complete, ways: lookup.ways, finnishWays: lookup.finnishWays, oldestSource: report.oldestTimestamp, newestSource: report.newestTimestamp,
    extract: {index: report.index, regions: report.regions, missingRegions: report.missingRegions, ...counts}};
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(out, 'source.json'), `${JSON.stringify({schema: 1, dataset: 'axle-load', source: 'extract', complete, osmTimestamp: report.oldestTimestamp})}\n`);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [pbf, reportFile, indexFile, out] = process.argv.slice(2);
  if (!pbf || !reportFile || !indexFile || !out) throw new Error('Usage: build-extract-axle-load.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <index.json> <output directory>');
  const json = async file => JSON.parse(await readFile(file, 'utf8'));
  console.log(JSON.stringify(await buildExtractAxleLoad(pbf, await json(reportFile), await json(indexFile), out)));
}
