import {ELECTRICITY_SIGNAL_STYLE} from '../../../styles/power-facilities.mjs';

// Electrification signals (pantograph, main switch, end of catenary) are small
// dots, distinct from the neutral facility dots. Deactivated
// signals follow the planned/former setting with hollow dots. No text on the
// map, as for the other Power features: the details give the function.
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
  return layers;
}
