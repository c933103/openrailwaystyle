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
style.layers.push({
  id: 'inactive-railways', type: 'line', source: 'railway', 'source-layer': 'railway_line_high', minzoom: 7,
  filter: ['all', ['!', present], notFerry],
  paint: {
    'line-color': ['match', ['get', 'state'], 'construction', '#ba8123', 'proposed', '#92709a', '#81756a'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.3, 14, 2.5, 20, 4],
    'line-dasharray': [3, 2], 'line-opacity': 0.8,
  },
});
style.layers.push({
  id: 'speed-labels', type: 'symbol', source: 'railway', 'source-layer': 'railway_line_high', minzoom: 10,
  filter: ['all', present, notFerry, ['has', 'speed_label']],
  layout: { 'symbol-placement': 'line', 'symbol-spacing': 300, 'text-field': ['get', 'speed_label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-padding': 5 },
  paint: { 'text-color': '#26363d', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
});
// Station circles do not disappear because a text label collides. Text is still
// collision-aware; large stations get first choice of label positions.
for (const [source, layer, minzoom, maxzoom] of [
  ['stationLow', 'standard_railway_text_stations_low', 4, 7],
  ['stationMed', 'standard_railway_text_stations_med', 7, 8],
  ['stations', 'standard_railway_text_stations', 8, undefined],
]) {
  const filter = source === 'stations' ? ['all', present, ['match', ['get', 'feature'], ['station', 'halt', 'tram_stop'], true, false]] : undefined;
  const common = {source, 'source-layer': layer, minzoom, ...(maxzoom === undefined ? {} : {maxzoom}), ...(filter ? {filter} : {})};
  style.layers.push({
    id: `station-${source}-dots`, type: 'circle', ...common,
    paint: {
      'circle-color': '#fffef7', 'circle-stroke-color': '#123e52', 'circle-stroke-width': 2,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['match', ['get', 'station_size'], 'large', 3.8, 2.6], 10, ['match', ['get', 'station_size'], 'large', 6, 'normal', 4.8, 3.5], 17, ['match', ['get', 'station_size'], 'large', 8, 'normal', 6, 4.5]],
    },
  });
  style.layers.push({
    id: `station-${source}-names`, type: 'symbol', ...common,
    layout: {
      'text-field': ['coalesce', ['get', 'name'], ['get', 'label'], ''], 'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, ['match', ['get', 'station_size'], 'large', 13, 11], 12, ['match', ['get', 'station_size'], 'large', 17, 'normal', 15, 13], 18, 18],
      'symbol-sort-key': ['match', ['get', 'station_size'], 'large', 0, 'normal', 1, 2],
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.75,
      'text-padding': 4, 'text-max-width': 10, 'text-allow-overlap': false,
    },
    paint: { 'text-color': '#123e52', 'text-halo-color': '#fffef8', 'text-halo-width': 2.2 },
  });
}
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
