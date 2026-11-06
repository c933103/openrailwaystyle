// The one `osmium tags-filter` selection the extract pipeline runs over each
// Geofabrik region (#330, B2): the union of what every dataset's Overpass
// query selects, so one filtered file per region serves every builder.
// It may select more than the queries do (the builders still apply their
// own tests). The Unicode limitation below remains unresolved.
// tests/extract-filter.test.mjs
// checks that every key the Overpass queries test is selected here or is
// listed in REFINEMENTS.
//
// osmium matches values exactly and case-sensitively. A `*` at either end of
// a key or value is a wildcard. For the case-insensitive railway and traction
// hints, every ASCII casing of a three-letter substring is selected anywhere in
// the value. This covers all ASCII case combinations of each whole hint without
// selecting all usage or landuse values. It can also select unrelated values
// containing the substring. Non-ASCII equivalences accepted by Overpass are
// not proven covered; do not treat this as full Unicode case-folding parity.
//
// Without -R osmium also writes the objects the matches refer to: way nodes
// and relation members (and their nodes), so a filtered file has complete
// geometry for what it selects, within the region.
//
// The polar basemap (scripts/build-polar.mjs, polar-features.mjs) is not
// here: it reads roads, buildings, water and places in the two polar caps
// only, which would bring most of every region's data. It stays on Overpass.
import {STATES} from './lifecycle.mjs';

const PREFIXES = STATES.map(state => `${state}:`);
export const HERITAGE_HISTORIC = ['archaeological_site', 'battlefield', 'district'];

// All ASCII case combinations of a substring known to occur in the hint.
// osmium wildcards apply at the ends, not within a value. Short fragments keep
// the number of expressions bounded; the extract can therefore overselect.
function CASE_FORMS(key, fragment, use) {
  const forms = [...fragment].reduce((prefixes, char) =>
    prefixes.flatMap(prefix => [prefix + char, prefix + char.toUpperCase()]), ['']);
  return forms.map(form => [`nwr/${key}=*${form}*`, use]);
}

// [expression, datasets that need it]
export const EXTRACT_FILTERS = Object.freeze([
  // Every railway object, with its lifecycle prefixes and namespaced keys:
  // lifecycle, branch lines, service-route tracks, crossings (and the ways
  // through them), signals, stations, the loading-gauge list, power supplies
  // and chargers on railway land.
  ['nwr/railway', 'lifecycle, branch lines, railway ways, crossings, signals, stations, loading gauges, power facilities'],
  ['nwr/*:railway', 'lifecycle (state:railway), power facilities'],
  ['nwr/railway:*', 'signals (railway:signal:*), power facilities (railway:electricity)'],
  ['nwr/*:railway:electricity', 'power facilities (state:railway:electricity)'],
  ['nwr/public_transport=station', 'stations'],
  ['r/route=subway,light_rail,tram,monorail,train', 'service routes, railway ways'],
  ['w/embedded,embedded_rails', 'street running, crossings'],
  ['w/conveying', 'escalators and moving walkways'],
  ['w/highway=elevator', 'elevators'],
  ['w/aerialway', 'aerialways'],
  [`wr/historic=${HERITAGE_HISTORIC.join(',')}`, 'heritage'],
  ['wr/protect_class=22', 'heritage'],
  ['wr/heritage=1', 'heritage'],
  // Power facilities: a power or man_made object counts only with a railway
  // hint; the hints themselves are selected.
  ['nwr/substation,transformer', 'power facilities (traction hints)'],
  ...CASE_FORMS('usage', 'lwa', 'power facilities, chargers'),
  ...CASE_FORMS('usage', 'act', 'power facilities, chargers'),
  ...CASE_FORMS('landuse', 'lwa', 'power facilities, chargers'),
  ['nwr/frequency=*16.6*', 'power facilities'],
  ['nwr/frequency=*16.7*', 'power facilities'],
  // Power methods: conductor rails, propulsion and traction, on ways of any
  // lifecycle state; chargers with a railway hint.
  ['w/electrified,propulsion,traction', 'power methods'],
  ...['electrified', 'propulsion', 'traction'].map(key => [`w/${PREFIXES.map(prefix => prefix + key).join(',')}`, 'power methods (lifecycle states)']),
  ['nwr/train,tram,light_rail,subway', 'chargers (vehicle hints)'],
].map(([expression, use]) => Object.freeze({expression, use})));

// Keys the Overpass queries test only to narrow objects already selected by
// a key above, with the reason each is safe to leave out of the filter.
export const REFINEMENTS = Object.freeze({
  usage: 'branch lines: on railway ways; power: by value above',
  service: 'branch lines and crossings: on railway ways; route relations: route=train above',
  type: 'route and multipolygon relations: selected by route, historic, protect_class or heritage',
  route: 'selected above by value',
  embedded: 'selected above',
  'railway:signal:direction': 'signals: on railway=signal',
  'railway:signal:electricity': 'signals: on railway=signal or selected by railway:*',
  power: 'power facilities: only with a railway hint, all selected above',
  man_made: 'power facilities and chargers: only with a railway hint, all selected above',
  amenity: 'chargers: only with a railway or vehicle hint, all selected above',
  loading_gauge: 'loading gauges: on railway ways',
  train: 'selected above', tram: 'selected above', light_rail: 'selected above', subway: 'selected above',
  monorail: 'stations: on public_transport=station', funicular: 'stations: on public_transport=station',
  ...Object.fromEntries(STATES.map(state => [state, 'crossings: lifecycle mode tags on railway ways'])),
  ...Object.fromEntries(PREFIXES.flatMap(prefix => ['power', 'man_made', 'amenity'].map(key => [prefix + key, `as ${key}: only with a railway hint`]))),
});

// The expressions file for `osmium tags-filter -e`.
export const expressionsFile = () => `${EXTRACT_FILTERS.map(filter => filter.expression).join('\n')}\n`;

// Whether one expression selects a key, by osmium's key matching: the key
// list after the type prefix and before any `=`, each with an optional `*`
// at either end.
export function expressionKeys(expression) {
  const body = expression.replace(/^[nwr]+\//, '');
  const keys = body.split('=')[0];
  return keys.split(',');
}
export function keyMatches(pattern, key) {
  if (pattern.startsWith('*') && pattern.endsWith('*') && pattern.length > 1) return key.includes(pattern.slice(1, -1));
  if (pattern.startsWith('*')) return key.endsWith(pattern.slice(1));
  if (pattern.endsWith('*')) return key.startsWith(pattern.slice(0, -1));
  return key === pattern;
}
export const selectedKey = key => EXTRACT_FILTERS.some(({expression}) => expressionKeys(expression).some(pattern => keyMatches(pattern, key)));

// Whether the filter selects an object with this one tag, by osmium's
// value matching: exact values, a comma list of exact values, or one value
// with a `*` at either end.
export function valueMatches(pattern, value) {
  if (pattern.length > 1 && pattern.startsWith('*') && pattern.endsWith('*')) return value.includes(pattern.slice(1, -1));
  if (pattern.startsWith('*')) return value.endsWith(pattern.slice(1));
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
  return pattern.split(',').includes(value);
}
export const selectsTag = (key, value) => EXTRACT_FILTERS.some(({expression}) => {
  const body = expression.replace(/^[nwr]+\//, ''), at = body.indexOf('=');
  const keys = (at < 0 ? body : body.slice(0, at)).split(',');
  return keys.some(pattern => keyMatches(pattern, key)) && (at < 0 || valueMatches(body.slice(at + 1), value));
});
