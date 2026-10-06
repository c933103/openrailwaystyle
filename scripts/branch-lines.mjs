// Operating branch lines (OSM railway=rail/narrow_gauge with usage=branch)
// and metro lines (railway=subway), kept as a table and cut into static
// vector tiles: branch lines at z4–6, metro at z7–9. OpenRailwayMap's z0–6
// overview tiles hold only main lines, so lines such as JR's local lines
// vanished below zoom 7; its z7+ tiles hold main and branch lines, but metro
// only from z10.
// Pure functions; scripts/build-branch-lines.mjs does the I/O.
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import '../styles/pbf-utf8.mjs'; // names beyond U+1FFFF intact
import {parseMaxspeed} from './lifecycle.mjs';
import {branchStageOwner, fallbackStage, isFallbackStage, legacyEuropeReady, migrateDownloadStages, partSelection} from './download-stages.mjs';
export {STAGES} from './download-stages.mjs';

export const MIN_ZOOM = 4, BRANCH_MAX_ZOOM = 6, METRO_MIN_ZOOM = 7, MAX_ZOOM = 9, LAYER = 'branch_lines';
export const BRANCH_DATA_VERSION = 3;

// A schema change queues the existing region stages for re-fetching. It only
// updates progress state; the complete geometry table stays in place until
// each region succeeds. Retain the previous completion date so deletion
// checks still protect migrated stages from an incomplete refresh response.
export function migrateBranchState(state) {
  if (state.version === BRANCH_DATA_VERSION) return state;
  for (const stage of Object.values(state.stages || {})) Object.assign(stage, {
    previousCompleted: stage.completed || stage.previousCompleted || null,
    completed: null, pending: null, seen: [],
  });
  state.version = BRANCH_DATA_VERSION;
  return state;
}

// Change the download layout separately from the feature schema so completed
// Japan/Asia/etc. do not restart just because Europe was split.
export function migrateBranchDownloads(state, table) {
  const retired = migrateDownloadStages(state);
  if (retired && state.legacyEurope) {
    for (const feature of table.values()) if (retired.includes(feature.stage)) feature.stage = fallbackStage(feature.stage);
    const baselines = {};
    for (const feature of table.values()) if (isFallbackStage(feature.stage)) baselines[feature.stage] = (baselines[feature.stage] || 0) + 1;
    state.legacyEurope.branchStages = baselines;
    state.legacyEurope.lines = Object.values(baselines).reduce((sum, count) => sum + count, 0);
  }
  return state;
}

export function retireBranchEurope(state, table) {
  if (!state.legacyEurope || !legacyEuropeReady(state)) return;
  const stale = [...table.values()].filter(feature => isFallbackStage(feature.stage));
  const total = state.legacyEurope.lines;
  if (total > 100 && stale.length > total * 0.2) return;
  for (const [stage, before] of Object.entries(state.legacyEurope.branchStages || {})) {
    if (before > 100 && stale.filter(feature => feature.stage === stage).length > before * 0.2) return;
  }
  for (const feature of stale) table.delete(feature.id);
  delete state.legacyEurope;
}
export {branchStageOwner};

export const quarters = ([s, w, n, e]) => {
  const lat = (s + n) / 2, lon = (w + e) / 2;
  return [[s, w, lat, lon], [s, lon, lat, e], [lat, w, n, lon], [lat, lon, n, e]];
};

const SELECTS = ['way[railway~"^(rail|narrow_gauge)$"][usage=branch][!service]', 'way[railway=subway][!service]'];
const select = filters => SELECTS.map(s => `${s}${filters};`).join('');
export function partQuery(part, box) {
  const {areas, set} = partSelection(part, box, select);
  return `[out:json][timeout:180][maxsize:536870912];${areas}${set};out tags geom qt;`;
}

// Train protection in provider-compatible slots, retaining concurrent
// railway:<system> tags rather than stopping at the first matching system.
const PROTECTION_ORDER = ['etcs', 'ctcs', 'ktcs', 'ptc', 'etms', 'itcs', 'eatc', 'atacs', 'cbtc', 'saet', 'nexteo', 'atms', 'tmacs',
  'lzb', 'tvm', 'zsl90', 'kcvb', 'kcvp', 'sacem', 'ouragan', 'octys', 'als', 'acses', 'ases', 'atb', 'ls', 'evm', 'atc',
  'pzb', 'zub', 'zbs', 'zsi127', 'kvb', 'kvbp', 'tpws', 'ebicab', 'jkv', 'satp', 'tbl', 'asfa', 'scmt', 'ssc', 'atp',
  'aws', 'caws', 'zst90', 'shp', 'ats'];
export function trainProtections(tags) {
  const systems = [];
  let explicitlyAbsent = false;
  for (const system of PROTECTION_ORDER) {
    const value = tags[`railway:${system}`];
    // Absence of one named system says nothing about other systems.
    if (value === 'no') continue;
    if (value === undefined || value === 'no' || value === '') continue;
    // Level 3 ETCS draws as level 2; CTCS levels 0 and 1 are plain ctcs.
    if (system === 'etcs' && /^[1-3]$/.test(value)) systems.push(value === '1' ? 'etcs_1' : 'etcs_2');
    else if (system === 'ctcs' && /^[2-3]$/.test(value)) systems.push(`ctcs_${value}`);
    else systems.push(system);
  }
  // The proposed list tag is already present in OSM. Only unprefixed codes
  // known to this importer are folded to provider names: country/vendor
  // prefixes and unfamiliar values stay distinct and use the unknown colour.
  for (const value of String(tags['railway:train_protection'] || '').split(';').map(v => v.trim()).filter(Boolean)) {
    const lower = value.toLowerCase();
    if (lower === 'no') { explicitlyAbsent = true; continue; }
    if (!PROTECTION_ORDER.includes(lower)) { systems.push(value); continue; }
    const version = tags[`railway:train_protection:${value}`] ?? tags[`railway:train_protection:${lower}`];
    if (lower === 'etcs' && /^[1-3]$/.test(version)) systems.push(version === '1' ? 'etcs_1' : 'etcs_2');
    else if (lower === 'ctcs' && /^[2-3]$/.test(version)) systems.push(`ctcs_${version}`);
    else systems.push(lower);
  }
  return systems.length ? [...new Set(systems)] : explicitlyAbsent ? ['none'] : [];
}
// Kept for existing callers that need the primary provider-style system.
export const trainProtection = tags => trainProtections(tags)[0];
const number = value => { const text = String(value ?? '').split(';')[0].trim(); const n = text === '' ? NaN : Number(text); return Number.isFinite(n) ? n : undefined; };
const GAUGE_WORDS = {standard: 1435, broad: 1668, narrow: 1067};
function gauges(value) {
  return String(value ?? '').split(';').map(s => s.trim()).filter(Boolean).slice(0, 2)
    .map(g => ({text: g, mm: /^\d+(\.\d+)?$/.test(g) ? Number(g) : GAUGE_WORDS[g]}));
}
// Electrification as OpenRailwayMap's importer derives it for the detailed
// tiles (electrification_state in its openrailwaymap.lua): the state, the
// current voltage and frequency only when electrified, and the planned ones
// (future_*) for electrification under construction or proposed.
const ELECTRIFIED = ['contact_line', 'yes', 'rail', 'ground-level_power_supply', '4th_rail', 'contact_line;rail', 'rail;contact_line'];
function electrification(tags) {
  const current = (state, prefix = '') => {
    const voltage = number(tags[`${prefix}voltage`]), frequency = number(tags[`${prefix}frequency`]), future = prefix ? 'future_' : '';
    return {electrification_state: state, ...(voltage !== undefined && {[`${future}voltage`]: voltage}), ...(frequency !== undefined && {[`${future}frequency`]: frequency})};
  };
  if (ELECTRIFIED.includes(tags.electrified)) return current('present');
  if (ELECTRIFIED.includes(tags['construction:electrified'])) return current('construction', 'construction:');
  if (ELECTRIFIED.includes(tags['proposed:electrified'])) return current('proposed', 'proposed:');
  if (tags.electrified !== 'no') return {};
  if (ELECTRIFIED.includes(tags.deelectrified)) return {electrification_state: 'deelectrified'};
  if (ELECTRIFIED.includes(tags['abandoned:electrified'])) return {electrification_state: 'abandoned'};
  return {electrification_state: 'no'};
}

// The mapped speed as written, as in OpenRailwayMap's speed_label: the
// value with its unit (bare numbers are km/h), or "forward / backward" with a
// dash for a direction not mapped.
// Only numeric values: words such as "none" or "signals" are not speeds (the
// panel would add km/h to them).
export function speedLabel(tags) {
  // Units spelled as the panel expects them (lower-case "mph").
  // A list ("80;100") stays a list when every part is a number.
  // Every unit the speed parser accepts: km/h spellings become bare numbers,
  // mph and knots keep their unit.
  const one = part => {
    const m = /^(\d+(?:\.\d+)?)\s*(mph|knots|km\/h|kmh|kph)?$/i.exec(part.trim());
    if (!m) return '';
    const unit = (m[2] || '').toLowerCase();
    return unit === 'mph' || unit === 'knots' ? `${m[1]} ${unit}` : m[1];
  };
  const clean = value => {
    const parts = String(value ?? '').split(';').map(one);
    return parts.every(Boolean) ? parts.join(';') : '';
  };
  if (clean(tags.maxspeed)) return clean(tags.maxspeed);
  const forward = clean(tags['maxspeed:forward']), backward = clean(tags['maxspeed:backward']);
  return forward || backward ? `${forward || '-'} / ${backward || '-'}` : undefined;
}
// On a line run mainly one way (railway:preferred_direction), that
// direction's limit is its speed; otherwise the faster direction's.
export function speedTags(tags) {
  const preferred = tags['railway:preferred_direction'];
  const numeric = value => parseMaxspeed({maxspeed: value}, 'present', true) !== undefined;
  // A plain limit applies when it is numeric (a word such as "signals" is not).
  if (numeric(tags.maxspeed) || !['forward', 'backward'].includes(preferred) || !numeric(tags[`maxspeed:${preferred}`])) return tags;
  return {maxspeed: tags[`maxspeed:${preferred}`]};
}
// The unit of the value the speed comes from: a label can mix units
// ("60 mph / 120"), and the panel must not guess from it.
export function speedUnit(tags) {
  // Unrounded, so near-equal limits in different units compare correctly.
  const kmh = value => parseMaxspeed({maxspeed: value}, 'present', true);
  const chosen = speedTags(tags);
  let source = chosen.maxspeed;
  if (kmh(source) === undefined) {
    const [forward, backward] = [tags['maxspeed:forward'], tags['maxspeed:backward']];
    source = (kmh(backward) ?? -1) > (kmh(forward) ?? -1) ? backward : forward;
  }
  if (kmh(source) === undefined) return undefined;
  // In a list ("80 mph;140") the member that gives the speed decides.
  const member = String(source).split(';').reduce((best, part) => (kmh(part) ?? -1) > (kmh(best) ?? -1) ? part : best);
  return /mph/i.test(member) ? 'mph' : /knots/i.test(member) ? 'knots' : 'km/h';
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
    // A node without coordinates splits the way (joining its neighbours would
    // draw a line that does not exist).
    const parts = [[]];
    for (const p of way.geometry) {
      if (p && Number.isFinite(p.lon) && Number.isFinite(p.lat)) parts.at(-1).push([p.lon, p.lat]);
      else if (parts.at(-1).length) parts.push([]);
    }
    const lines = parts.filter(part => part.length > 1).map(part => simplify(part).map(round));
    if (!lines.length) continue;
    const [g0, g1] = gauges(tags.gauge), protection = trainProtections(tags), maxspeed = parseMaxspeed(speedTags(tags), 'present', true), label = speedLabel(tags);
    const preferred = tags['railway:preferred_direction'];
    const properties = {
      osm_id: way.id, feature: tags.railway, usage: tags.railway === 'subway' ? (tags.usage || '') : 'branch', state: 'present',
      name: tags.name || tags['name:en'] || '',
      ...Object.fromEntries(Object.entries(tags).filter(([key]) => /^name:[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(key))),
      ...(tags.highspeed === 'yes' && {highspeed: true}),
      ...(maxspeed !== undefined && {maxspeed, speed_unit: speedUnit(tags)}), ...(label && {speed_label: label}),
      ...(['forward', 'backward', 'both'].includes(preferred) && {preferred_direction: preferred}),
      ...electrification(tags),
      ...(g0 && {gauge0: g0.text, ...(g0.mm && {gaugeint0: g0.mm})}),
      ...(g1 && {gauge1: g1.text, ...(g1.mm && {gaugeint1: g1.mm})}),
      ...(tags.loading_gauge && {loading_gauge: tags.loading_gauge}),
      ...Object.fromEntries(protection.slice(0, 3).map((code, i) => [`train_protection${i}`, code])),
      // Tiles follow the provider's three slots; keep an exceptional longer
      // list for the infobox instead of silently discarding its other systems.
      ...(protection.length > 3 && {train_protection: protection.join(';')}),
      ...(tags.operator && {operator: tags.operator}),
      // Structures, as the detailed tiles' booleans (bridge=no and tunnel=no
      // are not structures).
      ...(tags.bridge && tags.bridge !== 'no' && {bridge: true}),
      ...(tags.tunnel && tags.tunnel !== 'no' && {tunnel: true}),
    };
    features.push({type: 'Feature', id: way.id, properties, geometry: lines.length === 1 ? {type: 'LineString', coordinates: lines[0]} : {type: 'MultiLineString', coordinates: lines}});
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

// Tiles: Map 'z/x/y' → encoded bytes (layer branch_lines): branch lines at
// z4–6, metro lines at z7–9.
export function buildTiles(table) {
  const out = new Map(), all = [...table.values()];
  for (const [features, minZoom, maxZoom] of [[all.filter(f => f.properties.feature !== 'subway'), MIN_ZOOM, BRANCH_MAX_ZOOM], [all.filter(f => f.properties.feature === 'subway'), METRO_MIN_ZOOM, MAX_ZOOM]]) {
    const index = geojsonvt({type: 'FeatureCollection', features}, {maxZoom, indexMaxZoom: maxZoom, indexMaxPoints: 0, tolerance: 2, extent: 4096, buffer: 64});
    for (const {z, x, y} of index.tileCoords) {
      if (z < minZoom) continue;
      const tile = index.getTile(z, x, y);
      if (tile?.features.length) out.set(`${z}/${x}/${y}`, vtpbf.fromGeojsonVt({[LAYER]: tile}, {version: 2}));
    }
  }
  return out;
}
