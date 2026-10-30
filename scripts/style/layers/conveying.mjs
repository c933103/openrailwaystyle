// Escalators, moving walkways and elevators: a thin line in every view, with
// an arrow for a mapped travel direction (both ways for a reversible one).
// The arrow image is drawn at runtime (styleimagemissing 'conveying-arrow').
import {CONVEYING_COLOUR} from '../../../styles/map-model.mjs';
export function conveyingLayers() {
  const metadata={'atlas:group':'railway','atlas:category':'conveying','atlas:views':[],'atlas:settings':[],'atlas:initial-hidden':false,'atlas:base-map':false};
  const base={source:'conveying','source-layer':'conveying',metadata};
  // One arrow at the middle of each mapped piece; a chain of pieces gets one each.
  const arrow=(id,filter,rotate)=>({...base,id,type:'symbol',minzoom:16,filter,
    layout:{'symbol-placement':'line-center','icon-image':'conveying-arrow','icon-size':['interpolate',['linear'],['zoom'],16,0.7,19,1],'icon-rotate':rotate,
      // A reversible piece's two arrows step apart (the offset turns with each arrow): ‹ ›.
      'icon-offset':['case',['==',['get','arrows'],'two_way'],['literal',[7,0]],['literal',[0,0]]],
      'icon-allow-overlap':true,'icon-ignore-placement':true,'icon-rotation-alignment':'map'},
    paint:{'icon-color':CONVEYING_COLOUR,'icon-halo-color':'rgba(255,255,255,0.85)','icon-halo-width':1}});
  return [
    {...base,id:'conveying-lines',type:'line',minzoom:14,layout:{'line-cap':'round','line-join':'round'},
      paint:{'line-color':CONVEYING_COLOUR,'line-width':['interpolate',['linear'],['zoom'],14,0.8,18,2]}},
    arrow('conveying-arrows',['match',['get','arrows'],['one_way','two_way'],true,false],0),
    arrow('conveying-arrows-back',['==',['get','arrows'],'two_way'],180),
  ];
}
