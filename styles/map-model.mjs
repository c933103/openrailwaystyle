export {createPlatformLengths,platformLengthLabel,formatPlatformLength} from './platform-length.mjs?v=20261004-pr53-repair5';

export {axleLoad,formatAxleLoad,axlePaint,axleLabel} from './axle-load.mjs?v=20261004-pr53-repair5';
// The provider normalizes maxspeed to km/h; speed_label retains source units
// and both directional values. Never infer a limit from railway class.
export const SPEED_BANDS = [
  { min: 0, color: '#536da8', label: '< 40' },
  { min: 40, color: '#218aab', label: '40–79' },
  { min: 80, color: '#278454', label: '80–119' },
  { min: 120, color: '#9a8500', label: '120–159' },
  { min: 160, color: '#d98213', label: '160–199' },
  { min: 200, color: '#d24c35', label: '200–249' },
  { min: 250, color: '#ad2463', label: '250–299' },
  { min: 300, color: '#742da0', label: '≥ 300' },
];
// Imperial view: round mph bands close to the km/h ones, same colours.
export const MPH = 1.609344;
export const SPEED_BANDS_MPH = [0,25,50,75,100,125,155,185].map((min, i, all) => ({
  min, kmh: min*MPH, color: SPEED_BANDS[i].color,
  label: i === 0 ? `< ${all[1]}` : i === all.length-1 ? `≥ ${min}` : `${min}–${all[i+1]-1}`,
}));
export const speedBands = units => units === 'imperial' ? SPEED_BANDS_MPH : SPEED_BANDS;
export const UNKNOWN_COLOR = '#899197';
export const ORM = 'https://openrailwaymap.app';
// Public API explicitly supports cross-origin clients; the vector site's
// same-origin /api/facility endpoint is not suitable for GitHub Pages.
export const SEARCH_API = 'https://api.openrailwaymap.org/v2/facility';
// OpenStreetMap's geocoder, for stations mapped as areas (the facility API
// holds station nodes only: Sha Tin, a way, cannot be found there) and for
// ordinary place names, listed below the railway results.
export const PLACE_SEARCH_API = 'https://nominatim.openstreetmap.org/search';
const RAIL_PLACES = {railway: ['station', 'halt', 'tram_stop'], building: ['train_station']};
// A public_transport=station result (Nominatim gives one category per
// object) is a railway station only with rail evidence among its tags
// (asked for with extratags=1); bus, coach and ferry stations are places.
const RAIL_MODES = ['train', 'subway', 'light_rail', 'monorail', 'tram'];
const isRailPlace = place => RAIL_PLACES[place.category]?.includes(place.type) ||
  (place.category === 'public_transport' && place.type === 'station' &&
    (['station', 'halt', 'tram_stop'].includes(place.extratags?.railway) || RAIL_MODES.some(mode => place.extratags?.[mode] === 'yes')));
// Two station names are the same when equal, or when one is the other plus
// only a name in another script ("大埔墟 Tai Po Market" and "Tai Po Market"),
// not when the rest is more of the same script ("Central Park" is not
// "Central").
const LATIN = /[A-Za-z\u00C0-\u024F]/, OTHER_LETTER = /[^\P{L}A-Za-z\u00C0-\u024F]/u;
export function samePlaceName(a, b) {
  // The word for station does not tell stations apart.
  const tidy = v => String(v).toLowerCase().replace(/(\s+(railway |train |mtr )?station|站|駅|역)(?=\s|$)/gu, '').replace(/\s+/g, ' ').trim();
  [a, b] = [tidy(a), tidy(b)].sort((x, y) => x.length - y.length);
  if (!a || a.length < 2) return false;
  if (a === b) return true;
  if (!b.includes(a)) return false;
  const rest = b.replace(a, '');
  return LATIN.test(a) ? !LATIN.test(rest) : !OTHER_LETTER.test(rest);
}
// Facility API results and geocoder results → {rail, places}. A geocoded
// station joins the railway results unless the facility API already gave it
// (the same node, or the same name within about 400 m).
// Stations drawn in the map's own tiles whose name a search matches, for
// the stations neither search service finds: the facility search holds
// station nodes only, and the geocoder matches whole names ("Sha tin" finds
// Sha Tin, not Sha Tin Wai). A Latin query must begin a word of the name;
// one in other scripts may stand anywhere in it. Exact names come first,
// then the nearest to `centre` ([lng, lat]); stations the facility search
// already found are left out. Returned in the facility search's form, with
// the OSM object named.
const STATION_FEATURES = ['station', 'halt', 'tram_stop'];
export function tileStations(features, query, centre, found = [], limit = 8) {
  const q = String(query).trim().replace(/\s+/g, ' ');
  if (q.length < 2) return [];
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = LATIN.test(q) ? new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}`, 'iu') : new RegExp(escaped, 'iu');
  const near = (a, b) => Math.abs(a.latitude - b.latitude) < 0.004 && Math.abs(a.longitude - b.longitude) * Math.cos(a.latitude * Math.PI / 180) < 0.004;
  // Names in a language (name:en, name:zh-Hant, name:ja_kana), not name:etymology and the like.
  const namesOf = p => Object.entries(p).filter(([key, value]) => (/^name(:[a-z]{2,3}([-_][A-Za-z0-9]+)*)?$/.test(key) || key === 'localized_name' || key === 'atlas_name') && typeof value === 'string').map(([, value]) => value);
  const [cx, cy] = centre || [0, 0], matches = new Map();
  for (const feature of features) {
    const p = feature.properties || {}, coordinates = feature.geometry?.coordinates;
    // The overview tiles leave out the feature field: stations, as the style draws them.
    const kind = p.feature ?? 'station';
    if (feature.geometry?.type !== 'Point' || !STATION_FEATURES.includes(kind) || (p.state ?? 'present') !== 'present') continue;
    const names = namesOf(p);
    if (!names.some(n => pattern.test(n))) continue;
    const object = /^(node|way|relation)-(\d+)/.exec(String(p.id ?? ''));
    const [longitude, latitude] = coordinates, key = object ? object[0] : `${p.name}@${longitude.toFixed(4)},${latitude.toFixed(4)}`;
    if (matches.has(key)) continue;
    const item = {...p, latitude, longitude, railway: kind, ...(object && {osm_type: object[1], osm_id: Number(object[2])})};
    // The facility search returns nodes; a way or relation with the same number is another object.
    if (found.some(r => (object && object[1] === (r.osm_type ?? 'node') && String(r.osm_id) === object[2]) || (near(r, item) && namesOf(r).some(n => names.some(m => samePlaceName(n, m)))))) continue;
    const exact = names.some(n => samePlaceName(n, q)), dx = ((longitude - cx) % 360 + 540) % 360 - 180, distance = Math.hypot(dx * Math.cos(latitude * Math.PI / 180), latitude - cy);
    matches.set(key, {item, exact, distance});
  }
  return [...matches.values()].sort((a, b) => (b.exact - a.exact) || a.distance - b.distance).slice(0, limit).map(({item}) => item);
}
// What the station name layers draw at this zoom, as querySourceFeatures
// queries: each source with its layers' filters, the zoom put in (a source
// query evaluates ['zoom'] at the tile's zoom, not the map's). As a literal,
// so [">=", zoom, 10] is not read as a legacy filter.
export function drawnStationQueries(layers, zoom) {
  const at = v => !Array.isArray(v) || v[0] === 'literal' ? v : v.length === 1 && v[0] === 'zoom' ? ['literal', zoom] : v.map(at);
  const queries = new Map();
  for (const layer of layers) {
    if (layer.type !== 'symbol' || !/^station-.*-names$/.test(layer.id) || layer.layout?.visibility === 'none' || zoom < (layer.minzoom ?? 0) || zoom >= (layer.maxzoom ?? 24)) continue;
    const query = queries.get(layer.source) || {source: layer.source, sourceLayer: layer['source-layer'], filters: []};
    query.filters.push(layer.filter ? at(layer.filter) : true);
    queries.set(layer.source, query);
  }
  return [...queries.values()].map(({source, sourceLayer, filters}) => ({source, sourceLayer, filter: ['any', ...filters]}));
}
export function searchResults(facilities, places) {
  const located = item => Number.isFinite(item.longitude) && Number.isFinite(item.latitude);
  const rail = facilities.filter(located), others = [];
  const near = (a, b) => Math.abs(a.latitude - b.latitude) < 0.004 && Math.abs(a.longitude - b.longitude) * Math.cos(a.latitude * Math.PI / 180) < 0.004;
  const names = item => new Set(Object.entries(item).filter(([key, value]) => (key === 'name' || key.startsWith('name:')) && typeof value === 'string').map(([, value]) => value.toLowerCase()));
  for (const place of places) {
    const details = place.namedetails || {};
    const item = {...details, name: details.name || place.name || String(place.display_name || '').split(',')[0], latitude: Number(place.lat), longitude: Number(place.lon),
      osm_id: place.osm_id, osm_type: place.osm_type, area: String(place.display_name || '').split(',').slice(1).join(',').trim(),
      ...(Array.isArray(place.boundingbox) && {boundingbox: place.boundingbox.map(Number)})};
    if (!located(item)) continue;
    if (isRailPlace(place)) {
      const own = names(item);
      const sameName = r => [...names(r)].some(n => [...own].some(o => samePlaceName(n, o)));
      // The same OSM object, by type and number (facility results are nodes).
      if (rail.some(r => (place.osm_type === (r.osm_type ?? 'node') && String(r.osm_id) === String(place.osm_id)) || (near(r, item) && sameName(r)))) continue;
      rail.push({...item, railway: ['station', 'train_station'].includes(place.type) ? 'station' : place.type});
    } else others.push({...item, place: place.addresstype || place.type});
  }
  return {rail, places: others};
}
// Map background: the drawn base map, satellite imagery alone, or imagery
// under the railways (hybrid).
export const BACKGROUNDS = ['map', 'satellite', 'hybrid', 'carto'];
// Standard OSM tiles: ordinary browser caching, no offline/prefetch support.
export const CARTO_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const MODES = ['speed', 'infrastructure', 'electrification', 'control', 'gauge', 'loading', 'service', 'owner', 'axle'];
export const LANGUAGES = [
  ['local','Local names'], ['en','English'], ['ko','한국어'], ['ja','日本語'],
  ['zh-Hant','繁體中文'], ['zh-Hans','简体中文'], ['de','Deutsch'], ['fr','Français'],
  ['ru','Русский'], ['es','Español'], ['pt','Português'], ['it','Italiano'], ['nl','Nederlands'],
];
const language = value => LANGUAGES.some(([code]) => code === value) ? value : 'local';
export const INFRASTRUCTURE = [
  ['#d7191c', 'High-speed line'], ['#2356b6', 'Railway'],
  ['#00865a', 'Branch line'], ['#8226b0', 'Metro / light rail'],
  ['#df7900', 'Tram'], ['#747d86', 'Service tracks'],
];
// Colours from hue, saturation and lightness (percent).
export function hsl(h, s, l) {
  s /= 100; l /= 100;
  const f = n => { const k = (n + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
// Electrification. A train needs both the voltage and the frequency, so each
// system is a hue (DC, or AC by frequency) and the voltage its shade: darker
// is higher voltage, varying smoothly (e.g. 20 and 25 kV at 50 Hz are close
// shades of one hue). Frequency 0 means DC in the provider's data.
export const CURRENT_SYSTEMS = [
  {id:'dc', label:'DC', hue:275, sat:55, volts:[[600, 70], [1500, 50], [3000, 32]]},
  {id:'ac16', label:'AC 16.7 Hz', hue:145, sat:55, volts:[[11000, 55], [15000, 34]]},
  {id:'ac25', label:'AC 25 Hz', hue:75, sat:65, volts:[[6600, 58], [12500, 34]]},
  {id:'ac50', label:'AC 50 Hz', hue:8, sat:68, volts:[[6250, 70], [15000, 52], [25000, 38], [50000, 25]]},
  {id:'ac60', label:'AC 60 Hz', hue:32, sat:85, volts:[[12500, 62], [20000, 48], [25000, 40], [50000, 28]]},
];
export const NOT_ELECTRIFIED = '#525b62';
const kv = v => v >= 1000 ? `${Number((v / 1000).toFixed(2))} kV` : `${v} V`;
export const currentRange = system => `${kv(system.volts[0][0])} – ${kv(system.volts.at(-1)[0])}`;
export const currentStops = system => system.volts.map(([v, l]) => [v, hsl(system.hue, system.sat, l)]);
export function electrificationPaint() {
  const volts = ['to-number', ['coalesce', ['get', 'voltage'], -1], -1];
  const hz = ['to-number', ['coalesce', ['get', 'frequency'], -1], -1];
  const shade = system => {
    const stops = currentStops(system);
    // Unknown voltage: the system's middle shade.
    return ['case', ['<', volts, 0], stops[Math.floor(stops.length / 2)][1], ['interpolate', ['linear'], volts, ...stops.flat()]];
  };
  const [dc, ac16, ac25, ac50, ac60] = CURRENT_SYSTEMS;
  return ['case',
    ['match', ['get', 'electrification_state'], ['no', 'deelectrified'], true, false], NOT_ELECTRIFIED,
    ['==', volts, 0], NOT_ELECTRIFIED,
    ['==', hz, 0], ['case', ['<', volts, 0], UNKNOWN_COLOR, shade(dc)],
    ['<', hz, 0], UNKNOWN_COLOR,
    ['<', hz, 20], shade(ac16), ['<', hz, 40], shade(ac25), ['<', hz, 55], shade(ac50), shade(ac60)];
}
export function describeCurrent(voltage, frequency) {
  const v = typeof voltage === 'number' ? kv(voltage) : '';
  if (typeof frequency !== 'number') return v ? `${v}, current type not recorded` : '';
  const current = frequency === 0 ? 'DC' : `AC ${Number(frequency.toFixed(2))} Hz`;
  return v ? `${v} ${current}` : `${current}, voltage not recorded`;
}
// Train protection and control. Hue follows lineage (systems derived from or
// compatible with one another share a hue); shade follows how advanced the
// system is, darker being more advanced:
//   1 warning or train stop only, no speed supervision
//   2 spot transmission (balises, magnets, loops at points) with supervision
//   3 continuous transmission to the cab (coded track circuits, cable loops)
//   4 radio-based movement authority (incl. moving block)
// Codes are OpenRailwayMap's. Some codes are used for different systems in
// different countries (atc, ats, atp, ptc); they sit in the "various" family.
export const CONTROL_LEVELS = ['No automatic protection', 'Warning or train stop only', 'Spot transmission with speed supervision', 'Continuous transmission to the cab', 'Radio-based movement authority'];
export const CONTROL_FAMILIES = {
  etcs: {label:'ETCS', hue:215, sat:75, note:'European standard. ETCS on-board units handle every level.'},
  ctcs: {label:'CTCS (China, derived from ETCS)', hue:188, sat:80, note:'CTCS-2 adds balises to track circuits, compatible with ETCS level 1; CTCS-3 is functionally equivalent to ETCS level 2 (GSM-R). CTCS-3 trains can also run on CTCS-2 lines, though that compatibility has been reported as imperfect.'},
  ktcs: {label:'KTCS (Korea, ETCS-based)', hue:238, sat:55, note:'Korean standard meeting ETCS level 1 and 2 standards.'},
  etcsParts: {label:'National systems on ETCS hardware', hue:200, sat:35, note:'Built from ETCS components (Eurobalises) but not compatible with ETCS.'},
  german: {label:'German and Swiss systems', hue:12, sat:75, note:'LZB lines in Germany also have PZB.'},
  french: {label:'French and Paris (RATP) systems', hue:140, sat:60, note:'KVB on conventional lines; TVM cab signalling on high-speed lines (also on Korean KTX lines).'},
  british: {label:'British and Irish systems', hue:46, sat:85, note:'TPWS adds train stops and overspeed checks to AWS.'},
  ebicab: {label:'EBICAB (Sweden, Norway, Portugal, Finland…)', hue:295, sat:50, note:'EBICAB 700 is used in Sweden and Norway (as ATC) and Portugal (as CONVEL); EBICAB 900 in Finland (JKV) and Spain.'},
  japan: {label:'Japanese systems', hue:335, sat:65, note:'ATACS is radio-based moving block.'},
  soviet: {label:'Post-Soviet systems', hue:355, sat:45, note:'ALS continuous cab signalling over coded track circuits.'},
  american: {label:'North American PTC', hue:25, sat:55, note:'PTC is the US umbrella requirement; I-ETMS, ACSES, ITCS and E-ATC are systems meeting it.'},
  metro: {label:'CBTC (metro)', hue:318, sat:80, note:'Vendor-specific; trains generally work only with their own line’s system.'},
  national: {label:'Other national systems', hue:58, sat:30, note:'Unrelated national systems; shade still shows how advanced each is.'},
  various: {label:'Codes used for different systems by country', hue:250, sat:12, note:'OpenRailwayMap uses this code for different systems in different countries.'},
};
export const TRAIN_PROTECTION = [
  ['etcs_2', 'ETCS level 2', 'etcs', 4], ['etcs_1', 'ETCS level 1', 'etcs', 2], ['etcs', 'ETCS (level not recorded)', 'etcs', 2],
  ['ctcs_3', 'CTCS-3', 'ctcs', 4], ['ctcs_2', 'CTCS-2', 'ctcs', 3], ['ctcs', 'CTCS-0/1 (LKJ)', 'ctcs', 2],
  ['ktcs', 'KTCS', 'ktcs', 4],
  ['zbs', 'ZBS (Berlin S-Bahn)', 'etcsParts', 2], ['zsi127', 'ZSI 127 (Swiss metre gauge)', 'etcsParts', 2],
  ['lzb', 'LZB', 'german', 3], ['pzb', 'PZB (Indusi)', 'german', 2], ['zub', 'ZUB (Switzerland, Denmark)', 'german', 2],
  ['zsl90', 'ZSL 90', 'german', 3], ['zst90', 'ZST-90 (Zugstop)', 'german', 1],
  ['tvm', 'TVM', 'french', 3], ['kvb', 'KVB', 'french', 2], ['kvbp', 'KVBP', 'french', 2], ['kcvb', 'KCVB', 'french', 3],
  ['kcvp', 'KCVP', 'french', 3], ['sacem', 'SACEM', 'french', 3], ['ouragan', 'OURAGAN', 'french', 3], ['octys', 'OCTYS', 'french', 3],
  ['saet', 'SAET (automated lines)', 'french', 4], ['nexteo', 'NExTEO', 'french', 4],
  ['tpws', 'TPWS', 'british', 2], ['aws', 'AWS', 'british', 1], ['caws', 'CAWS (Ireland)', 'british', 1],
  ['ebicab', 'EBICAB / CONVEL', 'ebicab', 2], ['jkv', 'JKV (EBICAB 900)', 'ebicab', 2],
  ['atacs', 'ATACS', 'japan', 4],
  ['als', 'ALS (АЛС)', 'soviet', 3], ['satp', 'SATP', 'soviet', 2],
  ['etms', 'I-ETMS', 'american', 4], ['itcs', 'ITCS', 'american', 4], ['eatc', 'E-ATC', 'american', 4],
  ['acses', 'ACSES', 'american', 3], ['ases', 'ASES', 'american', 3],
  ['cbtc', 'CBTC', 'metro', 4],
  ['atb', 'ATB (Netherlands)', 'national', 3], ['tbl', 'TBL (Belgium)', 'national', 2], ['asfa', 'ASFA (Spain)', 'national', 2],
  ['scmt', 'SCMT (Italy)', 'national', 2], ['ssc', 'SSC (Italy)', 'national', 2], ['ls', 'LS (Czechia, Slovakia)', 'national', 3],
  ['evm', 'EVM (Hungary)', 'national', 3], ['shp', 'SHP (Poland)', 'national', 1],
  ['atms', 'ATMS (Australia)', 'national', 4], ['tmacs', 'TMACS (Australia)', 'national', 4],
  ['atc', 'ATC (Japanese ATC; EBICAB-based ATC in Scandinavia; others)', 'various', 3],
  ['ats', 'ATS / train stops (Japan, Australia, others)', 'various', 1],
  ['atp', 'ATP (generic)', 'various', 2], ['ptc', 'PTC (generic)', 'various', 4],
  ['tcb', 'Track circuit block, no train protection', 'national', 0], ['twc', 'Track warrant control, no train protection', 'national', 0],
  ['none', 'No train protection', 'national', 0],
];
export const NO_PROTECTION = '#dcd0c2';
const LEVEL_LIGHTNESS = [null, 68, 54, 41, 28];
export const controlColor = (family, level) => level === 0 ? NO_PROTECTION : hsl(CONTROL_FAMILIES[family].hue, CONTROL_FAMILIES[family].sat, LEVEL_LIGHTNESS[level]);
export const familyShades = family => [1, 2, 3, 4].map(level => controlColor(family, level));
export const trainProtection = code => TRAIN_PROTECTION.find(([c]) => c === code);
export const trainProtectionName = code => trainProtection(code)?.[1] || code;
// The provider publishes three simultaneous systems in both overview and
// detailed tiles (import/sql/tile_views.sql). Keep distinct codes even when
// their colours coincide, and ignore repeated or empty slots.
export function trainProtectionSystems(properties = {}) {
  const normalize = code => {
    const text = String(code ?? '').trim(), lower = text.toLowerCase();
    return lower === 'no' ? 'none' : trainProtection(lower) ? lower : text;
  };
  const slots = [0, 1, 2].map(i => properties[`train_protection${i}`]);
  const raw = properties.train_protection ?? properties['railway:train_protection'];
  const values = [...slots, ...(Array.isArray(raw) ? raw : String(raw ?? '').split(';'))];
  return [...new Set(values.map(normalize).filter(Boolean))];
}
function controlPropertiesExpression(result) {
  const bindings = [0, 1, 2].flatMap(i => {
    const raw = ['to-string', ['coalesce', ['get', `train_protection${i}`], '']], lower = ['downcase', raw];
    return [`p${i}`, ['case', ['==', lower, 'no'], 'none', ['in', lower, ['var', 'known']], lower, raw]];
  });
  // A binding can read enclosing lets, but not earlier names in its own let.
  return ['let', 'known', ['literal', TRAIN_PROTECTION.map(([code]) => code)], ['let', ...bindings, result]];
}
function controlSlotsExpression(result) {
  const p0 = ['var','p0'], p1 = ['var','p1'], p2 = ['var','p2'], a = ['var','a'], b = ['var','b'];
  return controlPropertiesExpression(
    ['let', 'a', ['case', ['!=', p0, ''], p0, ['!=', p1, ''], p1, p2],
      ['let', 'b', ['case', ['all', ['!=', p1, ''], ['!=', p1, a]], p1, ['all', ['!=', p2, ''], ['!=', p2, a]], p2, ''],
        ['let', 'c', ['case', ['all', ['!=', p2, ''], ['!=', p2, a], ['!=', p2, b]], p2, ''], result]]]);
}
export function controlSystemExpression(index = 0) {
  if (!Number.isInteger(index) || index < 0 || index > 2) throw new RangeError('Control system slot must be 0, 1 or 2');
  return controlSlotsExpression(['var', ['a','b','c'][index]]);
}
export function controlCountExpression() {
  const p0 = ['var','p0'], p1 = ['var','p1'], p2 = ['var','p2'];
  return controlPropertiesExpression(['+',
    ['case', ['!=', p0, ''], 1, 0],
    ['case', ['all', ['!=', p1, ''], ['!=', p1, p0]], 1, 0],
    ['case', ['all', ['!=', p2, ''], ['!=', p2, p0], ['!=', p2, p1]], 1, 0]]);
}
export function controlPaint(index = 0) {
  return ['match', controlSystemExpression(index), ...TRAIN_PROTECTION.flatMap(([code, , family, level]) => [code, controlColor(family, level)]), UNKNOWN_COLOR];
}
// Track gauge on a continuous scale: gauges a few millimetres apart (1432 and
// 1435, 1520 and 1524) get nearly the same colour, gauges far apart differ.
// Anchors sit at common gauges and keep their colour within ±10 mm (the
// usual tolerance between nominally different but compatible gauges);
// colours blend only between those bands.
export const GAUGE_ANCHORS = [
  [381, '#5b3f86'], [600, '#8a5fb3'], [762, '#c26fbf'], [914, '#e2729b'], [1000, '#2f9e44'], [1067, '#17a2b8'],
  [1372, '#8fb339'], [1435, '#1f5fbf'], [1520, '#d62728'], [1600, '#8c564b'], [1672, '#e07b00'], // 1668 Iberian and 1676 Indian share one band
];
const GAUGE_BAND = 10;
export const GAUGE_STOPS = GAUGE_ANCHORS.flatMap(([mm, color], i, all) => {
  const low = i ? Math.max(mm - GAUGE_BAND, (all[i-1][0] + mm) / 2) : mm, high = i < all.length - 1 ? Math.min(mm + GAUGE_BAND, (mm + all[i+1][0]) / 2) : mm;
  return low === high ? [[mm, color]] : [[low, color], [high, color]];
});
export function gaugePaint(index = 0) {
  const mm = ['to-number', ['coalesce', ['get', `gaugeint${index}`], -1], -1];
  return ['case', ['<=', mm, 0], UNKNOWN_COLOR, ['interpolate', ['linear'], mm, ...GAUGE_STOPS.flat()]];
}
// Colour at a value on piecewise-linear colour stops, as MapLibre's
// 'interpolate' does, so legends can show the exact colour of what is drawn.
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export function interpolateColor(stops, value) {
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (value > v1) continue;
    const [v0, c0] = stops[i - 1], t = v1 === v0 ? 1 : (value - v0) / (v1 - v0), a = rgb(c0), b = rgb(c1);
    return '#' + a.map((x, k) => Math.round(x + (b[k] - x) * t).toString(16).padStart(2, '0')).join('');
  }
  return stops.at(-1)[1];
}
export function electrificationColor(p) {
  const volts = typeof p.voltage === 'number' ? p.voltage : -1, hz = typeof p.frequency === 'number' ? p.frequency : -1;
  if (['no', 'deelectrified'].includes(p.electrification_state) || volts === 0) return NOT_ELECTRIFIED;
  if (hz < 0 || (hz === 0 && volts < 0)) return UNKNOWN_COLOR;
  const system = hz === 0 ? CURRENT_SYSTEMS[0] : CURRENT_SYSTEMS[hz < 20 ? 1 : hz < 40 ? 2 : hz < 55 ? 3 : 4];
  const stops = currentStops(system);
  return volts < 0 ? stops[Math.floor(stops.length / 2)][1] : interpolateColor(stops, volts);
}
export const gaugeColor = mm => mm > 0 ? interpolateColor(GAUGE_STOPS, mm) : UNKNOWN_COLOR;
// Short system names for labels along the track.
export const trainProtectionShort = code => ({etcs_2: 'ETCS L2', etcs_1: 'ETCS L1', etcs: 'ETCS', ctcs_3: 'CTCS-3', ctcs_2: 'CTCS-2', ctcs: 'CTCS-0/1',
  tcb: 'TCB', twc: 'TWC', none: 'none', atc: 'ATC', ats: 'ATS', atp: 'ATP', ptc: 'PTC', etms: 'I-ETMS'})[code]
  || (trainProtection(code)?.[1] || code || '').replace(/ \(.*\)$/, '');
// Loading gauge. Names differ by region and are not comparable by name, so
// colour follows the physical envelope: the maximum height above rail of
// the static profile, where published (Wikipedia, Loading gauge; UIC 506 /
// TSI, GOST 9238, AAR clearance plates, Portuguese PT gauges). Gauges of
// equal height share a colour: GA, GB, GB1 and GB2 all reach 4.32 m and
// differ only in the upper corners. Britain's W gauges form their own
// ladder: W6A is the standard wagon envelope, and W7 to W12 are load gauges
// (the containers and swap bodies a W6A wagon may carry), with height and
// width from the co-ordinate tables of RSSB GE/RT8073 (issue 4.1, 2022).
// Additional profile sources and measurement bases: docs/loading-gauges.md.
// EBV dimensions are kinematic reference profiles. Metro tags name networks,
// not one envelope: their named vehicle examples stay separate from gauge size.
// Other values are shown as tagged.
const FT = (ft, inch = 0) => Math.round((ft * 12 + inch) * 25.4) / 1000;
const W_NOTE = 'W7 to W12 are load gauges: the envelope of containers or swap bodies on W6A wagons (RSSB GE/RT8073).';
export const LOADING_GAUGES = [
  // code(s), name, height m, width m, family, note, optional dimension metadata
  [['PPI', 'G1', 'TSI_G1'], 'PPI (G1, Berne gauge)', 4.28, 3.15, 'height'],
  [['TSI_GA', 'GA'], 'GA', 4.32, 3.15, 'height', 'GA, GB, GB1 and GB2 reach the same height; each clears larger upper corners (containers, swap bodies, semi-trailers).'],
  [['TSI_GB', 'GB'], 'GB', 4.32, 3.15, 'height'], [['TSI_GB1', 'GB1'], 'GB1', 4.32, 3.15, 'height'], [['TSI_GB2', 'GB2'], 'GB2', 4.32, 3.15, 'height'],
  [['CPb', 'CPb+'], 'CPb / CPb+ (Portugal)', 4.5, 3.44, 'height'],
  [['UIC_C', 'G2'], 'G2 (formerly UIC C)', 4.65, 3.15, 'height'], [['TSI_GC', 'GC'], 'GC', 4.65, 3.15, 'height'],
  [['PT c'], 'PT c (Portugal)', 4.7, 3.44, 'height'],
  // AAR clearance plates (North America): 10 ft 8 in wide unless noted.
  [['AAR_B', 'AAR B'], 'AAR Plate B', FT(15, 1), FT(10, 8), 'height'],
  [['AAR_C', 'AAR C'], 'AAR Plate C', FT(15, 6), FT(10, 8), 'height'],
  [['AAR_E', 'AAR E'], 'AAR Plate E', FT(15, 9), FT(10, 8), 'height'],
  [['AAR_F', 'AAR F'], 'AAR Plate F', FT(17), FT(10, 8), 'height'],
  [['GOST_T'], 'T (GOST 9238, 1520 mm network)', 5.3, 3.75, 'height'],
  [['AAR_J', 'AAR J'], 'AAR Plate J', FT(19), FT(10, 8), 'height'],
  [['AAR_H', 'AAR H'], 'AAR Plate H', FT(20, 2), FT(10, 8), 'height', 'Double-stack container cars.'],
  [['AAR_K', 'AAR K'], 'AAR Plate K', FT(20, 3), FT(10), 'height', 'Autoracks and double-stack cars.'],
  [['W5'], 'W5', 3.965, 2.74, 'british', 'Historic British stationary-vehicle outline in the W5 comparison published by ITS Leeds (1989, Figure 1); dimensions are approximate. W6 subsequently enlarged the profile.', {basis: 'Approx. historic outline'}],
  [['W6'], 'W6', 3.965, 2.82, 'british', 'Height and width as W6A, which changed only the lower body (for third-rail electrification); W6 itself is no longer in GE/RT8073.'],
  [['W6A', 'W6A*'], 'W6A', 3.965, 2.82, 'british', 'Standard British wagon envelope, available over most of the network.'],
  [['W7', 'W7*'], 'W7', 3.965, 2.82, 'british', '8 ft 0 in (2.44 m) high containers on W6A wagons. ' + W_NOTE],
  [['W7A'], 'W7a', 3.635, 2.525, 'british', 'Supplementary upper load profile introduced in 2020 (RSSB T1132); includes fastening tolerance. ' + W_NOTE],
  [['W8', 'W8*'], 'W8', 3.965, 2.82, 'british', '8 ft 6 in (2.59 m) high containers on W6A wagons. ' + W_NOTE],
  [['W8A'], 'W8a', 3.635, 2.643, 'british', 'Introduced in 2020 (RSSB research T1132). ' + W_NOTE],
  [['W9'], 'W9', 3.965, 2.796, 'british', 'Swap bodies; 9 ft 0 in containers on low wagons. ' + W_NOTE],
  [['W9A'], 'W9a', 3.866, 2.625, 'british', 'Supplementary upper load profile introduced in 2020 (RSSB T1132); includes fastening tolerance. ' + W_NOTE],
  [['W9Plus'], 'W9Plus', 3.965, 2.796, 'british', 'Historic upper load profile, withdrawn from GE/RT8073 in 2020. Its maximum height and width match W9, but the upper corners differ.', {basis: 'Withdrawn profile'}],
  [['W10'], 'W10', 3.891, 2.525, 'british', '9 ft 6 in high-cube containers on standard wagons; 2.5 m wide Euro containers. ' + W_NOTE],
  [['W10A'], 'W10a', 3.891, 2.525, 'british', W_NOTE],
  [['W11'], 'W11', 3.896, 2.625, 'british', 'Historic upper load profile, withdrawn from GE/RT8073 in 2015. These are outline dimensions above rail, including allowances, rather than the 9 ft 6 in × 2.55 m container dimensions.', {basis: 'Withdrawn profile'}],
  [['W12'], 'W12', 3.965, 2.6, 'british', 'As W10, and 2.6 m wide refrigerated containers; recommended for new structures. ' + W_NOTE],
  [['EBV 1', 'EBV1', 'EBV O1'], 'EBV 1 (Switzerland)', 4.53, 3.29, 'other', 'EBV O1 upper kinematic reference profile (AB-EBV 18.2/47.2, sheet 7 N). Vehicle construction dimensions require the associated reductions.', {basis: 'Reference profile'}],
  [['EBV 2', 'EBV2', 'EBV O2'], 'EBV 2 (Switzerland)', 4.63, 3.29, 'other', 'EBV O2 upper kinematic reference profile (AB-EBV, sheet 8 N). Same maximum dimensions as O3, with different upper corners.', {basis: 'Reference profile'}],
  [['EBV 3', 'EBV3', 'EBV O3'], 'EBV 3 (Switzerland)', 4.63, 3.29, 'other', 'EBV O3 upper kinematic reference profile (AB-EBV, sheet 9 N). Same maximum dimensions as O2, with wider upper corners.', {basis: 'Reference profile'}],
  [['EBV 4', 'EBV4', 'EBV O4'], 'EBV 4 (Switzerland)', 4.7, 3.29, 'other', 'EBV O4 upper kinematic reference profile (AB-EBV, sheet 10 N); this sheet applies to infrastructure. It is not a rectangular vehicle envelope.', {basis: 'Reference profile'}],
  [['FS'], 'FS (Italian profile)', 4.3, 3.2, 'other', 'RFI (FS) / FN loading outline: UIC Loading Guidelines, volume 1, table 1.7 (2026).'],
  [['deep-tube'], 'London deep tube', null, null, 'metro', 'Vehicle example from TfL: 1992 Tube Stock, width over doors. Clearance profiles vary by line and are not tunnel diameters.', {basis: 'Vehicle example (1992 Stock)', example: {height: 2.869, width: 2.62}}],
  [['subsurface'], 'London sub-surface', null, null, 'metro', 'Vehicle example from TfL: S Stock, width over doors. This describes the train, not a universal sub-surface clearance profile.', {basis: 'Vehicle example (S Stock)', example: {height: 3.682, width: 2.92}}],
  [['Kleinprofil'], 'Kleinprofil (Berlin U-Bahn)', null, null, 'metro', 'Vehicle example: Stadler / BVG JK datasheet (2024). Dimensions describe this train type, not the complete clearance profile.', {basis: 'Vehicle example (JK)', example: {height: 3.16, width: 2.4}}],
  [['Großprofil', 'Grossprofil'], 'Großprofil (Berlin U-Bahn)', null, null, 'metro', 'Vehicle example: Stadler / BVG J datasheet. Dimensions describe this train type, not the complete clearance profile.', {basis: 'Vehicle example (J)', example: {height: 3.425, width: 2.65}}],
];
const LOADING_HEIGHT_STOPS = [[4.28, '#a5d66b'], [4.32, '#43a047'], [4.5, '#00897b'], [4.65, '#1e88e5'], [4.72, '#3949ab'], [4.8, '#5e35b1'], [5.3, '#8e24aa'], [6.2, '#6a1b4d']];
const BRITISH_LADDER = ['W5', 'W6', 'W6A', 'W7', 'W7A', 'W8', 'W8A', 'W9', 'W9A', 'W9Plus', 'W10', 'W10A', 'W11', 'W12'];
export const LOADING_OTHER = '#a1887f', LOADING_METRO = '#b0a4c8';
// "AAR F", "AAR-F", "aar_f" and "AARF" are all Plate F.
const aarCode = value => value.replace(/^AAR[ _-]?([A-Z])$/i, (_, plate) => `AAR_${plate.toUpperCase()}`);
const aarAliases = code => /^AAR_[A-Z]$/.test(code) ? ['_', ' ', '-', ''].map(sep => `AAR${sep}${code.at(-1)}`) : [code];
export function loadingGauge(value) {
  if (!value) return null;
  // Lists mean the line clears each listed profile. Pick the last display
  // category; W gauges do not form a strictly nested set of envelopes.
  // Tags vary in case and separators: "W6a", "AAR F".
  const british = BRITISH_LADDER.filter(code => String(value).split(/,\s*/).some(v => v.replace('*', '').toUpperCase() === code.toUpperCase()));
  const code = british.length ? british.at(-1) : aarCode(String(value).trim());
  const entry = LOADING_GAUGES.find(([codes]) => codes.some(c => c.toUpperCase() === code.toUpperCase()));
  if (!entry && /^[A-E][1-5]?$/.test(code)) return {code, name: `${code} (EN 15528 line category, not a loading gauge)`, family: 'other', color: LOADING_OTHER, rank: 0};
  if (!entry) return {code, name: `${code} (as tagged)`, family: 'other', color: LOADING_OTHER, rank: 0};
  const [, name, height, width, family, note, dimensions] = entry;
  const color = family === 'height' ? interpolateColor(LOADING_HEIGHT_STOPS, height)
    : family === 'british' ? hsl(18, 70, 72 - BRITISH_LADDER.indexOf(code) * 4.2) : family === 'metro' ? LOADING_METRO : LOADING_OTHER;
  // Sort key for legends: height where published, else position on the ladder.
  const rank = height || (family === 'british' ? 3 + BRITISH_LADDER.indexOf(code) / 100 : family === 'metro' ? 1 : 2);
  return {code, name, height, width, family, note, dimensions, color, rank};
}
// In-view legend rows from counted values ({row: [colour, name, sort key,
// detail], n}). Values with the same colour AND detail share a row (e.g.
// GA and GB). Different dimensions must remain visible even if colours match.
// The most common groups are listed, in order of size; the rest are
// summarised in a last row.
export function legendRows(entries, limit = 12) {
  const groups = new Map();
  for (const {row: [color, name, sort, detail], n} of entries) {
    const key = JSON.stringify([color, detail || '']);
    const group = groups.get(key) || {color, names: new Map(), details: new Set(), sort, n: 0};
    group.names.set(name, (group.names.get(name) || 0) + n);
    group.details.add(detail || '');
    if (sort !== undefined && (group.sort === undefined || sort < group.sort)) group.sort = sort;
    group.n += n; groups.set(key, group);
  }
  const all = [...groups.values()].sort((a, b) => b.n - a.n);
  const shown = all.slice(0, limit).sort((a, b) => a.sort === undefined || b.sort === undefined ? 0 : a.sort - b.sort);
  const rows = shown.map(g => {
    const names = [...g.names].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const listed = names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4} more` : names.join(', ');
    const detail = g.details.size === 1 ? [...g.details][0] : '';
    return [g.color, detail ? `${listed} · ${detail}` : listed];
  });
  const hidden = all.length - shown.length;
  if (hidden > 0) rows.push(['transparent', `${hidden} less common value${hidden > 1 ? 's' : ''} in view; zoom in for them`, 'empty']);
  return rows;
}
// To the millimetre, as the sources give them (3.965, 2.82).
const metres = m => String(Number(m.toFixed(3)));
const feetInches = m => { const inches = Math.round(m / 0.0254); return `${Math.floor(inches / 12)} ft ${inches % 12} in`; };
export function loadingDimensions(g, units = 'metric') {
  const size = g?.dimensions?.example || g;
  if (!(size?.height > 0 && size?.width > 0)) return '';
  const dimensions = units === 'imperial'
    ? `${feetInches(size.height)} high × ${feetInches(size.width)} wide`
    : `${metres(size.height)} m high × ${metres(size.width)} m wide`;
  return g.dimensions?.basis ? `${g.dimensions.basis}: ${dimensions}` : dimensions;
}
// Whether the upper-cased tag lists a British gauge: alone, in a list ('in'
// on "W6A," tokens avoids W6 matching inside W6A) or starred.
const britishTest = (upper, code) => { const c = code.toUpperCase(); return ['any', ['==', upper, c], ['in', `${c},`, ['concat', upper, ',']], ['in', `${c}*`, upper]]; };
// Owner view: each infrastructure owner (OSM owner=*) gets its own colour,
// made from its name, so it is the same wherever and whenever it is drawn.
// Tiles carry it as owner_color (added in the browser, tile-labels.mjs);
// without an owner, the unknown colour.
export function ownerColor(name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return null;
  let hash = 0x811c9dc5;
  for (const ch of key) { hash ^= ch.codePointAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
  // Hues spread by the golden angle; saturation and lightness in three
  // steps each, kept away from the grey of "not recorded".
  const hue = Math.round((hash % 360) * 137.508) % 360, sat = [62, 74, 86][(hash >>> 9) % 3], light = [34, 42, 50][(hash >>> 13) % 3];
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}
export const ownerPaint = () => ['coalesce', ['get', 'owner_color'], UNKNOWN_COLOR];
export function loadingPaint() {
  const lg = ['coalesce', ['get', 'loading_gauge'], ''], upper = ['upcase', lg];
  // Upper case: "W6a" is tagged as well as "W6A".
  const britishCases = [...BRITISH_LADDER].reverse().flatMap(code => [britishTest(upper, code), loadingGauge(code).color]);
  // Other gauges by exact code, compared in upper case, with the separator
  // variants loadingGauge() accepts for AAR plates.
  const seen = new Set(), exact = [];
  for (const [codes, , , , family] of LOADING_GAUGES) if (family !== 'british')
    for (const alias of codes.flatMap(aarAliases).map(c => c.toUpperCase())) if (!seen.has(alias)) { seen.add(alias); exact.push(alias, loadingGauge(alias).color); }
  return ['case', ['==', lg, ''], UNKNOWN_COLOR, ...britishCases, ['match', upper, ...exact, LOADING_OTHER]];
}
export const loadingLabel = () => {
  const lg = ['coalesce', ['get', 'loading_gauge'], ''], upper = ['upcase', lg];
  return ['case', ...[...BRITISH_LADDER].reverse().flatMap(code => [britishTest(upper, code), loadingGauge(code).name]), lg];
};
// Planned, construction and former lines: in the speed view coloured by the
// recorded (planned or former) limit where one exists; otherwise by state.
export const INACTIVE_STATES = [['construction', '#ad7619', 'Construction'], ['proposed', '#896192', 'Proposed'], ['disused', '#75675c', 'Disused'], ['former', '#9a8b80', 'Abandoned / removed']];
export const LIFECYCLE_PATTERNS = {construction:{dash:[8,2],cap:'butt'},proposed:{dash:[0.01,3.5],cap:'round'},disused:{dash:[5,2,0.6,2],cap:'butt'},former:{dash:[1,1.5,1,5],cap:'butt'}};
export function inactivePaint(mode, units = 'metric') {
  const byState = ['match', ['get', 'state'], 'construction', INACTIVE_STATES[0][1], 'proposed', INACTIVE_STATES[1][1], 'disused', INACTIVE_STATES[2][1], INACTIVE_STATES[3][1]];
  if (mode !== 'speed') return byState;
  return ['case', ['<', ['to-number', ['coalesce', ['get', 'maxspeed'], -1], -1], 0], byState, speedPaint(units)];
}
const han = value => /\p{Script=Han}/u.test(value || '');
const cyrillic = value => /\p{Script=Cyrillic}/u.test(value || '');
const nonempty = value => typeof value === 'string' && value.trim() !== '';
const chinese = lang => lang.startsWith('zh');
// Chinese labels always fall back to the other script before English, in
// every region and independently of Han-character borrowing. OSM keys:
//   name:zh-Hant / name:zh-Hans  general wording in a stated script;
//   name:zh                      general wording in whichever script its
//                                editor chose (Hong Kong/Macau: the local
//                                Chinese name);
//   name:zh-TW / -HK / -CN       regional wording;
//   name                         the local name: Chinese in mainland China and
//                                Taiwan, multilingual in Hong Kong and Macau.
// Keys are read by region (atlas_zh, see chineseArea in han-region.mjs). The
// script of a value is never guessed from its characters. Taiwan wording
// ranks before Hong Kong wording as a Traditional fallback; zh-SG, zh-MY and
// zh-MO are too rare to consult. 'name' below stands for the local name,
// used as recorded (Hong Kong and Macau names such as KFC, K11 or D2 Place
// are not Chinese). Every feature has one, so the list ends there.
const CHINESE_ORDER = {
  'zh-Hant': {
    TW: ['name'],
    HK: ['name:zh','name:zh-Hant','name:zh-HK','name:zh-TW','name'],
    CN: ['name:zh-Hant','name:zh-TW','name:zh-HK','name:zh','name'],
    '': ['name:zh-Hant','name:zh','name:zh-TW','name:zh-HK','name:zh-Hans','name:zh-CN'],
  },
  'zh-Hans': {
    CN: ['name'],
    HK: ['name:zh-Hans','name:zh-CN','name:zh','name:zh-Hant','name:zh-HK','name:zh-TW','name'],
    TW: ['name:zh-Hans','name:zh-CN','name:zh','name'],
    '': ['name:zh-Hans','name:zh','name:zh-CN','name:zh-Hant','name:zh-TW','name:zh-HK'],
  },
};
CHINESE_ORDER['zh-Hant'].MO = CHINESE_ORDER['zh-Hant'].HK;
CHINESE_ORDER['zh-Hans'].MO = CHINESE_ORDER['zh-Hans'].HK;
export function chineseVariantKeys(lang, area = '') {
  const order = CHINESE_ORDER[lang] || CHINESE_ORDER['zh-Hant'];
  return order[area] || order[''];
}
const chineseKeys = CHINESE_ORDER['zh-Hant'][''];
const chineseVariants = (p, lang) => chineseVariantKeys(lang, p.atlas_zh || '').map(k => p[k]).filter(nonempty);
const ideographicKeys = ['name:ja','name:ja-Hani','name:ko-Hani','name:ko:hanja','name:vi-Hani','name:vi:nom',...chineseKeys];
// Japanese names recorded as "kana (kanji)" or "kanji (kana)" show only the
// kanji in Chinese.
const kana = '[\\p{Script=Hiragana}\\p{Script=Katakana}ー・゠\\s]+';
const kanaThenKanji = new RegExp(`^${kana}[（(]\\s*([^()（）]*\\p{Script=Han}[^()（）]*?)\\s*[）)]$`,'u');
const kanjiThenKana = new RegExp(`^([^()（）]*\\p{Script=Han}[^()（）]*?)\\s*[（(]${kana}[）)]$`,'u');
const withoutKana = value => nonempty(value) ? (kanaThenKanji.exec(value.trim()) || kanjiThenKana.exec(value.trim()))?.[1] ?? value : value;
// Han-script fallbacks borrow names recorded for other languages or scripts.
// Apply them only where Han characters are in use: Chinese labels within
// CJKV, Singapore, Malaysia and the Russian Far East; Japanese labels within
// CJKV. Elsewhere use names recorded in the requested language, then English,
// then the native name. Every labelled feature carries atlas_han from its
// location (see han-region.mjs); a missing value borrows nothing.
export function hanFallback(p, lang) {
  if (chinese(lang)) return p.atlas_han === 'cjkv' || p.atlas_han === 'zh';
  return lang === 'ja' && p.atlas_han === 'cjkv';
}
// Select recorded names, never translate or transliterate a proper name ourselves.
// Unicode scripts include supplementary-plane Han characters used by Nôm/Hanja.
export function chooseName(p, lang = 'local') {
  const local = [p.name,p['name:nonlatin']].filter(nonempty);
  // The basemap can generate name:latin without knowing the source language
  // (e.g. Mandarin readings of Japanese kanji). It is not an English name.
  const english = [p['name:en'],p['name:en-Latn'],p.int_name].filter(nonempty);
  const selected = [p[`name:${lang}`]].filter(nonempty);
  const recorded = Object.entries(p).filter(([k,v])=>k.startsWith('name:') && nonempty(v)).map(([,v])=>v);
  const borrow = hanFallback(p, lang);
  let preferred;
  if (lang === 'local') preferred = local;
  else if (chinese(lang)) {
    const variants = chineseVariants(p, lang);
    preferred = borrow ? [
      ...variants,
      ...local.filter(han), ...ideographicKeys.map(k=>p[k]).filter(han), ...recorded.filter(han),
      ...english,
    ] : [...variants, ...english];
  }
  else if (lang === 'ja' && !borrow) preferred = [...selected, ...english];
  else if (lang === 'ja') preferred = [
    ...selected.filter(han), ...local.filter(han), ...ideographicKeys.map(k=>p[k]).filter(han), ...recorded.filter(han),
    ...selected, ...local.filter(v=>/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(v)), ...english,
  ];
  else if (lang === 'ru') preferred = [...selected.filter(cyrillic), ...local.filter(cyrillic), ...recorded.filter(cyrillic), ...english];
  else if (lang === 'ko') preferred = [...selected, ...local.filter(v=>/\p{Script=Hangul}/u.test(v)), ...english];
  else preferred = [...selected, ...english];
  const name = [...preferred, ...local, p.localized_name, p['name:latin'], p.label, p.ref].find(nonempty) || '';
  return chinese(lang) ? withoutKana(name) : name;
}
export function displayName(p, lang = 'local') {
  return p.atlas_language === lang ? p.atlas_name : chooseName(p,lang);
}
export function labelExpression(lang = 'local') {
  // Styles cannot tell regions apart; use the order for places elsewhere.
  const requested = chinese(lang) ? chineseVariantKeys(lang) : [`name:${lang}`];
  const keys = ['atlas_name', ...(lang !== 'local' ? [...new Set(requested),'name:en'] : []), 'name','name:nonlatin','name:latin','label','ref'];
  return ['case', ...keys.flatMap(key=>[['!=',['coalesce',['get',key],''],''],['to-string',['get',key]]]), ''];
}
// The station service substitutes the native name for missing translations.
// Store only distinct returned translations; native script remains available.
export function mergeStationTranslation(p, translated, lang) {
  const value = translated?.localized_name;
  if (nonempty(value) && value !== translated.name) p[`name:${lang}`] = value;
}
// Station names are fetched one language tag at a time; the service returns
// exactly name:<lang>, else the native name. Other Han-script languages are
// requested only where they apply.
const borrowLanguages = {zh:['ja','ko-Hani','vi-Hani'], ja:['ja-Hani','zh','ko-Hani','vi-Hani']};
export function stationLanguages(lang, borrow = true) {
  if (lang === 'local') return ['local'];
  if (chinese(lang)) {
    const regional = lang === 'zh-Hans' ? ['zh-CN','zh-TW','zh-HK'] : ['zh-TW','zh-HK','zh-CN'];
    return [...new Set([lang,'zh',lang === 'zh-Hans' ? 'zh-Hant' : 'zh-Hans',...regional,...(borrow ? borrowLanguages.zh : []),'en'])];
  }
  if (lang === 'ja') return ['ja',...(borrow ? borrowLanguages.ja : []),'en'];
  return [...new Set([lang,'en'])];
}
// Language tags still worth fetching for a station: those that could
// outrank the best name already known. Empty once the label is settled.
export function stationPending(p, lang, fetched) {
  if (lang === 'local') return [];
  const unfetched = codes => codes.filter(code => !fetched.has(code));
  const borrow = hanFallback(p,lang);
  if (chinese(lang)) {
    const wanted = [];
    const area = p.atlas_zh || '';
    for (const key of chineseVariantKeys(lang, area)) {
      if (key === 'name') { if (nonempty(p.name)) return wanted; continue; }
      const code = key.slice(5);
      if (!fetched.has(code)) wanted.push(code);
      else if (nonempty(p[key])) return wanted;
    }
    if (borrow) {
      if (han(p.name) || han(p['name:nonlatin'])) return wanted;
      for (const code of borrowLanguages.zh) {
        if (!fetched.has(code)) wanted.push(code);
        else if (han(p[`name:${code}`])) return wanted;
      }
    }
    return nonempty(p['name:en']) ? wanted : [...wanted, ...unfetched(['en'])];
  }
  const name = chooseName(p,lang);
  const resolved = lang === 'ja' && borrow ? han(name)
    : lang === 'ru' ? cyrillic(name) || nonempty(p['name:en'])
    : nonempty(p[`name:${lang}`]) || nonempty(p['name:en']) || (lang === 'ko' && /\p{Script=Hangul}/u.test(p.name || ''));
  return resolved ? [] : unfetched(stationLanguages(lang, borrow));
}

export function numericSpeed(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
export function speedColor(value) {
  const speed = numericSpeed(value);
  return speed === null ? UNKNOWN_COLOR : SPEED_BANDS.findLast(b => speed >= b.min).color;
}
export function formatSpeed(properties, units = 'metric') {
  const n = numericSpeed(properties.maxspeed);
  const raw = properties.speed_label;
  const kmh = n === null ? '' : `${Number(n.toFixed(1))} km/h`, mph = n === null ? '' : `${Number((n / MPH).toFixed(1))} mph`;
  // In the chosen units; the mapped value follows in brackets only when it
  // was in the other unit (converted), as a label in mph is.
  // The source unit when the feature records it (branch lines), else from the label.
  const inMph = properties.speed_unit ? properties.speed_unit === 'mph' : /mph/.test(raw || ''), shown = units === 'imperial' ? mph : kmh;
  const source = properties.speed_unit === 'knots' && n !== null ? `${Number((n / 1.852).toFixed(1))} knots` : inMph ? mph : kmh;
  return {
    mapped: n === null ? 'Not recorded / not numeric' : shown === source ? shown : `${shown} (${source})`,
    tagged: raw ? `${raw}${/mph|km\/h|knots/.test(raw) ? '' : ' km/h'}` : 'Not recorded',
  };
}
// Display settings live in a cookie; a link can still carry them (the app
// then saves them and removes them from the address). remembered: settings
// kept in this browser, used for anything the URL does not name.
export const SETTING_KEYS = ['mode','background','stations','stationImportanceColors','trackCounts','labels','inactive','relief','names','autoGlobe','readout','transport','destinations','constraints','units','detail','language','ui'];
const LEGACY_LANGUAGE_KEYS = ['stationLanguage','mapLanguage','lineLanguage'];
export const SETTING_PARAMS = [...SETTING_KEYS, ...LEGACY_LANGUAGE_KEYS];
// More detail: 0 (normal), 1 (the next zoom level at half size) or 2 (two
// levels further in at a quarter). Links and cookies from before the levels
// hold true or 1 for the first level.
export const DETAIL_LEVELS = 2;
export function detailLevel(value) {
  if (value === true) return 1;
  if (!/^\d$/.test(String(value ?? ''))) return 0;
  return Math.min(Number(value), DETAIL_LEVELS);
}
// The readout under the scale bar: coordinates (longitude wrapped to
// ±180°, as a globe or a panned map can go beyond) and zoom.
export function formatReadout({lng, lat}, zoom, detail = 0) {
  const lon = ((lng + 540) % 360 + 360) % 360 - 180;
  const coords = `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
  return `${coords} · zoom ${zoom.toFixed(1)}${detail ? ` (drawn at ${100 / 2 ** detail}%)` : ''}`;
}
// The OpenStreetMap object behind a map feature, {type, id}, or null. The
// provider's ids read "node-123…" (stations, crossings) or "123-0" (the way
// and a piece number, railway lines); the project's own tiles carry the way
// id (planned and former lines, street running) or the crossing node id;
// base-map features carry the id times ten plus 1, 2 or 3 for a node, way or
// relation.
const WAY_SOURCES = ['platformEdges','axleLow','axleRail','axleBranch','railway', 'network', 'speed', 'electric', 'control', 'gaugeLow', 'loadingLow', 'ownerLow', 'ownerRail', 'inactiveRegional', 'streetRunning', 'branchLines'];
export function osmObject(feature) {
  const p = feature?.properties || {};
  // Geocoder results name the type.
  if (['node', 'way', 'relation'].includes(p.osm_type) && /^\d+$/.test(String(p.osm_id ?? ''))) return {type: p.osm_type, id: String(p.osm_id)};
  for (const value of [p.id, p.osm_id]) {
    const match = /^(node|way|relation)-(\d+)/.exec(String(value ?? ''));
    if (match) return {type: match[1], id: match[2]};
  }
  if (feature.sourceLayer === 'level_crossings') return Number.isInteger(feature.id) ? {type: 'node', id: String(feature.id)} : null;
  // The dedicated signal and entrance tile functions expose bare OSM node IDs.
  if (['railwaySignals','railwaySignalSupplementOverview','railwaySignalSupplement','stationEntrances'].includes(feature.source)) {
    const id=p.id??feature.id;
    return /^[1-9]\d*$/.test(String(id??''))?{type:'node',id:String(id)}:null;
  }
  if (feature.source === 'openmaptiles') {
    const type = [, 'node', 'way', 'relation'][feature.id % 10];
    return Number.isInteger(feature.id) && feature.id > 0 && type ? {type, id: String(Math.floor(feature.id / 10))} : null;
  }
  // Railway lines: ways (search results give a bare id without its type).
  if (!WAY_SOURCES.includes(feature.source)) return null;
  const way = /^(\d+)(-\d+)?$/.exec(String(p.osm_id ?? p.id ?? ''));
  return way ? {type: 'way', id: way[1]} : null;
}
export function readSettings(search, remembered = {}) {
  const params = new URLSearchParams(search);
  const flag = (key, fallback) => params.has(key) ? params.get(key) !== '0' && (fallback || params.get(key) === '1') : typeof remembered[key] === 'boolean' ? remembered[key] : fallback;
  const pick = (key, valid, fallback) => [params.get(key), remembered[key]].find(valid) ?? fallback;
  return {
    mode: pick('mode', v => MODES.includes(v), 'infrastructure'),
    ui: pick('ui', v => ['standard','watch'].includes(v), 'standard'),
    background: pick('background', v => BACKGROUNDS.includes(v), 'map'),
    stations: flag('stations', true), stationImportanceColors: flag('stationImportanceColors', false), trackCounts: flag('trackCounts', true), labels: flag('labels', true), inactive: flag('inactive', true),
    transport: flag('transport', true), destinations: flag('destinations', true), constraints: flag('constraints', true),
    relief: flag('relief', true), names: flag('names', true), autoGlobe: flag('autoGlobe', true), readout: flag('readout', true),
    units: pick('units', v => v === 'metric' || v === 'imperial', 'metric'),
    detail: detailLevel(params.has('detail') ? params.get('detail') : remembered.detail),
    language: language(params.get('language') || LEGACY_LANGUAGE_KEYS.map(k => params.get(k)).find(Boolean) || remembered.language),
  };
}
// Automatic globe/flat map choice: the globe below zoom 4 everywhere; from
// zoom 4 the flat map, except where most of the view is beyond 60° N or S
// (null: leave the current choice).
export const GLOBE_BELOW_ZOOM = 4;
export function autoProjection(zoom, polarShare) {
  if (zoom < GLOBE_BELOW_ZOOM) return 'globe';
  return polarShare > 0.5 ? null : 'mercator';
}
// Settings as link parameters, for sharing a view.
export function settingsQuery(settings) {
  const params = new URLSearchParams();
  for (const key of SETTING_KEYS) params.set(key, typeof settings[key] === 'boolean' ? (settings[key] ? '1' : '0') : settings[key]);
  return params;
}
// Station modes below heavy rail and metro, in the style's ranking.
export const LIGHT_MODES = ['light_rail'], MINOR_MODES = ['monorail', 'funicular', 'miniature', 'tram'];
// Click priority as drawn: heavy rail and metro by size, then light rail,
// then trams, people movers and other minor modes.
export function stationRank(properties) {
  // Former, disused and planned stations are drawn last, under every operating one.
  if ((properties.state ?? 'present') !== 'present') return 5;
  if (properties.feature === 'tram_stop' || MINOR_MODES.includes(properties.station)) return 4;
  if (LIGHT_MODES.includes(properties.station)) return 3;
  return ({ large: 0, normal: 1, small: 2 })[properties.station_size] ?? 2;
}

// HTTP decoding may already have removed gzip; handle either representation.
export async function decodeLifecycleTile(data) {
  const bytes = new Uint8Array(data);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return data;
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

export const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
// Fine / emphasized intervals in metres; signed elevations include the seabed.
export const CONTOUR_OPTIONS = {
  thresholds:{7:[200,1000],9:[100,500],11:[50,250],13:[20,100],15:[10,50]},
  contourLayer:'contours',elevationKey:'ele',levelKey:'level',extent:4096,buffer:1,
};
// Imperial contours are drawn in feet at round intervals.
const LAND_FEET = {7:[500,2500],9:[250,1000],11:[100,500],13:[50,250],15:[25,100]};
// Seabed contours are drawn only below sea level. Most of each seabed tile is
// land or deep ocean that the style filters out, so the tiles are built from
// elevation one zoom coarser (overzoom 1): a quarter of the work and of the
// extra downloads, and still finer than the ETOPO1 seabed data behind most
// open water. The tiles hold seabed depths only up to zoom 10, so the 'close'
// source is built once, at zoom 11 from zoom-10 tiles, and MapLibre enlarges
// it beyond that. Metric: 50 m at zooms 5-8, 20 m at 9-10, 10 m from 11.
const SEABED = {
  metric:{shelf:{5:[50,250],9:[20,100]}, close:{11:[10,50]}},
  imperial:{shelf:{5:[150,750],9:[50,250]}, close:{11:[25,100]}},
};
export const contourOptions = (units, seabed) => {
  const imperial = units === 'imperial';
  const thresholds = seabed ? SEABED[imperial ? 'imperial' : 'metric'][seabed] : imperial ? LAND_FEET : CONTOUR_OPTIONS.thresholds;
  return {...CONTOUR_OPTIONS, ...(imperial && {multiplier:3.28084}), thresholds, ...(seabed && {overzoom:1})};
};
// Speed colours and track labels for the chosen units. maxspeed is km/h.
export function speedPaint(units) {
  const speed = ['to-number', ['coalesce', ['get', 'maxspeed'], -1], -1];
  const bands = speedBands(units);
  return ['case', ['<', speed, 0], UNKNOWN_COLOR,
    ['step', speed, bands[0].color, ...bands.slice(1).flatMap(b => [b.kmh ?? b.min, b.color])]];
}
// Metric keeps the tagged label (bare numbers are km/h, mph explicit).
// Imperial keeps labels already in mph and converts the rest.
export function speedLabel(units) {
  const label = ['coalesce', ['get', 'speed_label'], ''];
  if (units !== 'imperial') return ['get', 'speed_label'];
  const speed = ['to-number', ['coalesce', ['get', 'maxspeed'], -1], -1];
  return ['case', ['in', 'mph', label], label, ['>=', speed, 0], ['concat', ['to-string', ['round', ['/', speed, MPH]]], ' mph'], label];
}
