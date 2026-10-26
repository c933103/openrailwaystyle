import {TRACTION_LINE_STYLE} from '../../../styles/power-facilities.mjs';

// Railway traction power lines draw beneath the tracks: they supply the
// railway but must never hide track geometry or its thematic colour.
export function tractionLineLayers() {
  const metadata={'atlas:group':'railway','atlas:category':'energy-supply','atlas:views':['electrification'],'atlas:settings':[],'atlas:initial-hidden':true};
  const {color,width}=TRACTION_LINE_STYLE;
  const layers=[];
  for(const former of [false,true]) {
    const state=[former?'!=':'==',['get','power_state'],'present'];
    const base={source:'electricLines',minzoom:10,metadata:{...metadata,'atlas:settings':former?['inactive']:[]},layout:{'line-cap':'butt','line-join':'round'}};
    const paint=dash=>({'line-color':color,'line-opacity':former?0.5:1,
      'line-width':['interpolate',['linear'],['zoom'],10,['match',['get','power_line_kind'],'line',width.line[0],width.other[0]],15,['match',['get','power_line_kind'],'line',width.line[1],width.other[1]]],
      ...(dash?{'line-dasharray':dash}:{})});
    const suffix=former?'former-':'';
    layers.push({...base,id:`electrification-${suffix}traction-lines`,type:'line',filter:['all',state,['!=',['get','power_line_kind'],'cable']],paint:paint(former?[3,2]:null)});
    layers.push({...base,id:`electrification-${suffix}traction-cables`,type:'line',filter:['all',state,['==',['get','power_line_kind'],'cable']],paint:paint([1.5,1.5])});
  }
  return layers;
}
