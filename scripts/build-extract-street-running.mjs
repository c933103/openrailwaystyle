// Street running built from the assembled Geofabrik extract (#330, step 9):
//   node scripts/build-extract-street-running.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>
// One read of the ways selects what STREET_QUERY selects, element by
// element; the elements are kept as `out tags geom` gives them (type, id,
// tags, geometry), converted by streetFeatures and written by the Overpass
// build's writer (street-running-files.mjs), with source.json for the site's
// source switch (scripts/data-source.mjs), complete only when the assembly
// covers the world.
import {readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkAssembly, coversWorld} from './build-extract-branch-lines.mjs';
import {readElements} from './extract-elements.mjs';
import {STREET_QUERY, streetFeatures, writeStreetSnapshot} from './street-running-files.mjs';

// way[embedded=yes] (the exact value) and way[embedded_rails] (any value).
export const isStreetWay = ({type, tags = {}}) => type === 'way' && (tags.embedded === 'yes' || tags.embedded_rails !== undefined);

// What the conversion reads of an element, as the Overpass build keeps it.
const pick = ({type, id, tags, geometry}) => ({type, id, tags, geometry});

export async function streetElements(pbf, {read = readElements} = {}) {
  const elements = [];
  const counts = await read(pbf, {keep: isStreetWay, onElement: element => { elements.push(pick(element)); }});
  return {elements: elements.sort((a, b) => a.id - b.id), counts: {read: counts.read, kept: counts.kept, waysWithoutGeometry: counts.withoutGeometry}};
}

// The Overpass build's floor for a worldwide result (build-street-running.mjs).
export const MINIMUM = 100;

export async function buildExtractStreetRunning(pbf, report, out, {read = readElements, now = () => new Date()} = {}) {
  checkAssembly(report);
  const complete = coversWorld(report);
  const {elements, counts} = await streetElements(pbf, {read});
  const features = streetFeatures(elements);
  if (complete && features.length < MINIMUM) throw new Error(`Suspiciously small worldwide street-running extract: ${features.length}`);
  await rm(out, {recursive: true, force: true});
  const manifest = await writeStreetSnapshot(out, {elements, features,
    head: {generated: now().toISOString(), osmBase: report.oldestTimestamp, update: 'full'},
    tail: {source: 'OpenStreetMap via the Geofabrik extracts', query: STREET_QUERY, license: 'ODbL-1.0',
      description: 'Explicit OSM embedded / embedded_rails tags. Not inferred from tram type or proximity. Missing tags imply unknown coverage.',
      complete, oldestSource: report.oldestTimestamp, newestSource: report.newestTimestamp,
      extract: {index: report.index, regions: report.regions, missingRegions: report.missingRegions, ...counts}}});
  await writeFile(join(out, 'source.json'), `${JSON.stringify({schema: 1, dataset: 'street-running', source: 'extract', complete, osmTimestamp: report.oldestTimestamp})}\n`);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [pbf, reportFile, out] = process.argv.slice(2);
  if (!pbf || !reportFile || !out) throw new Error('Usage: build-extract-street-running.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>');
  console.log(JSON.stringify(await buildExtractStreetRunning(pbf, JSON.parse(await readFile(reportFile, 'utf8')), out)));
}
