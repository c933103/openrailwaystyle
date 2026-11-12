// Conductor rails, propulsion and traction means, and railway chargers built
// from the assembled Geofabrik extract (#330, step 9, group 4). The
// selection of powerMethodSelection (power-method-data.mjs), element by
// element, and its conversion (powerMethodsGeoJSON) on elements shaped as
// its `out body geom` answer gives them, as for the energy supplies
// (build-extract-power-facilities.mjs). Written as build-power-methods.mjs
// writes power/ (power-methods.geojson, its gzip copy and
// methods-manifest.json), by the same validated writer, only from an
// assembly that covers every region and gap tile, since the manifest
// certifies the whole world.
import {join} from 'node:path';
import {checkAssembly, coversWorld} from './build-extract-branch-lines.mjs';
import {readElements} from './extract-elements.mjs';
import {osmiumSubset} from './build-extract-station-points.mjs';
import {shapeRelations} from './build-extract-power-facilities.mjs';
import {powerMethodsGeoJSON} from './power-method-data.mjs';
import {publishPowerMethods} from './build-power-methods.mjs';
import {startRegions} from './crossing-data.mjs';

// The lists and the token pattern of powerMethodSelection: one of the
// options as a whole semicolon-separated value, POSIX whitespace around it,
// matched without regard to case.
const PREFIXES = ['', ...['construction', 'proposed', 'disused', 'abandoned', 'razed', 'demolished', 'removed'].map(state => `${state}:`)];
const TRACKS = 'rail|narrow_gauge|subway|light_rail|tram|monorail|miniature|funicular';
const token = options => new RegExp(`(^|;)[ \\t\\n\\v\\f\\r]*(${options})[ \\t\\n\\v\\f\\r]*(;|$)`, 'i');
const P = {methods: token('rail|4th_rail|ground-level_power_supply|inductive'), propulsion: token('linear_motor'), traction: token('rack|cable'),
  chargingRailway: token('charging_station'), amenity: token('charging_station'), chargePoint: token('charge_point'),
  mode: token('yes|designated|only'), railwayHint: token(`yes|power_supply|${TRACKS}`), usage: token('railway|traction'), landuse: token('railway')};
const matches = (tags, key, pattern) => typeof tags[key] === 'string' && pattern.test(tags[key]);

// The charging set's hints, as the query's selectors on `.potential` test them.
const chargerHint = tags => ['train', 'tram', 'light_rail', 'subway'].some(key => matches(tags, key, P.mode))
  || PREFIXES.some(prefix => matches(tags, `${prefix}railway`, P.railwayHint))
  || matches(tags, 'usage', P.usage) || matches(tags, 'landuse', P.landuse);
export function isMethodElement({type, tags = {}}) {
  if (type === 'way' && PREFIXES.some(prefix => matches(tags, `${prefix}electrified`, P.methods) || matches(tags, `${prefix}propulsion`, P.propulsion)
    || matches(tags, `${prefix}traction`, P.traction))) return true;
  if (PREFIXES.some(prefix => matches(tags, `${prefix}railway`, P.chargingRailway))) return true;
  const charger = PREFIXES.some(prefix => matches(tags, `${prefix}amenity`, P.amenity) || matches(tags, `${prefix}man_made`, P.chargePoint));
  return charger && chargerHint(tags);
}

export async function methodElements(pbf, {read = readElements, subset = osmiumSubset} = {}) {
  const elements = [], relations = [];
  const first = await read(pbf, {keep: isMethodElement, onElement: element => { (element.type === 'relation' ? relations : elements).push(element); }});
  const shaped = await shapeRelations(pbf, relations, {read, subset});
  elements.push(...shaped.relations);
  const {memberWaysWithoutGeometry, ...counts} = shaped.counts;
  return {elements, counts: {read: first.kept, ...counts, waysWithoutGeometry: first.withoutGeometry + memberWaysWithoutGeometry}};
}

// An Overpass bounding box holds its edges: a feature with a coordinate on
// one is counted in both boxes.
const inBox = ([s, w, n, e], geometry) => {
  const coords = geometry.type === 'Point' ? [geometry.coordinates] : geometry.type === 'LineString' ? geometry.coordinates
    : geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
  return coords.some(([lon, lat]) => lat >= s && lat <= n && lon >= w && lon <= e);
};

// Writes out/power-methods.geojson(.gz) and out/methods-manifest.json;
// returns the manifest, or null (nothing written) when the assembly does
// not cover the world.
export async function buildExtractPowerMethods(pbf, report, out, {read = readElements, subset = osmiumSubset, now = () => new Date()} = {}) {
  checkAssembly(report);
  if (!coversWorld(report)) return null;
  const {elements} = await methodElements(pbf, {read, subset});
  const data = powerMethodsGeoJSON({elements});
  if (!data.features.length) throw new Error('Refusing to publish empty worldwide conductor-rail and charging data');
  // The world's start regions as the coverage, each counted as an Overpass
  // bounding box holds a feature (a coordinate inside, edges included).
  const coverage = startRegions().map(({box}) => ({bbox: box, timestamp: report.oldestTimestamp, features: data.features.filter(f => inBox(box, f.geometry)).length}));
  const {manifest} = await publishPowerMethods(data, coverage, {output: join(out), requests: 0, downloadedBytes: 0, now: () => now().getTime(), log: () => {},
    source: 'OpenStreetMap via the Geofabrik extracts'});
  return manifest;
}
