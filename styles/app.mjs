import { SPEED_BANDS, UNKNOWN_COLOR, SEARCH_API, LANGUAGES, labelExpression, displayName, ORM, MODES, readSettings, formatSpeed, numericSpeed, stationRank } from './map-model.mjs?v=20260922-2';


const $ = id => document.getElementById(id);
const settings = readSettings(location.search);
const status = $('map-status');
let map, ready = false, currentFeature, searchController;
const assetVersion = new URL(import.meta.url).searchParams.get('v') || '20260922-2';
const errors = new Set();
const textNode = (tag, value, className) => {
  const el = document.createElement(tag); el.textContent = value;
  if (className) el.className = className;
  return el;
};
function renderLegend() {
  const box = $('legend'); box.replaceChildren();
  const legends = {
    speed: { title: 'Mapped maximum speed · km/h', rows: SPEED_BANDS.map(b => [b.color, b.label]) },
    infrastructure: { title: 'Railway infrastructure', rows: [['#a92b47','High-speed line'],['#b85c29','Railway'],['#a97d29','Branch line'],['#237b82','Metro / light rail'],['#9f5e96','Tram'],['#888278','Service tracks']] },
    electrification: { title: 'Electrification · nominal voltage', rows: [['#d364a1','< 1 kV'],['#9d56b6','1–< 3 kV'],['#317cb9','3–< 15 kV'],['#42864a','15–< 25 kV'],['#c94831','≥ 25 kV'],['#525b62','Not electrified']] },
  };
  const legend = legends[settings.mode];
  box.append(textNode('h2', legend.title));
  const grid = textNode('div', '', 'legend-grid');
  const rows = [...legend.rows];
  if (settings.mode !== 'infrastructure') rows.push([UNKNOWN_COLOR, 'Unknown']);
  if (settings.inactive) rows.push(['#896192', 'Proposed', 'dashed'], ['#ad7619', 'Construction', 'dashed'], ['#75675c', 'Former lines', 'dashed']);
  for (const [color, label, extra] of rows) {
    const row = textNode('div', '', 'legend-item');
    const swatch = textNode('span', '', `swatch ${extra || ''}`); swatch.style.setProperty('--swatch', color);
    row.append(swatch, textNode('span', label)); grid.append(row);
  }
  if (settings.stations) {
    const station = textNode('div', '', 'legend-item'); station.append(textNode('span', '', 'station-swatch'), textNode('span', 'Station')); grid.append(station);
  }
  box.append(grid);
  const note = settings.mode === 'speed'
    ? 'Colours use km/h. Labels preserve mph and directional limits. Grey means no numeric limit is recorded.'
    : settings.mode === 'electrification' ? 'Click a track for voltage and frequency. Grey means unknown.' : 'Stations stay visible in every view.';
  box.append(textNode('p', note, 'legend-note'));
}
function saveSettings() {
  const url = new URL(location.href);
  url.searchParams.set('mode', settings.mode);
  for (const key of ['stations', 'labels', 'inactive', 'relief', 'names']) url.searchParams.set(key, settings[key] ? '1' : '0');
  for (const key of ['mapLanguage','stationLanguage','lineLanguage']) url.searchParams.set(key, settings[key]);
  history.replaceState(null, '', url);
}
function applySettings() {
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === settings.mode)));
  for (const key of ['stations', 'labels', 'inactive', 'relief', 'names']) $(key).checked = settings[key];
  if (ready) for (const layer of map.getStyle().layers) {
    let visible;
    if (MODES.some(mode => layer.id.startsWith(`${mode}-`)) && layer.id !== 'speed-labels') visible = layer.id.startsWith(`${settings.mode}-`);
    if (layer.id.startsWith('station-')) visible = settings.stations;
    if (layer.id === 'speed-labels') visible = settings.mode === 'speed' && settings.labels;
    if (layer.id.startsWith('inactive-')) visible = settings.inactive;
    if (layer.id.endsWith('-names') && !layer.id.startsWith('station-')) visible = settings.names && (!layer.id.startsWith('inactive-') || settings.inactive);
    if (layer.id === 'terrain-relief') visible = settings.relief;
    if (visible !== undefined) map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
  }
  renderLegend();

}
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
  panel.append(textNode('h2', displayName(p, settings[isStation ? 'stationLanguage' : 'lineLanguage'], isStation) || (isStation ? 'Unnamed station' : 'Unnamed railway')));
  const dl = document.createElement('dl');
  row(dl, 'Type', p.feature || p.railway || (isStation ? 'station' : undefined));
  row(dl, 'Status', p.state || 'present');
  row(dl, 'Reference', p.label || p.ref || p.railway_ref || p['railway:ref']);
  if (isStation) {
    row(dl, 'Station type', p.station);
    row(dl, 'Mapped size', p.station_size);
    if (p.station_size) panel.append(textNode('p', 'Size follows mapped route importance, not passenger numbers.', 'small'));
  } else {
    const speed = formatSpeed(p);
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
    row(dl, 'Gauge', p.gauges ? `${p.gauges} mm` : undefined);
    row(dl, 'Tunnel', p.tunnel === true ? 'Yes' : undefined);
    row(dl, 'Bridge', p.bridge === true ? 'Yes' : undefined);
    if (!p.state || p.state === 'present') panel.append(textNode('p', 'Colour uses the preferred-direction limit, or the larger directional limit if no preference is mapped. The source label above retains both directions. Bare numbers are km/h.', 'small'));
  }
  row(dl, 'Operator', Array.isArray(p.operator) ? p.operator.join(', ') : p.primary_operator || p.operator);
  panel.append(dl);
  if (!isStation && map.getZoom() < 7) panel.append(textNode('p', 'This is a generalized overview. Zoom in for individual tracks and full details.', 'small'));
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
  status.dataset.lifecycleNames = JSON.stringify([...new Set(regional.map(f=>f.properties.name).filter(Boolean))].slice(0,200));
  status.dataset.renderedRailNames = String(features.filter(f=>f.layer.id.endsWith('-names') && !f.layer.id.startsWith('station-')).length);
  status.dataset.renderedPlanned = String(regional.filter(f => f.properties.state === 'proposed').length);
  status.dataset.renderedConstruction = String(regional.filter(f => f.properties.state === 'construction').length);
  status.dataset.renderedFormer = String(regional.filter(f => !['proposed','construction'].includes(f.properties.state)).length);
  status.dataset.numericSpeeds = String(tracks.filter(f => numericSpeed(f.properties.maxspeed) !== null).length);
}
function localizeStyle(style) {
  for (const layer of style.layers) {
    if (layer.type !== 'symbol' || layer.id === 'speed-labels') continue;
    if (layer.source === 'openmaptiles') layer.layout['text-field'] = labelExpression(settings.mapLanguage);
    else if (layer.id.startsWith('station-')) layer.layout['text-field'] = labelExpression(settings.stationLanguage, true);
    else if (layer.id.endsWith('-names')) layer.layout['text-field'] = labelExpression(settings.lineLanguage);
  }
  for (const [id,path] of [['stationLow','standard_railway_text_stations_low'],['stationMed','standard_railway_text_stations_med'],['stations','standard_railway_text_stations']]) {
    const url = new URL(`${ORM}/${path}`);
    if(settings.stationLanguage !== 'local') url.searchParams.set('lang',settings.stationLanguage);
    style.sources[id].url=url.href;
  }
}
async function initialize() {
  if (!window.maplibregl || !window.pmtiles) throw new Error('Map libraries could not load. Check your connection and reload.');
  // MapLibre 5 has no top-level supported() export. The Map constructor checks
  // WebGL itself; initialization errors are caught by the handler below.
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
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
  map = new maplibregl.Map({
    container: 'map', style,
    center: [15,23], zoom: 1.8, hash: true, minZoom: 1, maxZoom: 20,
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
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.on('error', e => {
    console.error('Map resource error', e.error);
    errors.add(e.sourceId || 'resource');
    status.classList.add('error'); status.textContent = 'Some map data could not load. Check your connection or reload to retry.';
  });
  map.on('sourcedata', e => { if (e.isSourceLoaded && e.sourceId) errors.delete(e.sourceId); });
  map.on('load', () => {
    ready = true;
    applySettings(); updateStatus();
    document.body.dataset.mapReady = 'true';
  });
  map.on('idle', updateStatus);
  map.on('click', event => {
    const p = event.point;
    const features = map.queryRenderedFeatures([[p.x - 7, p.y - 7], [p.x + 7, p.y + 7]])
      .filter(f => f.layer.id.startsWith('station-') || f.layer.id.startsWith('inactive-') || /^(speed|infrastructure|electrification)-(tracks|overview)$/.test(f.layer.id))
      .sort((a, b) => Number(!a.source.startsWith('station')) - Number(!b.source.startsWith('station')) || stationRank(a.properties) - stationRank(b.properties));
    if (features[0]) showDetails(features[0]);
  });
  map.on('mousemove', event => {
    const hit = map.queryRenderedFeatures(event.point).some(f => f.layer.id.startsWith('station-') || f.source === 'railway' || f.layer.id.startsWith('inactive-'));
    map.getCanvas().style.cursor = hit ? 'pointer' : '';
  });
}

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  settings.mode = button.dataset.mode; applySettings(); saveSettings();
}));
for (const key of ['stations', 'labels', 'inactive', 'relief', 'names']) $(key).addEventListener('change', () => {
  settings[key] = $(key).checked; applySettings(); saveSettings();
});
for (const key of ['mapLanguage','stationLanguage','lineLanguage']) {
  const select = $(key);
  for (const [code,name] of LANGUAGES) { const option = textNode('option',name); option.value=code; select.append(option); }
  select.value=settings[key];
  select.addEventListener('change', () => {
    settings[key]=select.value;
    if (ready) {
      const style=map.getStyle(); localizeStyle(style);
      for(const layer of style.layers) if(layer.type==='symbol' && layer.layout?.['text-field']) map.setLayoutProperty(layer.id,'text-field',layer.layout['text-field']);
      if(key==='stationLanguage') for(const source of ['stationLow','stationMed','stations']) map.getSource(source).setUrl(style.sources[source].url);
      if(currentFeature) showDetails(currentFeature);
    }
    saveSettings();
  });
}
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
    const url = new URL(SEARCH_API); url.searchParams.set('q', q); url.searchParams.set('limit', '8');
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Search returned ${response.status}`);
    const items = await response.json(); if (!Array.isArray(items)) throw new Error('Unexpected search response');
    if (controller !== searchController) return;
    const results = $('search-results'); results.replaceChildren();
    for (const item of items) {
      if (!Number.isFinite(item.longitude) || !Number.isFinite(item.latitude)) continue;
      const li = document.createElement('li'); const button = document.createElement('button'); button.type = 'button';
      button.append(textNode('span', item.name || item.localized_name || item.railway_ref || 'Unnamed facility'));
      button.append(textNode('small', [item.station || item.feature || item.railway, item.railway_ref || item['railway:ref'], Array.isArray(item.operator) ? item.operator.join(', ') : item.operator].filter(Boolean).join(' · ')));
      button.addEventListener('click', () => {
        if (!ready) { $('search-status').textContent = 'The map is still loading. Try this result again shortly.'; return; }
        const coordinates = [item.longitude, item.latitude];
        map.flyTo({ center: coordinates, zoom: 14, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1000 });
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
