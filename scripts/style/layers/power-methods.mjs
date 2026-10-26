import {electrificationPaint} from '../../../styles/map-model.mjs';
import {POWER_FACILITY_SYMBOL,POWER_METHOD_STROKES} from '../../../styles/power-facilities.mjs';
import {powerKindText} from './power-facilities.mjs';

export function powerMethodLayers() {
  const metadata={'atlas:group':'railway','atlas:category':'energy-supply','atlas:views':['electrification'],'atlas:settings':[],'atlas:initial-hidden':true};
  const layers=[];
  for(const former of [false,true]) {
    const suffix=former?'former-':'',meta={...metadata,'atlas:settings':former?['inactive']:[]};
    const base={source:'electricMethods',minzoom:10,metadata:meta,
      filter:['all',['==',['geometry-type'],'LineString'],[former?'!=':'==',['get','power_state'],'present']]};
    // Snapshots built before the per-method fields existed carry only
    // power_method; read it for those until the next snapshot replaces them.
    const legacy={method_rail:'rail',method_fourth_rail:'4th_rail',method_ground:'ground-level',method_inductive:'inductive'};
    const has=key=>legacy[key]?['any',['==',['get',key],true],['all',['!',['has',key]],['in',legacy[key],['coalesce',['get','power_method'],'']]]]:['==',['get',key],true];
    const opacity=former?0.5:1;
    // Each means of delivery or traction has its own stroke beside or along
    // the track, so several can be read on one track. Overhead contact line
    // is the track colour alone. Power strokes keep the system colour.
    for(const {id,when,offset,width,dash,color,cap} of POWER_METHOD_STROKES)
      layers.push({...base,id:`electrification-${suffix}${id}`,type:'line',filter:['all',...base.filter.slice(1),['any',...when.map(has)]],
        layout:{'line-cap':cap||'butt','line-join':'round'},
        paint:{'line-color':color||electrificationPaint(),'line-width':width,'line-offset':offset,...(dash?{'line-dasharray':dash}:{}),'line-opacity':opacity}});
    // Means and charger labels say what the feature is, so they stay with
    // the features rather than following the value-labels setting.
    layers.push({...base,id:`electrification-${suffix}method-labels`,type:'symbol',minzoom:12,
      metadata:meta,
      layout:{'symbol-placement':'line','symbol-spacing':350,'text-field':['get','power_method_label'],'text-font':['Noto Sans Bold'],'text-size':11,'text-offset':[0,1]},
      paint:{'text-color':'#26363d','text-halo-color':'#fffef8','text-halo-width':2}});
    const point={source:'electricMethods',minzoom:12,metadata:meta,filter:['all',['==',['geometry-type'],'Point'],[former?'!=':'==',['get','power_state'],'present']]};
    const {paper,radius,textSize,stroke,formerStroke}=POWER_FACILITY_SYMBOL;
    layers.push({...point,id:`electrification-${suffix}charging-points`,type:'circle',paint:{'circle-color':former?paper:['get','power_color'],'circle-radius':radius,'circle-stroke-color':former?['get','power_color']:paper,'circle-stroke-width':former?formerStroke:stroke}});
    layers.push({...point,id:`electrification-${suffix}charging-marks`,type:'symbol',layout:{'text-field':'B','text-font':['Noto Sans Bold'],'text-size':textSize,'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':former?['get','power_color']:paper}});
    layers.push({...point,id:`electrification-${suffix}charging-kinds`,type:'symbol',minzoom:14,metadata:{...meta,'atlas:localize':false},
      layout:{'text-field':powerKindText(former),'text-font':['Noto Sans Bold'],'text-size':10.5,'text-anchor':'bottom','text-offset':[0,-0.9],'text-max-width':12},paint:{'text-color':'#008a83','text-halo-color':paper,'text-halo-width':1.5}});
    layers.push({...point,id:`electrification-${suffix}charging-names`,type:'symbol',minzoom:14,
      metadata:{...meta,'atlas:localize':true},
      layout:{'text-field':['coalesce',['get','atlas_name'],['get','name'],['get','ref'],''],'text-font':['Noto Sans Regular'],'text-size':11,'text-anchor':'top','text-offset':[0,0.9]},paint:{'text-color':'#008a83','text-halo-color':paper,'text-halo-width':1.5}});
  }
  const catenary={source:'electricCatenary','source-layer':'electrification_catenary',minzoom:16,metadata};
  layers.push({...catenary,id:'electrification-catenary-masts',type:'circle',filter:['==',['get','feature'],'mast'],paint:{'circle-color':'#b77d00','circle-radius':2.5,'circle-stroke-color':'#fffef8','circle-stroke-width':1}});
  layers.push({...catenary,id:'electrification-catenary-portals',type:'line',filter:['==',['get','feature'],'portal'],paint:{'line-color':'#b77d00','line-width':1.5}});
  layers.push({...catenary,id:'electrification-catenary-references',type:'symbol',minzoom:18,
    metadata:{...metadata,'atlas:settings':['labels']},layout:{'text-field':['get','ref'],'text-font':['Noto Sans Regular'],'text-size':10,'text-offset':[0,1]},paint:{'text-color':'#8c5f00','text-halo-color':'#fffef8','text-halo-width':1}});
  return layers;
}
