import {AERIALWAY_KINDS, AERIALWAY_TICK, viewLinePaint, viewLineWidth} from '../../../styles/map-model.mjs';

// Every view: part of the transport network even where a view has no data on
// them. Not base map: hybrid imagery keeps them, like the railway lines they
// sit with. From the project's own aerialway snapshot (conveying.yml), which
// carries the owner and maxspeed the thematic views colour the cable by; the
// app swaps that colour and width on each view change (viewLinePaint).
export function aerialwayLayers() {
  const metadata={'atlas:group':'railway','atlas:category':'aerialway','atlas:views':[],
    'atlas:settings':[],'atlas:initial-hidden':false,'atlas:base-map':false};
  const base={type:'line',source:'aerialways','source-layer':'aerialways',minzoom:12,metadata,layout:{'line-join':'round'}};
  const of=kind=>['==',['get','kind'],kind.id];
  return AERIALWAY_KINDS.flatMap(kind=>{
    const cable=`aerialway-${kind.id}-cable`;
    return [
      {...base,id:cable,filter:of(kind),paint:{'line-color':viewLinePaint(cable,'infrastructure'),'line-width':viewLineWidth(cable,'infrastructure')}},
      {...base,id:`aerialway-${kind.id}-ticks`,filter:of(kind),paint:{'line-color':AERIALWAY_TICK,'line-width':kind.tickWidth,'line-dasharray':[...kind.dash]}},
    ];
  });
}
