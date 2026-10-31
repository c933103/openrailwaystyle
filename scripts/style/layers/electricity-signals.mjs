import {ELECTRICITY_SIGNAL_STYLE} from '../../../styles/power-facilities.mjs';

// Electrification signals (pantograph, main switch, end of catenary) are small
// dots, distinct from the neutral facility dots. Deactivated
// signals follow the planned/former setting with hollow dots.
export function electricitySignalLayers() {
  const {color,stroke,paper}=ELECTRICITY_SIGNAL_STYLE;
  const metadata={'atlas:group':'railway','atlas:category':'energy-supply','atlas:views':['electrification'],'atlas:settings':[],'atlas:initial-hidden':true};
  const radius=['interpolate',['linear'],['zoom'],13,2.5,17,4];
  const layers=[];
  for(const former of [false,true]) {
    const base={source:'electricSignals',minzoom:13,metadata:{...metadata,'atlas:settings':former?['inactive']:[]},filter:[former?'!=':'==',['get','power_state'],'present']};
    layers.push({...base,id:`electrification-${former?'former-':''}signal-points`,type:'circle',
      paint:{'circle-color':former?paper:color,'circle-radius':radius,'circle-stroke-color':former?color:stroke,'circle-stroke-width':1.5}});
  }
  layers.push({id:'electrification-signal-labels',type:'symbol',source:'electricSignals',minzoom:16,
    metadata:{...metadata,'atlas:settings':['labels']},filter:['==',['get','power_state'],'present'],
    layout:{'text-field':['coalesce',['get','ref'],['get','electricity_label'],''],'text-font':['Noto Sans Regular'],'text-size':10,'text-offset':[0,0.9],'text-anchor':'top','text-padding':4,'text-max-width':10},
    paint:{'text-color':stroke,'text-halo-color':paper,'text-halo-width':1.5}});
  return layers;
}
