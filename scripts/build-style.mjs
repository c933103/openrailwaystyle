import { readFile, writeFile } from 'node:fs/promises';
import { ORM, UNKNOWN_COLOR, labelExpression, INFRASTRUCTURE, DEM_URL, speedPaint as speedColours, speedLabel } from '../styles/map-model.mjs';

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
    inactiveRegional: { type: 'vector', tiles: ['railtiles://{z}/{x}/{y}'], minzoom: 0, maxzoom: 10, promoteId: 'osm_id', attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors, ODbL</a>' },
    contours: {type:'vector',tiles:['atlas-contour://{z}/{x}/{y}'],minzoom:7,maxzoom:15},
    relief: {type:'raster-dem', tiles:[DEM_URL], tileSize:256, encoding:'terrarium', maxzoom:15, attribution:'<a href="terrain-credits.html">Terrain: Mapzen / AWS and data contributors</a>'},
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
  if (l.id.startsWith('admin_country')) {
    l.paint['line-color']='#6b6570';
    l.paint['line-width']=['interpolate',['linear'],['zoom'],0,0.6,4,1.2,7,1.8,12,2.3];
  }
}
const boundary = style.layers.find(l => l.id === 'admin_sub');
if (boundary) {
  boundary.filter = ['in','admin_level',6,8];
  boundary.paint = {'line-color':'#96928c','line-width':['interpolate',['linear'],['zoom'],5,0.35,10,0.65], 'line-opacity':0.45, 'line-dasharray':[3,3]};
}
const firstBoundary = {type:'line',source:'openmaptiles','source-layer':'boundary',minzoom:3,filter:['in','admin_level',3,4],layout:{'line-join':'round'}};
style.layers.push({...firstBoundary,id:'regional-border-casing',paint:{'line-color':'#fffef7','line-opacity':0.8,'line-width':['interpolate',['linear'],['zoom'],3,1.3,7,2.5,12,3.4]}});
style.layers.push({...firstBoundary,id:'regional-borders',paint:{'line-color':'#81747e','line-opacity':0.9,'line-width':['interpolate',['linear'],['zoom'],3,0.7,7,1.25,12,1.8],'line-dasharray':[5,2]}});
// Place hillshade over land/water fills, below waterways, roads and borders.
style.layers = [...style.layers.filter(l=>l.type==='background'||l.type==='fill'), ...style.layers.filter(l=>l.type!=='background'&&l.type!=='fill')];
const reliefIndex = style.layers.findIndex(l => l.type === 'line');
style.layers.splice(reliefIndex,0,{id:'terrain-relief',type:'hillshade',source:'relief',paint:{'hillshade-exaggeration':0.3,'hillshade-shadow-color':'#667365','hillshade-highlight-color':'#ffffff','hillshade-accent-color':'#738978','hillshade-illumination-anchor':'map','hillshade-illumination-direction':315}});
const contourBase = {type:'line',source:'contours','source-layer':'contours',minzoom:7,filter:['!=',['get','ele'],0],layout:{'line-join':'round'}};
const contourColor = ['case',['<',['get','ele'],0],'#467d9a','#927b5a'];
// Keep contours below transport and administrative linework.
style.layers.splice(reliefIndex+1,0,{...contourBase,id:'terrain-contours',paint:{'line-color':contourColor,'line-width':['case',['>', ['get','level'],0],0.8,0.4],'line-opacity':['interpolate',['linear'],['zoom'],7,0.45,12,0.65]}});
style.layers.push({id:'terrain-contour-labels',type:'symbol',source:'contours','source-layer':'contours',minzoom:8,filter:['all',['>', ['get','level'],0],['!=',['get','ele'],0]],layout:{'symbol-placement':'line','symbol-spacing':250,'text-field':['concat',['to-string',['get','ele']],' m'],'text-font':['Noto Sans Regular'],'text-size':10,'text-padding':10},paint:{'text-color':contourColor,'text-halo-color':'#f2f1e9','text-halo-width':1}});
const number = key => ['to-number', ['coalesce', ['get', key], -1], -1];
const present = ['==', ['coalesce', ['get', 'state'], 'present'], 'present'];
const notFerry = ['!=', ['get', 'feature'], 'ferry'];
const speedPaint = speedColours('metric');
const hasService = ['!=',['coalesce',['get','service'],''],''];
const infrastructurePaint = ['case',
  ['==', ['get', 'highspeed'], true], INFRASTRUCTURE[0][0],
  ['match', ['get', 'feature'], ['subway', 'light_rail', 'monorail'], true, false], INFRASTRUCTURE[3][0],
  ['==', ['get', 'feature'], 'tram'], INFRASTRUCTURE[4][0],
  hasService, INFRASTRUCTURE[5][0],
  ['==', ['get', 'usage'], 'branch'], INFRASTRUCTURE[2][0], INFRASTRUCTURE[1][0]];
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
    'line-opacity': mode === 'infrastructure' ? 1 : ['case', ['==', ['get', 'tunnel'], true], 0.65, 1],
    'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.6, 11, ['case', hasService, 1.1, 2.8], 16, ['case', hasService, 2, 4.8], 20, 7],
  });
}
// Structural cues use shape as well as colour. A bridge has dark parapets
// outside the class-coloured track; tunnels use a pale dashed core. They start
// with the detailed railway tiles: the z0–6 overview tiles carry no structure.
const structure = {type:'line',source:'railway','source-layer':'railway_line_high',minzoom:7,layout:{'line-cap':'butt','line-join':'round'}};
const bridge = {...structure,filter:['all',present,notFerry,['==',['get','bridge'],true]]};
const bridgeWidth = ['interpolate',['linear'],['zoom'],7,3.4,10,5.4,14,8,18,12];
const trackIndex = style.layers.findIndex(l=>l.id==='infrastructure-tracks');
style.layers.splice(trackIndex,0,
  {...bridge,id:'infrastructure-bridge-edge',paint:{'line-color':'#263b48','line-width':bridgeWidth}},
  {...bridge,id:'infrastructure-bridge-deck',paint:{'line-color':'#fffef8','line-width':['interpolate',['linear'],['zoom'],7,2.2,10,3.8,14,6,18,10]}},
);
style.layers.push({...structure,id:'infrastructure-tunnel',filter:['all',present,notFerry,['==',['get','tunnel'],true]],paint:{'line-color':'#fffef8','line-width':['interpolate',['linear'],['zoom'],7,0.7,10,1.1,14,2,18,3], 'line-dasharray':[3,2]}});
const inactivePaint = {
  'line-color': ['match', ['get', 'state'], 'construction', '#ad7619', 'proposed', '#896192', '#75675c'],
  'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 5, 1.2, 7, 1.7, 12, 2, 16, 2.8, 20, 4],
  'line-dasharray': [3, 2], 'line-opacity': 0.9,
};
style.layers.push({
  id: 'inactive-railways', type: 'line', source: 'railway', 'source-layer': 'railway_line_high', minzoom: 12,
  filter: ['all', ['!', present], notFerry], paint: inactivePaint,
});
// The complete snapshot supplies every lifecycle at regional scales. The
// ordinary detail tiles take over together at z12, avoiding duplicate lines.
// Construction shows at every zoom, proposals from z5, former lines from z7.
style.layers.push({
  id:'inactive-regional', type:'line', source:'inactiveRegional', 'source-layer':'lifecycle', minzoom:0, maxzoom:12,
  filter:['any', ['>=',['zoom'],7], ['==',['get','state'],'construction'], ['all', ['>=',['zoom'],5], ['==',['get','state'],'proposed']]],
  paint:inactivePaint,
});
for (const [id,source,sourceLayer,minzoom,maxzoom,filter] of [
  ['railway-names','railway','railway_line_high',9,undefined,['all',present,notFerry]],
  ['inactive-names','inactiveRegional','lifecycle',9,12,['literal',true]],
  ['inactive-detail-names','railway','railway_line_high',12,undefined,['all',['!',present],notFerry]],
]) style.layers.push({
  id, type:'symbol', source, 'source-layer':sourceLayer, minzoom, ...(maxzoom ? {maxzoom} : {}), filter,
  layout:{'symbol-placement':'line','symbol-spacing':450,'text-field':labelExpression('local'), 'text-font':['Noto Sans Bold'], 'text-size':['interpolate',['linear'],['zoom'],9,11,14,13], 'text-offset':[0,-0.85], 'text-padding':8, 'text-max-angle':35},
  paint:{'text-color':'#4a453f','text-halo-color':'#fffef8','text-halo-width':2},
});
style.layers.push({
  id: 'speed-labels', type: 'symbol', source: 'railway', 'source-layer': 'railway_line_high', minzoom: 10,
  filter: ['all', present, notFerry, ['has', 'speed_label']],
  layout: { 'symbol-placement': 'line', 'symbol-spacing': 300, 'text-field': speedLabel('metric'), 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-padding': 5 },
  paint: { 'text-color': '#26363d', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
});
// Keep distant views sparse. Marker and name form one collision-aware symbol
// below zoom 12; individual circles appear only at local scale.
const stationSelection = ['all',
  ['any', ['>=', ['zoom'], 7], ['==', ['get','station_size'], 'large']],
];
const stationFeatures = ['all', present,
  ['any', ['==', ['get','feature'], 'station'], ['all', ['>=', ['zoom'], 11], ['==', ['get','feature'], 'halt']], ['all', ['>=', ['zoom'], 13], ['==', ['get','feature'], 'tram_stop']]],
  ['any', ['>=', ['zoom'], 11], ['!', ['match', ['get','station'], ['subway','light_rail','monorail'], true, false]]],
];
const stationText = {
  'text-field': labelExpression('local', true), 'text-font': ['Noto Sans Bold'],
  'text-size': ['interpolate', ['linear'], ['zoom'], 6, 14, 10, ['match', ['get', 'station_size'], 'large', 16, 'normal', 15, 14], 18, 18],
  'symbol-sort-key': ['match', ['get', 'station_size'], 'large', 0, 'normal', 1, 2],
  'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.7,
  'text-padding': ['step', ['zoom'], 14, 9, 9, 12, 4], 'text-max-width': 9, 'text-allow-overlap': false,
};
const stationInk = { 'text-color': ['match', ['get','station_size'], 'large', '#123e52', '#0865c0'], 'text-halo-color': '#fffef8', 'text-halo-width': 2 };
// symbol-sort-key only orders labels within one tile, so a minor stop in one
// tile could block a main station in the next. MapLibre places whole layers
// from the top down, so each importance tier gets its own layer: main-line
// stations by size, then halts, then metro, light rail, people movers and
// trams. Low- and mid-zoom tiles carry only station_size (and already omit
// metro stations).
const metro = ['any', ['match', ['coalesce', ['get','station'], ''], ['subway','light_rail','monorail','funicular','miniature','tram'], true, false],
  ['==', ['get','feature'], 'tram_stop']];
const isStation = ['==', ['coalesce', ['get','feature'], 'station'], 'station'];
const size = ['coalesce', ['get','station_size'], 'small'];
const tiers = [ // bottom to top
  ['metro', metro],
  ['halt', ['all', ['!', metro], ['!', isStation]]],
  ['small', ['all', ['!', metro], isStation, ['!', ['match', size, ['large','normal'], true, false]]]],
  ['normal', ['all', ['!', metro], isStation, ['==', size, 'normal']]],
  ['large', ['all', ['!', metro], isStation, ['==', size, 'large']]],
];
for (const [tier, filter] of tiers) for (const [source, layer, minzoom, maxzoom] of [
  ['stationLow', 'standard_railway_text_stations_low', 6, 7],
  ['stationMed', 'standard_railway_text_stations_med', 7, 8],
  ['stations', 'standard_railway_text_stations', 8, 12],
]) {
  style.layers.push({
    id: `station-${source}-${tier}-names`, type: 'symbol', source, 'source-layer': layer, minzoom, maxzoom,
    filter: ['all', filter, ...(source === 'stations' ? [stationSelection, stationFeatures] : [stationSelection])],
    layout: { ...stationText, 'icon-image': 'station-dot', 'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.95, 11, 1.15],
      'icon-padding': 12, 'icon-allow-overlap': false, 'icon-ignore-placement': false, 'icon-optional': false, 'text-optional': false },
    paint: stationInk,
  });
}
style.layers.push({
  id: 'station-stations-dots', type: 'circle', source: 'stations', 'source-layer': 'standard_railway_text_stations', minzoom: 12,
  filter: stationFeatures,
  paint: { 'circle-color': '#ffa323', 'circle-stroke-color': '#123e52', 'circle-stroke-width': 1.5,
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, ['match', ['get', 'station_size'], 'large', 5, 'normal', 4, 3], 17, ['match', ['get', 'station_size'], 'large', 7, 'normal', 5.5, 4]] },
});
for (const [tier, filter] of tiers) style.layers.push({
  id: `station-detail-${tier}-names`, type: 'symbol', source: 'stations', 'source-layer': 'standard_railway_text_stations', minzoom: 12,
  filter: ['all', filter, stationFeatures], layout: stationText, paint: stationInk,
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
const railwayNames = style.layers.filter(l => l.type === 'symbol' && l.id.endsWith('-names') && !l.id.startsWith('station-'));
style.layers = style.layers.filter(l => !stationNames.includes(l) && !railwayNames.includes(l)).concat(railwayNames, stationNames);
for (const l of style.layers) {
  if (/^(infrastructure|electrification)-/.test(l.id)) l.layout.visibility = 'none';
}
await writeFile(new URL('../styles/world.style.json', import.meta.url), JSON.stringify(style, null, 2) + '\n');
console.log(`Built world.style.json: ${style.layers.length} layers`);
