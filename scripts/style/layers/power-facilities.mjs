import {POWER_FACILITY_SYMBOL,POWER_FACILITY_KINDS} from '../../../styles/power-facilities.mjs';

// What each point is, written above its pictogram. The browser adds
// power_label (kind, fuel supplies, status) when it loads the data; the match
// is the fallback for data without it.
export function powerKindText(former=false) {
  const kind=['match',['get','power_kind'],...Object.entries(POWER_FACILITY_KINDS).flatMap(([key,{label}])=>[key,label]),''];
  return ['coalesce',['get','power_label'],former?['concat',kind,' (',['get','power_state'],')']:kind];
}
// Pictogram per kind (see POWER_FACILITY_ICONS); drawn on demand by the app.
export const powerIconLayout=former=>({'icon-image':['concat','power-',['get','power_kind'],former?'-former':''],
  'icon-size':['interpolate',['linear'],['zoom'],10,0.55,14,0.8,17,1],'icon-allow-overlap':true,'icon-ignore-placement':true});

export function powerFacilityLayers() {
  const {paper} = POWER_FACILITY_SYMBOL;
  const metadata = {'atlas:group':'railway','atlas:category':'energy-supply','atlas:views':['electrification'],
    'atlas:settings':[],'atlas:initial-hidden':true};
  const present=['==',['get','power_state'],'present'];
  const point={source:'electricFacilities',minzoom:10,metadata,filter:['all',present,['>=',['zoom'],['get','power_minzoom']]]};
  const former={...point,metadata:{...metadata,'atlas:settings':['inactive']},filter:['all',['!=',['get','power_state'],'present'],['>=',['zoom'],['get','power_minzoom']]]};
  const icons=(id,base,former=false)=>({...base,id,type:'symbol',layout:powerIconLayout(former)});
  const kinds=(id,base,former=false)=>({...base,id,type:'symbol',minzoom:14,metadata:{...base.metadata,'atlas:localize':false},
    layout:{'text-field':powerKindText(former),'text-font':['Noto Sans Bold'],'text-size':10.5,'text-anchor':'bottom','text-offset':[0,-1.2],'text-padding':2,'text-max-width':12},
    paint:{'text-color':['get','power_color'],'text-halo-color':paper,'text-halo-width':1.5}});
  // The mapped name, localised, sits under the marker.
  const names=(id,base)=>({...base,id,type:'symbol',minzoom:14,metadata:{...base.metadata,'atlas:localize':true},
    layout:{'text-field':['coalesce',['get','atlas_name'],['get','name'],['get','ref'],''],
      'text-font':['Noto Sans Regular'],'text-size':11,'text-anchor':'top','text-offset':[0,1.2],'text-padding':4,'text-max-width':14},
    paint:{'text-color':['get','power_color'],'text-halo-color':paper,'text-halo-width':1.5}});
  // Provider traction substations are polygon-only. Their footprint is useful
  // alongside the point markers prepared from nodes, ways and relations.
  const substation={source:'electricSubstations','source-layer':'electrification_substation',minzoom:13,metadata};
  return [
    {...substation,id:'electrification-substation-areas',type:'fill',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#d7ae35','fill-opacity':0.25}},
    {...substation,id:'electrification-substation-edges',type:'line',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':'#b77d00','line-width':1.5}},
    icons('electrification-supply-points',point),icons('electrification-former-supply-points',former,true),
    kinds('electrification-supply-kinds',point),kinds('electrification-former-supply-kinds',former,true),
    names('electrification-supply-names',point),names('electrification-former-supply-names',former),
  ];
}
