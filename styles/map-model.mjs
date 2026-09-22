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
  ['es','Español'], ['pt','Português'], ['it','Italiano'], ['nl','Nederlands'],
];
const language = value => LANGUAGES.some(([code]) => code === value) ? value : 'local';
// Empty translations also fall back. Never substitute a blank for a name.
export function labelExpression(lang, station = false) {
  const keys = [...(lang !== 'local' ? [`name:${lang}`] : []), ...(station ? ['localized_name'] : []), 'name', 'name:nonlatin', 'name:latin', 'label', 'ref'];
  return ['case', ...keys.flatMap(key => [['!=',['coalesce',['get',key],''],''],['to-string',['get',key]]]), ''];
}
export function displayName(p, lang, station = false) {
  return [lang !== 'local' && p[`name:${lang}`], station && p.localized_name, p.name, p['name:nonlatin'], p['name:latin'], p.label, p.ref].find(Boolean) || '';
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
    mapLanguage: language(params.get('mapLanguage')),
    stationLanguage: language(params.get('stationLanguage')),
    lineLanguage: language(params.get('lineLanguage')),
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
