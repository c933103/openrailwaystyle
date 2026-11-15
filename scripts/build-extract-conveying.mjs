// Escalators, moving walkways and elevators, and aerial cableways and lifts,
// built from the assembled Geofabrik extract (#330, step 9):
//   node scripts/build-extract-conveying.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>
// One read of the ways selects what CONVEYING_QUERY and AERIALWAY_QUERY
// select, element by element; the elements are kept as `out tags geom`
// gives them (type, id, tags, geometry), converted by conveyingGeoJSON and
// aerialwaysGeoJSON and written by the Overpass builds' writer
// (conveying-files.mjs) to <out>/conveying and <out>/aerialways, each with
// source.json for the site's source switch (scripts/data-source.mjs),
// complete only when the assembly covers the world.
import {readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkAssembly, coversWorld} from './build-extract-branch-lines.mjs';
import {readElements} from './extract-elements.mjs';
import {AERIALWAY_QUERY, AERIALWAY_ZOOM, CONVEYING_QUERY, CONVEYING_ZOOM, aerialwaysGeoJSON, conveyingGeoJSON} from './conveying-data.mjs';
import {writeLineSnapshot} from './conveying-files.mjs';
import {AERIALWAY_KINDS} from '../styles/map-model.mjs';

// way[conveying][conveying!=no] and way[highway=elevator]: exact values, as
// Overpass compares them.
export const isConveyingWay = ({type, tags = {}}) => type === 'way'
  && ((tags.conveying !== undefined && tags.conveying !== 'no') || tags.highway === 'elevator');
// way[aerialway~"^(...)$"]: an Overpass regular expression, case-sensitive.
const AERIALWAY = new RegExp(`^(${AERIALWAY_KINDS.flatMap(kind => kind.subclasses).join('|')})$`);
export const isAerialwayWay = ({type, tags = {}}) => type === 'way' && typeof tags.aerialway === 'string' && AERIALWAY.test(tags.aerialway);

// What the conversion reads of an element, as the Overpass builds keep it.
const pick = ({type, id, tags, geometry}) => ({type, id, tags, geometry});

export async function conveyingElements(pbf, {read = readElements} = {}) {
  const conveying = [], aerialways = [];
  const counts = await read(pbf, {keep: element => isConveyingWay(element) || isAerialwayWay(element), onElement: element => {
    if (isConveyingWay(element)) conveying.push(pick(element));
    if (isAerialwayWay(element)) aerialways.push(pick(element));
  }});
  const byId = (a, b) => a.id - b.id;
  return {conveying: conveying.sort(byId), aerialways: aerialways.sort(byId), counts: {read: counts.read, kept: counts.kept, waysWithoutGeometry: counts.withoutGeometry}};
}

// The Overpass builds' floors for a worldwide result (build-conveying.mjs,
// build-aerialways.mjs), applied when the assembly covers the world.
export const DATASETS = Object.freeze([
  {dataset: 'conveying', dir: 'conveying', file: 'conveying', layer: 'conveying', zoom: CONVEYING_ZOOM, kindIds: ['escalator', 'travelator', 'elevator'],
    convert: conveyingGeoJSON, query: CONVEYING_QUERY, minimum: 10000,
    description: 'Every OSM way with conveying=* (not no) or highway=elevator. Backward escalators are stored reversed so arrows follow the line.'},
  {dataset: 'aerialways', dir: 'aerialways', file: 'aerialways', layer: 'aerialways', zoom: AERIALWAY_ZOOM, kindIds: ['cableway', 'lift'],
    convert: aerialwaysGeoJSON, query: AERIALWAY_QUERY, minimum: 5000,
    description: 'Every OSM aerial cableway and lift way (cable car, gondola, mixed lift, chair, drag, T-bar, J-bar and platter lifts), with names, owner and maxspeed.'},
]);

export async function buildExtractConveying(pbf, report, out, {read = readElements, now = () => new Date()} = {}) {
  checkAssembly(report);
  const complete = coversWorld(report);
  const found = await conveyingElements(pbf, {read});
  const result = {};
  for (const {dataset, dir, file, layer, zoom, kindIds, convert, query, minimum, description} of DATASETS) {
    const elements = found[dataset], {features} = convert({elements});
    if (complete && features.length < minimum) throw new Error(`Suspiciously small worldwide ${dataset} extract: ${features.length}`);
    const root = join(out, dir);
    await rm(root, {recursive: true, force: true});
    const manifest = await writeLineSnapshot(root, {elements, features, file, layer, zoom, kindIds,
      head: {generated: now().toISOString(), osmBase: report.oldestTimestamp, update: 'full'},
      tail: {source: 'OpenStreetMap via the Geofabrik extracts', query, license: 'ODbL-1.0', description, complete,
        oldestSource: report.oldestTimestamp, newestSource: report.newestTimestamp,
        extract: {index: report.index, regions: report.regions, missingRegions: report.missingRegions, ...found.counts}}});
    await writeFile(join(root, 'source.json'), `${JSON.stringify({schema: 1, dataset, source: 'extract', complete, osmTimestamp: report.oldestTimestamp})}\n`);
    result[dataset] = manifest;
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [pbf, reportFile, out] = process.argv.slice(2);
  if (!pbf || !reportFile || !out) throw new Error('Usage: build-extract-conveying.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>');
  console.log(JSON.stringify(await buildExtractConveying(pbf, JSON.parse(await readFile(reportFile, 'utf8')), out)));
}
