import {POWER_FACILITY_SYMBOL} from '../../../styles/power-facilities.mjs';

// Facilities are drawn as they are mapped, as on a topographic map: an area
// as its outline with a neutral man-made fill, a line as a line, a point as a
// small plain dot. No symbols or text; hover and click give the details.
// Planned and former facilities are fainter with a dashed outline.
export function facilityShapeLayers(prefix, source, base, former=false) {
  const {ink,fill,paper}=POWER_FACILITY_SYMBOL;
  const geometry=types=>['match',['geometry-type'],types,true,false];
  const filter=(...extra)=>['all',...base.filter.slice(1),...extra];
  return [
    {...base,source,id:`${prefix}-areas`,type:'fill',filter:filter(geometry(['Polygon','MultiPolygon'])),
      paint:{'fill-color':fill,'fill-opacity':former?0.1:0.3}},
    {...base,source,id:`${prefix}-outlines`,type:'line',filter:filter(geometry(['Polygon','MultiPolygon','LineString','MultiLineString'])),
      layout:{'line-join':'round'},
      paint:{'line-color':ink,'line-width':['interpolate',['linear'],['zoom'],10,0.6,16,1.4],'line-opacity':former?0.6:1,...(former?{'line-dasharray':[2,2]}:{})}},
    {...base,source,id:`${prefix}-points`,type:'circle',filter:filter(geometry(['Point','MultiPoint'])),
      paint:{'circle-color':former?paper:ink,'circle-radius':['interpolate',['linear'],['zoom'],10,1.6,14,2.6,18,3.6],
        'circle-stroke-color':former?ink:paper,'circle-stroke-width':former?1:0.8,'circle-opacity':former?0.8:1}},
  ];
}

export function powerFacilityLayers() {
  const {ink,fill} = POWER_FACILITY_SYMBOL;
  const metadata = {'atlas:group':'railway','atlas:category':'energy-supply','atlas:views':['electrification'],
    'atlas:settings':[],'atlas:initial-hidden':true};
  const present=['==',['get','power_state'],'present'];
  const point={minzoom:10,metadata,filter:['all',present,['>=',['zoom'],['get','power_minzoom']]]};
  const former={...point,metadata:{...metadata,'atlas:settings':['inactive']},filter:['all',['!=',['get','power_state'],'present'],['>=',['zoom'],['get','power_minzoom']]]};
  // Provider traction substations are polygon-only; same neutral treatment.
  const substation={source:'electricSubstations','source-layer':'electrification_substation',minzoom:13,metadata};
  return [
    {...substation,id:'electrification-substation-areas',type:'fill',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':fill,'fill-opacity':0.3}},
    {...substation,id:'electrification-substation-edges',type:'line',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':ink,'line-width':1}},
    ...facilityShapeLayers('electrification-supply','electricFacilities',point),
    ...facilityShapeLayers('electrification-former-supply','electricFacilities',former,true),
  ];
}
