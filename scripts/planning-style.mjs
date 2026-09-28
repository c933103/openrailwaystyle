import {labelExpression} from '../styles/map-model.mjs';
const match=(key,values)=>['match',['coalesce',['get',key],''],values,true,false];
const base=(id,type,sourceLayer,minzoom,filter)=>({id,type,source:'openmaptiles','source-layer':sourceLayer,minzoom,filter});
const nameLayout={'text-field':labelExpression('local'),'text-font':['Noto Sans Regular'],'text-size':11,'text-padding':8,'text-max-width':12};
export function roadLayers() {
  const roads=[], names=[];
  const groups=[
    ['major',['motorway','trunk','primary','motorway_construction','trunk_construction','primary_construction'],5,'#b5afa0',0.65,4.5],
    ['secondary',['secondary','tertiary','secondary_construction','tertiary_construction'],9,'#bbb6aa',0.6,3.5],
    ['local',['minor','service','busway','bus_guideway','minor_construction','service_construction'],12,'#c2bdb2',0.6,2.5],
    ['track',['track'],13,'#a99b7e',0.65,1.5],
  ];
  for(const [id,classes,zoom,color,start,end] of groups) {
    const filter=match('class',classes),width=['interpolate',['linear'],['zoom'],zoom,start,18,end];
    roads.push({...base(`road-${id}`,'line','transportation',zoom,filter),layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':color,'line-width':width,'line-opacity':['case',['==',['get','brunnel'],'tunnel'],0.4,0.8]}});
  }
  for(const [id,subclasses,color] of [['cycle',['cycleway'],'#829b9b'],['walk',['pedestrian','path','footway','steps','bridleway','corridor'],'#a89a80']]) roads.push({...base(`road-${id}`,'line','transportation',13,['all',match('class',['path']),match('subclass',subclasses)]),paint:{'line-color':color,'line-width':['interpolate',['linear'],['zoom'],13,0.7,18,1.6],'line-dasharray':id==='cycle'?[3,2]:[1,2],'line-opacity':0.85}});
  // Preserve an unclassified mapped path as context, without guessing permitted uses.
  roads.push({...base('road-other-path','line','transportation',13,['all',match('class',['path']),['!',match('subclass',['cycleway','pedestrian','path','footway','steps','bridleway','corridor','platform'])]]),paint:{'line-color':'#a89a80','line-width':1,'line-dasharray':[1,2]}});
  names.push({...base('road-labels','symbol','transportation_name',15,['!',match('class',['rail','transit','ferry'])]),layout:{...nameLayout,'symbol-placement':'line','symbol-spacing':350,'text-size':10},paint:{'text-color':'#827e74','text-halo-color':'#f5f3eb','text-halo-width':1.4}});
  return {roads,names};
}
export function constraintLayers() {
  const areas=[],lines=[],labels=[];
  const indigenous=match('class',['aboriginal_lands']);
  const heritage=match('class',['archaeological_site','battlefield','district','historic']);
  const groups=[
    ['protected','park',6,['all',['!',indigenous],['!',heritage]],'#59845b'],
    ['heritage','park',10,heritage,'#956837'],
    ['indigenous','boundary',4,indigenous,'#91689b'],
    ['indigenous-park','park',6,indigenous,'#91689b'],
    ['military','landuse',8,match('class',['military']),'#b36765'],
    ['religious','landuse',12,match('class',['religious','cemetery']),'#968575'],
  ];
  for(const [id,source,zoom,filter,color] of groups) {
    const polygon=['all',filter,['==',['geometry-type'],'Polygon']];
    areas.push({...base(`context-constraints-${id}-area`,'fill',source,zoom,polygon),paint:{'fill-color':color,'fill-opacity':id.startsWith('indigenous')?0.045:0.1}});
    lines.push({...base(`context-constraints-${id}-edge`,'line',source,zoom,polygon),paint:{'line-color':color,'line-width':['interpolate',['linear'],['zoom'],zoom,0.8,14,1.5],'line-opacity':0.8,'line-dasharray':id.startsWith('indigenous')?[8,2,1,2]:id==='military'?[2,2]:[6,2]}});
    labels.push({...base(`context-constraints-${id}-area-label`,'symbol',source,zoom+1,filter),layout:{...nameLayout,'symbol-placement':source==='park'?'point':'line','symbol-spacing':500,'text-size':11},paint:{'text-color':color,'text-halo-color':'#fffef8','text-halo-width':1.5}});
  }
  return {areas,lines,labels};
}
