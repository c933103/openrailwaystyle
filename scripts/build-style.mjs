import { readFile, writeFile } from 'node:fs/promises';
import { ORM, SPEED_BANDS, UNKNOWN_COLOR } from '../styles/map-model.mjs';

// Keep the Hack4Rail base-map design and replace its Europe-only rail source.
const original = JSON.parse(await readFile(new URL('../styles/default.style.json', import.meta.url)));
const vector = (path, minzoom, maxzoom) => ({
  type: 'vector', url: `${ORM}/${path}`, minzoom, maxzoom, promoteId: 'id',
  attribution: '<a href="https://www.openrailwaymap.app/">OpenRailwayMap</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
});
const style = {
  version: 8, name: 'Open Railway Atlas — world',
  metadata: { description: 'Worldwide station-first adaptation of Open Railway Styles', 'openrailwaystyle:rail-data': ORM },
  glyphs: original.glyphs,
  sources: {
    openmaptiles: { ...original.sources.openmaptiles, attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a> · <a href="https://tuiles.enliberte.fr/">En Liberté tiles</a>' },
    network: vector('standard_railway_line_low', 0, 6),
    speed: vector('speed_railway_line_low', 0, 6),
    electric: vector('electrification_railway_line_low', 0, 6),
    railway: vector('railway_line_high', 7, 16),
    stationLow: vector('standard_railway_text_stations_low', 4, 6),
    stationMed: vector('standard_railway_text_stations_med', 7, 7),
    stations: vector('standard_railway_text_stations', 8, 16),
    inactiveRegional: { type: 'geojson', data: {type:'FeatureCollection',features:[]}, tolerance: 1, buffer: 128, attribution: '<a href="https://overpass.private.coffee/">Overpass by Private.coffee</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>' },
  },
  layers: original.layers.filter(l => (!l.source || l.source === 'openmaptiles') && !l.id.startsWith('airport_')).map(l => structuredClone(l)),
};
const places = style.layers.filter(l => l.type === 'symbol');
style.layers = style.layers.filter(l => l.type !== 'symbol');
for (const l of style.layers) {
  if (l.id === 'background') l.paint['background-color'] = '#f2f1e9';
  if (l.id === 'landcover_sand') l.paint['fill-color'] = '#e7dfc7';
  if (l['source-layer'] === 'transportation') l.paint['line-opacity'] = 0.35;
  if (l.id === 'water') l.paint['fill-color'] = '#bfd8e0';
}
const number = key => ['to-number', ['coalesce', ['get', key], -1], -1];
const present = ['==', ['coalesce', ['get', 'state'], 'present'], 'present'];
const notFerry = ['!=', ['get', 'feature'], 'ferry'];
const speed = number('maxspeed');
const speedPaint = ['case', ['<', speed, 0], UNKNOWN_COLOR,
  ['step', speed, SPEED_BANDS[0].color, ...SPEED_BANDS.slice(1).flatMap(b => [b.min, b.color])]];
const infrastructurePaint = ['case',
  ['==', ['get', 'highspeed'], true], '#a92b47',
  ['match', ['get', 'feature'], ['subway', 'light_rail', 'monorail'], true, false], '#237b82',
  ['==', ['get', 'feature'], 'tram'], '#9f5e96',
  ['has', 'service'], '#888278',
  ['==', ['get', 'usage'], 'branch'], '#a97d29', '#b85c29'];
const electricPaint = ['case',
  ['match', ['get', 'electrification_state'], ['no', 'deelectrified'], true, false], '#525b62',
  ['<', number('voltage'), 0], UNKNOWN_COLOR,
  ['==', number('voltage'), 0], '#525b62',
  ['step', number('voltage'), '#d364a1', 1000, '#9d56b6', 3000, '#317cb9', 15000, '#42864a', 25000, '#c94831']];
const width = ['interpolate', ['linear'], ['zoom'], 0, 0.6, 4, 1.15, 7, 1.8, 11, 2.6, 16, 4.5, 20, 7];
const addLine = (id, source, sourceLayer, minzoom, maxzoom, paint, extra = {}) => style.layers.push({
  id, type: 'line', source, 'source-layer': sourceLayer, minzoom, ...(maxzoom === undefined ? {} : {maxzoom}),
  filter: ['all', present, notFerry], layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': paint, 'line-width': width, ...extra },
});
for (const [mode, source, sourceLayer, color] of [
  ['infrastructure', 'network', 'standard_railway_line_low', infrastructurePaint],
  ['speed', 'speed', 'speed_railway_line_low', speedPaint],
  ['electrification', 'electric', 'electrification_railway_line_low', electricPaint],
]) {
  addLine(`${mode}-overview`, source, sourceLayer, 0, 7, color);
  addLine(`${mode}-tracks`, 'railway', 'railway_line_high', 7, undefined, color, {
    'line-opacity': ['case', ['==', ['get', 'tunnel'], true], 0.65, 1],
    'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.6, 11, ['case', ['has', 'service'], 1.1, 2.8], 16, ['case', ['has', 'service'], 2, 4.8], 20, 7],
  });
}
const inactivePaint = {
  'line-color': ['match', ['get', 'state'], 'construction', '#ad7619', 'proposed', '#896192', '#75675c'],
  'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 12, 2, 16, 2.8, 20, 4],
  'line-dasharray': [3, 2], 'line-opacity': 0.9,
};
style.layers.push({
  id: 'inactive-railways', type: 'line', source: 'railway', 'source-layer': 'railway_line_high', minzoom: 7,
  filter: ['all', ['!', present], notFerry], paint: inactivePaint,
});
// Fill only the lifecycle gaps in the upstream tiles, avoiding double lines.
style.layers.push({
  id: 'inactive-regional', type: 'line', source: 'inactiveRegional', minzoom: 7, maxzoom: 12,
  filter: ['!', ['step', ['zoom'], false,
    8, ['all', ['match', ['get','state'], ['proposed','construction'], true, false], ['==', ['get','feature'], 'rail'], ['match', ['get','usage'], ['main','branch'], true, false], ['==', ['get','service'], '']],
    9, ['all', ['match', ['get','state'], ['proposed','construction'], true, false], ['==', ['get','service'], ''], ['any', ['all', ['==', ['get','feature'], 'rail'], ['match', ['get','usage'], ['main','branch','industrial'], true, false]], ['all', ['==', ['get','feature'], 'light_rail'], ['match', ['get','usage'], ['main','branch'], true, false]]]],
    10, ['all', ['match', ['get','state'], ['proposed','construction'], true, false], ['match', ['get','feature'], ['rail','narrow_gauge','light_rail','monorail','subway','tram'], true, false], ['==', ['get','service'], '']],
    11, ['all', ['match', ['get','state'], ['proposed','construction','disused'], true, false], ['any', ['all', ['match', ['get','feature'], ['rail','narrow_gauge','light_rail'], true, false], ['match', ['get','service'], ['','spur','yard'], true, false]], ['all', ['match', ['get','feature'], ['monorail','subway','tram'], true, false], ['==', ['get','service'], '']]]]]],
  paint: inactivePaint,
});
style.layers.push({
  id: 'speed-labels', type: 'symbol', source: 'railway', 'source-layer': 'railway_line_high', minzoom: 10,
  filter: ['all', present, notFerry, ['has', 'speed_label']],
  layout: { 'symbol-placement': 'line', 'symbol-spacing': 300, 'text-field': ['get', 'speed_label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-padding': 5 },
  paint: { 'text-color': '#26363d', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
});
// Keep distant views sparse. Marker and name form one collision-aware symbol
// below zoom 12; individual circles appear only at local scale.
const stationSelection = ['all',
  ['any', ['>=', ['zoom'], 10], ['==', ['get','station_size'], 'large'], ['all', ['>=', ['zoom'], 8], ['==', ['get','station_size'], 'normal']]],
];
const stationFeatures = ['all', present,
  ['any', ['==', ['get','feature'], 'station'], ['all', ['>=', ['zoom'], 11], ['==', ['get','feature'], 'halt']], ['all', ['>=', ['zoom'], 13], ['==', ['get','feature'], 'tram_stop']]],
  ['any', ['>=', ['zoom'], 11], ['!', ['match', ['get','station'], ['subway','light_rail','monorail'], true, false]]],
];
const stationText = {
  'text-field': ['coalesce', ['get', 'name'], ['get', 'label'], ''], 'text-font': ['Noto Sans Bold'],
  'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 10, ['match', ['get', 'station_size'], 'large', 14, 'normal', 13, 12], 18, 16],
  'symbol-sort-key': ['match', ['get', 'station_size'], 'large', 0, 'normal', 1, 2],
  'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.8,
  'text-padding': ['step', ['zoom'], 14, 9, 9, 12, 4], 'text-max-width': 9, 'text-allow-overlap': false,
};
const stationInk = { 'text-color': '#123e52', 'text-halo-color': '#fffef8', 'text-halo-width': 2 };
for (const [source, layer, minzoom, maxzoom] of [
  ['stationLow', 'standard_railway_text_stations_low', 6, 7],
  ['stationMed', 'standard_railway_text_stations_med', 7, 8],
  ['stations', 'standard_railway_text_stations', 8, 12],
]) {
  style.layers.push({
    id: `station-${source}-names`, type: 'symbol', source, 'source-layer': layer, minzoom, maxzoom,
    filter: source === 'stations' ? ['all', stationSelection, stationFeatures] : stationSelection,
    layout: { ...stationText, 'icon-image': 'station-dot', 'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.65, 11, 0.9],
      'icon-padding': 12, 'icon-allow-overlap': false, 'icon-ignore-placement': false, 'icon-optional': false, 'text-optional': false },
    paint: stationInk,
  });
}
style.layers.push({
  id: 'station-stations-dots', type: 'circle', source: 'stations', 'source-layer': 'standard_railway_text_stations', minzoom: 12,
  filter: stationFeatures,
  paint: { 'circle-color': '#fffef7', 'circle-stroke-color': '#123e52', 'circle-stroke-width': 1.5,
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, ['match', ['get', 'station_size'], 'large', 4, 'normal', 3.2, 2.4], 17, ['match', ['get', 'station_size'], 'large', 6, 'normal', 4.5, 3.5]] },
});
style.layers.push({
  id: 'station-detail-names', type: 'symbol', source: 'stations', 'source-layer': 'standard_railway_text_stations', minzoom: 12,
  filter: stationFeatures, layout: stationText, paint: stationInk,
});
// Place labels are visually secondary. App moves station labels to the end to
// give them placement priority under MapLibre's reverse layer placement order.
for (const l of places) {
  l.paint['text-color'] = '#74807d';
  l.layout['text-font'] = ['Noto Sans Regular'];
  if (l.id.startsWith('place_')) l.layout['text-size'] = ['interpolate', ['linear'], ['zoom'], 5, 10, 14, 12];
  style.layers.push(l);
}
const stationNames = style.layers.filter(l => l.id.startsWith('station-') && l.type === 'symbol');
style.layers = style.layers.filter(l => !stationNames.includes(l)).concat(stationNames);
for (const l of style.layers) {
  if (/^(infrastructure|electrification)-/.test(l.id)) l.layout.visibility = 'none';
}
await writeFile(new URL('../styles/world.style.json', import.meta.url), JSON.stringify(style, null, 2) + '\n');
console.log(`Built world.style.json: ${style.layers.length} layers`);
