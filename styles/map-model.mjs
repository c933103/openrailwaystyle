import {POLYGONS, BORDERS} from './cjkv-region-data.mjs';
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
export const UNKNOWN_COLOR = '#899197';
export const ORM = 'https://openrailwaymap.app';
// Public API explicitly supports cross-origin clients; the vector site's
// same-origin /api/facility endpoint is not suitable for GitHub Pages.
export const SEARCH_API = 'https://api.openrailwaymap.org/v2/facility';
export const MODES = ['speed', 'infrastructure', 'electrification'];
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
// China, Taiwan, Hong Kong, Macau, Japan, the Koreas and Vietnam: the areas
// that historically write in Han characters. Coastal points slightly outside
// the simplified outline (piers, reclaimed land) count as inside; points
// beyond a land border with any other country never do.
const COAST_KM = 8, CELL = 4, PAD = 0.15;
let region;
function indexRegion() {
  const decode = line => { const points = []; let x = 0, y = 0; for (let i = 0; i < line.length; i += 2) { x += line[i]; y += line[i+1]; points.push([x/1000, y/1000]); } return points; };
  const bands = new Map(), cells = new Map();
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  // Latitude bands serve ray casting; padded cells serve distance queries.
  const segment = (a, b, border) => {
    const s = [a[0],a[1],b[0],b[1],border];
    if (!border) for (let y = Math.floor(Math.min(a[1],b[1])*CELL); y <= Math.floor(Math.max(a[1],b[1])*CELL); y++) add(bands, y, s);
    for (let x = Math.floor((Math.min(a[0],b[0])-PAD)*CELL); x <= Math.floor((Math.max(a[0],b[0])+PAD)*CELL); x++)
      for (let y = Math.floor((Math.min(a[1],b[1])-PAD)*CELL); y <= Math.floor((Math.max(a[1],b[1])+PAD)*CELL); y++) add(cells, `${x},${y}`, s);
  };
  for (const ring of POLYGONS.map(decode)) for (let i = 1; i < ring.length; i++) segment(ring[i-1], ring[i], false);
  for (const line of BORDERS.map(decode)) for (let i = 1; i < line.length; i++) segment(line[i-1], line[i], true);
  return {bands, cells, uniform: new Map()};
}
function distance(lon, lat, [ax,ay,bx,by]) {
  const k = Math.cos(lat*Math.PI/180);
  ax = (ax-lon)*k; bx = (bx-lon)*k; ay -= lat; by -= lat;
  const dx = bx-ax, dy = by-ay, t = dx||dy ? Math.max(0, Math.min(1, -(ax*dx+ay*dy)/(dx*dx+dy*dy))) : 0;
  return Math.hypot(ax+t*dx, ay+t*dy)*111.2;
}
function inside(lon, lat) {
  let odd = false;
  for (const [xi,yi,xj,yj] of region.bands.get(Math.floor(lat*CELL)) || [])
    if ((yi > lat) !== (yj > lat) && lon < (xj-xi)*(lat-yi)/(yj-yi)+xi) odd = !odd;
  return odd;
}
export function inCJKV(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  if (lon < 73 || lon > 154.5 || lat < 3 || lat > 54) return false;
  region ||= indexRegion();
  const key = `${Math.floor(lon*CELL)},${Math.floor(lat*CELL)}`, near = region.cells.get(key);
  // A cell with no outline nearby has one answer throughout.
  if (!near) {
    if (!region.uniform.has(key)) region.uniform.set(key, inside(lon, lat));
    return region.uniform.get(key);
  }
  if (inside(lon, lat)) return true;
  let coast = Infinity, border = Infinity;
  for (const s of near) {
    const d = distance(lon, lat, s);
    if (s[4]) border = Math.min(border, d); else coast = Math.min(coast, d);
  }
  return coast <= COAST_KM && border > coast + 0.01;
}
const han = value => /\p{Script=Han}/u.test(value || '');
const cyrillic = value => /\p{Script=Cyrillic}/u.test(value || '');
const nonempty = value => typeof value === 'string' && value.trim() !== '';
const chinese = lang => lang.startsWith('zh');
const chineseKeys = ['name:zh','name:zh-Hant','name:zh-Hans','name:zh-TW','name:zh-CN'];
const ideographicKeys = ['name:ja','name:ja-Hani','name:ko-Hani','name:ko:hanja','name:vi-Hani','name:vi:nom',...chineseKeys];
// Japanese names recorded as "kana (kanji)" show only the kanji in Chinese.
const kanaKanji = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・゠\s]+[（(]\s*([^()（）]*\p{Script=Han}[^()（）]*?)\s*[）)]$/u;
const withoutKana = value => nonempty(value) ? kanaKanji.exec(value.trim())?.[1] ?? value : value;
// Han-script fallbacks borrow names from other CJKV languages. Apply them only
// where Han characters are historically used; elsewhere keep recorded names
// in the requested language, then English, then the local name. Features
// without a known location keep the Han fallbacks.
const hanRegion = p => p.atlas_cjkv !== false;
// Select recorded names, never translate or transliterate a proper name ourselves.
// Unicode scripts include supplementary-plane Han characters used by Nôm/Hanja.
export function chooseName(p, lang = 'local') {
  const local = [p.name,p['name:nonlatin']].filter(nonempty);
  const english = [p['name:en'],p.int_name,p['name:latin'],p['name:en-Latn']].filter(nonempty);
  const selected = [p[`name:${lang}`]].filter(nonempty);
  const recorded = Object.entries(p).filter(([k,v])=>k.startsWith('name:') && nonempty(v)).map(([,v])=>v);
  let preferred;
  if (lang === 'local') preferred = local;
  else if (chinese(lang) && !hanRegion(p)) preferred = [...selected, ...chineseKeys.map(k=>p[k]).filter(nonempty), ...english];
  else if (chinese(lang)) preferred = [
    ...selected.filter(han),
    ...chineseKeys.map(k=>p[k]).filter(han),
    ...local.filter(han), ...ideographicKeys.map(k=>p[k]).filter(han), ...recorded.filter(han),
    ...english, ...selected,
  ].map(withoutKana);
  else if (lang === 'ja' && !hanRegion(p)) preferred = [...selected, ...english];
  else if (lang === 'ja') preferred = [
    ...selected.filter(han), ...local.filter(han), ...ideographicKeys.map(k=>p[k]).filter(han), ...recorded.filter(han),
    ...selected, ...local.filter(v=>/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(v)), ...english,
  ];
  else if (lang === 'ru') preferred = [...selected.filter(cyrillic), ...local.filter(cyrillic), ...recorded.filter(cyrillic), ...english];
  else if (lang === 'ko') preferred = [...selected, ...local.filter(v=>/\p{Script=Hangul}/u.test(v)), ...english];
  else preferred = [...selected, ...english];
  return [...preferred, ...local, p.localized_name, p.label, p.ref].find(nonempty) || '';
}
export function displayName(p, lang = 'local') {
  return p.atlas_language === lang ? p.atlas_name : chooseName(p,lang);
}
export function labelExpression(lang = 'local') {
  const keys = ['atlas_name', ...(lang !== 'local' ? [`name:${lang}`,'name:en','name:latin'] : []), 'name','name:nonlatin','label','ref'];
  return ['case', ...keys.flatMap(key=>[['!=',['coalesce',['get',key],''],''],['to-string',['get',key]]]), ''];
}
// The station service substitutes the native name for missing translations.
// Store only distinct returned translations; native script remains available.
export function mergeStationTranslation(p, translated, lang) {
  const value = translated?.localized_name;
  if (nonempty(value) && value !== translated.name) p[`name:${lang}`] = value;
}
// Other CJKV languages are requested only for tiles within the Han region.
export function stationLanguages(lang, hanTile = true) {
  if (lang === 'local') return ['local'];
  if (chinese(lang)) return [...new Set([lang,'zh','zh-Hant','zh-Hans',...(hanTile ? ['ja','ko-Hani','vi-Hani'] : []),'en'])];
  if (lang === 'ja') return hanTile ? ['ja','ja-Hani','zh','ko-Hani','vi-Hani','en'] : ['ja','en'];
  return [...new Set([lang,'en'])];
}
export function stationNameResolved(p,lang) {
  if (lang === 'local') return true;
  const name = chooseName(p,lang);
  if ((chinese(lang) || lang === 'ja') && hanRegion(p)) return han(name);
  if (chinese(lang)) return [`name:${lang}`,...chineseKeys,'name:en'].some(k=>nonempty(p[k]));
  if (lang === 'ru') return cyrillic(name) || nonempty(p['name:en']);
  return nonempty(p[`name:${lang}`]) || nonempty(p['name:en']) || (lang === 'ko' && /\p{Script=Hangul}/u.test(p.name || ''));
}

export function numericSpeed(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
export function speedColor(value) {
  const speed = numericSpeed(value);
  return speed === null ? UNKNOWN_COLOR : SPEED_BANDS.findLast(b => speed >= b.min).color;
}
export function formatSpeed(properties) {
  const n = numericSpeed(properties.maxspeed);
  const raw = properties.speed_label;
  return {
    mapped: n === null ? 'Not recorded / not numeric' : `${Number(n.toFixed(1))} km/h (${Number((n / 1.609344).toFixed(1))} mph)`,
    tagged: raw ? `${raw}${/mph|km\/h/.test(raw) ? '' : ' (km/h)'}` : 'Not recorded',
  };
}
export function readSettings(search) {
  const params = new URLSearchParams(search);
  return {
    mode: MODES.includes(params.get('mode')) ? params.get('mode') : 'speed',
    stations: params.get('stations') !== '0',
    labels: params.get('labels') !== '0',
    inactive: params.get('inactive') !== '0',
    relief: params.get('relief') !== '0',
    names: params.get('names') !== '0',
    language: language(params.get('language') || params.get('stationLanguage') || params.get('mapLanguage') || params.get('lineLanguage')),
  };
}
export function stationRank(properties) {
  return ({ large: 0, normal: 1, small: 2 })[properties.station_size] ?? 3;
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
