import { SETTING_KEYS, SETTING_PARAMS, settingsQuery, speedBands, UNKNOWN_COLOR, INFRASTRUCTURE, NOT_ELECTRIFIED, TRAIN_PROTECTION, CONTROL_FAMILIES, CONTROL_LEVELS, NO_PROTECTION, controlColor, trainProtection, trainProtectionName, electrificationColor, gaugeColor, loadingGauge, loadingDimensions, INACTIVE_STATES, inactivePaint, describeCurrent, DEM_URL, contourOptions, speedPaint, speedLabel, SEARCH_API, LANGUAGES, labelExpression, displayName, legendRows, autoProjection, ORM, MODES, readSettings, formatSpeed, numericSpeed, stationRank, decodeLifecycleTile } from './map-model.mjs?v=20260928-12';

import { Drawing, Measure, readDrawing } from './draw.mjs?v=20260928-12';
import { installGlobeDrag, allowPolarCentres } from './globe-drag.mjs?v=20260928-12';

const $ = id => document.getElementById(id);
// The controls work as soon as this small module runs; the map libraries and
// label code load in the background (index.html reports a failure to load
// this module itself).
document.body.dataset.appStarted = 'true';
// Display settings are remembered in a cookie, not the address; settings in a
// shared link apply once and are then saved and removed from the address.
const SETTINGS_COOKIE = 'atlas_settings', LANGUAGE_COOKIE = 'atlas_language';
// The last position, heading and globe/flat choice, reopened next time.
// Kept in this browser's local storage (not a cookie, so it is never sent
// with page requests). A link with a position (#zoom/lat/lng) still wins.
const VIEW_STORE = 'atlas_view';
const rememberedView = (() => { try { const v = JSON.parse(localStorage.getItem(VIEW_STORE) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } })();
function saveView() {
  if (!map) return;
  const c = map.getCenter();
  try { localStorage.setItem(VIEW_STORE, JSON.stringify({c: [+c.lng.toFixed(5), +c.lat.toFixed(5)], z: +map.getZoom().toFixed(2), b: +map.getBearing().toFixed(1), p: +map.getPitch().toFixed(1), g: onGlobe()})); } catch {}
}
const readCookie = name => { try { return decodeURIComponent(document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1] || ''); } catch { return ''; } };
const writeCookie = (name, value) => { try { document.cookie = `${name}=${encodeURIComponent(value)}; max-age=31536000; path=/; SameSite=Lax`; } catch {} };
const remembered = (() => { try { const value = JSON.parse(readCookie(SETTINGS_COOKIE) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } })();
const settings = readSettings(location.search, {language: readCookie(LANGUAGE_COOKIE), ...remembered});
const status = $('map-status');
let map, ready = false, currentFeature, searchController, searchPausedUntil = 0, dem, scale, styleLanguage, pendingView, clickable = [], hoverFrame, drawing, measuring;
const assetVersion = new URL(import.meta.url).searchParams.get('v') || '20260928-12';
const loadScript = (src, global) => window[global] ? Promise.resolve() : new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = src; script.onload = resolve;
  script.onerror = () => reject(new Error('Map libraries could not load. Check your connection and reload.'));
  document.head.append(script);
});
const libraries = Promise.all([
  loadScript('https://cdn.jsdelivr.net/npm/maplibre-gl@5.1.0/dist/maplibre-gl.js', 'maplibregl'),
  loadScript('https://cdn.jsdelivr.net/npm/pmtiles@4.2.1/dist/pmtiles.js', 'pmtiles'),
  loadScript(new URL(`vendor/maplibre-contour.js?v=${assetVersion}`, import.meta.url).href, 'mlcontour'),
]);
const labels = import(`./vendor/tile-labels.js?v=${assetVersion}`);
libraries.catch(() => {}); labels.catch(() => {});
// Han characters are drawn with local fonts. One font per label language keeps
// glyph styles consistent: with a generic family, browsers mix fonts, e.g.
// a Japanese font for shared characters and a Chinese one for the rest.
const CJK_FONTS = {
  'zh-Hans': '"Noto Sans SC","Noto Sans CJK SC","Source Han Sans SC","PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif',
  'zh-Hant': '"Noto Sans TC","Noto Sans CJK TC","Source Han Sans TC","PingFang TC","Microsoft JhengHei",sans-serif',
  ja: '"Noto Sans JP","Noto Sans CJK JP","Source Han Sans JP","Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","Meiryo",sans-serif',
  ko: '"Noto Sans KR","Noto Sans CJK KR","Source Han Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif',
};
function cjkScript(lang) {
  if (CJK_FONTS[lang]) return lang;
  // Other label languages follow the browser's language, else Simplified
  // Chinese, whose fonts also cover Traditional characters.
  const browser = (navigator.languages || [navigator.language]).map(l => l || '').find(l => /^(zh|ja|ko)/i.test(l)) || '';
  return /^zh-(Hant|TW|HK|MO)/i.test(browser) ? 'zh-Hant' : /^ja/i.test(browser) ? 'ja' : /^ko/i.test(browser) ? 'ko' : 'zh-Hans';
}
const cjkFont = lang => CJK_FONTS[cjkScript(lang)];
// Named fonts are missing on many systems (Android exposes none), and the
// generic fallback then picks glyph shapes by language. MapLibre draws on a
// canvas outside the page, which has no language, so the browser's default
// applies: often Japanese shapes for Chinese names (e.g. 门). Give the canvas
// the label language whenever MapLibre sets up one of these fonts.
const CANVAS_LANG = {'zh-Hans':'zh-CN', 'zh-Hant':'zh-TW', ja:'ja', ko:'ko'};
{
  const context = window.CanvasRenderingContext2D?.prototype;
  const font = context && Object.getOwnPropertyDescriptor(context, 'font');
  if (font?.set && 'lang' in context) Object.defineProperty(context, 'font', {...font, set(value) {
    font.set.call(this, value);
    const script = Object.keys(CJK_FONTS).find(key => String(value).includes(CJK_FONTS[key]));
    if (script) this.lang = CANVAS_LANG[script];
  }});
}
// Run once the map has loaded, or now if it has.
function whenReady(action) {
  if (ready) action();
  else pendingView = action;
}
const errors = new Set();
const textNode = (tag, value, className) => {
  const el = document.createElement(tag); el.textContent = value;
  if (className) el.className = className;
  return el;
};
// Power, train control, gauge and loading gauge legends name exactly what
// is drawn in the current view, most common first: systems are regional,
// and a fixed list would be long and mostly irrelevant.
let inView = [], legendTimer;
// Waits for the view's tiles rather than map idle, which any slow tile
// (e.g. relief) can hold back.
function scheduleLegend() {
  clearTimeout(legendTimer);
  if (IN_VIEW[settings.mode]) legendTimer = setTimeout(updateInView, 250);
}
const GAUGE_NAMES = {600:'', 762:'2 ft 6 in', 914:'3 ft', 1000:'metre', 1067:'3 ft 6 in', 1372:'Scotch', 1435:'standard', 1520:'Russian', 1524:'Finnish', 1600:'Irish', 1668:'Iberian', 1676:'Indian'};
const IN_VIEW = {
  electrification: p => {
    if (['no', 'deelectrified'].includes(p.electrification_state) || p.voltage === 0) return null;
    const label = describeCurrent(p.voltage, p.frequency);
    // Sorted DC first, then AC by frequency, each by voltage.
    return label && !/not recorded/.test(label) ? [electrificationColor(p), label, (p.frequency || 0) * 1e6 + (p.voltage || 0)] : null;
  },
  control: p => {
    const system = trainProtection(p.train_protection0);
    return system && system[0] !== 'none' ? [controlColor(system[2], system[3]), system[1], system[3], LEVEL_SHORT[system[3]]] : null;
  },
  // Both halves of a dual-gauge track are drawn, so both gauges are listed
  // (a third gauge is not drawn; clicking the track lists it).
  gauge: p => {
    const rows = [p.gaugeint0, p.gaugeint1].filter(mm => mm > 0)
      .map(mm => [gaugeColor(mm), `${gauge(mm)}${GAUGE_NAMES[mm] && settings.units !== 'imperial' ? ` (${GAUGE_NAMES[mm]})` : ''}`, mm]);
    return rows.length ? rows : null;
  },
  loading: p => { const g = loadingGauge(p.loading_gauge); return g ? [g.color, g.name, g.rank, loadingDimensions(g)] : null; },
};
function updateInView() {
  const describe = IN_VIEW[settings.mode];
  if (!ready || !describe) return;
  const layers = [`${settings.mode}-overview`, `${settings.mode}-tracks`].filter(id => map.getLayer(id));
  const counts = new Map();
  for (const f of map.queryRenderedFeatures({layers})) {
    const described = describe(f.properties);
    if (!described) continue;
    for (const row of Array.isArray(described[0]) ? described : [described]) {
      const key = row.slice(0, 2).join('|'), entry = counts.get(key) || {row, n: 0};
      entry.n++; counts.set(key, entry);
    }
  }
  const rows = legendRows([...counts.values()]);
  if (rows.join() !== inView.join()) { inView = rows; renderLegend(); }
}
const LEVEL_SHORT = ['none', 'warning / stop only', 'spot', 'continuous', 'radio'];
function renderLegend() {
  const box = $('legend'); box.replaceChildren();
  const nothing = [['transparent', 'Nothing recorded in view', 'empty']];
  const listed = rows => rows.length ? rows : nothing;
  const legends = {
    speed: { title: `Mapped maximum speed · ${settings.units === 'imperial' ? 'mph' : 'km/h'}`, rows: speedBands(settings.units).map(b => [b.color, b.label]) },
    infrastructure: { title: 'Railway infrastructure', rows: INFRASTRUCTURE },
    electrification: { title: 'Electrification · in view', rows: [...listed(inView), [NOT_ELECTRIFIED, 'Not electrified']] },
    control: { title: 'Train protection · in view', rows: [...listed(inView), [NO_PROTECTION, 'No train protection']] },
    gauge: { title: 'Track gauge · in view', rows: listed(inView) },
    loading: { title: 'Loading gauge · in view', rows: listed(inView) },
  };
  const legend = legends[settings.mode];
  box.append(textNode('h2', legend.title));
  const grid = textNode('div', '', 'legend-grid');
  const rows = [...legend.rows];
  if (settings.mode === 'gauge') rows.push(['#1f5fbf', 'Dual gauge (one half per gauge)', 'dual']);
  if (settings.mode !== 'infrastructure') rows.push([UNKNOWN_COLOR, 'Unknown']);
  rows.push(['#2356b6','Bridge','bridge'], ['#2356b6','Tunnel','tunnel']);
  if (settings.inactive) rows.push(...INACTIVE_STATES.map(([state, color, label]) => [color, label, `inactive-${state}`]));
  for (const [color, label, extra] of rows) {
    const row = textNode('div', '', 'legend-item');
    const swatch = textNode('span', '', `swatch ${extra || ''}`); swatch.style.setProperty('--swatch', color);
    row.append(swatch, textNode('span', label)); grid.append(row);
  }
  if (settings.stations) {
    const station = textNode('div', '', 'legend-item'); station.append(textNode('span', '', 'station-swatch'), textNode('span', 'Station')); grid.append(station);
  }
  if (settings.mode === 'infrastructure') {
    const tracks = textNode('div', '', 'legend-item'); tracks.append(textNode('span', '2', 'track-badge-swatch'), textNode('span', 'Tracks side by side')); grid.append(tracks);
  }
  box.append(grid);
  const notes = {
    speed: settings.units === 'imperial' ? 'Labels in mph; limits tagged in mph keep their directional values. Grey means no numeric limit is recorded.' : 'Labels keep tagged units: bare numbers are km/h, mph is written out. Grey means no numeric limit is recorded.',
    electrification: 'Hue is the current type (DC, or AC by frequency); darker is higher voltage. A train needs both to match, unless built for several systems. Grey means not recorded.',
    control: 'Hue groups related systems (e.g. ETCS with China’s ETCS-derived CTCS); darker is more advanced: warning only, spot transmission, continuous, radio. Colour shows the first recorded system; click a track for all of them and their compatibility. Grey means nothing is recorded.',
    gauge: 'Gauges a few millimetres apart (e.g. 1432 and 1435, 1520 and 1524) share one colour and are generally compatible. Click a track for all recorded gauges. Grey means not recorded.',
    loading: 'Colour follows the envelope’s height above rail, so equal sizes match across regions; Britain’s W gauges share one height and form their own ladder. Click a track for dimensions. Grey means not recorded.',
    infrastructure: 'Zoomed in (zoom 14+), a boxed number gives the running tracks side by side, counted from the mapped tracks; sidings, yards and crossovers are not counted, and station areas are left unlabelled.',
  };
  let note = notes[settings.mode];
  if (settings.inactive && settings.mode === 'speed') note += ' Planned and former lines take the colour of their recorded limit, if any.';
  box.append(textNode('p', note, 'legend-note'));
}
function saveSettings() {
  writeCookie(SETTINGS_COOKIE, JSON.stringify(Object.fromEntries(SETTING_KEYS.map(key => [key, settings[key]]))));
  const url = new URL(location.href);
  if (SETTING_PARAMS.some(key => url.searchParams.has(key))) {
    for (const key of SETTING_PARAMS) url.searchParams.delete(key);
    history.replaceState(null, '', url);
  }
}
// The address of this view with its display settings, for sharing.
function shareURL() {
  const url = new URL(location.href);
  for (const [key, value] of settingsQuery(settings)) url.searchParams.set(key, value);
  return url.href;
}
saveSettings();
function applySettings() {
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === settings.mode)));
  for (const key of ['stations', 'labels', 'inactive', 'relief', 'names', 'autoGlobe']) $(key).checked = settings[key];
  $('units').value = settings.units;
  if (ready) clickable = [];
  if (ready) for (const layer of map.getStyle().layers) {
    let visible;
    if (MODES.some(mode => layer.id.startsWith(`${mode}-`))) visible = layer.id.startsWith(`${settings.mode}-`) && (!VALUE_LABELS.test(layer.id) || settings.labels);
    if (layer.id.startsWith('station-')) visible = settings.stations && (!layer.id.startsWith('station-former-') || settings.inactive);
    if (layer.id.startsWith('inactive-')) visible = settings.inactive;
    if (layer.id.endsWith('-names') && !layer.id.startsWith('station-')) visible = settings.names && (!layer.id.startsWith('inactive-') || settings.inactive);
    if (layer.id.startsWith('terrain-')) visible = settings.relief;
    if (layer.id === 'polar-caps') map.triggerRepaint();
    if (visible !== undefined) map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
    if (/^inactive-(regional|railways)-/.test(layer.id) && layer.type === 'line' && !layer.id.includes('bridge')) map.setPaintProperty(layer.id, 'line-color', inactivePaint(settings.mode, settings.units));
    if ((visible ?? true) && isClickable(layer.id)) clickable.push(layer.id);
  }
  // Clear the previous view's values before drawing the legend: if the new
  // view has nothing in view, the in-view list never changes and the legend
  // would keep the old rows.
  inView = [];
  renderLegend();
  if (ready) scheduleLegend();
}
const VALUE_LABELS = /^(speed|electrification|control|gauge|loading)-labels$/;
const isClickable = id => id.startsWith('station-') || (id.startsWith('inactive-') && !id.includes('bridge')) || /^(speed|infrastructure|electrification|control|gauge|loading)-(tracks|overview)$/.test(id);
function row(dl, label, value) {
  if (value === undefined || value === null || value === '') return;
  dl.append(textNode('dt', label), textNode('dd', String(value)));
}
function showDetails(feature) {
  currentFeature = feature;
  const p = feature.properties;
  const isStation = feature.source?.startsWith('station') || feature.kind === 'station';
  const panel = $('detail-content'); panel.replaceChildren();
  panel.append(textNode('div', isStation ? 'RAILWAY STATION' : 'RAILWAY INFRASTRUCTURE', 'eyebrow'));
  panel.append(textNode('h2', displayName(p, settings.language) || (isStation ? 'Unnamed station' : 'Unnamed railway')));
  const dl = document.createElement('dl');
  row(dl, 'Type', p.feature || p.railway || (isStation ? 'station' : undefined));
  row(dl, 'Status', p.state || 'present');
  row(dl, 'Reference', p.label || p.ref || p.railway_ref || p['railway:ref']);
  if (isStation) {
    row(dl, 'Station type', p.station);
    row(dl, 'Mapped size', p.station_size);
    if (p.station_size) panel.append(textNode('p', 'Size follows mapped route importance, not passenger numbers.', 'small'));
  } else {
    const speed = formatSpeed(p, settings.units);
    if (!p.state || p.state === 'present') {
      panel.append(textNode('p', speed.mapped, 'speed-value'));
      row(dl, 'Speed label', speed.tagged);
    } else if (typeof p.maxspeed === 'number') {
      row(dl, ['construction', 'proposed'].includes(p.state) ? 'Planned speed' : 'Former speed', speed.mapped);
    }
    row(dl, 'Direction', p.preferred_direction);
    row(dl, 'Usage', p.usage);
    row(dl, 'Service', p.service);
    row(dl, 'Track', p.track_ref);
    row(dl, 'Current', describeCurrent(p.voltage, p.frequency));
    row(dl, 'Electrification', p.electrification_state);
    row(dl, 'Planned current', p.electrification_state === 'present' ? undefined : describeCurrent(p.future_voltage, p.future_frequency));
    const protection = [p.train_protection0, p.train_protection1, p.train_protection2].filter(Boolean);
    row(dl, 'Train protection', protection.length ? protection.map(code => { const system = trainProtection(code); return system ? `${system[1]} (${CONTROL_LEVELS[system[3]].toLowerCase()})` : code; }).join('; ') : undefined);
    const family = trainProtection(protection[0])?.[2];
    if (family && CONTROL_FAMILIES[family]?.note && protection[0] !== 'none') row(dl, 'Compatibility', `${CONTROL_FAMILIES[family].label}: ${CONTROL_FAMILIES[family].note}`);
    row(dl, 'Protection being built', p.train_protection_construction ? trainProtectionName(p.train_protection_construction) : undefined);
    const gauges = p.gauges ? String(p.gauges).split(/[;,]\s*/) : [p.gauge0, p.gauge1, p.gauge2].filter(Boolean);
    row(dl, 'Gauge', gauges.length ? gauges.map(gauge).join(', ') : undefined);
    const loading = loadingGauge(p.loading_gauge);
    row(dl, 'Loading gauge', loading ? [loading.name, loadingDimensions(loading), loading.note].filter(Boolean).join(' · ') + (p.loading_gauge !== loading.code ? ` (tagged: ${p.loading_gauge})` : '') : undefined);
    row(dl, 'Tunnel', p.tunnel === true ? 'Yes' : undefined);
    row(dl, 'Bridge', p.bridge === true ? 'Yes' : undefined);
    if (!p.state || p.state === 'present') panel.append(textNode('p', 'Colour uses the preferred-direction limit, or the larger directional limit if no preference is mapped. The source label above retains both directions. Bare numbers are km/h.', 'small'));
  }
  row(dl, 'Operator', Array.isArray(p.operator) ? p.operator.join(', ') : p.primary_operator || p.operator);
  panel.append(dl);
  if (!isStation && map?.getZoom() < 7) panel.append(textNode('p', 'This is a generalized overview. Zoom in for individual tracks and full details.', 'small'));
  if (p.osm_id) {
    const link = textNode('a', 'View railway on OpenStreetMap ↗');
    link.href = `https://www.openstreetmap.org/way/${encodeURIComponent(p.osm_id)}`;
    link.target = '_blank'; link.rel = 'noopener'; panel.append(link);
  }
  if (feature.geometry?.type === 'Point') {
    const [lng, lat] = feature.geometry.coordinates;
    const link = textNode('a', 'View location on OpenStreetMap ↗');
    link.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
    link.target = '_blank'; link.rel = 'noopener'; panel.append(link);
  }
  $('details').hidden = false;
}
const EIGHTHS = ['','⅛','¼','⅜','½','⅝','¾','⅞'];
function gauge(value) {
  const mm = Number(value);
  if (!Number.isFinite(mm) || mm <= 0) return value;
  if (settings.units !== 'imperial') return `${mm} mm`;
  const eighths = Math.round(mm/25.4*8), feet = Math.floor(eighths/96), inches = Math.floor(eighths%96/8);
  return `${feet ? `${feet} ft ` : ''}${inches}${EIGHTHS[eighths%8]} in (${mm} mm)`;
}
// Units change speed colours and labels, contour intervals and the scale bar.
function unitStyle(style) {
  for (const layer of style.layers) {
    if (/^speed-(overview|tracks)$/.test(layer.id)) layer.paint['line-color'] = speedPaint(settings.units);
    if (layer.id === 'speed-labels') layer.layout['text-field'] = speedLabel(settings.units);
    if (/^inactive-(regional|railways)-/.test(layer.id) && layer.type === 'line' && !layer.id.includes('bridge')) layer.paint['line-color'] = inactivePaint(settings.mode, settings.units);
    if (/^terrain-(seabed-)?contour-labels/.test(layer.id)) layer.layout['text-field'] = ['concat', ['to-string', ['get','ele']], settings.units === 'imperial' ? ' ft' : ' m'];
  }
  if (dem) {
    style.sources.contours.tiles = [dem.contourProtocolUrl(contourOptions(settings.units))];
    style.sources.seabedContours.tiles = [dem.contourProtocolUrl(contourOptions(settings.units, 'shelf'))];
    style.sources.seabedContoursClose.tiles = [dem.contourProtocolUrl(contourOptions(settings.units, 'close'))];
  }
}
function applyUnits() {
  scale?.setUnit(settings.units);
  if (!ready) return;
  const style = {layers: map.getStyle().layers, sources: {contours: {}, seabedContours: {}, seabedContoursClose: {}}};
  unitStyle(style);
  for (const layer of style.layers) {
    if (/^speed-(overview|tracks)$/.test(layer.id) || (/^inactive-(regional|railways)-/.test(layer.id) && !layer.id.includes('bridge'))) map.setPaintProperty(layer.id, 'line-color', layer.paint['line-color']);
    if (layer.id === 'speed-labels' || /^terrain-(seabed-)?contour-labels/.test(layer.id)) map.setLayoutProperty(layer.id, 'text-field', layer.layout['text-field']);
  }
  map.getSource('contours')?.setTiles(style.sources.contours.tiles);
  map.getSource('seabedContours')?.setTiles(style.sources.seabedContours.tiles);
  map.getSource('seabedContoursClose')?.setTiles(style.sources.seabedContoursClose.tiles);
}
function updateStatus() {
  if (errors.size) {
    status.classList.add('error'); status.textContent = 'Some map data could not load. Check your connection or reload to retry.'; return;
  }
  status.classList.remove('error');
  status.textContent = map.getZoom() < 6 ? 'Worldwide coverage · zoom in for stations and former lines' : 'Explore the rail network · click a line or station';
  // Visible diagnostics make source availability inspectable without exposing
  // internal map objects or relying on a generic "loaded" flag.
  const features = map.queryRenderedFeatures();
  const tracks = features.filter(f => ['railway','speed','network','electric'].includes(f.source));
  const stations = features.filter(f => f.source.startsWith('station'));
  status.dataset.renderedTracks = String(tracks.length);
  status.dataset.renderedStations = String(stations.length);
  const regional = features.filter(f => f.source === 'inactiveRegional');
  status.dataset.lifecycleNames = JSON.stringify([...new Set(regional.map(f=>f.properties.name).filter(Boolean))]);
  status.dataset.renderedRailNames = String(features.filter(f=>f.layer.id.endsWith('-names') && !f.layer.id.startsWith('station-')).length);
  status.dataset.renderedPlanned = String(regional.filter(f => f.properties.state === 'proposed').length);
  status.dataset.renderedConstruction = String(regional.filter(f => f.properties.state === 'construction').length);
  status.dataset.renderedFormer = String(regional.filter(f => !['proposed','construction'].includes(f.properties.state)).length);
  status.dataset.numericSpeeds = String(tracks.filter(f => numericSpeed(f.properties.maxspeed) !== null).length);
}
const unwrap = url => url.replace(/^atlas(?:base|station):\/\/[^/]+\//,'').replace(/^atlas(?:rail|lg):\/\//,'');
function localizeStyle(style) {
  for (const layer of style.layers) {
    if (layer.type !== 'symbol' || layer.id === 'speed-labels' || layer.id.startsWith('terrain-')) continue;
    if (layer.source === 'openmaptiles' || layer.id.startsWith('station-') || layer.id.endsWith('-names')) layer.layout['text-field'] = labelExpression(settings.language);
  }
  style.sources.openmaptiles.url = `atlasbase://${settings.language}/${unwrap(style.sources.openmaptiles.url).replace(/^pmtiles:\/\//,'')}`;
  for(const id of ['stationLow','stationMed','stations']) style.sources[id].url = `atlasstation://${settings.language}/${unwrap(style.sources[id].url)}`;
  style.sources.inactiveRegional.tiles = [`railtiles://{z}/{x}/{y}?lang=${settings.language}`];
  style.sources.railway.url = `atlasrail://${unwrap(style.sources.railway.url)}`;
  style.sources.loadingLow.url = `atlaslg://${unwrap(style.sources.loadingLow.url)}`;
  unitStyle(style);
  styleLanguage = settings.language;
}
// More detail: draw the map at twice the size, scaled to half, one zoom level
// further in. The same area shows more tiles, features and smaller labels;
// the canvas keeps its pixel count. Controls are scaled back to normal size.
const detailButton = Object.assign(document.createElement('button'), {type:'button', className:'atlas-ctrl', textContent:'⊞', title:'More detail: show the next zoom level at half size'});
const drawButton = Object.assign(document.createElement('button'), {type:'button', className:'atlas-ctrl', textContent:'✎', title:'Drawing tools'});
// Globe or flat map. Web Mercator stretches high latitudes without limit;
// the globe (MapLibre's vertical-perspective projection) shows every region
// at its true shape. The button switches either way; automatically (unless
// turned off in Display options) the map becomes the globe below zoom 4 and
// the flat map from zoom 4, except where most of the view is beyond 60° N or
// S (autoProjection). It acts only when that choice changes, so a manual
// switch holds until then.
const polarButton = Object.assign(document.createElement('button'), {type:'button', className:'atlas-ctrl'});
let lastAutoProjection;
function polarShare() {
  // Layout size, not on-screen size: More detail draws the map scaled.
  const {clientWidth: width, clientHeight: height} = map.getContainer();
  let polar = 0, total = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const {lat} = map.unproject([width * i / 10, height * j / 10]);
    total++; if (Math.abs(lat) > 60) polar++;
  }
  return polar / total;
}
const onGlobe = () => map?.getProjection?.()?.type === 'globe';
function wantedProjection() {
  // More detail draws one zoom level further in.
  const zoom = map.getZoom() - (settings.detail ? 1 : 0);
  return autoProjection(zoom, zoom < 4 ? 0 : polarShare());
}
let syncPanning = () => {}, globeDragged = () => false, polarCentres;
function updatePolar() {
  if (!map) return;
  if (settings.autoGlobe) {
    const wanted = wantedProjection();
    if (wanted !== lastAutoProjection) {
      lastAutoProjection = wanted;
      if (wanted && wanted !== (onGlobe() ? 'globe' : 'mercator')) map.setProjection({type: wanted});
    }
  }
  const globe = onGlobe();
  polarButton.textContent = globe ? '🗺️' : '🌍';
  polarButton.title = globe ? 'Switch to the flat map' : 'Switch to the globe: every region at its true shape, without the flat map’s stretching near the poles';
  polarButton.setAttribute('aria-label', polarButton.title);
  syncPanning(); saveView();
}
polarButton.addEventListener('click', () => { map.setProjection({type: onGlobe() ? 'mercator' : 'globe'}); updatePolar(); });
const measureButton = Object.assign(document.createElement('button'), {type:'button', className:'atlas-ctrl', textContent:'📏', title:'Measure'});
const MIN_ZOOM = 1, MAX_ZOOM = 20;
function applyDetail(changeZoom) {
  $('map').classList.toggle('detail', settings.detail);
  detailButton.setAttribute('aria-pressed', String(settings.detail));
  detailButton.setAttribute('aria-label', settings.detail ? 'Show normal detail' : 'Show more detail');
  if (!map) return;
  map.setPixelRatio(devicePixelRatio / (settings.detail ? 2 : 1));
  // The zoom range shifts with the mode, so toggling always moves exactly one
  // level and keeps the viewport, even at the zoom limits.
  if (settings.detail) { map.setMaxZoom(MAX_ZOOM + 1); if (changeZoom) map.jumpTo({zoom: map.getZoom() + 1}); map.setMinZoom(MIN_ZOOM + 1); }
  else { map.setMinZoom(MIN_ZOOM); if (changeZoom) map.jumpTo({zoom: map.getZoom() - 1}); map.setMaxZoom(MAX_ZOOM); }
  // On the globe the smallest zoom follows the latitude (globe-drag.mjs).
  polarCentres?.refresh();
}
detailButton.addEventListener('click', () => { settings.detail = !settings.detail; applyDetail(true); saveSettings(); });
applyDetail(false);
class ButtonControl {
  constructor(buttons) { this.buttons = buttons; }
  onAdd() { this.container = Object.assign(document.createElement('div'), {className:'maplibregl-ctrl maplibregl-ctrl-group'}); this.container.append(...this.buttons); return this.container; }
  onRemove() { this.container.remove(); }
}
// Drawing tools: points, lines and areas, kept in this browser and saved or
// opened as GeoJSON.
function updateDrawing() {
  drawButton.setAttribute('aria-pressed', String(!$('draw-toolbar').hidden));
  measureButton.setAttribute('aria-pressed', String(!$('measure-toolbar').hidden));
  document.querySelectorAll('[data-draw]').forEach(b => b.setAttribute('aria-pressed', String(drawing?.mode === b.dataset.draw && !drawing.paused)));
  $('draw-pan').setAttribute('aria-pressed', String(Boolean(drawing?.paused)));
  $('draw-pan').disabled = !drawing?.mode;
  // Curve points apply to lines; the selected point's actions.
  $('draw-curved').disabled = drawing?.mode !== 'line';
  $('draw-curved').setAttribute('aria-pressed', String(Boolean(drawing?.curved)));
  const selected = drawing?.selection();
  $('draw-node').hidden = !selected;
  if (selected) {
    $('node-curve').hidden = !selected.canCurve;
    $('node-curve').textContent = selected.curved ? 'Make corner' : 'Make curved';
    $('node-extend').hidden = !selected.canExtend;
  }
  $('measure-delete').hidden = measuring?.selected === null || measuring?.selected === undefined;
  document.querySelectorAll('[data-measure]').forEach(b => b.setAttribute('aria-pressed', String(measuring?.mode === b.dataset.measure)));
}
// Drawing and measuring are exclusive: opening one closes the other.
function openTools(id) {
  for (const [toolbar, tool] of [['draw-toolbar', drawing], ['measure-toolbar', measuring]]) {
    const show = toolbar === id && $(toolbar).hidden;
    $(toolbar).hidden = !show;
    if (!show && tool?.active) tool.setMode(tool.mode);
  }
  updateDrawing();
}
drawButton.addEventListener('click', () => openTools('draw-toolbar'));
measureButton.addEventListener('click', () => openTools('measure-toolbar'));
$('draw-close').addEventListener('click', () => openTools(null));
$('measure-close').addEventListener('click', () => openTools(null));
document.querySelectorAll('[data-measure]').forEach(b => b.addEventListener('click', () => whenMap(() => measuring.setMode(b.dataset.measure))));
$('measure-undo').addEventListener('click', () => measuring?.undo());
$('measure-clear').addEventListener('click', () => measuring?.clear());
// Selected points: delete after confirmation.
$('measure-delete').addEventListener('click', () => { if (confirm('Delete this point?')) measuring?.deleteSelected(); });
$('node-delete').addEventListener('click', () => { if (confirm('Delete this point?')) drawing?.deleteSelected(); });
$('node-curve').addEventListener('click', () => drawing?.toggleSelectedCurve());
$('node-extend').addEventListener('click', () => {
  drawing?.extendSelected();
  // The extended line keeps its own style; show it in the style controls.
  if (drawing) { drawStyle({color: drawing.style.color}); $('draw-dash').value = drawing.style.dash; $('draw-width').value = String(drawing.style.width); }
});
$('draw-curved').addEventListener('click', () => drawing?.setCurved(!drawing.curved));
// Drawing style: colour, line style and width for new drawings.
function drawStyle(style) {
  whenMap(() => drawing.setStyle(style));
  if (style.color) {
    $('draw-color').value = style.color;
    document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === style.color)));
  }
}
document.querySelectorAll('[data-color]').forEach(b => { b.style.setProperty('--c', b.dataset.color); b.addEventListener('click', () => drawStyle({color: b.dataset.color})); });
$('draw-color').addEventListener('input', () => drawStyle({color: $('draw-color').value}));
$('draw-dash').addEventListener('change', () => drawStyle({dash: $('draw-dash').value}));
$('draw-width').addEventListener('change', () => drawStyle({width: Number($('draw-width').value)}));
document.querySelectorAll('[data-draw]').forEach(b => b.addEventListener('click', () => whenMap(() => drawing.setMode(b.dataset.draw))));
$('draw-pan').addEventListener('click', () => drawing?.setPaused(!drawing.paused));
$('draw-undo').addEventListener('click', () => drawing?.undo());
$('draw-finish').addEventListener('click', () => drawing?.finish());
$('draw-clear').addEventListener('click', () => { if (drawing?.features.length && confirm('Delete all drawings?')) drawing.clear(); });
$('draw-save').addEventListener('click', () => {
  if (!drawing) return;
  const link = Object.assign(document.createElement('a'), {href:URL.createObjectURL(drawing.file()), download:`railway-atlas-drawing-${new Date().toISOString().slice(0,10)}.geojson`});
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
$('draw-open').addEventListener('click', () => $('draw-file').click());
$('draw-file').addEventListener('change', async () => {
  const file = $('draw-file').files[0]; $('draw-file').value = '';
  if (!file || !drawing) return;
  try {
    const features = readDrawing(JSON.parse(await file.text()));
    drawing.add(features);
    $('draw-status').textContent = features.length ? `Opened ${features.length} drawing${features.length > 1 ? 's' : ''}.` : 'No points, lines or areas found in that file.';
  } catch { $('draw-status').textContent = 'That file is not valid GeoJSON.'; }
});
addEventListener('keydown', event => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
  if (measuring?.active) { if (event.key === 'Enter') measuring.end(); if (event.key === 'Escape') measuring.clear(); return; }
  if (!drawing?.active) return;
  if (event.key === 'Enter') drawing.finish();
  if (event.key === 'Escape') drawing.cancel();
});
// A drawing-layer failure must not stop the map from loading.
function installDrawing() {
  try { drawing.install(); measuring.install(); } catch (error) { console.error('Drawing tools unavailable:', error?.message || String(error)); }
  installPolar();
}
// The polar caps beyond 85.05°, which Web Mercator tiles do not reach, drawn
// on the globe from data prepared in a polar projection (polar-layer.mjs).
// Added below roads, borders, labels and railways; again after each style
// replacement. Place names there are markers.
let polarLayer, polarLoading, polarMarkers = new Map();
function showPolarPlaces(places) {
  const wanted = new Map(places.map(p => [`${p.lngLat[0]},${p.lngLat[1]},${settings.language}`, p]));
  for (const [key, marker] of polarMarkers) if (!wanted.has(key)) { marker.remove(); polarMarkers.delete(key); }
  for (const [key, place] of wanted) {
    if (polarMarkers.has(key)) continue;
    const element = textNode('span', displayName(place, settings.language) || place.name || '', 'polar-place');
    polarMarkers.set(key, new maplibregl.Marker({element}).setLngLat(place.lngLat).addTo(map));
  }
  // Labels that would overlap give way, the larger kinds of place first.
  const rank = place => {const k = POLAR_PLACE_ORDER.indexOf(place.place); return k < 0 ? POLAR_PLACE_ORDER.length : k;};
  const taken = [];
  for (const [key, place] of [...wanted].sort((a, b) => rank(a[1]) - rank(b[1]))) {
    const element = polarMarkers.get(key).getElement(), at = map.project(place.lngLat);
    const w = element.offsetWidth / 2 + 2, h = element.offsetHeight / 2 + 2;
    const clash = taken.some(([x, y, tw, th]) => Math.abs(x - at.x) < w + tw && Math.abs(y - at.y) < h + th);
    element.style.visibility = clash ? 'hidden' : '';
    if (!clash) taken.push([at.x, at.y, w, h]);
  }
}
const POLAR_PLACE_ORDER = ['continent', 'country', 'state', 'region', 'province', 'city', 'town', 'village', 'hamlet', 'locality', 'isolated_dwelling', 'island', 'islet'];
function installPolar() {
  if (!map) return;
  if (polarLayer) { if (!map.getLayer(polarLayer.id)) map.addLayer(polarLayer, map.getLayer('waterway-tunnel') ? 'waterway-tunnel' : undefined); return; }
  polarLoading ||= import(`./vendor/polar-layer.js?v=${assetVersion}`).then(({PolarLayer}) => {
    polarLayer = new PolarLayer({data: new URL('./data/polar/', import.meta.url), units: () => settings.units, relief: () => settings.relief, places: showPolarPlaces});
    installPolar();
  }).catch(error => console.warn('Polar caps unavailable:', error?.message || error));
}
// Once the map object exists (drawing needs it; loading can still be under way).
function whenMap(action) { if (drawing) action(); else pendingDraw = action; }
let pendingDraw;
let locate = () => ({});
async function initialize() {
  const [, labelCode] = await Promise.all([libraries, labels]);
  const {installLabelProtocols, localizeTile} = labelCode;
  locate = labelCode.locate;
  if (!window.maplibregl || !window.pmtiles) throw new Error('Map libraries could not load. Check your connection and reload.');
  // MapLibre 5 has no top-level supported() export. The Map constructor checks
  // WebGL itself; initialization errors are caught by the handler below.
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  installLabelProtocols(maplibregl,protocol,fetch,{dataRoot:new URL('./data/', import.meta.url)});
  dem = new mlcontour.DemSource({url:DEM_URL,encoding:'terrarium',maxzoom:15,worker:true,cacheSize:200,timeoutMs:20000,id:'atlas'});
  dem.setupMaplibre(maplibregl);
  const lifecycleRoot = new URL('./data/lifecycle/', import.meta.url);
  let tileIndex;
  maplibregl.addProtocol('railtiles', async (params, controller) => {
    const [key,query] = params.url.slice('railtiles://'.length).split('?');
    const lang = new URLSearchParams(query).get('lang') || 'local';
    if (!/^\d+\/\d+\/\d+$/.test(key)) throw new Error('Invalid lifecycle tile');
    tileIndex ||= fetch(new URL('index.json', lifecycleRoot)).then(async response => {
      if (!response.ok) throw new Error('The railway tile index could not load');
      return new Set((await response.json()).tiles);
    }).catch(error => { tileIndex = undefined; throw error; });
    if (!(await tileIndex).has(key)) return {data: new ArrayBuffer(0)};
    const response = await fetch(new URL(`${key}.pbf.gz`, lifecycleRoot), {signal: controller.signal});
    if (!response.ok) throw new Error(`Railway tile returned ${response.status}`);
    const [z,x,y] = key.split('/').map(Number);
    return {data: localizeTile(await decodeLifecycleTile(await response.arrayBuffer()),lang,{z,x,y})};
  });
  const styleURL = new URL(`world.style.json?v=${encodeURIComponent(assetVersion)}`, import.meta.url);
  const response = await fetch(styleURL);
  if (!response.ok) throw new Error('The map style could not load. Reload to try again.');
  const style = await response.json();
  for (const source of Object.values(style.sources)) {
    if (source.url?.startsWith('pmtiles://data/')) source.url = 'pmtiles://' + new URL(source.url.slice(10), styleURL).href;
  }
  // Apply language before constructing the map, avoiding an initial duplicate
  // station-tile download in the wrong language.
  // This also sets the contour sources (unitStyle). Relief and all contours
  // share one elevation loader and tile cache.
  localizeStyle(style);
  style.sources.relief.tiles = [dem.sharedDemProtocolUrl];
  // Reopen where the last visit ended, unless the link gives a position; start
  // on the globe (or as last left) so the first frame is not the flat map.
  const linked = /^#-?[\d.]+\//.test(location.hash), start = linked ? {} : rememberedView;
  const startZoom = linked ? Number(location.hash.slice(1).split('/')[0]) : Number.isFinite(start.z) ? start.z : 1.8;
  const startGlobe = typeof rememberedView.g === 'boolean' ? rememberedView.g : settings.autoGlobe && startZoom - (settings.detail ? 1 : 0) < 4;
  style.projection = {type: startGlobe ? 'globe' : 'mercator'};
  const validCenter = Array.isArray(start.c) && start.c.length === 2 && start.c.every(Number.isFinite);
  map = new maplibregl.Map({
    container: 'map', style, localIdeographFontFamily: cjkFont(settings.language), pixelRatio: devicePixelRatio / (settings.detail ? 2 : 1),
    center: validCenter ? start.c : [15,23], zoom: Number.isFinite(start.z) ? start.z : 1.8, bearing: Number.isFinite(start.b) ? start.b : 0, pitch: Number.isFinite(start.p) ? start.p : 0, hash: true, minZoom: MIN_ZOOM + (settings.detail ? 1 : 0), maxZoom: MAX_ZOOM + (settings.detail ? 1 : 0),
    renderWorldCopies: true, attributionControl: { compact: true },
  });
  // The globe may be centred beyond 85° (globe-drag.mjs); a view left or
  // linked there is applied again once that is allowed.
  polarCentres = allowPolarCentres(map, maplibregl.LngLat, () => MIN_ZOOM + (settings.detail ? 1 : 0));
  const [hashZoom, hashLat, hashLng] = linked ? location.hash.slice(1).split('/').map(Number) : [];
  const wanted = linked ? {center: [hashLng, hashLat], zoom: hashZoom} : validCenter ? {center: start.c, zoom: start.z} : null;
  if (wanted && Math.abs(wanted.center[1]) > 85 && wanted.center.every(Number.isFinite)) map.jumpTo(wanted);
  map.on('styleimagemissing', event => {
    if (event.id === 'track-badge') {
      // Track-count badge: a white rounded box with a dark edge, stretched
      // around its number.
      const size = 24, radius = 7, edge = 2, data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const qx = Math.max(radius - x - 0.5, x + 0.5 - (size - radius), 0), qy = Math.max(radius - y - 0.5, y + 0.5 - (size - radius), 0);
        const d = radius - Math.hypot(qx, qy); // distance inside the outline
        const alpha = Math.max(0, Math.min(1, d)), fill = Math.max(0, Math.min(1, d - edge));
        const c = [23 + (255 - 23) * fill, 62 + (254 - 62) * fill, 71 + (248 - 71) * fill];
        data.set([...c.map(Math.round), Math.round(alpha * 255)], (y * size + x) * 4);
      }
      map.addImage('track-badge', {width: size, height: size, data}, {pixelRatio: 2, stretchX: [[8, 16]], stretchY: [[8, 16]], content: [6, 5, 18, 19]});
      return;
    }
    if (event.id !== 'station-dot') return;
    const width = 32, data = new Uint8Array(width * width * 4);
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
      const r = Math.hypot(x + 0.5 - width / 2, y + 0.5 - width / 2);
      const offset = (y * width + x) * 4;
      const color = r < 8.5 ? [255,163,35] : [18,62,82];
      data.set([...color, Math.round(Math.max(0, Math.min(1, 12 - r)) * 255)], offset);
    }
    map.addImage('station-dot', {width,height:width,data}, {pixelRatio:2});
  });
  // Compass above the zoom buttons: shows the heading; click to face north.
  map.addControl(new maplibregl.NavigationControl({ showZoom: false, showCompass: true, visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new ButtonControl([detailButton, drawButton, measureButton, polarButton]), 'top-right');
  scale = new maplibregl.ScaleControl({ unit: settings.units });
  map.addControl(scale, 'bottom-left');
  drawing = new Drawing(map, {units: () => settings.units, status: text => { $('draw-status').textContent = text; }, changed: updateDrawing});
  measuring = new Measure(map, {units: () => settings.units, status: text => { $('measure-status').textContent = text; }, changed: updateDrawing});
  map.on('style.load', installDrawing);
  map.on('dblclick', event => {
    if (measuring.mode === 'distance') { event.preventDefault(); measuring.end(); }
    else if (drawing.multiPoint && !drawing.paused) { event.preventDefault(); drawing.finish(); }
  });
  const action = pendingDraw; pendingDraw = undefined; action?.();
  map.on('error', e => {
    // Panning and replacing language sources intentionally cancel old tiles.
    if (e.error?.name === 'AbortError' || /^AbortError$|operation was aborted/i.test(e.error?.message || '')) return;
    // Log text as well as the object: errors passed back from map workers
    // carry no stack, and plain logs of them show only "Error".
    console.error('Map resource error:', e.sourceId || 'map', e.error?.message || String(e.error), e.error);
    errors.add(e.sourceId || 'resource');
    status.classList.add('error'); status.textContent = 'Some map data could not load. Check your connection or reload to retry.';
    // A failed tile is requested again when next needed, but a source whose
    // metadata request failed stays empty for good: retry it a few times.
    const source = e.sourceId && !e.tile && map.getSource(e.sourceId), attempt = metadataRetries.get(e.sourceId) || 0;
    if (source?.url && typeof source.setUrl === 'function' && !source.loaded?.() && attempt < 3) {
      metadataRetries.set(e.sourceId, attempt + 1);
      setTimeout(() => { const current = map.getSource(e.sourceId); if (current?.url && !current.loaded?.()) current.setUrl(current.url); }, [5000, 15000, 45000][attempt]);
    }
  });
  const metadataRetries = new Map();
  map.on('sourcedata', e => { if (e.isSourceLoaded && e.sourceId) { errors.delete(e.sourceId); metadataRetries.delete(e.sourceId); } });
  // Apply settings as soon as the style is in place, not at MapLibre's
  // 'load', which waits for every initial tile: zoomed out that is dozens of
  // large overview tiles, and a source whose metadata request fails never
  // loads at all, which left view changes unapplied.
  const styleReady = () => {
    ready = true;
    // Settings changed while the map was loading take effect now.
    if (styleLanguage !== settings.language) { reloadLanguage(); return; }
    installDrawing();
    // A remembered globe/flat choice holds until the automatic choice changes.
    if (typeof rememberedView.g === 'boolean') lastAutoProjection = wantedProjection();
    applySettings(); applyUnits(); updateStatus(); updatePolar();
    document.body.dataset.mapReady = 'true';
    const action = pendingView; pendingView = undefined; action?.();
  };
  if (map.isStyleLoaded?.()) styleReady(); else map.once('style.load', styleReady);
  map.on('idle', updateStatus);
  map.on('moveend', scheduleLegend);
  map.on('moveend', updatePolar);
  // Drag the globe as a globe, over the poles (globe-drag.mjs); editable
  // points keep their own dragging.
  const globeDrag = installGlobeDrag(map, {active: onGlobe, ignore: point => {
    const layers = ['drawing-handle-targets', 'measure-point-targets'].filter(id => map.getLayer(id));
    return layers.length > 0 && map.queryRenderedFeatures([point.x, point.y], {layers}).length > 0;
  }});
  syncPanning = globeDrag.sync; globeDragged = globeDrag.justDragged;
  syncPanning();
  map.on('sourcedata', e => { if (['electric', 'control', 'gaugeLow', 'loadingLow', 'railway'].includes(e.sourceId) && e.tile) scheduleLegend(); });
  map.on('click', event => {
    // The release that ends a globe drag is not a click.
    if (globeDragged()) return;
    if (measuring.active) { measuring.click(event.lngLat, event.point); return; }
    if (drawing.active) { drawing.click(event.lngLat, event.point); return; }
    const p = event.point;
    const features = map.queryRenderedFeatures([[p.x - 7, p.y - 7], [p.x + 7, p.y + 7]], {layers: clickable})
      .sort((a, b) => Number(!a.source.startsWith('station')) - Number(!b.source.startsWith('station')) || stationRank(a.properties) - stationRank(b.properties));
    if (!features[0]) return;
    // Operating-line tiles are not relabelled; locate them by the click.
    const {properties} = features[0];
    features[0].properties = properties.atlas_han ? properties : {...properties, ...locate(event.lngLat.lng, event.lngLat.lat)};
    showDetails(features[0]);
  });
  // A full feature query on every mouse move is slow in dense areas and made
  // mouse panning stall. Skip it while dragging or moving, query only the
  // clickable layers, and at most once per frame.
  map.on('mousemove', event => {
    cancelAnimationFrame(hoverFrame);
    if (measuring.active) { if (!event.originalEvent.buttons) measuring.move(event.lngLat); return; }
    if (drawing.active) { if (!event.originalEvent.buttons) drawing.move(event.lngLat); return; }
    if (!ready || event.originalEvent.buttons || map.isMoving()) return;
    hoverFrame = requestAnimationFrame(() => {
      const hit = clickable.length && map.queryRenderedFeatures(event.point, {layers: clickable}).length > 0;
      map.getCanvas().style.cursor = hit ? 'pointer' : '';
    });
  });
}

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  settings.mode = button.dataset.mode; applySettings(); saveSettings();
}));
for (const key of ['stations', 'labels', 'inactive', 'relief', 'names', 'autoGlobe']) $(key).addEventListener('change', () => {
  settings[key] = $(key).checked; applySettings(); saveSettings();
  if (key === 'autoGlobe') { lastAutoProjection = undefined; updatePolar(); }
});
function reloadLanguage() {
  const appliedLanguage=settings.language;
  const style=map.getStyle();localizeStyle(style);
  ready=false;errors.clear();
  status.classList.remove('error');status.textContent='Updating map labels…';
  // Replace the style atomically. Incremental setUrl calls can leave stale
  // symbol-placement buckets after a language switch followed by a long pan.
  // Camera and display options persist; protocol/HTTP caches reuse the data.
  map.once('style.load',()=>{
    ready=true;
    if(appliedLanguage!==settings.language) {reloadLanguage();return;}
    applySettings();applyUnits();updateStatus();
    document.body.dataset.mapReady = 'true';
    if(currentFeature) showDetails(currentFeature);
    const action = pendingView; pendingView = undefined; action?.();
  });
  map.setStyle(style,{diff:false,localIdeographFontFamily:cjkFont(appliedLanguage)});
}
{
  const select = $('language');
  for (const [code,name] of LANGUAGES) {const option=textNode('option',name);option.value=code;select.append(option);}
  select.value=settings.language;
  select.addEventListener('change',()=>{
    settings.language=select.value;
    if(ready) reloadLanguage();
    saveSettings();
  });
}
$('units').addEventListener('change', () => {
  settings.units = $('units').value === 'imperial' ? 'imperial' : 'metric';
  applyUnits(); renderLegend(); saveSettings(); drawing?.refresh(); measuring?.refresh();
  if (currentFeature) showDetails(currentFeature);
});
$('collapse').addEventListener('click', () => {
  $('controls').hidden = !$('controls').hidden;
  $('collapse').textContent = $('controls').hidden ? '+' : '−';
  $('collapse').setAttribute('aria-expanded', String(!$('controls').hidden));
  $('collapse').setAttribute('aria-label', `${$('controls').hidden ? 'Expand' : 'Collapse'} map controls`);
});
// On phones and other small screens start with the controls folded away, so
// the map is visible at launch.
if (matchMedia('(max-width: 650px), (max-height: 500px)').matches) $('collapse').click();
function closeDetails() { $('details').hidden = true; currentFeature = null; }
$('details-close').addEventListener('click', closeDetails);
addEventListener('keydown', event => { if (event.key === 'Escape' && !$('details').hidden && !drawing?.active && !measuring?.active && !document.querySelector('dialog[open]')) closeDetails(); });
$('about-open').addEventListener('click', () => $('about').showModal());
$('about-close').addEventListener('click', () => $('about').close());
$('share').addEventListener('click', async () => {
  saveSettings(); $('share-status').hidden = false;
  const link = shareURL();
  try { await navigator.clipboard.writeText(link); $('share-status').textContent = 'Map link copied, including position and display options.'; }
  catch { $('share-status').replaceChildren(textNode('span', 'Copy this address: ')); const input = document.createElement('input'); input.value = link; input.readOnly = true; input.setAttribute('aria-label', 'Shareable map address'); input.style.width = '100%'; $('share-status').append(input); input.select(); }
});
$('search-form').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('search-input').value.trim(); if (q.length < 2) return;
  // The OpenRailwayMap API asks clients to stop after HTTP 429 and to give
  // up on requests after about 5 seconds.
  if (Date.now() < searchPausedUntil) {
    $('search-status').hidden = false;
    $('search-status').textContent = 'Station search is busy. Please try again in a few minutes.';
    return;
  }
  searchController?.abort(); searchController = new AbortController();
  const controller = searchController;
  const timeout = setTimeout(() => controller.abort('timeout'), 5000);
  $('search-results').hidden = true;
  $('search-status').hidden = false; $('search-status').textContent = 'Searching railway facilities…';
  try {
    // Search results are located for their Chinese name order.
    await labels.catch(() => {});
    const url = new URL(SEARCH_API); url.searchParams.set('q', q); url.searchParams.set('limit', '8');
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 429) searchPausedUntil = Date.now() + 10 * 60_000;
    if (!response.ok) throw new Error(`Search returned ${response.status}`);
    const items = await response.json(); if (!Array.isArray(items)) throw new Error('Unexpected search response');
    if (controller !== searchController) return;
    const results = $('search-results'); results.replaceChildren();
    for (const item of items) {
      if (!Number.isFinite(item.longitude) || !Number.isFinite(item.latitude)) continue;
      try { Object.assign(item, locate(item.longitude,item.latitude)); } catch {}
      const li = document.createElement('li'); const button = document.createElement('button'); button.type = 'button';
      button.append(textNode('span', displayName(item,settings.language) || item.railway_ref || 'Unnamed facility'));
      button.append(textNode('small', [item.station || item.feature || item.railway, item.railway_ref || item['railway:ref'], Array.isArray(item.operator) ? item.operator.join(', ') : item.operator].filter(Boolean).join(' · ')));
      button.addEventListener('click', () => {
        const coordinates = [item.longitude, item.latitude];
        // Before the map has loaded, go there as soon as it has.
        whenReady(() => map.flyTo({ center: coordinates, zoom: 14, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1000 }));
        showDetails({ kind: 'station', properties: item, geometry: { type: 'Point', coordinates } });
        results.hidden = true; $('search-status').hidden = true;
        if (matchMedia('(max-width: 650px)').matches && !$('controls').hidden) $('collapse').click();
      });
      li.append(button); results.append(li);
    }
    results.hidden = !results.children.length;
    $('search-status').textContent = results.children.length ? `${results.children.length} results` : 'No matching facility found. Try a local name or railway code.';
  } catch (error) {
    if (controller !== searchController) return;
    $('search-status').textContent = 'Station search is unavailable. Try again, or browse by panning and zooming.';
  } finally { clearTimeout(timeout); }
});
applySettings();
initialize().catch(error => {
  console.error(error);
  status.classList.add('error');
  status.textContent = /WebGL|webglcontext/i.test(error.message)
    ? 'This browser could not start WebGL. Enable graphics acceleration in your browser settings, then reload the map.'
    : error.message;
});

// Named export lets integration tests inspect rendered features without
// adding test controls or global variables to the map interface.
export {map};
