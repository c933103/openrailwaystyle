import {electrificationPaint} from '../../../styles/map-model.mjs';
import {present,notFerry,byKindZoom} from './railway-expressions.mjs';
import {POWER_METHOD_STROKES} from '../../../styles/power-facilities.mjs';
import {facilityShapeLayers} from './power-facilities.mjs';

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
    // Rack railways are mapped with rack=* (abt, strub, riggenbach, yes…),
    // which the provider's detailed railway tiles already carry; draw them
    // from there rather than only from the rare traction=rack tag.
    const rack=POWER_METHOD_STROKES.find(({id})=>id==='rack-traction');
    layers.push({id:`electrification-${suffix}provider-rack`,type:'line',source:'railway','source-layer':'railway_line_high',minzoom:10,metadata:meta,
      filter:['all',former?['!',present]:present,notFerry,byKindZoom,['!',['in',['downcase',['coalesce',['get','rack'],'no']],['literal',['no','']]]]],
      layout:{'line-cap':rack.cap||'butt','line-join':'round'},
      paint:{'line-color':rack.color,'line-width':rack.width,'line-offset':rack.offset,'line-dasharray':rack.dash,'line-opacity':opacity}});
    // Battery-train chargers: the same mapped shapes as other facilities.
    const charging={minzoom:12,metadata:meta,filter:['all',['match',['geometry-type'],['Point','MultiPoint','Polygon','MultiPolygon'],true,false],[former?'!=':'==',['get','power_state'],'present']]};
    layers.push(...facilityShapeLayers(`electrification-${suffix}charging`,'electricMethods',charging,former));
  }
  const catenary={source:'electricCatenary','source-layer':'electrification_catenary',minzoom:16,metadata};
  layers.push({...catenary,id:'electrification-catenary-masts',type:'circle',filter:['==',['get','feature'],'mast'],paint:{'circle-color':'#b77d00','circle-radius':2.5,'circle-stroke-color':'#fffef8','circle-stroke-width':1}});
  layers.push({...catenary,id:'electrification-catenary-portals',type:'line',filter:['==',['get','feature'],'portal'],paint:{'line-color':'#b77d00','line-width':1.5}});
  layers.push({...catenary,id:'electrification-catenary-references',type:'symbol',minzoom:18,
    metadata:{...metadata,'atlas:settings':['labels']},layout:{'text-field':['get','ref'],'text-font':['Noto Sans Regular'],'text-size':10,'text-offset':[0,1]},paint:{'text-color':'#8c5f00','text-halo-color':'#fffef8','text-halo-width':1}});
  return layers;
}
