// Historic areas built from the assembled Geofabrik extract (#330, step 9):
//   node scripts/build-extract-heritage.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>
// The selection of heritageQuery, element by element, over the whole world
// (its region boxes together cover it): ways and multipolygon or boundary
// relations tagged historic=archaeological_site|battlefield|district,
// protect_class=22 or heritage=1. The elements are shaped as its `out geom`
// answer gives them (a way with its geometry, a relation with its members'
// geometry), converted by heritageFeatures and written by the Overpass build's
// writer (heritage-files.mjs), with source.json for the site's source switch
// (scripts/data-source.mjs), complete only when the assembly covers the world.
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkAssembly, coversWorld} from './build-extract-branch-lines.mjs';
import {readElements} from './extract-elements.mjs';
import {osmiumSubset} from './build-extract-station-points.mjs';
import {shapeRelations} from './build-extract-power-facilities.mjs';
import {HISTORIC, heritageFeatures, heritageRegions} from './heritage-data.mjs';
import {writeHeritageSnapshot, HERITAGE_SELECTION} from './heritage-files.mjs';

// [historic~"^(...)$"], [protect_class=22], [heritage=1]: exact values; a
// relation also [type~"^(multipolygon|boundary)$"].
const tagged = tags => HISTORIC.includes(tags.historic) || tags.protect_class === '22' || tags.heritage === '1';
export const isHeritageElement = ({type, tags = {}}) => (type === 'way' && tagged(tags))
  || (type === 'relation' && tagged(tags) && typeof tags.type === 'string' && /^(multipolygon|boundary)$/.test(tags.type));

export async function heritageElements(pbf, {read = readElements, subset = osmiumSubset} = {}) {
  const ways = [], relations = [];
  const first = await read(pbf, {keep: isHeritageElement, onElement: element => { (element.type === 'relation' ? relations : ways).push(element); }});
  const shaped = await shapeRelations(pbf, relations, {read, subset});
  const byId = (a, b) => a.id - b.id;
  const {memberWaysWithoutGeometry, ...counts} = shaped.counts;
  return {elements: [...ways.sort(byId), ...shaped.relations.sort(byId)],
    counts: {read: first.read, kept: first.kept, ...counts, waysWithoutGeometry: first.withoutGeometry + memberWaysWithoutGeometry}};
}

// An Overpass bounding box holds its edges: an area with a coordinate on one
// is counted in both boxes.
const inBox = ([s, w, n, e], geometry) => (geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates.flat(2))
  .some(([lon, lat]) => lat >= s && lat <= n && lon >= w && lon <= e);

export async function buildExtractHeritage(pbf, report, out, {read = readElements, subset = osmiumSubset, now = () => new Date()} = {}) {
  checkAssembly(report);
  const complete = coversWorld(report);
  const {elements, counts} = await heritageElements(pbf, {read, subset});
  const features = heritageFeatures({elements});
  if (complete && !features.length) throw new Error('Refusing to publish an empty worldwide historic area snapshot');
  // The world's 45-degree regions as the coverage, each counted as an
  // Overpass bounding box holds an area.
  const coverage = heritageRegions().map(bbox => ({bbox, timestamp: report.oldestTimestamp, features: features.filter(f => inBox(bbox, f.geometry)).length}));
  const manifest = await writeHeritageSnapshot(out, features, {
    head: {version: 2, built: now().toISOString(), source: 'OpenStreetMap via the Geofabrik extracts', license: 'ODbL-1.0', complete},
    tail: {coverage, downloadedBytes: 0, selection: HERITAGE_SELECTION, oldestSource: report.oldestTimestamp, newestSource: report.newestTimestamp,
      extract: {index: report.index, regions: report.regions, missingRegions: report.missingRegions, ...counts}}});
  await writeFile(join(out, 'source.json'), `${JSON.stringify({schema: 1, dataset: 'heritage', source: 'extract', complete, osmTimestamp: report.oldestTimestamp})}\n`);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [pbf, reportFile, out] = process.argv.slice(2);
  if (!pbf || !reportFile || !out) throw new Error('Usage: build-extract-heritage.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>');
  const {coverage, ...manifest} = await buildExtractHeritage(pbf, JSON.parse(await readFile(reportFile, 'utf8')), out);
  console.log(JSON.stringify({...manifest, coverage: coverage.length}));
}
