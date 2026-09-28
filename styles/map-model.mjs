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
export const MODES = ['speed', 'infrastructure', 'electrification', 'control', 'gauge', 'loading'];
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
export function controlPaint() {
  return ['match', ['coalesce', ['get', 'train_protection0'], ''], ...TRAIN_PROTECTION.flatMap(([code, , family, level]) => [code, controlColor(family, level)]), UNKNOWN_COLOR];
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
// TSI, GOST 9238, AAR Plate C, Portuguese PT gauges). Gauges of equal height
// share a colour: GA, GB, GB1 and GB2 all reach 4.32 m and differ only in
// the upper corners. Britain's W gauges share one height and differ in the
// containers they clear, so they form their own ladder. Other values are
// shown as tagged.
export const LOADING_GAUGES = [
  // code(s), name, height m, width m, family, note
  [['PPI', 'G1'], 'PPI (G1, Berne gauge)', 4.28, 3.15, 'height'],
  [['TSI_GA'], 'GA', 4.32, 3.15, 'height', 'GA, GB, GB1 and GB2 reach the same height; each clears larger upper corners (containers, swap bodies, semi-trailers).'],
  [['TSI_GB'], 'GB', 4.32, 3.15, 'height'], [['TSI_GB1'], 'GB1', 4.32, 3.15, 'height'], [['TSI_GB2'], 'GB2', 4.32, 3.15, 'height'],
  [['CPb', 'CPb+'], 'CPb / CPb+ (Portugal)', 4.5, 3.44, 'height'],
  [['UIC_C', 'G2'], 'G2 (formerly UIC C)', 4.65, 3.15, 'height'], [['TSI_GC'], 'GC', 4.65, 3.15, 'height'],
  [['PT c'], 'PT c (Portugal)', 4.7, 3.44, 'height'],
  [['AAR_C'], 'AAR Plate C', 4.72, 3.25, 'height'],
  [['AAR_F'], 'AAR Plate F', 5.18, 3.25, 'height'],
  [['GOST_T'], 'T (GOST 9238, 1520 mm network)', 5.3, 3.75, 'height'],
  [['W5'], 'W5', null, null, 'british', 'Britain: W gauges share one height; higher numbers clear larger containers.'],
  [['W6'], 'W6', null, null, 'british'], [['W6A', 'W6A*'], 'W6A', null, null, 'british', 'Available over most of the British network.'],
  [['W7', 'W7*'], 'W7', null, null, 'british'], [['W8', 'W8*'], 'W8', null, null, 'british', '8 ft 6 in (2.6 m) containers on standard wagons.'],
  [['W9'], 'W9', null, null, 'british', '9 ft 0 in containers on low wagons (Megafret).'], [['W9Plus'], 'W9Plus', null, null, 'british'],
  [['W10'], 'W10', null, null, 'british', '9 ft 6 in high-cube containers on standard wagons; 2.5 m wide Euro containers.'], [['W10A'], 'W10A', null, null, 'british'],
  [['W11'], 'W11', null, null, 'british'], [['W12'], 'W12', null, null, 'british', 'As W10, and 2.6 m wide refrigerated containers.'],
  [['EBV 1', 'EBV 2', 'EBV 3', 'EBV 4'], 'EBV (Swiss profiles)', null, null, 'other', 'EBV 4 is the Gotthard corridor profile for 4.00 m corner-height road vehicles on suitable wagons.'],
  [['FS'], 'FS (Italian profile)', null, null, 'other'],
  [['deep-tube'], 'London deep tube', null, null, 'metro'], [['subsurface'], 'London sub-surface', null, null, 'metro'],
  [['Kleinprofil'], 'Kleinprofil (Berlin U-Bahn)', null, null, 'metro'], [['Großprofil'], 'Großprofil (Berlin U-Bahn)', null, null, 'metro'],
];
const LOADING_HEIGHT_STOPS = [[4.28, '#a5d66b'], [4.32, '#43a047'], [4.5, '#00897b'], [4.65, '#1e88e5'], [4.72, '#3949ab'], [4.8, '#5e35b1'], [5.3, '#8e24aa']];
const BRITISH_LADDER = ['W5', 'W6', 'W6A', 'W7', 'W8', 'W9', 'W9Plus', 'W10', 'W10A', 'W11', 'W12'];
export const LOADING_OTHER = '#a1887f', LOADING_METRO = '#b0a4c8';
export function loadingGauge(value) {
  if (!value) return null;
  // Lists (e.g. "W6A, W7, W8") mean the line clears all of them: take the largest.
  const british = BRITISH_LADDER.filter(code => String(value).split(/,\s*/).some(v => v.replace('*', '') === code));
  const code = british.length ? british.at(-1) : String(value).trim();
  const entry = LOADING_GAUGES.find(([codes]) => codes.includes(code));
  if (!entry && /^[A-E][1-5]?$/.test(code)) return {code, name: `${code} (EN 15528 line category, not a loading gauge)`, family: 'other', color: LOADING_OTHER, rank: 0};
  if (!entry) return {code, name: `${code} (as tagged)`, family: 'other', color: LOADING_OTHER, rank: 0};
  const [, name, height, width, family, note] = entry;
  const color = family === 'height' ? interpolateColor(LOADING_HEIGHT_STOPS, height)
    : family === 'british' ? hsl(18, 70, 72 - BRITISH_LADDER.indexOf(code) * 4.2) : family === 'metro' ? LOADING_METRO : LOADING_OTHER;
  // Sort key for legends: height where published, else position on the ladder.
  const rank = height || (family === 'british' ? 3 + BRITISH_LADDER.indexOf(code) / 100 : family === 'metro' ? 1 : 2);
  return {code, name, height, width, family, note: note || LOADING_GAUGES.find(([, , , , f, n]) => f === family && n)?.[5], color, rank};
}
export const loadingDimensions = g => g?.height ? `${g.height.toFixed(2)} m high × ${g.width.toFixed(2)} m wide` : '';
export function loadingPaint() {
  const lg = ['coalesce', ['get', 'loading_gauge'], ''];
  const britishCases = [...BRITISH_LADDER].reverse().flatMap(code => [['any', ['==', lg, code], ['in', `${code},`, ['concat', lg, ',']], ['in', `${code}*`, lg]], loadingGauge(code).color]);
  // 'in' on "W6A," style tokens avoids W6 matching inside W6A.
  const exact = LOADING_GAUGES.filter(([, , , , family]) => family !== 'british').flatMap(([codes]) => codes.map(code => [code, loadingGauge(code).color])).flat();
  return ['case', ['==', lg, ''], UNKNOWN_COLOR, ...britishCases, ['match', lg, ...exact, LOADING_OTHER]];
}
export const loadingLabel = () => {
  const lg = ['coalesce', ['get', 'loading_gauge'], ''];
  return ['case', ...[...BRITISH_LADDER].reverse().flatMap(code => [['any', ['==', lg, code], ['in', `${code},`, ['concat', lg, ',']], ['in', `${code}*`, lg]], code]), lg];
};
// Planned, construction and former lines: in the speed view coloured by the
// recorded (planned or former) limit where one exists; otherwise by state.
export const INACTIVE_STATES = [['construction', '#ad7619', 'Construction'], ['proposed', '#896192', 'Proposed'], ['former', '#75675c', 'Former lines']];
export function inactivePaint(mode, units = 'metric') {
  const byState = ['match', ['get', 'state'], 'construction', INACTIVE_STATES[0][1], 'proposed', INACTIVE_STATES[1][1], INACTIVE_STATES[2][1]];
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
  const english = [p['name:en'],p.int_name,p['name:latin'],p['name:en-Latn']].filter(nonempty);
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
  return {
    mapped: n === null ? 'Not recorded / not numeric' : units === 'imperial' ? `${mph} (${kmh})` : `${kmh} (${mph})`,
    tagged: raw ? `${raw}${/mph|km\/h/.test(raw) ? '' : ' (km/h)'}` : 'Not recorded',
  };
}
// Display settings live in a cookie; a link can still carry them (the app
// then saves them and removes them from the address). remembered: settings
// kept in this browser, used for anything the URL does not name.
export const SETTING_KEYS = ['mode','stations','labels','inactive','relief','names','units','detail','language'];
const LEGACY_LANGUAGE_KEYS = ['stationLanguage','mapLanguage','lineLanguage'];
export const SETTING_PARAMS = [...SETTING_KEYS, ...LEGACY_LANGUAGE_KEYS];
export function readSettings(search, remembered = {}) {
  const params = new URLSearchParams(search);
  const flag = (key, fallback) => params.has(key) ? params.get(key) !== '0' && (fallback || params.get(key) === '1') : typeof remembered[key] === 'boolean' ? remembered[key] : fallback;
  const pick = (key, valid, fallback) => [params.get(key), remembered[key]].find(valid) ?? fallback;
  return {
    mode: pick('mode', v => MODES.includes(v), 'speed'),
    stations: flag('stations', true), labels: flag('labels', true), inactive: flag('inactive', true),
    relief: flag('relief', true), names: flag('names', true),
    units: pick('units', v => v === 'metric' || v === 'imperial', 'metric'),
    detail: flag('detail', false),
    language: language(params.get('language') || LEGACY_LANGUAGE_KEYS.map(k => params.get(k)).find(Boolean) || remembered.language),
  };
}
// Settings as link parameters, for sharing a view.
export function settingsQuery(settings) {
  const params = new URLSearchParams();
  for (const key of SETTING_KEYS) params.set(key, typeof settings[key] === 'boolean' ? (settings[key] ? '1' : '0') : settings[key]);
  return params;
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
