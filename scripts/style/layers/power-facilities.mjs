export function powerFacilityLayers() {
  const metadata = {'atlas:group':'railway','atlas:category':'energy-supply','atlas:views':['electrification'],
    'atlas:settings':[],'atlas:initial-hidden':true};
  const present=['==',['get','power_state'],'present'];
  const point={source:'electricFacilities',minzoom:10,metadata,filter:['all',present,['>=',['zoom'],['get','power_minzoom']]]};
  const former={...point,metadata:{...metadata,'atlas:settings':['inactive']},filter:['all',['!=',['get','power_state'],'present'],['>=',['zoom'],['get','power_minzoom']]]};
  const circle=(id,base,former=false)=>({...base,id,type:'circle',paint:{'circle-color':former?'#fffef8':['get','power_color'],
    'circle-radius':['interpolate',['linear'],['zoom'],10,3.2,14,5.5,18,6.5],
    'circle-stroke-color':former?['get','power_color']:'#fffef8','circle-stroke-width':former?2:1.5}});
  const letters=(id,base,former=false)=>({...base,id,type:'symbol',minzoom:13,layout:{'text-field':['get','power_mark'],
    'text-font':['Noto Sans Bold'],'text-size':9,'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':former?['get','power_color']:'#fffef8'}});
  const names=(id,base)=>({...base,id,type:'symbol',minzoom:14,metadata:{...base.metadata,'atlas:settings':[...base.metadata['atlas:settings'],'labels'],'atlas:localize':true},
    layout:{'text-field':['coalesce',['get','atlas_name'],['get','name'],['get','ref'],''],
      'text-font':['Noto Sans Regular'],'text-size':11,'text-anchor':'top','text-offset':[0,0.9],'text-padding':4,'text-max-width':14},
    paint:{'text-color':['get','power_color'],'text-halo-color':'#fffef8','text-halo-width':1.5}});
  // Provider traction substations are polygon-only. Their footprint is useful
  // alongside the point markers prepared from nodes, ways and relations.
  const substation={source:'electricSubstations','source-layer':'electrification_substation',minzoom:13,metadata};
  return [
    {...substation,id:'electrification-substation-areas',type:'fill',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#d7ae35','fill-opacity':0.25}},
    {...substation,id:'electrification-substation-edges',type:'line',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':'#b77d00','line-width':1.5}},
    circle('electrification-supply-points',point),circle('electrification-former-supply-points',former,true),
    letters('electrification-supply-marks',point),letters('electrification-former-supply-marks',former,true),
    names('electrification-supply-names',point),names('electrification-former-supply-names',former),
  ];
}
