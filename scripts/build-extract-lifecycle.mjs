// Planned, construction and former railways built from the assembled
// Geofabrik extract (#330, step 9):
//   node scripts/build-extract-lifecycle.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>
// The selection of build-snapshot.mjs's regionQuery, way by way, over the
// whole world (its region boxes together cover it): ways with railway= one
// of the lifecycle STATES, or <state>:railway= a track type. They are kept
// as `out tags geom` gives them, converted by toGeoJSON and written by the
// Overpass build's writer (lifecycle-files.mjs) into <output>/snapshot, for
// scripts/pack-snapshot.py. source.json, for the site's source switch
// (scripts/data-source.mjs), stays not complete: the lifecycle dataset's
// branch also carries the loading-gauge list and the polar caps, which do
// not come from the extract yet (`missing` in source.json).
import {readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkAssembly, coversWorld} from './build-extract-branch-lines.mjs';
import {readElements} from './extract-elements.mjs';
import {STATES, toGeoJSON} from './lifecycle.mjs';
import {lifecycleRegression, stateCounts, writeLifecycleSnapshot} from './lifecycle-files.mjs';

// build-snapshot.mjs's `tracks`, the values a <state>:railway tag may take.
export const LIFECYCLE_TRACKS = ['rail', 'narrow_gauge', 'light_rail', 'subway', 'tram', 'monorail', 'funicular'];
// way[railway~"^(states)$"], or way["<state>:railway"~"^(tracks)$"].
export const isLifecycleWay = ({type, tags = {}}) => type === 'way'
  && (STATES.includes(tags.railway) || STATES.some(state => LIFECYCLE_TRACKS.includes(tags[`${state}:railway`])));

// Each way is converted as it is read (toGeoJSON, one way at a time, as
// `out tags geom` gives it), so only the features are held, never every
// way's tags and geometry as well: the world did not fit a 6 GB heap with
// both. Features in way id order.
export async function lifecycleFeatures(pbf, {read = readElements} = {}) {
  const features = [];
  const counts = await read(pbf, {keep: isLifecycleWay, onElement: ({type, id, tags, geometry}) => {
    features.push(...toGeoJSON({elements: [{type, id, tags, geometry}]}).features);
  }});
  return {features: features.sort((a, b) => a.id - b.id), counts: {read: counts.read, kept: counts.kept, waysWithoutGeometry: counts.withoutGeometry}};
}

// The parts of the lifecycle dataset's branch (rail-data) besides the
// lifecycle snapshot, which this build does not make.
export const MISSING_PARTS = ['loading-gauge.json', 'polar'];

export async function buildExtractLifecycle(pbf, report, out, {read = readElements, now = () => new Date()} = {}) {
  checkAssembly(report);
  const complete = coversWorld(report);
  const {features, counts} = await lifecycleFeatures(pbf, {read});
  const data = {type: 'FeatureCollection', features};
  // The Overpass build's check: the Korean regression line present and
  // whole (south-korea has a file in every assembly that has run).
  const regression = lifecycleRegression(data.features);
  const manifest = {coverage: 'world', built: now().toISOString(), source: 'OpenStreetMap via the Geofabrik extracts', licence: 'ODbL-1.0',
    parts: [{bbox: [-90, -180, 90, 180], timestamp: report.oldestTimestamp, features: data.features.length}],
    features: data.features.length, states: stateCounts(data.features), regression,
    complete, oldestSource: report.oldestTimestamp, newestSource: report.newestTimestamp,
    extract: {index: report.index, regions: report.regions, missingRegions: report.missingRegions, ...counts}};
  await rm(out, {recursive: true, force: true});
  await mkdir(out, {recursive: true});
  const tiles = await writeLifecycleSnapshot(join(out, 'snapshot'), data, manifest);
  await writeFile(join(out, 'source.json'), `${JSON.stringify({schema: 1, dataset: 'lifecycle', source: 'extract', complete: false, missing: MISSING_PARTS, osmTimestamp: report.oldestTimestamp})}\n`);
  return {...manifest, tiles};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [pbf, reportFile, out] = process.argv.slice(2);
  if (!pbf || !reportFile || !out) throw new Error('Usage: build-extract-lifecycle.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>');
  const {parts, regression, ...manifest} = await buildExtractLifecycle(pbf, JSON.parse(await readFile(reportFile, 'utf8')), out);
  console.log(JSON.stringify({...manifest, regression: {ways: regression.ways, bbox: regression.bbox}}));
}
