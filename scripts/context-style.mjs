import {CONTEXT_CATEGORIES, AREA_CATEGORIES} from '../styles/context.mjs';
import {labelExpression} from '../styles/map-model.mjs';
const base = (id, type, sourceLayer, minzoom, filter) => ({id,type,source:'openmaptiles','source-layer':sourceLayer,minzoom,filter});
const values = (key, list) => ['match',['coalesce',['get',key],''],list,true,false];
const text = {
  'text-field':labelExpression('local'),'text-font':['Noto Sans Regular'],
  'text-size':['interpolate',['linear'],['zoom'],9,11,15,12.5],
  'text-variable-anchor':['left','right','top','bottom'],'text-radial-offset':1.1,
  'text-max-width':9,'text-padding':5,'text-optional':true,
  'icon-size':0.75,'icon-padding':4,'icon-allow-overlap':false,'icon-ignore-placement':false,
  'symbol-sort-key':['to-number',['coalesce',['get','rank'],100],100],
};
export function contextLayers() {
  const areas = [], lines = [], labels = [];
  for (const c of AREA_CATEGORIES) {
    const b=base(`context-destinations-${c.id}-area`,'fill','landuse',10,values('class',c.values));
    areas.push({...b,paint:{'fill-color':c.color,'fill-opacity':0.12}});
    lines.push({...b,id:`context-destinations-${c.id}-edge`,type:'line',minzoom:12,paint:{'line-color':c.color,'line-width':0.65,'line-opacity':0.35}});
  }
  areas.push({...base('context-transport-grounds','fill','landuse',12,values('class',['bus_station','railway'])),paint:{'fill-color':'#6ca6a8','fill-opacity':0.2}});
  lines.push({...base('context-transport-grounds-edge','line','landuse',12,values('class',['bus_station','railway'])),paint:{'line-color':'#4d8d91','line-width':1,'line-opacity':0.65}});
  areas.push({...base('context-transport-airport-area','fill','aeroway',10,['all',['==',['geometry-type'],'Polygon'],values('class',['aerodrome','apron','terminal','runway','taxiway'])]),paint:{'fill-color':'#929bc2','fill-opacity':0.25}});
  lines.push({...base('context-transport-airport-runways','line','aeroway',10,values('class',['runway','taxiway'])),paint:{'line-color':'#7982a1','line-width':['interpolate',['linear'],['zoom'],10,1.5,16,5],'line-opacity':0.7}});
  lines.push({...base('context-transport-ferry-routes','line','transportation',9,values('class',['ferry'])),paint:{'line-color':'#388b9b','line-width':1.2,'line-opacity':0.65,'line-dasharray':[4,3]}});
  // Destinations are placed below transport and all rail labels. Named major
  // facilities lead; ordinary schools/cultural sites enter a little later.
  const priority=c=>c.group==='transport'?(c.local?(c.id==='bike-parking'?0.5:1):2):0;
  for (const c of [...CONTEXT_CATEGORIES].sort((a,b)=>priority(a)-priority(b))) {
    const airport=c.id==='airport';
    const destination=c.group==='destinations';
    const filter=airport ? ['all',['!',values('class',['military','private'])],['any',['>=',['zoom'],12],values('class',['international']),['!=',['coalesce',['get','iata'],''],'']]]
      : ['any',...(c.values ? [['match',['coalesce',['get','subclass'],['get','class'],''],c.values,true,false]]:[]),...(c.classes ? [values('class',c.classes)]:[])];
    labels.push({...base(`context-${c.group}-${c.id}-label`,'symbol',airport?'aerodrome_label':'poi',airport?8:(c.zoom||12),filter),
      layout:{...text,'icon-image':`context-${c.id}`,'icon-size':c.local?0.62:c.group==='transport'?0.85:destination?0.55:0.7,
        ...(destination?{'text-size':['interpolate',['linear'],['zoom'],12,10,16,11,19,12],'text-padding':8,'text-radial-offset':0.9}: {})},
      paint:{'text-color':destination?'#707973':c.color,'text-halo-color':'#fffef8','text-halo-width':destination?1:1.8,
        ...(destination?{'icon-opacity':0.7,'text-opacity':0.85}: {})}});
  }
  return {areas,lines,labels};
}
