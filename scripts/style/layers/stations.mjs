import {MAJOR_STATION_DENSITY} from '../../major-stations.mjs';
import {LIGHT_MODES, MINOR_MODES, labelExpression, platformLengthLabel} from '../../../styles/map-model.mjs';
import {present} from './railway-expressions.mjs';

// MapLibre places symbols from top to bottom, so names retain their exact
// importance-tier order independently of the platform and dot layers.
export function stationLayers(curatedFilter) {
  const platforms = [], dots = [], names = [];
  // Keep distant views sparse. Marker and name form one collision-aware symbol
  // below zoom 12; individual circles appear only at local scale.
  // Zoom 4–5: large stations; 6: large and normal, plus small ones from the
  // zoom-7 tiles; 7 and above: all.
  const stationSelection = ['any', ['>=', ['zoom'], 6], ['==', ['get','station_size'], 'large']];
  const zoom6Small = ['any', ['>=', ['zoom'], 7], ['!', ['match', ['get','station_size'], ['large','normal'], true, false]]];
  // By mode, as the detailed tiles give it: metro stations from zoom 8 (the
  // first zoom whose station tiles include them), light rail, monorail, people
  // movers, trams, tram stops, funiculars and miniature railways from 10, so a high-capacity metro is never outranked on screen by
  // a tram stop that appears earlier.
  const stationMode = ['coalesce', ['get','station'], ''];
  const stationFeatures = ['all', present,
    ['any', ['==', ['get','feature'], 'station'], ['all', ['>=', ['zoom'], 11], ['==', ['get','feature'], 'halt']], ['all', ['>=', ['zoom'], 10], ['==', ['get','feature'], 'tram_stop']]],
    ['case',
      ['==', stationMode, 'subway'], ['>=', ['zoom'], 8],
      ['match', stationMode, [...LIGHT_MODES, ...MINOR_MODES], true, false], ['>=', ['zoom'], 10],
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
    names.push({
      id: `station-${source}-${tier}-names`, type: 'symbol', source, 'source-layer': layer, minzoom, maxzoom,
      filter: ['all', filter,...(source==='stations'?[]:[source==='stationMed'?['any',['>=',['zoom'],7],curatedFilter]:curatedFilter]), ...(source === 'stations' ? [stationSelection, stationFeatures] : source === 'stationMed' ? [zoom6Small] : [stationSelection])],
      layout: { ...stationText, 'icon-image': 'station-dot', 'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 6, 0.95, 11, bySize(1.25, 1.15, 1.05, 0.9, 0.8)],
        'icon-padding': 12, 'icon-allow-overlap': false, 'icon-ignore-placement': false, 'icon-optional': false, 'text-optional': false },
      paint: stationInk,
    });
  }
  // Curated tiers lie above provider fill at zooms 4–6; principal hubs place first.
  for(const tier of [6,5,4,3])names.push({
   id:`station-major-${tier}-names`,type:'symbol',source:'stationMajor',minzoom:tier,maxzoom:7,
   filter:['==',['get','tier'],tier],
   layout:{...stationText,'text-padding':['step',['zoom'],MAJOR_STATION_DENSITY[0].padding,...MAJOR_STATION_DENSITY.slice(1).flatMap(({zoom,padding})=>[zoom,padding])],'symbol-sort-key':['get','rank'],'icon-image':'station-dot','icon-size':.85,'icon-padding':12,'icon-allow-overlap':false,'icon-ignore-placement':false,'icon-optional':false,'text-optional':false},paint:stationInk,
  });
  // Close-zoom infrastructure details use the worldwide provider sources directly,
  // independently of the original Hack4Rail demo styles. Platform tiles omit ref;
  // the app's shared feature-API queue supplies platformNumbers and full edge lengths.
  const platformBase={source:'platforms','source-layer':'standard_railway_platforms',minzoom:17};
  platforms.push(
   {...platformBase,id:'platform-areas',type:'fill',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#cad6d1','fill-opacity':0.55}},
   {...platformBase,id:'platform-outlines',type:'line',filter:['match',['geometry-type'],['Polygon','LineString'],true,false],paint:{'line-color':'#879e96','line-width':1}},
   {...platformBase,id:'platform-points',type:'circle',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'#cad6d1','circle-radius':3,'circle-stroke-color':'#527987','circle-stroke-width':1}},
   {id:'platform-edges',type:'line',source:'platformEdges','source-layer':'standard_railway_platform_edges',minzoom:17,paint:{'line-color':'#527987','line-width':1.5}},
   {id:'platform-numbers',type:'symbol',source:'platformNumbers',minzoom:17,layout:{'text-field':platformLengthLabel(),'text-font':['Noto Sans Bold'],'text-size':12,'text-padding':2,'text-anchor':['coalesce',['get','label_anchor'],'center'],'text-allow-overlap':['step',['zoom'],false,19,true],'text-ignore-placement':true},paint:{'text-color':'#214b5b','text-halo-color':'#fffef8','text-halo-width':2}},
   {id:'platform-lengths',type:'symbol',source:'platformLengths',minzoom:17,layout:{'text-field':platformLengthLabel(),'text-font':['Noto Sans Bold'],'text-size':11,'text-padding':2,'text-anchor':['coalesce',['get','label_anchor'],'center'],'text-allow-overlap':['step',['zoom'],false,19,true],'text-ignore-placement':true},paint:{'text-color':'#214b5b','text-halo-color':'#fffef8','text-halo-width':2}},
  );
  for(const [source,sourceLayer,kind,colour,label,minzoom] of [
   ['railwaySignals','railway_signals','signal','#765484',['coalesce',['get','ref'],['get','caption'],''],16],
   ['stationEntrances','standard_station_entrances','entrance','#167a78',['coalesce',['get','label'],''],17],
  ]){
   const point={source,'source-layer':sourceLayer,filter:['==',['geometry-type'],'Point']};
   // Neutral location markers identify mapped assets, not a live signal aspect.
   platforms.push({...point,id:`infrastructure-${kind}-points`,type:'circle',minzoom:kind==='signal'?13:16,...(kind==='signal'?{filter:['all',point.filter,['==',['get','railway'],'signal']]}:{}),paint:{'circle-color':colour,'circle-radius':kind==='signal'?['interpolate',['linear'],['zoom'],13,2,17,3]:4,'circle-stroke-color':'#fffef8','circle-stroke-width':1.5}});
   platforms.push({...point,id:`infrastructure-${kind}-references`,type:'symbol',minzoom,...(kind==='signal'?{filter:['all',point.filter,['==',['get','railway'],'signal']]}:{}),layout:{'text-field':label,'text-font':['Noto Sans Regular'],'text-size':11,'text-offset':[0,0.9],'text-anchor':'top','text-padding':5,'text-allow-overlap':false},paint:{'text-color':colour,'text-halo-color':'#fffef8','text-halo-width':1.5}});
  }
  // The provider omits signals without a direction tag. Their published
  // worldwide supplement uses the same neutral dots and reference labels.
  // Separate native overview/detail zooms retain close-zoom positioning.
  const signalDots = platforms.find(layer => layer.id === 'infrastructure-signal-points');
  const signalReferences = platforms.find(layer => layer.id === 'infrastructure-signal-references');
  platforms.push(
   {...signalDots, id:'infrastructure-signal-supplement-overview', source:'railwaySignalSupplementOverview', maxzoom:16},
   {...signalDots, id:'infrastructure-signal-supplement-points', source:'railwaySignalSupplement', minzoom:16},
   {...signalReferences, id:'infrastructure-signal-supplement-references', source:'railwaySignalSupplement'},
  );
  // Signals are shared with Train control; platform/entrance details remain
  // Infrastructure-only. References follow the numeric-label setting.
  for (const layer of platforms) layer.metadata = {
    'atlas:group': layer.id.startsWith('platform-') ? 'platforms' : 'railway',
    'atlas:category': layer.type === 'symbol' ? 'references' : 'geometry',
    'atlas:views': layer.id.startsWith('infrastructure-signal-') ? ['infrastructure','control'] : ['infrastructure'],
    'atlas:settings': layer.type === 'symbol' ? ['labels'] : [],
  };
  // Former, disused and planned stations rank last, from zoom 12, muted; their
  // dots lie under the operating stations' dots.
  dots.push({
    id: 'station-former-dots', type: 'circle', source: 'stations', 'source-layer': 'standard_railway_text_stations', minzoom: 12,
    filter: ['all', ['!', current], ['match', ['get','feature'], ['station','halt'], true, false]],
    paint: { 'circle-color': '#fffef8', 'circle-stroke-color': '#8a8076', 'circle-stroke-width': 1.5, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 17, 4.5] },
  });
  dots.push({
    id: 'station-stations-dots', type: 'circle', source: 'stations', 'source-layer': 'standard_railway_text_stations', minzoom: 12,
    filter: stationFeatures,
    // Where dots meet, the higher-capacity station's is drawn on top.
    layout: {'circle-sort-key': bySize(4, 3, 2, 1, 0)},
    paint: { 'circle-color': '#ffa323', 'circle-stroke-color': '#123e52', 'circle-stroke-width': 1.5,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, bySize(5, 4, 3.2, 2.7, 2.3), 17, bySize(7, 5.5, 4.5, 3.8, 3.2)] },
  });
  names.push({
    id: 'station-former-names', type: 'symbol', source: 'stations', 'source-layer': 'standard_railway_text_stations', minzoom: 12,
    filter: ['all', ['!', current], ['match', ['get','feature'], ['station','halt'], true, false]],
    layout: {...stationText, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 12, 18, 15]},
    paint: { 'text-color': '#8a8076', 'text-halo-color': '#fffef8', 'text-halo-width': 2 },
  });
  for (const [tier, filter] of tiers) names.push({
    id: `station-detail-${tier}-names`, type: 'symbol', source: 'stations', 'source-layer': 'standard_railway_text_stations', minzoom: 12,
    filter: ['all', filter, stationFeatures], layout: stationText, paint: stationInk,
  });
  return {platforms, dots, names};
}
