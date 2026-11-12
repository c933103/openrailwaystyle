// Railway energy supplies built from the assembled Geofabrik extract
// (scripts/assemble-extracts.mjs) instead of Overpass (#330, step 9, group 4).
// The selection of powerFacilityQuery (power-facility-data.mjs), element by
// element, and its conversion (powerFacilitiesGeoJSON) on elements shaped as
// its `out body geom` answer gives them: a way with its geometry and bounds,
// a relation with its members' geometry and bounds. Written as
// build-power-facilities.mjs writes power/ (power-facilities.geojson, its
// gzip copy and manifest.json), only from an assembly that covers every
// region and gap tile, since the manifest certifies the whole world.
// Two passes, as for station points: the selected elements, then the
// selected relations' node and way members, cut out with osmium.
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {checkAssembly, coversWorld} from './build-extract-branch-lines.mjs';
import {readElements} from './extract-elements.mjs';
import {osmiumSubset} from './build-extract-station-points.mjs';
import {powerFacilitiesGeoJSON} from './power-facility-data.mjs';
import {worldRegions} from './world-regions.mjs';

// The value lists and the token pattern of powerFacilityQuery: one of the
// options as a whole semicolon-separated value, POSIX whitespace around it,
// matched without regard to case (Overpass's `,i`).
const SUPPLIES = 'fuel|coaling_facility|water_tower|water_tank|water_crane|power_supply|preheating|power_station|substation';
const POWER = 'substation|plant|generator|converter|frequency_converter|transformer';
const RAIL = 'yes|rail|narrow_gauge|light_rail|subway|tram|monorail|power_station|substation';
const PREFIXES = ['', 'construction:', 'proposed:', 'disused:', 'abandoned:', 'razed:', 'demolished:', 'removed:'];
const token = options => new RegExp(`(^|;)[ \\t\\n\\v\\f\\r]*(${options})[ \\t\\n\\v\\f\\r]*(;|$)`, 'i');
const PATTERNS = {rail: token(RAIL), supplies: token(SUPPLIES), power: token(POWER), tank: token('water_tower|storage_tank'), feeder: token('power_supply'),
  traction: token('traction'), usage: token('railway|traction'), landuse: token('railway'), frequency: token('16\\.(7|67|66[67]?)')};
const matches = (tags, key, pattern) => typeof tags[key] === 'string' && pattern.test(tags[key]);

// The query's `hints` set: what makes a power facility or tank a railway one.
export const isHint = (tags = {}) => PREFIXES.some(prefix => matches(tags, `${prefix}railway`, PATTERNS.rail))
  || matches(tags, 'substation', PATTERNS.traction) || matches(tags, 'transformer', PATTERNS.traction)
  || matches(tags, 'usage', PATTERNS.usage) || matches(tags, 'landuse', PATTERNS.landuse) || matches(tags, 'frequency', PATTERNS.frequency);
// Its selectors: hinted power facilities and tanks, and railway supplies.
export const isFacilityElement = ({tags = {}}) => PREFIXES.some(prefix => matches(tags, `${prefix}railway`, PATTERNS.supplies) || matches(tags, `${prefix}railway:electricity`, PATTERNS.feeder))
  || isHint(tags) && PREFIXES.some(prefix => matches(tags, `${prefix}power`, PATTERNS.power) || matches(tags, `${prefix}man_made`, PATTERNS.tank));

const boundsOf = points => points.length ? {minlat: Math.min(...points.map(p => p.lat)), minlon: Math.min(...points.map(p => p.lon)),
  maxlat: Math.max(...points.map(p => p.lat)), maxlon: Math.max(...points.map(p => p.lon))} : undefined;

// The selected elements, shaped as `out body geom` gives them.
export async function facilityElements(pbf, {read = readElements, subset = osmiumSubset} = {}) {
  const elements = [], relations = [], memberNodes = new Set(), memberWays = new Set();
  const first = await read(pbf, {keep: isFacilityElement, onElement: element => {
    if (element.type !== 'relation') { elements.push(element); return; }
    relations.push(element);
    for (const m of element.members || []) (m.type === 'node' ? memberNodes : m.type === 'way' ? memberWays : new Set()).add(m.ref);
  }});
  const points = new Map();
  let second = {kept: 0, withoutGeometry: 0};
  if (relations.length) {
    const members = await subset(pbf, [...[...memberNodes].map(id => `n${id}`), ...[...memberWays].map(id => `w${id}`)]);
    try {
      second = await read(members.file, {untaggedNodes: true,
        keep: e => e.type === 'node' ? memberNodes.has(e.id) : e.type === 'way' && memberWays.has(e.id),
        onElement: e => points.set(`${e.type}${e.id}`, e.type === 'node' ? {lat: e.lat, lon: e.lon} : e.geometry)});
    } finally { await members.remove(); }
  }
  for (const relation of relations) {
    // Member nodes with their position, member ways with their geometry;
    // member relations and members the extract lacks carry none.
    const members = (relation.members || []).map(m => {
      const found = points.get(`${m.type}${m.ref}`);
      return m.type === 'node' && found ? {...m, ...found} : m.type === 'way' && found ? {...m, geometry: found} : m;
    });
    const bounds = boundsOf(members.flatMap(m => m.geometry || (Number.isFinite(m.lat) ? [m] : [])));
    elements.push({...relation, members, ...(bounds ? {bounds} : {})});
  }
  return {elements, counts: {read: first.kept, relations: relations.length, memberNodes: memberNodes.size, memberWays: memberWays.size,
    membersRead: second.kept, waysWithoutGeometry: first.withoutGeometry + second.withoutGeometry}};
}

// Writes out/power-facilities.geojson(.gz) and out/manifest.json; returns the
// manifest, or null (nothing written) when the assembly does not cover the
// world.
export async function buildExtractPowerFacilities(pbf, report, out, {read = readElements, subset = osmiumSubset, now = () => new Date()} = {}) {
  checkAssembly(report);
  if (!coversWorld(report)) return null;
  const {elements, counts: extract} = await facilityElements(pbf, {read, subset});
  const data = powerFacilitiesGeoJSON({elements});
  if (!data.features.length) throw new Error('Refusing to publish an empty worldwide railway energy supply snapshot');
  const counts = {};
  for (const feature of data.features) counts[feature.properties.power_kind] = (counts[feature.properties.power_kind] || 0) + 1;
  // The Overpass build's eight 90° regions, each counted as an Overpass
  // bounding box holds a feature (its edges included); every feature here
  // comes from one assembly time.
  const coverage = worldRegions(90).map(bbox => ({bbox, timestamp: report.oldestTimestamp,
    features: data.features.filter(f => inBox(bbox, f.geometry)).length}));
  const manifest = {version: 6, built: now().toISOString(), source: 'OpenStreetMap via the Geofabrik extracts', license: 'ODbL-1.0',
    complete: true, features: data.features.length, counts, coverage, downloadedBytes: 0, oldestSource: report.oldestTimestamp, newestSource: report.newestTimestamp,
    selection: 'Explicit railway supplies, traction substations, railway-tagged power/storage facilities and 16.7/16.67 Hz traction power facilities. Ordinary utility, road fuel and general water facilities are excluded.',
    extract: {index: report.index, regions: report.regions, ...extract}};
  await mkdir(out, {recursive: true});
  await writeFile(join(out, 'power-facilities.geojson'), JSON.stringify(data));
  await writeFile(join(out, 'power-facilities.geojson.gz'), gzipSync(JSON.stringify(data)));
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// Whether any coordinate of a geometry lies in the box, edges included.
function inBox([s, w, n, e], geometry) {
  const coords = geometry.type === 'Point' ? [geometry.coordinates] : geometry.type === 'LineString' ? geometry.coordinates
    : geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
  return coords.some(([lon, lat]) => lat >= s && lat <= n && lon >= w && lon <= e);
}
