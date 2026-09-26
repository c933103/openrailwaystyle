import { speedBands, UNKNOWN_COLOR, INFRASTRUCTURE, DEM_URL, contourOptions, speedPaint, speedLabel, SEARCH_API, LANGUAGES, labelExpression, displayName, ORM, MODES, readSettings, formatSpeed, numericSpeed, stationRank, decodeLifecycleTile } from './map-model.mjs?v=20260926-10';

import { Drawing, Measure, readDrawing } from './draw.mjs?v=20260926-10';

const $ = id => document.getElementById(id);
// The controls work as soon as this small module runs; the map libraries and
// label code load in the background (index.html reports a failure to load
// this module itself).
document.body.dataset.appStarted = 'true';
// The label language is remembered in a cookie; a language in the URL wins.
const LANGUAGE_COOKIE = 'atlas_language';
const readCookie = name => { try { return decodeURIComponent(document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1] || ''); } catch { return ''; } };
const rememberLanguage = code => { try { document.cookie = `${LANGUAGE_COOKIE}=${encodeURIComponent(code)}; max-age=31536000; path=/; SameSite=Lax`; } catch {} };
const settings = readSettings(location.search, {language: readCookie(LANGUAGE_COOKIE)});
const status = $('map-status');
let map, ready = false, currentFeature, searchController, dem, scale, styleLanguage, pendingView, clickable = [], hoverFrame, drawing, measuring;
const assetVersion = new URL(import.meta.url).searchParams.get('v') || '20260926-10';
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
function cjkFont(lang) {
  if (CJK_FONTS[lang]) return CJK_FONTS[lang];
  // Other label languages follow the browser's language, else a Simplified
  // Chinese font, which also covers Traditional characters.
  const browser = (navigator.languages || [navigator.language]).map(l => l || '').find(l => /^(zh|ja|ko)/i.test(l)) || '';
  return /^zh-(Hant|TW|HK|MO)/i.test(browser) ? CJK_FONTS['zh-Hant'] : /^ja/i.test(browser) ? CJK_FONTS.ja : /^ko/i.test(browser) ? CJK_FONTS.ko : CJK_FONTS['zh-Hans'];
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
function renderLegend() {
  const box = $('legend'); box.replaceChildren();
  const legends = {
    speed: { title: `Mapped maximum speed · ${settings.units === 'imperial' ? 'mph' : 'km/h'}`, rows: speedBands(settings.units).map(b => [b.color, b.label]) },
    infrastructure: { title: 'Railway infrastructure', rows: INFRASTRUCTURE },
    electrification: { title: 'Electrification · nominal voltage', rows: [['#d364a1','< 1 kV'],['#9d56b6','1–< 3 kV'],['#317cb9','3–< 15 kV'],['#42864a','15–< 25 kV'],['#c94831','≥ 25 kV'],['#525b62','Not electrified']] },
  };
  const legend = legends[settings.mode];
  box.append(textNode('h2', legend.title));
  const grid = textNode('div', '', 'legend-grid');
  const rows = [...legend.rows];
  if (settings.mode === 'infrastructure') rows.push(['#2356b6','Bridge','bridge','from zoom 7'], ['#2356b6','Tunnel','tunnel','from zoom 7']);
  if (settings.mode !== 'infrastructure') rows.push([UNKNOWN_COLOR, 'Unknown']);
  if (settings.inactive) rows.push(['#ad7619', 'Construction', 'dashed', 'all zooms'], ['#896192', 'Proposed', 'dashed', 'from zoom 5'], ['#75675c', 'Former lines', 'dashed', 'from zoom 7']);
  for (const [color, label, extra, zooms] of rows) {
    const row = textNode('div', '', 'legend-item');
    const swatch = textNode('span', '', `swatch ${extra || ''}`); swatch.style.setProperty('--swatch', color);
    const text = textNode('span', label);
    if (zooms) text.append(textNode('small', zooms, 'legend-zoom'));
    row.append(swatch, text); grid.append(row);
  }
  if (settings.stations) {
    const station = textNode('div', '', 'legend-item'); station.append(textNode('span', '', 'station-swatch'), textNode('span', 'Station')); grid.append(station);
  }
  box.append(grid);
  const note = settings.mode === 'speed'
    ? settings.units === 'imperial' ? 'Labels in mph; limits tagged in mph keep their directional values. Grey means no numeric limit is recorded.' : 'Labels keep tagged units: bare numbers are km/h, mph is written out. Grey means no numeric limit is recorded.'
    : settings.mode === 'electrification' ? 'Click a track for voltage and frequency. Grey means unknown.' : 'Stations stay visible in every view.';
  box.append(textNode('p', note, 'legend-note'));
}
function saveSettings() {
  const url = new URL(location.href);
  url.searchParams.set('mode', settings.mode);
  for (const key of ['stations', 'labels', 'inactive', 'relief', 'names']) url.searchParams.set(key, settings[key] ? '1' : '0');
  if (settings.units === 'imperial') url.searchParams.set('units', 'imperial'); else url.searchParams.delete('units');
  if (settings.detail) url.searchParams.set('detail', '1'); else url.searchParams.delete('detail');
  for (const key of ['mapLanguage','stationLanguage','lineLanguage']) url.searchParams.delete(key);
  url.searchParams.set('language',settings.language);
  history.replaceState(null, '', url);
}
function applySettings() {
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === settings.mode)));
  for (const key of ['stations', 'labels', 'inactive', 'relief', 'names']) $(key).checked = settings[key];
  $('units').value = settings.units;
  if (ready) clickable = [];
  if (ready) for (const layer of map.getStyle().layers) {
    let visible;
    if (MODES.some(mode => layer.id.startsWith(`${mode}-`)) && layer.id !== 'speed-labels') visible = layer.id.startsWith(`${settings.mode}-`);
    if (layer.id.startsWith('station-')) visible = settings.stations && (!layer.id.startsWith('station-former-') || settings.inactive);
    if (layer.id === 'speed-labels') visible = settings.mode === 'speed' && settings.labels;
    if (layer.id.startsWith('inactive-')) visible = settings.inactive;
    if (layer.id.endsWith('-names') && !layer.id.startsWith('station-')) visible = settings.names && (!layer.id.startsWith('inactive-') || settings.inactive);
    if (layer.id.startsWith('terrain-')) visible = settings.relief;
    if (visible !== undefined) map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
    if ((visible ?? true) && isClickable(layer.id)) clickable.push(layer.id);
  }
  renderLegend();

}
const isClickable = id => id.startsWith('station-') || id.startsWith('inactive-') || /^(speed|infrastructure|electrification)-(tracks|overview)$/.test(id);
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
    }
    row(dl, 'Direction', p.preferred_direction);
    row(dl, 'Usage', p.usage);
    row(dl, 'Service', p.service);
    row(dl, 'Track', p.track_ref);
    row(dl, 'Voltage', typeof p.voltage === 'number' ? `${p.voltage.toLocaleString()} V` : undefined);
    row(dl, 'Frequency', typeof p.frequency === 'number' ? p.frequency === 0 ? 'DC' : `${p.frequency} Hz AC` : undefined);
    row(dl, 'Electrification', p.electrification_state);
    row(dl, 'Gauge', p.gauges ? String(p.gauges).split(/[;,]\s*/).map(gauge).join(', ') : undefined);
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
    if (layer.id === 'terrain-contour-labels' || layer.id === 'terrain-seabed-contour-labels') layer.layout['text-field'] = ['concat', ['to-string', ['get','ele']], settings.units === 'imperial' ? ' ft' : ' m'];
  }
  if (dem) {
    style.sources.contours.tiles = [dem.contourProtocolUrl(contourOptions(settings.units))];
    style.sources.seabedContours.tiles = [dem.contourProtocolUrl(contourOptions(settings.units, true))];
  }
}
function applyUnits() {
  scale?.setUnit(settings.units);
  if (!ready) return;
  const style = {layers: map.getStyle().layers, sources: {contours: {}, seabedContours: {}}};
  unitStyle(style);
  for (const layer of style.layers) {
    if (/^speed-(overview|tracks)$/.test(layer.id)) map.setPaintProperty(layer.id, 'line-color', layer.paint['line-color']);
    if (['speed-labels','terrain-contour-labels','terrain-seabed-contour-labels'].includes(layer.id)) map.setLayoutProperty(layer.id, 'text-field', layer.layout['text-field']);
  }
  map.getSource('contours')?.setTiles(style.sources.contours.tiles);
  map.getSource('seabedContours')?.setTiles(style.sources.seabedContours.tiles);
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
const unwrap = url => url.replace(/^atlas(?:base|station):\/\/[^/]+\//,'');
function localizeStyle(style) {
  for (const layer of style.layers) {
    if (layer.type !== 'symbol' || layer.id === 'speed-labels' || layer.id.startsWith('terrain-')) continue;
    if (layer.source === 'openmaptiles' || layer.id.startsWith('station-') || layer.id.endsWith('-names')) layer.layout['text-field'] = labelExpression(settings.language);
  }
  style.sources.openmaptiles.url = `atlasbase://${settings.language}/${unwrap(style.sources.openmaptiles.url).replace(/^pmtiles:\/\//,'')}`;
  for(const id of ['stationLow','stationMed','stations']) style.sources[id].url = `atlasstation://${settings.language}/${unwrap(style.sources[id].url)}`;
  style.sources.inactiveRegional.tiles = [`railtiles://{z}/{x}/{y}?lang=${settings.language}`];
  unitStyle(style);
  styleLanguage = settings.language;
}
// More detail: draw the map at twice the size, scaled to half, one zoom level
// further in. The same area shows more tiles, features and smaller labels;
// the canvas keeps its pixel count. Controls are scaled back to normal size.
const detailButton = Object.assign(document.createElement('button'), {type:'button', className:'atlas-ctrl', textContent:'⊞', title:'More detail: show the next zoom level at half size'});
const drawButton = Object.assign(document.createElement('button'), {type:'button', className:'atlas-ctrl', textContent:'✎', title:'Drawing tools'});
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
  document.querySelectorAll('[data-draw]').forEach(b => b.setAttribute('aria-pressed', String(drawing?.mode === b.dataset.draw)));
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
  installLabelProtocols(maplibregl,protocol);
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
  localizeStyle(style);
  style.sources.relief.tiles = [dem.sharedDemProtocolUrl];
  style.sources.contours.tiles = [dem.contourProtocolUrl(contourOptions(settings.units))];
  style.sources.seabedContours.tiles = [dem.contourProtocolUrl(contourOptions(settings.units, true))];
  map = new maplibregl.Map({
    container: 'map', style, localIdeographFontFamily: cjkFont(settings.language), pixelRatio: devicePixelRatio / (settings.detail ? 2 : 1),
    center: [15,23], zoom: 1.8, hash: true, minZoom: MIN_ZOOM + (settings.detail ? 1 : 0), maxZoom: MAX_ZOOM + (settings.detail ? 1 : 0),
    renderWorldCopies: true, attributionControl: { compact: true },
  });
  map.on('styleimagemissing', event => {
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
  map.addControl(new ButtonControl([detailButton, drawButton, measureButton]), 'top-right');
  scale = new maplibregl.ScaleControl({ unit: settings.units });
  map.addControl(scale, 'bottom-left');
  drawing = new Drawing(map, {units: () => settings.units, status: text => { $('draw-status').textContent = text; }, changed: updateDrawing});
  measuring = new Measure(map, {units: () => settings.units, status: text => { $('measure-status').textContent = text; }, changed: updateDrawing});
  map.on('style.load', installDrawing);
  map.on('dblclick', event => {
    if (measuring.mode === 'distance') { event.preventDefault(); measuring.end(); }
    else if (drawing.multiPoint) { event.preventDefault(); drawing.finish(); }
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
  });
  map.on('sourcedata', e => { if (e.isSourceLoaded && e.sourceId) errors.delete(e.sourceId); });
  map.on('load', () => {
    ready = true;
    // Settings changed while the map was loading take effect now.
    if (styleLanguage !== settings.language) { reloadLanguage(); return; }
    installDrawing();
    applySettings(); applyUnits(); updateStatus();
    document.body.dataset.mapReady = 'true';
    const action = pendingView; pendingView = undefined; action?.();
  });
  map.on('idle', updateStatus);
  map.on('click', event => {
    if (measuring.active) { measuring.click(event.lngLat); return; }
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
for (const key of ['stations', 'labels', 'inactive', 'relief', 'names']) $(key).addEventListener('change', () => {
  settings[key] = $(key).checked; applySettings(); saveSettings();
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
    rememberLanguage(settings.language);
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
$('details-close').addEventListener('click', () => { $('details').hidden = true; currentFeature = null; });
$('about-open').addEventListener('click', () => $('about').showModal());
$('about-close').addEventListener('click', () => $('about').close());
$('share').addEventListener('click', async () => {
  saveSettings(); $('share-status').hidden = false;
  try { await navigator.clipboard.writeText(location.href); $('share-status').textContent = 'Map link copied, including position and display options.'; }
  catch { $('share-status').replaceChildren(textNode('span', 'Copy this address: ')); const input = document.createElement('input'); input.value = location.href; input.readOnly = true; input.setAttribute('aria-label', 'Shareable map address'); input.style.width = '100%'; $('share-status').append(input); input.select(); }
});
$('search-form').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('search-input').value.trim(); if (q.length < 2) return;
  searchController?.abort(); searchController = new AbortController();
  const controller = searchController;
  const timeout = setTimeout(() => controller.abort('timeout'), 15000);
  $('search-results').hidden = true;
  $('search-status').hidden = false; $('search-status').textContent = 'Searching railway facilities…';
  try {
    // Search results are located for their Chinese name order.
    await labels.catch(() => {});
    const url = new URL(SEARCH_API); url.searchParams.set('q', q); url.searchParams.set('limit', '8');
    const response = await fetch(url, { signal: controller.signal });
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
