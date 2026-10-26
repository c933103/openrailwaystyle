import {ENERGY_SITE_STYLE} from '../../../styles/power-facilities.mjs';

// Rail-served fuel and coal sites are areas, so they read differently from the
// circular trackside servicing markers. They draw beneath the tracks.
export function energySiteLayers() {
  const metadata={'atlas:group':'railway','atlas:category':'energy-supply','atlas:views':['electrification'],'atlas:settings':[],'atlas:initial-hidden':true};
  const colour=['match',['get','energy_group'],'coal',ENERGY_SITE_STYLE.coal,ENERGY_SITE_STYLE.fuel];
  const layers=[];
  for(const former of [false,true]) {
    const meta={...metadata,'atlas:settings':former?['inactive']:[]},suffix=former?'former-':'';
    const base={source:'energySites',minzoom:11,metadata:meta,filter:[former?'!=':'==',['get','power_state'],'present']};
    layers.push({...base,id:`electrification-${suffix}energy-site-areas`,type:'fill',paint:{'fill-color':colour,'fill-opacity':former?0.08:0.18}});
    layers.push({...base,id:`electrification-${suffix}energy-site-edges`,type:'line',paint:{'line-color':colour,'line-width':1.5,...(former?{'line-dasharray':[3,2],'line-opacity':0.6}:{})}});
  }
  return layers;
}

// Names sit with the other railway labels, above the map.
export function energySiteNameLayers() {
  return [{id:'electrification-energy-site-names',type:'symbol',source:'energySites',minzoom:14,
    metadata:{'atlas:group':'railway','atlas:category':'energy-supply','atlas:views':['electrification'],'atlas:settings':['labels'],'atlas:initial-hidden':true,'atlas:localize':true},
    filter:['==',['get','power_state'],'present'],
    layout:{'text-field':['coalesce',['get','atlas_name'],['get','name'],''],'text-font':['Noto Sans Regular'],'text-size':11,'text-max-width':12,'text-padding':4},
    paint:{'text-color':['match',['get','energy_group'],'coal',ENERGY_SITE_STYLE.coal,ENERGY_SITE_STYLE.fuel],'text-halo-color':'#fffef8','text-halo-width':1.5}}];
}
