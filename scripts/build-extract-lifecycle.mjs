// Planned, construction and former railways built from the assembled
// Geofabrik extract (#330, step 9):
//   node scripts/build-extract-lifecycle.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>
// The selection of build-snapshot.mjs's regionQuery, way by way, over the
// whole world (its region boxes together cover it): ways with railway= one
// of the lifecycle STATES, or <state>:railway= a track type. They are kept
// as `out tags geom` gives them, converted by toGeoJSON and written by the
// Overpass build's writer (lifecycle-files.mjs) into <output>/snapshot, for
// scripts/pack-snapshot.py. The same read gives the loading-gauge list
// (build-loading-gauge-list.mjs's query, way by way) as
// <output>/snapshot/loading-gauge.json. The lifecycle dataset's branch also
// carries the polar caps (beyond 85°: ETOPO relief and Overpass features,
// none in the extract filter). They are taken unchanged from the Overpass
// build's published branch (rail-data, build-polar.mjs) when given:
//   ... <output directory> [<polar directory> <its rail-data commit>]
// With them, source.json is complete when the assembly covers the world;
// without them it stays not complete (`missing` in source.json), for the
// site's source switch (scripts/data-source.mjs).
import {cp, readdir, readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkAssembly, coversWorld} from './build-extract-branch-lines.mjs';
import {readElements} from './extract-elements.mjs';
import {STATES, toGeoJSON} from './lifecycle.mjs';
import {lifecycleRegression, stateCounts, writeLifecycleSnapshot} from './lifecycle-files.mjs';
import {AXLE_RAILWAYS} from './axle-load-lookup.mjs';
import {encodeLoadingGauges} from '../styles/loading-gauge-list.mjs';

// build-snapshot.mjs's `tracks`, the values a <state>:railway tag may take.
export const LIFECYCLE_TRACKS = ['rail', 'narrow_gauge', 'light_rail', 'subway', 'tram', 'monorail', 'funicular'];
// way[railway~"^(states)$"], or way["<state>:railway"~"^(tracks)$"].
export const isLifecycleWay = ({type, tags = {}}) => type === 'way'
  && (STATES.includes(tags.railway) || STATES.some(state => LIFECYCLE_TRACKS.includes(tags[`${state}:railway`])));

// build-loading-gauge-list.mjs's way[railway~"^(...)$"][loading_gauge]: the
// same railway values as the axle-load lookup's.
const GAUGE_RAILWAYS = new Set(AXLE_RAILWAYS);
export const isGaugeWay = ({type, tags = {}}) => type === 'way' && GAUGE_RAILWAYS.has(tags.railway) && tags.loading_gauge !== undefined;

// Each way is converted as it is read (toGeoJSON, one way at a time, as
// `out tags geom` gives it), so only the features are held, never every
// way's tags and geometry as well: the world did not fit a 6 GB heap with
// both. Features in way id order.
// One read gives both: the loading-gauge rows are [way id, value trimmed],
// as parseCsv makes them from the Overpass CSV.
export async function lifecycleFeatures(pbf, {read = readElements} = {}) {
  const features = [], gauges = [];
  const counts = await read(pbf, {keep: e => isLifecycleWay(e) || isGaugeWay(e), onElement: ({type, id, tags, geometry}) => {
    // A loading-gauge way with no lifecycle tag would give no feature; not
    // converting it saves the work for some 200,000 ways.
    if (isLifecycleWay({type, tags})) features.push(...toGeoJSON({elements: [{type, id, tags, geometry}]}).features);
    if (isGaugeWay({type, tags})) gauges.push([id, tags.loading_gauge.trim()]);
  }});
  return {features: features.sort((a, b) => a.id - b.id), gauges, counts: {read: counts.read, kept: counts.kept, waysWithoutGeometry: counts.withoutGeometry}};
}

// The parts of the lifecycle dataset's branch (rail-data) besides the
// lifecycle snapshot and the loading-gauge list, which this build does not
// make.
export const MISSING_PARTS = ['polar'];

// build-polar.mjs publishes the two caps together, each with its index; a
// directory without both is not a complete pair and is not used.
export const POLAR_INDEXES = ['north-index.json', 'south-index.json'];
export async function checkPolar(dir, commit) {
  if (!/^[0-9a-f]{40}$/.test(String(commit))) throw new Error(`The polar caps need their rail-data commit, not ${JSON.stringify(commit)}`);
  const files = await readdir(dir);
  for (const index of POLAR_INDEXES) {
    if (!files.includes(index)) throw new Error(`The polar caps in ${dir} lack ${index}`);
    JSON.parse(await readFile(join(dir, index), 'utf8'));
  }
  return files.length;
}

export async function buildExtractLifecycle(pbf, report, out, {read = readElements, now = () => new Date(), polar} = {}) {
  checkAssembly(report);
  const polarFiles = polar ? await checkPolar(polar.dir, polar.commit) : 0;
  const complete = coversWorld(report);
  const {features, gauges, counts} = await lifecycleFeatures(pbf, {read});
  const data = {type: 'FeatureCollection', features};
  // The Overpass build's check: the Korean regression line present and
  // whole (south-korea has a file in every assembly that has run).
  const regression = lifecycleRegression(data.features);
  const manifest = {coverage: 'world', built: now().toISOString(), source: 'OpenStreetMap via the Geofabrik extracts', licence: 'ODbL-1.0',
    parts: [{bbox: [-90, -180, 90, 180], timestamp: report.oldestTimestamp, features: data.features.length}],
    features: data.features.length, states: stateCounts(data.features), regression, loadingGauges: gauges.length,
    complete, oldestSource: report.oldestTimestamp, newestSource: report.newestTimestamp,
    extract: {index: report.index, regions: report.regions, missingRegions: report.missingRegions, ...counts},
    ...(polar ? {polar: {from: 'rail-data', commit: polar.commit, files: polarFiles}} : {})};
  await rm(out, {recursive: true, force: true});
  await mkdir(out, {recursive: true});
  const tiles = await writeLifecycleSnapshot(join(out, 'snapshot'), data, manifest);
  await writeFile(join(out, 'snapshot', 'loading-gauge.json'), JSON.stringify(encodeLoadingGauges(gauges)));
  if (polar) await cp(polar.dir, join(out, 'snapshot', 'polar'), {recursive: true});
  const marker = polar ? {complete} : {complete: false, missing: MISSING_PARTS};
  await writeFile(join(out, 'source.json'), `${JSON.stringify({schema: 1, dataset: 'lifecycle', source: 'extract', ...marker, osmTimestamp: report.oldestTimestamp})}\n`);
  return {...manifest, tiles};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [pbf, reportFile, out, polarDir, polarCommit] = process.argv.slice(2);
  if (!pbf || !reportFile || !out || (polarDir && !polarCommit)) throw new Error('Usage: build-extract-lifecycle.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory> [<polar directory> <rail-data commit>]');
  const polar = polarDir ? {dir: polarDir, commit: polarCommit} : undefined;
  const {parts, regression, ...manifest} = await buildExtractLifecycle(pbf, JSON.parse(await readFile(reportFile, 'utf8')), out, {polar});
  console.log(JSON.stringify({...manifest, regression: {ways: regression.ways, bbox: regression.bbox}}));
}
