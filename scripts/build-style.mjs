import { readFile, writeFile } from 'node:fs/promises';
import {roadLayers, constraintLayers} from './planning-style.mjs';
import {contextLayers} from './context-style.mjs';
import {DETAIL_ZOOM} from './crossing-data.mjs';
import { ORM, LIGHT_MODES, MINOR_MODES, LIFECYCLE_PATTERNS, UNKNOWN_COLOR, labelExpression, INFRASTRUCTURE, DEM_URL, speedPaint as speedColours, speedLabel, electrificationPaint, controlPaint, gaugePaint, loadingPaint, loadingLabel, trainProtectionShort, TRAIN_PROTECTION, inactivePaint as inactiveColours } from '../styles/map-model.mjs';

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
    control: vector('signals_railway_line_low', 0, 6),
    gaugeLow: vector('track_railway_line_low', 0, 6),
    // The same overview tiles with loading gauges added by way ID (atlaslg
    // protocol, tile-labels.mjs).
    loadingLow: vector('standard_railway_line_low', 0, 6),
    railway: vector('railway_line_high', 7, 16),
    // Running tracks side by side, counted in the browser from the railway
    // tiles (atlastracks protocol, tile-labels.mjs and track-tiles.mjs):
    // always from zoom-14 tiles, so the same at every zoom.
    trackCounts: {type: 'vector', tiles: ['atlastracks://{z}/{x}/{y}'], minzoom: 14, maxzoom: 14, attribution: '<a href="https://www.openrailwaymap.app/">OpenRailwayMap</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>'},
    stationLow: vector('standard_railway_text_stations_low', 4, 6),
    // The mid-zoom endpoint returns nothing below zoom 7, and the low-zoom
    // one keeps only stations OpenRailwayMap sizes large or normal, which
    // excludes nearly all of China. The fragment (never requested; see
    // tile-labels.mjs) makes zoom-6 tiles from their four zoom-7 children
    // and keeps zoom 7 on zoom-7 tiles (the provider says maxzoom 8).
    stationMed: {...vector('standard_railway_text_stations_med', 6, 7), url: `${ORM}/standard_railway_text_stations_med#minzoom=6&maxzoom=7&underzoom=7`},
    stations: vector('standard_railway_text_stations', 8, 16),
    inactiveRegional: { type: 'vector', tiles: ['railtiles://{z}/{x}/{y}'], minzoom: 0, maxzoom: 10, promoteId: 'osm_id', attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors, ODbL</a>' },
    crossings: vector('points_of_interest',15,18),
    crossingsDetail: {type:'vector',tiles:['crossingtiles://{z}/{x}/{y}'],minzoom:DETAIL_ZOOM,maxzoom:DETAIL_ZOOM,attribution:'<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors, ODbL</a>'},
    // Operating branch lines for the overview zooms (branch-lines.yml):
    // OpenRailwayMap's z0–6 tiles hold main lines only.
    branchLines: {type:'vector',tiles:['branchtiles://{z}/{x}/{y}'],minzoom:4,maxzoom:6,attribution:'<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors, ODbL</a>'},
    streetRunning: {type:'vector',tiles:['streettiles://{z}/{x}/{y}'],minzoom:12,maxzoom:12,attribution:'<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors, ODbL</a>'},
    contours: {type:'vector',tiles:['atlas-contour://{z}/{x}/{y}'],minzoom:7,maxzoom:15},
    // Seabed contours (see contourOptions in map-model.mjs). The elevation
    // tiles hold depths only to zoom 10, so the close source stops at zoom 11
    // and is enlarged beyond it rather than regenerated.
    seabedContours: {type:'vector',tiles:['atlas-contour://{z}/{x}/{y}'],minzoom:5,maxzoom:10},
    seabedContoursClose: {type:'vector',tiles:['atlas-contour://{z}/{x}/{y}'],minzoom:11,maxzoom:11},
    // Satellite and hybrid backgrounds: EOxCloudless (Sentinel-2, 10 m), free
    // for non-commercial use under CC BY-NC-SA 4.0 with this attribution. The
    // source stops at zoom 14, near the imagery's own resolution, and is
    // enlarged beyond it, which also spares EOX's free service.
    satellite: {type:'raster', tiles:['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg'], tileSize:256, maxzoom:14,
      attribution:'<a href="https://cloudless.eox.at">EOxCloudless https://cloudless.eox.at</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025), <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>'},
    relief: {type:'raster-dem', tiles:[DEM_URL], tileSize:256, encoding:'terrarium', maxzoom:15, attribution:'<a href="terrain-credits.html">Terrain: Mapzen / AWS and data contributors</a>'},
  },
  // The base map's airport layers are replaced by the transport context
  // layers (context-style.mjs), including its white runway stripe.
  layers: original.layers.filter(l => (!l.source || l.source === 'openmaptiles') && !l.id.startsWith('airport_') && l['source-layer'] !== 'aeroway' && l['source-layer'] !== 'transportation').map(l => structuredClone(l)),
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
style.layers.splice(reliefIndex+1,0,{...contourBase,id:'terrain-contours',filter:['all',['!=',['get','ele'],0],['any',['<',['zoom'],9],['>',['get','ele'],0]]],paint:{'line-color':contourColor,'line-width':['case',['>', ['get','level'],0],0.8,0.4],'line-opacity':['interpolate',['linear'],['zoom'],7,0.45,12,0.65]}},{...contourBase,id:'terrain-seabed-contours',source:'seabedContours',minzoom:5,maxzoom:11,filter:['all',['<',['get','ele'],0],['any',['>=',['zoom'],9],['>',['get','ele'],-200]]],paint:{'line-color':contourColor,'line-width':['case',['>', ['get','level'],0],0.8,0.4],'line-opacity':['interpolate',['linear'],['zoom'],5,0.4,12,0.65]}},{...contourBase,id:'terrain-seabed-contours-close',source:'seabedContoursClose',minzoom:11,filter:['<',['get','ele'],0],paint:{'line-color':contourColor,'line-width':['case',['>', ['get','level'],0],0.8,0.4],'line-opacity':['interpolate',['linear'],['zoom'],5,0.4,12,0.65]}});
style.layers.push({id:'terrain-contour-labels',type:'symbol',source:'contours','source-layer':'contours',minzoom:8,filter:['all',['>', ['get','level'],0],['!=',['get','ele'],0],['any',['<',['zoom'],9],['>',['get','ele'],0]]],layout:{'symbol-placement':'line','symbol-spacing':250,'text-field':['concat',['to-string',['get','ele']],' m'],'text-font':['Noto Sans Regular'],'text-size':10,'text-padding':10},paint:{'text-color':contourColor,'text-halo-color':'#f2f1e9','text-halo-width':1}});
style.layers.push({id:'terrain-seabed-contour-labels',type:'symbol',source:'seabedContours','source-layer':'contours',minzoom:6,maxzoom:11,filter:['all',['>', ['get','level'],0],['<',['get','ele'],0],['any',['>=',['zoom'],9],['>',['get','ele'],-200]]],layout:{'symbol-placement':'line','symbol-spacing':250,'text-field':['concat',['to-string',['get','ele']],' m'],'text-font':['Noto Sans Regular'],'text-size':10,'text-padding':10},paint:{'text-color':contourColor,'text-halo-color':'#f2f1e9','text-halo-width':1}});
style.layers.push({id:'terrain-seabed-contour-labels-close',type:'symbol',source:'seabedContoursClose','source-layer':'contours',minzoom:11,filter:['all',['>', ['get','level'],0],['<',['get','ele'],0]],layout:{'symbol-placement':'line','symbol-spacing':250,'text-field':['concat',['to-string',['get','ele']],' m'],'text-font':['Noto Sans Regular'],'text-size':10,'text-padding':10},paint:{'text-color':contourColor,'text-halo-color':'#f2f1e9','text-halo-width':1}});
const number = key => ['to-number', ['coalesce', ['get', key], -1], -1];
const present = ['==', ['coalesce', ['get', 'state'], 'present'], 'present'];
const notFerry = ['!=', ['get', 'feature'], 'ferry'];
const speedPaint = speedColours('metric');
const hasService = ['!=',['coalesce',['get','service'],''],''];
// Tracks by kind: light rail, monorail and metro from zoom 10; trams,
// funiculars, miniature railways and service tracks (sidings, yards, spurs)
// from zoom 11. The detailed tiles hold some of them earlier (light rail main
// and branch lines from zoom 9).
const LATE_FEATURES = ['tram', 'funicular', 'miniature'], URBAN_FEATURES = ['light_rail', 'monorail', 'subway'];
const byKindZoom = ['case',
  ['any', ['match', ['get', 'feature'], LATE_FEATURES, true, false], hasService], ['>=', ['zoom'], 11],
  ['match', ['get', 'feature'], URBAN_FEATURES, true, false], ['>=', ['zoom'], 10],
  true];
const infrastructurePaint = ['case',
  ['==', ['get', 'highspeed'], true], INFRASTRUCTURE[0][0],
  ['match', ['get', 'feature'], ['subway', 'light_rail', 'monorail'], true, false], INFRASTRUCTURE[3][0],
  ['==', ['get', 'feature'], 'tram'], INFRASTRUCTURE[4][0],
  hasService, INFRASTRUCTURE[5][0],
  ['==', ['get', 'usage'], 'branch'], INFRASTRUCTURE[2][0], INFRASTRUCTURE[1][0]];
const electricPaint = electrificationPaint();
const width = ['interpolate', ['linear'], ['zoom'], 0, 0.6, 4, 1.15, 7, 1.8, 11, 2.6, 16, 4.5, 20, 7];
const addLine = (id, source, sourceLayer, minzoom, maxzoom, paint, extra = {}) => style.layers.push({
  id, type: 'line', source, 'source-layer': sourceLayer, minzoom, ...(maxzoom === undefined ? {} : {maxzoom}),
  filter: ['all', present, notFerry, ...(source === 'railway' ? [byKindZoom] : [])], layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': paint, 'line-width': width, ...extra },
});
// Track width by zoom; scale multiplies each stop, so halves and offsets
// follow the same curve (zoom expressions cannot be nested in arithmetic).
const trackWidth = (scale = 1) => ['interpolate', ['linear'], ['zoom'],
  7, 1.6 * scale, 11, ['case', hasService, 1.1 * scale, 2.8 * scale], 16, ['case', hasService, 2 * scale, 4.8 * scale], 20, 7 * scale];
// Dual or multiple gauge: the track is split lengthwise, the first gauge's
// colour on one half and the second's on the other. Dashes would clash with
// the dashed tunnel core and the inactive-line patterns.
const isDual = ['>', ['to-number', ['coalesce', ['get','gaugeint1'], 0], 0], 0];
const halfWidth = ['interpolate', ['linear'], ['zoom'],
  7, ['case', isDual, 0.8, 1.6], 11, ['case', hasService, ['case', isDual, 0.55, 1.1], ['case', isDual, 1.4, 2.8]],
  16, ['case', hasService, ['case', isDual, 1, 2], ['case', isDual, 2.4, 4.8]], 20, ['case', isDual, 3.5, 7]];
const dualOffset = sign => ['interpolate', ['linear'], ['zoom'],
  7, ['case', isDual, 0.4 * sign, 0], 11, ['case', isDual, ['case', hasService, 0.275 * sign, 0.7 * sign], 0],
  16, ['case', isDual, ['case', hasService, 0.5 * sign, 1.2 * sign], 0], 20, ['case', isDual, 1.75 * sign, 0]];
// Branch lines at zooms 4–7 are split the same way (the overview width).
const branchHalfWidth = ['interpolate', ['linear'], ['zoom'], 4, ['case', isDual, 0.575, 1.15], 7, ['case', isDual, 0.9, 1.8]];
const branchDualOffset = sign => ['interpolate', ['linear'], ['zoom'], 4, ['case', isDual, 0.2875 * sign, 0], 7, ['case', isDual, 0.45 * sign, 0]];
for (const [mode, source, sourceLayer, color] of [
  ['infrastructure', 'network', 'standard_railway_line_low', infrastructurePaint],
  ['speed', 'speed', 'speed_railway_line_low', speedPaint],
  ['electrification', 'electric', 'electrification_railway_line_low', electricPaint],
  ['control', 'control', 'signals_railway_line_low', controlPaint()],
  ['gauge', 'gaugeLow', 'track_railway_line_low', gaugePaint()],
  ['loading', 'loadingLow', 'standard_railway_line_low', loadingPaint()],
]) {
  // Branch lines from zoom 4, under the main lines, in the same colours
  // (their tiles carry the fields of the detailed railway tiles).
  addLine(`${mode}-branch-overview`, 'branchLines', 'branch_lines', 4, 7, color,
    mode === 'gauge' ? {'line-width': branchHalfWidth, 'line-offset': branchDualOffset(-1)} : {});
  // The second gauge of a branch line, also under the main lines.
  if (mode === 'gauge') style.layers.push({id:'gauge-branch-dual', type:'line', source:'branchLines', 'source-layer':'branch_lines', minzoom:4, maxzoom:7,
    filter:['all', present, notFerry, isDual],
    layout:{'line-cap':'butt','line-join':'round'},
    paint:{'line-color':gaugePaint(1), 'line-width':branchHalfWidth, 'line-offset':branchDualOffset(1)}});
  addLine(`${mode}-overview`, source, sourceLayer, 0, 7, color);
  addLine(`${mode}-tracks`, 'railway', 'railway_line_high', 7, undefined, color, {
    'line-opacity': mode === 'infrastructure' ? 1 : ['case', ['==', ['get', 'tunnel'], true], 0.65, 1],
    'line-width': mode === 'gauge' ? halfWidth : trackWidth(),
    ...(mode === 'gauge' ? {'line-offset': dualOffset(-1)} : {}),
  });
}
style.layers.push({id:'gauge-dual', type:'line', source:'railway', 'source-layer':'railway_line_high', minzoom:7,
  filter:['all', present, notFerry, byKindZoom, isDual],
  layout:{'line-cap':'butt','line-join':'round'},
  paint:{'line-color':gaugePaint(1), 'line-width':trackWidth(0.5), 'line-offset':dualOffset(1),
    'line-opacity':['case', ['==', ['get', 'tunnel'], true], 0.65, 1]}});
// Structural cues use shape as well as colour, in every view. A bridge has
// dark parapets outside the track; tunnels use a pale dashed core. They start
// with the detailed railway tiles: the z0–6 overview tiles carry no structure.
const structure = {type:'line',source:'railway','source-layer':'railway_line_high',minzoom:7,layout:{'line-cap':'butt','line-join':'round'}};
const bridge = {...structure,filter:['all',present,notFerry,byKindZoom,['==',['get','bridge'],true]]};
const bridgeWidth = ['interpolate',['linear'],['zoom'],7,3.4,10,5.4,14,8,18,12];
const trackIndex = style.layers.findIndex(l=>l.id==='infrastructure-tracks');
style.layers.splice(trackIndex,0,
  {...bridge,id:'structure-bridge-edge',paint:{'line-color':'#263b48','line-width':bridgeWidth}},
  {...bridge,id:'structure-bridge-deck',paint:{'line-color':'#fffef8','line-width':['interpolate',['linear'],['zoom'],7,2.2,10,3.8,14,6,18,10]}},
);
style.layers.push({...structure,id:'structure-tunnel',filter:['all',present,notFerry,byKindZoom,['==',['get','tunnel'],true]],paint:{'line-color':'#fffef8','line-width':['interpolate',['linear'],['zoom'],7,0.7,10,1.1,14,2,18,3], 'line-dasharray':[3,2]}});
// Planned, construction and former lines. line-dasharray cannot vary by
// feature, so each state has its own layers: long dashes with short gaps for
// construction, spaced round dots for proposals, dash-dot for disused and
// sparse paired short dashes for abandoned or removed lines. The patterns stay distinct when the speed view recolours the
// lines by planned or former speed (inactivePaint in map-model.mjs).
const INACTIVE_DASH = Object.fromEntries(Object.entries(LIFECYCLE_PATTERNS).map(([k,v])=>[k,v.dash]));
const stateFilter = state => state === 'former' ? ['!', ['match', ['get','state'], ['construction','proposed','disused','present'], true, false]] : ['==', ['get','state'], state];
const inactiveWidth = ['interpolate', ['linear'], ['zoom'], 0, 0.7, 5, 1.3, 7, 1.9, 12, 2.4, 16, 3.2, 20, 4.5];
const inactiveLine = state => ({
  'line-color': inactiveColours('speed'), 'line-width': inactiveWidth, 'line-dasharray': INACTIVE_DASH[state],
  'line-opacity': ['case', ['==', ['get','tunnel'], true], 0.4, state === 'former' ? 0.75 : 0.95],
});
const inactiveLayout = state => ({'line-cap': LIFECYCLE_PATTERNS[state].cap, 'line-join': 'round'});
// The complete snapshot supplies every lifecycle at regional scales. The
// ordinary detail tiles take over together at z12, avoiding duplicate lines.
// Construction shows at every zoom, proposals from z5, former lines from z7.
const regionalZoom = ['all', byKindZoom, ['any', ['>=',['zoom'],7], ['==',['get','state'],'construction'], ['all', ['>=',['zoom'],5], ['==',['get','state'],'proposed']]]];
const inactiveBridge = {type:'line', layout:{'line-cap':'butt','line-join':'round'}};
const inactiveBridgeEdge = {'line-color':'#5b5550','line-width':['interpolate',['linear'],['zoom'],7,3,12,4.6,16,6.5,20,8.5]};
const inactiveBridgeDeck = {'line-color':'#fffef8','line-width':['interpolate',['linear'],['zoom'],7,1.8,12,3,16,4.6,20,6.2]};
style.layers.push(
  {...inactiveBridge, id:'inactive-regional-bridge-edge', source:'inactiveRegional', 'source-layer':'lifecycle', minzoom:7, maxzoom:12, filter:['all',byKindZoom,['==',['get','bridge'],true]], paint:inactiveBridgeEdge},
  {...inactiveBridge, id:'inactive-regional-bridge-deck', source:'inactiveRegional', 'source-layer':'lifecycle', minzoom:7, maxzoom:12, filter:['all',byKindZoom,['==',['get','bridge'],true]], paint:inactiveBridgeDeck},
  {...inactiveBridge, id:'inactive-bridge-edge', source:'railway', 'source-layer':'railway_line_high', minzoom:12, filter:['all', ['!', present], notFerry, ['==',['get','bridge'],true]], paint:inactiveBridgeEdge},
  {...inactiveBridge, id:'inactive-bridge-deck', source:'railway', 'source-layer':'railway_line_high', minzoom:12, filter:['all', ['!', present], notFerry, ['==',['get','bridge'],true]], paint:inactiveBridgeDeck},
);
for (const state of ['former', 'disused', 'proposed', 'construction']) style.layers.push(
  {id:`inactive-regional-${state}`, type:'line', source:'inactiveRegional', 'source-layer':'lifecycle', minzoom:0, maxzoom:12,
    filter:['all', regionalZoom, stateFilter(state)], layout:inactiveLayout(state), paint:inactiveLine(state)},
  {id:`inactive-railways-${state}`, type:'line', source:'railway', 'source-layer':'railway_line_high', minzoom:12,
    filter:['all', ['!', present], notFerry, stateFilter(state)], layout:inactiveLayout(state), paint:inactiveLine(state)},
);
for (const [id,source,sourceLayer,minzoom,maxzoom,filter] of [
  ['railway-names','railway','railway_line_high',9,undefined,['all',present,notFerry,byKindZoom]],
  ['inactive-names','inactiveRegional','lifecycle',9,12,byKindZoom],
  ['inactive-detail-names','railway','railway_line_high',12,undefined,['all',['!',present],notFerry]],
]) style.layers.push({
  id, type:'symbol', source, 'source-layer':sourceLayer, minzoom, ...(maxzoom ? {maxzoom} : {}), filter,
  layout:{'symbol-placement':'line','symbol-spacing':450,'text-field':labelExpression('local'), 'text-font':['Noto Sans Bold'], 'text-size':['interpolate',['linear'],['zoom'],9,11,14,13], 'text-offset':[0,-0.85], 'text-padding':8, 'text-max-angle':35},
  paint:{'text-color':'#4a453f','text-halo-color':'#fffef8','text-halo-width':2},
});
// Running tracks side by side (counted from the mapped geometry by the
// atlasrail protocol; see track-count.mjs): a small numbered badge on the
// middle track of each bundle, kept apart from each other, in the
// Infrastructure view. Where badges would collide, surface tracks win over
// tunnels, then larger counts. Each kind has its own badge (app.mjs);
// stations (every track at the station) have a layer of their own.
const badge = (id, filter, layout, paint) => style.layers.push({
  id, type: 'symbol', source: 'trackCounts', 'source-layer': 'atlas_track_counts', minzoom: 14,
  filter: ['all', ['>=', ['to-number', ['get', 'tracks'], 0], 1], filter],
  layout: { 'text-field': ['to-string', ['get', 'tracks']], 'text-font': ['Noto Sans Bold'], 'text-size': 11,
    'icon-text-fit': 'both', 'icon-text-fit-padding': [2, 5, 1, 5], ...layout }, paint });
badge('infrastructure-track-count', ['!=', ['get', 'station'], true],
  { 'icon-image': ['case', ['==', ['get', 'tunnel'], true], 'track-badge-tunnel', 'track-badge'],
    'symbol-sort-key': ['+', ['case', ['==', ['get', 'tunnel'], true], 100, 0], ['-', ['to-number', ['get', 'tracks'], 0]]], 'text-padding': 24, 'icon-padding': 24 },
  { 'text-color': ['case', ['==', ['get', 'tunnel'], true], '#4b626a', '#173e47'] });
// A station's count sits among its tracks, where the station's name often
// is: always drawn, and never pushing a name or another label away.
badge('infrastructure-station-tracks', ['==', ['get', 'station'], true],
  { 'icon-image': 'track-badge-station', 'icon-allow-overlap': true, 'text-allow-overlap': true, 'icon-ignore-placement': true, 'text-ignore-placement': true },
  { 'text-color': '#7a4a08' });
// Values written along the tracks, like speed limits, in each view.
const valueLabel = (id, filter, text) => style.layers.push({
  id, type: 'symbol', source: 'railway', 'source-layer': 'railway_line_high', minzoom: 10,
  filter: ['all', present, notFerry, byKindZoom, filter],
  layout: { 'symbol-placement': 'line', 'symbol-spacing': 300, 'text-field': text, 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-padding': 5 },
  paint: { 'text-color': '#26363d', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
});
valueLabel('speed-labels', ['has', 'speed_label'], speedLabel('metric'));
const volts = ['to-number', ['coalesce', ['get', 'voltage'], 0], 0], hz = ['to-number', ['coalesce', ['get', 'frequency'], -1], -1];
const kv = ['case', ['>=', volts, 1000], ['concat', ['to-string', ['/', ['round', ['/', volts, 10]], 100]], ' kV'], ['concat', ['to-string', volts], ' V']];
valueLabel('electrification-labels', ['>', volts, 0],
  ['case', ['==', hz, 0], ['concat', kv, ' DC'], ['>', hz, 0], ['concat', kv, ' ', ['to-string', ['/', ['round', ['*', hz, 10]], 10]], ' Hz'], kv]);
const shortName = key => ['match', ['coalesce', ['get', key], ''], ...TRAIN_PROTECTION.flatMap(([code]) => [code, trainProtectionShort(code)]), ['coalesce', ['get', key], '']];
valueLabel('control-labels', ['has', 'train_protection0'],
  ['case', ['has', 'train_protection1'], ['concat', shortName('train_protection0'), ' + ', shortName('train_protection1')], shortName('train_protection0')]);
valueLabel('gauge-labels', ['>', ['to-number', ['coalesce', ['get', 'gaugeint0'], 0], 0], 0],
  ['concat', ['get', 'gauge0'], ['case', ['has', 'gauge1'], ['concat', ' / ', ['get', 'gauge1']], ''], ' mm']);
valueLabel('loading-labels', ['has', 'loading_gauge'], loadingLabel());
// Keep distant views sparse. Marker and name form one collision-aware symbol
// below zoom 12; individual circles appear only at local scale.
// Zoom 4–5: large stations; 6: large and normal, plus small ones from the
// zoom-7 tiles; 7 and above: all.
const stationSelection = ['any', ['>=', ['zoom'], 6], ['==', ['get','station_size'], 'large']];
const zoom6Small = ['any', ['>=', ['zoom'], 7], ['!', ['match', ['get','station_size'], ['large','normal'], true, false]]];
// By mode, as the detailed tiles give it: metro stations from zoom 8 (the
// first zoom whose station tiles include them), light rail, monorail and
// people movers from 10, trams, tram stops, funiculars and miniature
// railways from 11, so a high-capacity metro is never outranked on screen by
// a tram stop that appears earlier.
const stationMode = ['coalesce', ['get','station'], ''];
const stationFeatures = ['all', present,
  ['any', ['==', ['get','feature'], 'station'], ['all', ['>=', ['zoom'], 11], ['match', ['get','feature'], ['halt', 'tram_stop'], true, false]]],
  ['case',
    ['==', stationMode, 'subway'], ['>=', ['zoom'], 8],
    ['match', stationMode, [...LIGHT_MODES, 'monorail'], true, false], ['>=', ['zoom'], 10],
    ['match', stationMode, MINOR_MODES, true, false], ['>=', ['zoom'], 11],
    true],
];
// Size by mode as well as by the provider's station size (which counts routes,
// so a busy people mover can be "large" and most metro stations "small"):
// heavy rail and metro by station size; light rail and people movers one step
// smaller than any metro station; trams, funiculars and monorails smaller still.
const modeClass = ['case', ['==', ['get','feature'], 'tram_stop'], 'minor',
  ['match', stationMode, MINOR_MODES, true, false], 'minor', ['match', stationMode, LIGHT_MODES, true, false], 'light', 'major'];
const bySize = (large, normal, small, light, minor) => ['match', modeClass, 'minor', minor, 'light', light,
  ['match', ['get', 'station_size'], 'large', large, 'normal', normal, small]];
const stationText = {
  'text-field': labelExpression('local', true), 'text-font': ['Noto Sans Bold'],
  'text-size': ['interpolate', ['linear'], ['zoom'], 4, 12, 6, 14, 10, bySize(16, 15, 14, 13, 12), 18, bySize(18, 18, 17.5, 16, 15)],
  'symbol-sort-key': bySize(0, 1, 2, 3, 4),
  'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.7,
  'text-padding': ['step', ['zoom'], 14, 9, 9, 12, 4], 'text-max-width': 9, 'text-allow-overlap': false,
};
const stationInk = { 'text-color': ['match', ['get','station_size'], 'large', '#123e52', '#0865c0'], 'text-halo-color': '#fffef8', 'text-halo-width': 2 };
// symbol-sort-key only orders labels within one tile, so a minor stop in one
// tile could block a main station in the next. MapLibre places whole layers
// from the top down, so each importance tier gets its own layer. By mode:
// heavy rail (by mapped size, then halts) > metro > light rail > people
// movers, monorail, funicular and tram > former and planned stations.
// Low- and mid-zoom tiles carry only station_size (and omit metro stations).
const mode = ['coalesce', ['get','station'], ''];
const current = ['==', ['coalesce', ['get','state'], 'present'], 'present'];
const metro = ['all', current, ['==', mode, 'subway']];
const lightRail = ['all', current, ['==', mode, 'light_rail']];
const mover = ['all', current, ['any', ['match', mode, ['monorail','funicular','miniature','tram'], true, false], ['==', ['get','feature'], 'tram_stop']]];
const heavy = ['all', current, ['!', ['match', mode, ['subway','light_rail','monorail','funicular','miniature','tram'], true, false]], ['!=', ['get','feature'], 'tram_stop']];
const isStation = ['==', ['coalesce', ['get','feature'], 'station'], 'station'];
const size = ['coalesce', ['get','station_size'], 'small'];
const tiers = [ // bottom to top
  ['mover', mover], ['light-rail', lightRail], ['metro', metro],
  ['halt', ['all', heavy, ['!', isStation]]],
  ['small', ['all', heavy, isStation, ['!', ['match', size, ['large','normal'], true, false]]]],
  ['normal', ['all', heavy, isStation, ['==', size, 'normal']]],
  ['large', ['all', heavy, isStation, ['==', size, 'large']]],
];
for (const [tier, filter] of tiers) for (const [source, layer, minzoom, maxzoom] of [
  ['stationLow', 'standard_railway_text_stations_low', 4, 7],
  ['stationMed', 'standard_railway_text_stations_med', 6, 8],
  ['stations', 'standard_railway_text_stations', 8, 12],
]) {
  style.layers.push({
    id: `station-${source}-${tier}-names`, type: 'symbol', source, 'source-layer': layer, minzoom, maxzoom,
    filter: ['all', filter, ...(source === 'stations' ? [stationSelection, stationFeatures] : source === 'stationMed' ? [zoom6Small] : [stationSelection])],
    layout: { ...stationText, 'icon-image': 'station-dot', 'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 6, 0.95, 11, bySize(1.25, 1.15, 1.05, 0.9, 0.8)],
      'icon-padding': 12, 'icon-allow-overlap': false, 'icon-ignore-placement': false, 'icon-optional': false, 'text-optional': false },
    paint: stationInk,
  });
}
// Former, disused and planned stations rank last, from zoom 12, muted; their
// dots lie under the operating stations' dots.
style.layers.push({
  id: 'station-former-dots', type: 'circle', source: 'stations', 'source-layer': 'standard_railway_text_stations', minzoom: 12,
  filter: ['all', ['!', current], ['match', ['get','feature'], ['station','halt'], true, false]],
  paint: { 'circle-color': '#fffef8', 'circle-stroke-color': '#8a8076', 'circle-stroke-width': 1.5, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 17, 4.5] },
});
style.layers.push({
  id: 'station-stations-dots', type: 'circle', source: 'stations', 'source-layer': 'standard_railway_text_stations', minzoom: 12,
  filter: stationFeatures,
  // Where dots meet, the higher-capacity station's is drawn on top.
  layout: {'circle-sort-key': bySize(4, 3, 2, 1, 0)},
  paint: { 'circle-color': '#ffa323', 'circle-stroke-color': '#123e52', 'circle-stroke-width': 1.5,
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, bySize(5, 4, 3.2, 2.7, 2.3), 17, bySize(7, 5.5, 4.5, 3.8, 3.2)] },
});
style.layers.push({
  id: 'station-former-names', type: 'symbol', source: 'stations', 'source-layer': 'standard_railway_text_stations', minzoom: 12,
  filter: ['all', ['!', current], ['match', ['get','feature'], ['station','halt'], true, false]],
  layout: {...stationText, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 12, 18, 15]},
  paint: { 'text-color': '#8a8076', 'text-halo-color': '#fffef8', 'text-halo-width': 2 },
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
// Context fills sit above the base fills/shading, below contours and all
// transport linework. Context labels outrank towns but yield to railways.
const context = contextLayers(), constraints = constraintLayers(), roads = roadLayers();
const roadIndex=style.layers.findIndex(l=>l.id==='infrastructure-overview');
style.layers.splice(roadIndex,0,...roads.roads);
// A broad roadbed casing marks explicit shared roadway while keeping rail
// class colours on top. Separate from bridge parapets and lifecycle dashes.
const streetIndex=style.layers.findIndex(l=>l.id==='infrastructure-tracks');
style.layers.splice(streetIndex,0,{id:'infrastructure-street-running',type:'line',source:'streetRunning','source-layer':'street_running',minzoom:13,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#b68f55','line-width':['interpolate',['linear'],['zoom'],13,7,18,14],'line-opacity':0.65}});
// Level crossings from zoom 11 (the project's own worldwide tiles,
// crossings.yml): a small × per crossing, all drawn (no collision
// placement); from 15 the provider's × symbols with equipment details.
const crossingColor = ['match',['get','kind'],'foot','#a0704a','#63332c'];
style.layers.push({id:'infrastructure-crossing-marks', type:'symbol', source:'crossingsDetail', 'source-layer':'level_crossings', minzoom:11, maxzoom:15,
  layout:{'icon-image':'crossing-x', 'icon-size':['interpolate',['linear'],['zoom'],11,0.7,13,0.85,14.99,1], 'icon-allow-overlap':true, 'icon-ignore-placement':true},
  paint:{'icon-color':crossingColor, 'icon-halo-color':'#fffef8', 'icon-halo-width':1.2, 'icon-opacity':0.95}});
style.layers.push({id:'infrastructure-level-crossings',type:'symbol',source:'crossings','source-layer':'points_of_interest',minzoom:15,filter:['==',['get','type'],'level_crossing'],layout:{'text-field':'×','text-font':['Noto Sans Bold'],'text-size':23,'text-allow-overlap':false,'text-padding':2},paint:{'text-color':'#63332c','text-halo-color':'#fffef8','text-halo-width':2}});
const contextIndex = style.layers.findIndex(l => l.id === 'terrain-contours');
// Ordinary buildings provide faint street-scale context independently of the
// destination toggle. Keep footprints flat and below roads, rails and labels.
const buildings = [
  {id:'building-footprints',type:'fill',source:'openmaptiles','source-layer':'building',minzoom:13,
    paint:{'fill-color':'#a8aca4','fill-opacity':['interpolate',['linear'],['zoom'],13,0.12,15,0.24,17,0.34]}},
  {id:'building-outlines',type:'line',source:'openmaptiles','source-layer':'building',minzoom:15,
    paint:{'line-color':'#879187','line-width':0.55,'line-opacity':['interpolate',['linear'],['zoom'],15,0.05,18,0.22]}},
];
style.layers.splice(contextIndex, 0, ...context.areas, ...constraints.areas, ...buildings, ...context.lines, ...constraints.lines);
style.layers.push(...roads.names, ...constraints.labels, ...context.labels);
const stationNames = style.layers.filter(l => l.id.startsWith('station-') && l.type === 'symbol');
const railwayNames = style.layers.filter(l => l.type === 'symbol' && l.id.endsWith('-names') && !l.id.startsWith('station-'));
// Track-count badges above railway names, so a line's name never hides
// how many tracks it has; station names keep priority over both.
const trackBadges = style.layers.filter(l => l.id === 'infrastructure-track-count' || l.id === 'infrastructure-station-tracks');
style.layers = style.layers.filter(l => !stationNames.includes(l) && !railwayNames.includes(l) && !trackBadges.includes(l)).concat(railwayNames, trackBadges, stationNames);
for (const l of style.layers) {
  if (/^(infrastructure|electrification|control|gauge|loading)-/.test(l.id)) l.layout.visibility = 'none';
}
// Satellite imagery directly above the background, off unless chosen.
style.layers.splice(style.layers.findIndex(l => l.id === 'background') + 1, 0, {id:'satellite', type:'raster', source:'satellite', layout:{visibility:'none'}, paint:{'raster-fade-duration':150}});
await writeFile(new URL('../styles/world.style.json', import.meta.url), JSON.stringify(style, null, 2) + '\n');
console.log(`Built world.style.json: ${style.layers.length} layers`);

