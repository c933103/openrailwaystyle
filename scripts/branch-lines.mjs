// Operating branch lines (OSM railway=rail/narrow_gauge with usage=branch),
// kept as a table and cut into static z4–6 vector tiles. OpenRailwayMap's
// z0–6 overview tiles hold only main lines, so lines such as JR's local
// lines vanished below zoom 7; its z7+ tiles hold main and branch lines.
// Pure functions; scripts/build-branch-lines.mjs does the I/O.
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {parseMaxspeed} from './lifecycle.mjs';

export const MIN_ZOOM = 4, MAX_ZOOM = 6, LAYER = 'branch_lines';

// Regions fetched one stage at a time, in this order. A part is a bounding
// box [south, west, north, east], optionally limited to OSM country areas
// (area) and leaving out countries fetched in earlier stages (exclude).
const JP = 'ISO3166-1=JP', KR = 'ISO3166-1=KR', KP = 'ISO3166-1=KP', TW = 'ISO3166-1=TW', HK = 'ISO3166-1=HK', MO = 'ISO3166-1=MO';
const CN = 'ISO3166-1=CN', GD = 'ISO3166-2=CN-GD', RU = 'ISO3166-1=RU', IN = 'ISO3166-1=IN', US = 'ISO3166-1=US', CA = 'ISO3166-1=CA';
export const STAGES = [
  {name: 'japan', label: 'Japan', parts: [{area: JP, box: [20, 122, 46, 154]}]},
  {name: 'east-asia', label: 'Koreas, Taiwan, Hong Kong, Macau and Guangdong', parts: [
    {area: KR, box: [33, 124, 39, 132]}, {area: KP, box: [37.5, 124, 43.1, 131]}, {area: TW, box: [21.5, 118, 26.5, 123]},
    {area: HK, box: [22.1, 113.8, 22.6, 114.5]}, {area: MO, box: [22.05, 113.5, 22.25, 113.65]}, {area: GD, box: [20, 109.5, 25.6, 117.4]}]},
  {name: 'china', label: 'Rest of China', parts: [{area: CN, box: [18, 73, 54, 135], exclude: [GD, HK, MO]}]},
  {name: 'russia', label: 'Russia', parts: [{area: RU, box: [41, 19, 82, 180]}, {area: RU, box: [60, -180, 72, -168]}]},
  {name: 'europe', label: 'Rest of Europe', parts: [{box: [34, -25, 72, 26.5], exclude: [RU]}, {box: [40.5, 26.5, 72, 45], exclude: [RU]}]},
  {name: 'india', label: 'India', parts: [{area: IN, box: [6, 68, 36, 98]}]},
  {name: 'asia', label: 'Rest of Asia', parts: [
    {box: [-11, 60, 55, 180], exclude: [JP, KR, KP, TW, HK, MO, CN, RU, IN]},
    {box: [12, 26.5, 40.5, 60], exclude: ['ISO3166-1=EG']}, {box: [40.5, 45, 55, 60], exclude: [RU]}]},
  {name: 'north-america', label: 'US and Canada', parts: [{area: US, box: [18, -180, 72, -66]}, {area: CA, box: [41, -141, 84, -52]}]},
  {name: 'americas', label: 'Rest of the Americas', parts: [{box: [-56, -120, 33, -30], exclude: [US]}]},
  {name: 'world', label: 'Rest of the world', parts: [
    {box: [-35, -20, 37.5, 52]}, {box: [-50, 110, -11, 180]}, {box: [-50, -180, 0, -150]}]},
];

export const quarters = ([s, w, n, e]) => {
  const lat = (s + n) / 2, lon = (w + e) / 2;
  return [[s, w, lat, lon], [s, lon, lat, e], [lat, w, n, lon], [lat, lon, n, e]];
};

const areaFilter = spec => { const [key, value] = spec.split('='); return `area["${key}"="${value}"]`; };
const SELECT = 'way[railway~"^(rail|narrow_gauge)$"][usage=branch][!service]';
export function partQuery(part, box) {
  const bbox = `(${box.join(',')})`, specs = [part.area, ...(part.exclude || [])].filter(Boolean);
  const areas = specs.map((spec, i) => `${areaFilter(spec)}->.a${i};`).join('');
  const main = `${SELECT}${part.area ? '(area.a0)' : ''}${bbox};`;
  const excluded = (part.exclude || []).map((_, i) => `${SELECT}(area.a${i + (part.area ? 1 : 0)})${bbox};`).join('');
  // Ways in countries fetched in earlier stages are left out of the download.
  const set = excluded ? `(${main} - (${excluded});)` : `(${main})`;
  return `[out:json][timeout:180][maxsize:536870912];${areas}${set};out tags geom qt;`;
}

// Train protection as OpenRailwayMap's first system: the most advanced
// recorded railway:<system> tag (ETCS and CTCS by level).
const PROTECTION_ORDER = ['etcs', 'ctcs', 'ktcs', 'ptc', 'etms', 'itcs', 'eatc', 'atacs', 'cbtc', 'saet', 'nexteo', 'atms', 'tmacs',
  'lzb', 'tvm', 'zsl90', 'kcvb', 'kcvp', 'sacem', 'ouragan', 'octys', 'als', 'acses', 'ases', 'atb', 'ls', 'evm', 'atc',
  'pzb', 'zub', 'zbs', 'zsi127', 'kvb', 'kvbp', 'tpws', 'ebicab', 'jkv', 'satp', 'tbl', 'asfa', 'scmt', 'ssc', 'atp',
  'aws', 'caws', 'zst90', 'shp', 'ats'];
export function trainProtection(tags) {
  for (const system of PROTECTION_ORDER) {
    const value = tags[`railway:${system}`];
    if (value === undefined || value === 'no') continue;
    // Level 3 ETCS draws as level 2; CTCS levels 0 and 1 are plain ctcs.
    if (system === 'etcs' && /^[1-3]$/.test(value)) return value === '1' ? 'etcs_1' : 'etcs_2';
    if (system === 'ctcs' && /^[2-3]$/.test(value)) return `ctcs_${value}`;
    return system;
  }
  return undefined;
}
const number = value => { const text = String(value ?? '').split(';')[0].trim(); const n = text === '' ? NaN : Number(text); return Number.isFinite(n) ? n : undefined; };
const GAUGE_WORDS = {standard: 1435, broad: 1668, narrow: 1067};
function gauges(value) {
  return String(value ?? '').split(';').map(s => s.trim()).filter(Boolean).slice(0, 2)
    .map(g => ({text: g, mm: /^\d+(\.\d+)?$/.test(g) ? Number(g) : GAUGE_WORDS[g]}));
}
function electrification(tags) {
  const e = tags.electrified;
  if (e === 'no') return 'no';
  if (e && e !== 'no') return 'present';
  if (tags['construction:electrified'] && tags['construction:electrified'] !== 'no') return 'construction';
  if (tags['proposed:electrified'] && tags['proposed:electrified'] !== 'no') return 'proposed';
  if (tags['deelectrified:electrified'] || tags.deelectrified) return 'deelectrified';
  return undefined;
}

// The mapped speed as written, as in OpenRailwayMap's speed_label: the
// value with its unit (bare numbers are km/h), or "forward / backward" with a
// dash for a direction not mapped.
// Only numeric values: words such as "none" or "signals" are not speeds (the
// panel would add km/h to them).
export function speedLabel(tags) {
  const clean = value => { const text = String(value ?? '').trim().replace(/\s*km\/h$/i, ''); return /^\d+(\.\d+)?( ?mph)?$/i.test(text) ? text : ''; };
  if (clean(tags.maxspeed)) return clean(tags.maxspeed);
  const forward = clean(tags['maxspeed:forward']), backward = clean(tags['maxspeed:backward']);
  return forward || backward ? `${forward || '-'} / ${backward || '-'}` : undefined;
}
// Douglas–Peucker in degrees (tolerance 0.0005°, about 50 m: finer than a
// z6 tile's 150 m units), then five decimals.
export function simplify(points, tolerance = 0.0005) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(), [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let far = -1, best = tolerance;
    for (let i = a + 1; i < b; i++) {
      // Distance to the segment, not the infinite line: a way that doubles
      // back (a switchback) keeps its far end.
      const [px, py] = points[i], t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > best) { best = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
const round = ([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5];

// Overpass JSON → features with the fields of OpenRailwayMap's railway
// tiles, so the style colours them as it colours those tiles.
export function toFeatures(json) {
  if (json.remark || !Array.isArray(json.elements)) throw new Error(json.remark ? `Overpass: ${json.remark}` : 'Incomplete Overpass response');
  const features = [];
  for (const way of json.elements) {
    if (way.type !== 'way' || !Array.isArray(way.geometry)) continue;
    const tags = way.tags || {};
    const coordinates = simplify(way.geometry.filter(p => p && Number.isFinite(p.lon) && Number.isFinite(p.lat)).map(p => [p.lon, p.lat])).map(round);
    if (coordinates.length < 2) continue;
    const [g0, g1] = gauges(tags.gauge), protection = trainProtection(tags), maxspeed = parseMaxspeed(tags, 'present'), label = speedLabel(tags);
    const properties = {
      osm_id: way.id, feature: tags.railway, usage: 'branch', state: 'present',
      name: tags.name || tags['name:en'] || '',
      ...Object.fromEntries(Object.entries(tags).filter(([key]) => /^name:[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(key))),
      ...(tags.highspeed === 'yes' && {highspeed: true}),
      ...(maxspeed !== undefined && {maxspeed}), ...(label && {speed_label: label}),
      ...(electrification(tags) && {electrification_state: electrification(tags)}),
      ...(number(tags.voltage) !== undefined && {voltage: number(tags.voltage)}),
      ...(number(tags.frequency) !== undefined && {frequency: number(tags.frequency)}),
      ...(g0 && {gauge0: g0.text, ...(g0.mm && {gaugeint0: g0.mm})}),
      ...(g1 && {gauge1: g1.text, ...(g1.mm && {gaugeint1: g1.mm})}),
      ...(tags.loading_gauge && {loading_gauge: tags.loading_gauge}),
      ...(protection && {train_protection0: protection}),
      ...(tags.operator && {operator: tags.operator}),
    };
    features.push({type: 'Feature', id: way.id, properties, geometry: {type: 'LineString', coordinates}});
  }
  return features;
}

// The table: one feature per line (NDJSON), each with the stage it belongs to.
export const writeTable = table => [...table.values()].sort((a, b) => a.id - b.id).map(f => JSON.stringify(f)).join('\n') + '\n';
export function readTable(text) {
  const table = new Map();
  for (const line of text.split('\n')) if (line) { const f = JSON.parse(line); table.set(f.id, f); }
  return table;
}

// Tiles z4–6: Map 'z/x/y' → encoded bytes (layer branch_lines).
export function buildTiles(table) {
  const index = geojsonvt({type: 'FeatureCollection', features: [...table.values()]},
    {maxZoom: MAX_ZOOM, indexMaxZoom: MAX_ZOOM, indexMaxPoints: 0, tolerance: 2, extent: 4096, buffer: 64});
  const out = new Map();
  for (const {z, x, y} of index.tileCoords) {
    if (z < MIN_ZOOM) continue;
    const tile = index.getTile(z, x, y);
    if (tile?.features.length) out.set(`${z}/${x}/${y}`, vtpbf.fromGeojsonVt({[LAYER]: tile}, {version: 2}));
  }
  return out;
}
