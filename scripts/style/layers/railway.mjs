import { INFRASTRUCTURE, speedPaint as speedColours, speedLabel, electrificationPaint, controlPaint, gaugePaint, loadingPaint, ownerPaint, loadingLabel, axlePaint, axleLabel, labelExpression, trainProtectionShort, TRAIN_PROTECTION } from '../../../styles/map-model.mjs';
import {present, notFerry, hasService, byKindZoom} from './railway-expressions.mjs';
import {serviceFrequencyPaint} from '../../../styles/service-frequency.mjs';

// Each group has a fixed position in the atlas composition. Returning separate
// groups keeps roads and structural cues ordered without searching layer IDs.
export function createRailwayLayers() {
  const groups = {overviewPrefix: [], overview: [], structures: [], infrastructureTracks: [], thematic: [], details: [], names: [], badges: [], values: []};
  const speedPaint = speedColours('metric');
  const infrastructurePaint = ['case',
    ['==', ['get', 'highspeed'], true], INFRASTRUCTURE[0][0],
    ['match', ['get', 'feature'], ['subway', 'light_rail', 'monorail'], true, false], INFRASTRUCTURE[3][0],
    ['==', ['get', 'feature'], 'tram'], INFRASTRUCTURE[4][0],
    hasService, INFRASTRUCTURE[5][0],
    ['==', ['get', 'usage'], 'branch'], INFRASTRUCTURE[2][0], INFRASTRUCTURE[1][0]];
  const electricPaint = electrificationPaint();
  const width = ['interpolate', ['linear'], ['zoom'], 0, 0.6, 4, 1.15, 7, 1.8, 11, 2.6, 16, 4.5, 20, 7];
  const line = (id, source, sourceLayer, minzoom, maxzoom, paint, extra = {}) => ({
    id, type: 'line', source, 'source-layer': sourceLayer, minzoom, ...(maxzoom === undefined ? {} : {maxzoom}),
    filter: ['all', present, notFerry, ...(source === 'railway' || source === 'ownerRail' || source === 'axleRail' ? [byKindZoom] : [])], layout: { 'line-cap': 'round', 'line-join': 'round' },
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
  const SERVICE_TRACK = '#b8c0c5';
  for (const [mode, source, sourceLayer, color] of [
    ['infrastructure', 'network', 'standard_railway_line_low', infrastructurePaint],
    ['speed', 'speed', 'speed_railway_line_low', speedPaint],
    ['electrification', 'electric', 'electrification_railway_line_low', electricPaint],
    ['control', 'control', 'signals_railway_line_low', controlPaint()],
    ['gauge', 'gaugeLow', 'track_railway_line_low', gaugePaint()],
    ['loading', 'loadingLow', 'standard_railway_line_low', loadingPaint()],
    ['axle','axleLow','standard_railway_line_low',axlePaint()],
    ['owner', 'ownerLow', 'operator_railway_line_low', ownerPaint()],
    // Service view: the infrastructure in grey, under the services.
    ['service', 'network', 'standard_railway_line_low', SERVICE_TRACK],
  ]) {
    // Branch lines from zoom 4, under the main lines, in the same colours
    // (their tiles carry the fields of the detailed railway tiles).
    const modeLayers = [];
    modeLayers.push(line(`${mode}-branch-overview`, mode === 'axle' ? 'axleBranch' : 'branchLines', 'branch_lines', 4, 7, color,
      mode === 'gauge' ? {'line-width': branchHalfWidth, 'line-offset': branchDualOffset(-1)} : {}));
    // The second gauge of a branch line, also under the main lines.
    if (mode === 'gauge') modeLayers.push({id:'gauge-branch-dual', type:'line', source:'branchLines', 'source-layer':'branch_lines', minzoom:4, maxzoom:7,
      filter:['all', present, notFerry, isDual],
      layout:{'line-cap':'butt','line-join':'round'},
      paint:{'line-color':gaugePaint(1), 'line-width':branchHalfWidth, 'line-offset':branchDualOffset(1)}});
    modeLayers.push(line(`${mode}-overview`, source, sourceLayer, 0, 7, color));
    const trackPaint = {
      'line-opacity': mode === 'infrastructure' ? 1 : ['case', ['==', ['get', 'tunnel'], true], 0.65, 1],
      'line-width': mode === 'gauge' ? halfWidth : trackWidth(),
      ...(mode === 'gauge' ? {'line-offset': dualOffset(-1)} : {}),
    };
    modeLayers.push(line(`${mode}-tracks`, mode === 'owner' ? 'ownerRail' : mode === 'axle' ? 'axleRail' : 'railway', 'railway_line_high', 7, undefined, color, trackPaint));
    // Metro lines at zooms 7–9 from the same snapshot (the detailed railway
    // tiles hold them only from zoom 10).
    modeLayers.push(line(`${mode}-metro-overview`, mode === 'axle' ? 'axleBranch' : 'branchLines', 'branch_lines', 7, 10, color, trackPaint));
    if (mode === 'infrastructure') {
      groups.overviewPrefix.push(modeLayers[0]);
      groups.overview.push(modeLayers[1]);
      groups.infrastructureTracks.push(modeLayers[2], modeLayers[3]);
    } else groups.thematic.push(...modeLayers);
  }
  const gaugeDual = {id:'gauge-dual', type:'line', source:'railway', 'source-layer':'railway_line_high', minzoom:7,
    filter:['all', present, notFerry, byKindZoom, isDual],
    layout:{'line-cap':'butt','line-join':'round'},
    paint:{'line-color':gaugePaint(1), 'line-width':trackWidth(0.5), 'line-offset':dualOffset(1),
      'line-opacity':['case', ['==', ['get', 'tunnel'], true], 0.65, 1]}};
  groups.details.push(gaugeDual);
  // Each service along the tracks it runs on, in its own colour, side by side
  // where several share a track (i of n, drawn with an offset), and its name.
  const servicePaint = serviceFrequencyPaint();
  groups.details.push({id:'service-routes', type:'line', source:'serviceRoutes', 'source-layer':'service_routes', minzoom:7,
    layout:{'line-cap':'butt','line-join':'round'},
    paint:{'line-color':['to-color', ['get', 'colour'], '#5d6b73'], 'line-width':servicePaint.width, 'line-offset':servicePaint.offset, 'line-opacity':servicePaint.opacity}});
  groups.names.push({id:'service-names', type:'symbol', source:'serviceRoutes', 'source-layer':'service_routes', minzoom:9,
    // Names of services sharing a track stand side by side across it, in the
    // order of their lines, so one does not hide another.
    layout:{'symbol-placement':'line', 'symbol-spacing':400, 'text-field':labelExpression('local'), 'text-font':['Noto Sans Bold'], 'text-size':['interpolate', ['linear'], ['zoom'], 9, 10.5, 14, 12.5], 'text-padding':6, 'text-max-angle':35,
      // Every slot a way can have in practice (styles cannot build the offset
      // from a number, so each has its entry); beyond 64 services on one way,
      // the outermost names share the last offset.
      'text-offset':servicePaint.labelOffset},
    paint:{'text-color':'#1c2b33', 'text-halo-color':'#ffffff', 'text-halo-width':2}});
  // Structural cues use shape as well as colour, in every view. A bridge has
  // dark parapets outside the track; tunnels use a pale dashed core. They start
  // with the detailed railway tiles: the z0–6 overview tiles carry no structure.
  const structure = {type:'line',source:'railway','source-layer':'railway_line_high',minzoom:7,layout:{'line-cap':'butt','line-join':'round'}};
  const bridge = {...structure,filter:['all',present,notFerry,byKindZoom,['==',['get','bridge'],true]]};
  const bridgeWidth = ['interpolate',['linear'],['zoom'],7,3.4,10,5.4,14,8,18,12];
  const bridgeEdgePaint = {'line-color':'#263b48','line-width':bridgeWidth};
  const bridgeDeckPaint = {'line-color':'#fffef8','line-width':['interpolate',['linear'],['zoom'],7,2.2,10,3.8,14,6,18,10]};
  groups.structures.push(
    {...bridge,id:'structure-bridge-edge',paint:bridgeEdgePaint},
    {...bridge,id:'structure-bridge-deck',paint:bridgeDeckPaint},
  );
  const tunnelPaint = {'line-color':'#fffef8','line-width':['interpolate',['linear'],['zoom'],7,0.7,10,1.1,14,2,18,3], 'line-dasharray':[3,2]};
  groups.details.push({...structure,id:'structure-tunnel',filter:['all',present,notFerry,byKindZoom,['==',['get','tunnel'],true]],paint:tunnelPaint});
  // The same cues on the metro snapshot at zooms 7–9, and its second gauge.
  const metroStructure = {...structure, source:'branchLines', 'source-layer':'branch_lines', maxzoom:10};
  const metroBridge = {...metroStructure, filter:['all',present,['==',['get','bridge'],true]]};
  groups.structures.push(
    {...metroBridge,id:'structure-metro-bridge-edge',paint:structuredClone(bridgeEdgePaint)},
    {...metroBridge,id:'structure-metro-bridge-deck',paint:structuredClone(bridgeDeckPaint)},
  );
  // The second gauge under the tunnel core, as gauge-dual is under structure-tunnel.
  groups.details.push({...structuredClone(gaugeDual), id:'gauge-metro-dual', source:'branchLines', 'source-layer':'branch_lines', minzoom:7, maxzoom:10,
    filter:['all', present, isDual]});
  groups.details.push({...metroStructure,id:'structure-metro-tunnel',filter:['all',present,['==',['get','tunnel'],true]],paint:structuredClone(tunnelPaint)});
  for (const [id,source,sourceLayer,minzoom,maxzoom,filter] of [
    ['railway-names','railway','railway_line_high',9,undefined,['all',present,notFerry,byKindZoom]],
  ]) groups.names.push({
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
  const badge = (id, filter, layout, paint) => groups.badges.push({
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
  const valueLabel = (id, filter, text, source = 'railway') => groups.values.push({
    id, type: 'symbol', source, 'source-layer': 'railway_line_high', minzoom: 10,
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
  valueLabel('axle-labels',['>', ['to-number',['get','axle_tonnes'],0],0],axleLabel(), 'axleRail');
  valueLabel('owner-labels', ['has', 'owner'], ['get', 'owner']);
  return groups;
}
