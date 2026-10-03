import {OVERVIEW_ZOOM, DETAIL_ZOOM} from '../../crossing-data.mjs';

export function infrastructureContextLayers() {
  const street = [], crossings = [];
  // A broad roadbed casing marks explicit shared roadway while keeping rail
  // class colours on top. Separate from bridge parapets and lifecycle dashes.
  street.push({id:'infrastructure-street-running',type:'line',source:'streetRunning','source-layer':'street_running',minzoom:13,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#b68f55','line-width':['interpolate',['linear'],['zoom'],13,7,18,14],'line-opacity':0.65}});
  // Level crossings from zoom 5 (the project's own worldwide tiles,
  // crossings.yml): dots to zoom 11, where a cross could not be read and the
  // crossings of a busy network would run together; then a small × per
  // crossing, all drawn (no collision placement); from 15 the provider's ×
  // symbols with equipment details. Crossings only on tram, light rail,
  // funicular, miniature, service or street-running tracks (minor) wait for
  // the ×s at zoom 11.
  const crossingColor = ['match',['get','kind'],'foot','#a0704a','#63332c'];
  const crossingDot = (id, source, minzoom, maxzoom) => ({id, type:'circle', source, 'source-layer':'level_crossings', minzoom, maxzoom, layout:{},
    filter:['!=',['get','minor'],true],
    paint:{'circle-color':crossingColor, 'circle-radius':['interpolate',['linear'],['zoom'],5,0.9,8,1.4,11,2.2],
      'circle-stroke-color':'#fffef8', 'circle-stroke-width':['interpolate',['linear'],['zoom'],9,0,11,0.8], 'circle-opacity':0.9}});
  crossings.push(crossingDot('infrastructure-crossing-overview','crossingsOverview',OVERVIEW_ZOOM,DETAIL_ZOOM), crossingDot('infrastructure-crossing-dots','crossingsDetail',DETAIL_ZOOM,11));
  crossings.push({id:'infrastructure-crossing-marks', type:'symbol', source:'crossingsDetail', 'source-layer':'level_crossings', minzoom:11, maxzoom:15,
    layout:{'icon-image':'crossing-x', 'icon-size':['interpolate',['linear'],['zoom'],11,0.7,13,0.85,14.99,1], 'icon-allow-overlap':true, 'icon-ignore-placement':true},
    paint:{'icon-color':crossingColor, 'icon-halo-color':'#fffef8', 'icon-halo-width':1.2, 'icon-opacity':0.95}});
  crossings.push({id:'infrastructure-level-crossings',type:'symbol',source:'crossings','source-layer':'points_of_interest',minzoom:15,filter:['==',['get','type'],'level_crossing'],layout:{'text-field':'×','text-font':['Noto Sans Bold'],'text-size':23,'text-allow-overlap':false,'text-padding':2},paint:{'text-color':'#63332c','text-halo-color':'#fffef8','text-halo-width':2}});
  return {street, crossings};
}
