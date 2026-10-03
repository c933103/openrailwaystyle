import {LIFECYCLE_PATTERNS, inactivePaint as inactiveColours, labelExpression} from '../../../styles/map-model.mjs';
import {present, notFerry, byKindZoom} from './railway-expressions.mjs';

export function lifecycleLayers() {
  const lines = [], names = [];
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
  // Construction shows at every zoom, proposals from z5, former lines from z7;
  // metro from z7 and light rail, tram and other urban kinds from z10 whatever
  // their state.
  const regionalZoom = ['all', byKindZoom, ['any', ['>=',['zoom'],7], ['==',['get','state'],'construction'], ['all', ['>=',['zoom'],5], ['==',['get','state'],'proposed']]]];
  const inactiveBridge = {type:'line', layout:{'line-cap':'butt','line-join':'round'}};
  const inactiveBridgeEdge = {'line-color':'#5b5550','line-width':['interpolate',['linear'],['zoom'],7,3,12,4.6,16,6.5,20,8.5]};
  const inactiveBridgeDeck = {'line-color':'#fffef8','line-width':['interpolate',['linear'],['zoom'],7,1.8,12,3,16,4.6,20,6.2]};
  lines.push(
    {...inactiveBridge, id:'inactive-regional-bridge-edge', source:'inactiveRegional', 'source-layer':'lifecycle', minzoom:7, maxzoom:12, filter:['all',byKindZoom,['==',['get','bridge'],true]], paint:inactiveBridgeEdge},
    {...inactiveBridge, id:'inactive-regional-bridge-deck', source:'inactiveRegional', 'source-layer':'lifecycle', minzoom:7, maxzoom:12, filter:['all',byKindZoom,['==',['get','bridge'],true]], paint:inactiveBridgeDeck},
    {...inactiveBridge, id:'inactive-bridge-edge', source:'railway', 'source-layer':'railway_line_high', minzoom:12, filter:['all', ['!', present], notFerry, ['==',['get','bridge'],true]], paint:inactiveBridgeEdge},
    {...inactiveBridge, id:'inactive-bridge-deck', source:'railway', 'source-layer':'railway_line_high', minzoom:12, filter:['all', ['!', present], notFerry, ['==',['get','bridge'],true]], paint:inactiveBridgeDeck},
  );
  for (const state of ['former', 'disused', 'proposed', 'construction']) lines.push(
    {id:`inactive-regional-${state}`, type:'line', source:'inactiveRegional', 'source-layer':'lifecycle', minzoom:0, maxzoom:12,
      filter:['all', regionalZoom, stateFilter(state)], layout:inactiveLayout(state), paint:inactiveLine(state)},
    {id:`inactive-railways-${state}`, type:'line', source:'railway', 'source-layer':'railway_line_high', minzoom:12,
      filter:['all', ['!', present], notFerry, stateFilter(state)], layout:inactiveLayout(state), paint:inactiveLine(state)},
  );
  for (const [id,source,sourceLayer,minzoom,maxzoom,filter] of [
    ['inactive-names','inactiveRegional','lifecycle',9,12,byKindZoom],
    ['inactive-detail-names','railway','railway_line_high',12,undefined,['all',['!',present],notFerry]],
  ]) names.push({
    id, type:'symbol', source, 'source-layer':sourceLayer, minzoom, ...(maxzoom ? {maxzoom} : {}), filter,
    layout:{'symbol-placement':'line','symbol-spacing':450,'text-field':labelExpression('local'), 'text-font':['Noto Sans Bold'], 'text-size':['interpolate',['linear'],['zoom'],9,11,14,13], 'text-offset':[0,-0.85], 'text-padding':8, 'text-max-angle':35},
    paint:{'text-color':'#4a453f','text-halo-color':'#fffef8','text-halo-width':2},
  });
  return {lines, names};
}
