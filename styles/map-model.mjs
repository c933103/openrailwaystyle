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
// zh-MO are too rare to consult. 'name' below stands for the local name.
const CHINESE_ORDER = {
  'zh-Hant': {
    TW: ['name','name:zh-Hant','name:zh','name:zh-TW','name:zh-HK','name:zh-Hans','name:zh-CN'],
    HK: ['name:zh','name:zh-Hant','name:zh-HK','name:zh-TW','name','name:zh-Hans','name:zh-CN'],
    CN: ['name:zh-Hant','name:zh-TW','name:zh-HK','name:zh','name','name:zh-Hans','name:zh-CN'],
    '': ['name:zh-Hant','name:zh','name:zh-TW','name:zh-HK','name:zh-Hans','name:zh-CN'],
  },
  'zh-Hans': {
    CN: ['name','name:zh-Hans','name:zh','name:zh-CN','name:zh-Hant','name:zh-TW','name:zh-HK'],
    HK: ['name:zh-Hans','name:zh-CN','name:zh','name:zh-Hant','name:zh-HK','name:zh-TW','name'],
    TW: ['name:zh-Hans','name:zh-CN','name:zh','name','name:zh-Hant','name:zh-TW','name:zh-HK'],
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
// Hong Kong and Macau names are usually "中文 English"; only a Chinese-only
// local name stands in for name:zh there.
function chineseVariants(p, lang) {
  const area = p.atlas_zh || '';
  return chineseVariantKeys(lang, area).map(k => k !== 'name' ? p[k]
    : han(p.name) && !((area === 'HK' || area === 'MO') && /\p{Script=Latin}/u.test(p.name)) ? p.name : '').filter(nonempty);
}
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
  const english = [p['name:en'],p.int_name,p['name:latin'],p['name:en-Latn']].filter(nonempty);
  const selected = [p[`name:${lang}`]].filter(nonempty);
  const recorded = Object.entries(p).filter(([k,v])=>k.startsWith('name:') && nonempty(v)).map(([,v])=>v);
  const borrow = hanFallback(p, lang);
  let preferred;
  if (lang === 'local') preferred = local;
  else if (chinese(lang)) {
    const variants = chineseVariants(p, lang);
    preferred = borrow ? [
      ...variants.filter(han),
      ...local.filter(han), ...ideographicKeys.map(k=>p[k]).filter(han), ...recorded.filter(han),
      ...english, ...variants,
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
  const name = [...preferred, ...local, p.localized_name, p.label, p.ref].find(nonempty) || '';
  return chinese(lang) ? withoutKana(name) : name;
}
export function displayName(p, lang = 'local') {
  return p.atlas_language === lang ? p.atlas_name : chooseName(p,lang);
}
export function labelExpression(lang = 'local') {
  // Styles cannot tell regions apart; use the order for places elsewhere.
  const requested = chinese(lang) ? chineseVariantKeys(lang) : [`name:${lang}`];
  const keys = ['atlas_name', ...(lang !== 'local' ? [...new Set(requested),'name:en','name:latin'] : []), 'name','name:nonlatin','label','ref'];
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
      if (key === 'name') { if (chineseVariants({name:p.name, atlas_zh:area}, lang).length) return wanted; continue; }
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
