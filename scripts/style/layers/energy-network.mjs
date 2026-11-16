import {ENERGY_TIERS,ENERGY_DOMAIN_PAINT,ENERGY_DOMAIN_BADGE,ENERGY_NETWORK_LINES} from '../../../styles/energy-network.mjs';
export function energyNetworkLayers() {
 const areas=[],lines=[],points=[];
 for(const [tier,limits] of Object.entries(ENERGY_TIERS))for(const former of [false,true]){
  const suffix=`${tier}${former?'-former':''}`,metadata={'atlas:group':'railway','atlas:category':'energy-supply','atlas:views':['electrification'],'atlas:settings':former?['inactive']:[],'atlas:initial-hidden':true};
  const base={source:'energyNetwork'+tier[0].toUpperCase()+tier.slice(1),'source-layer':'atlas_energy_network',minzoom:limits.minzoom,...(tier!=='detail'?{maxzoom:limits.maxzoom+1}:{}),metadata};
  const filter=['all',[former?'!=':'==',['get','power_state'],'present'],['>=',['zoom'],['get','energy_minzoom']]];
  const shape=type=>['all',...filter.slice(1),['==',['geometry-type'],type]];
  areas.push({...base,id:`energy-${suffix}-areas`,type:'fill',filter:shape('Polygon'),paint:{'fill-color':ENERGY_DOMAIN_PAINT,'fill-opacity':['case',['==',['get','supply_tier'],'civil_network'],former?.09:.18,former?.16:.32]}});
  for(const civil of [false,true])areas.push({...base,id:`energy-${suffix}-${civil?'civil':'rail'}-outlines`,type:'line',filter:['all',...shape('Polygon').slice(1),[civil?'==':'!=',['get','supply_tier'],'civil_network']],paint:{'line-color':ENERGY_DOMAIN_PAINT,'line-width':1.5,'line-opacity':former?.5:1,...(civil||former?{'line-dasharray':[3,2]}:{})}});
  for(const stroke of ENERGY_NETWORK_LINES)lines.push({...base,id:`energy-${suffix}-${stroke.id}-lines`,type:'line',filter:['all',...shape('LineString').slice(1),['==',['get','energy_line_style'],stroke.id]],paint:{'line-color':stroke.id==='grid'?['step',['coalesce',['get','energy_voltage'],0],'#fb6a4a',110000,'#de2d26',220000,'#a50f15',380000,stroke.color]:stroke.color,'line-width':['interpolate',['linear'],['zoom'],6,.7,14,2],'line-opacity':former?.5:.85,...(stroke.dash?{'line-dasharray':stroke.dash}:{})}});
  points.push({...base,id:`energy-${suffix}-points`,type:'circle',filter:shape('Point'),paint:{'circle-color':ENERGY_DOMAIN_PAINT,'circle-radius':['interpolate',['linear'],['zoom'],8,2,14,4],'circle-stroke-color':'#fffef8','circle-stroke-width':1,'circle-opacity':former?.5:1}});
  if(tier==='detail')points.push({...base,id:`energy-${suffix}-badges`,type:'symbol',minzoom:Math.max(base.minzoom,13),metadata:{...metadata,'atlas:settings':[...metadata['atlas:settings'],'labels']},filter:shape('Point'),layout:{'text-field':ENERGY_DOMAIN_BADGE,'text-font':['Noto Sans Regular'],'text-size':10,'text-offset':[0,1.1]},paint:{'text-color':ENERGY_DOMAIN_PAINT,'text-halo-color':'#fffef8','text-halo-width':1,'text-opacity':former?.5:1}});
 }
 return {areas,lines,points};
}
