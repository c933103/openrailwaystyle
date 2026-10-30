import {AERIALWAY_KINDS, AERIALWAY_CABLE, AERIALWAY_TICK} from '../../../styles/map-model.mjs';

// Not base map: hybrid imagery keeps them, like the railway lines they sit
// with. The Carto raster already draws them the same way, so skip it there.
export function aerialwayLayers() {
  const metadata={'atlas:group':'railway','atlas:category':'aerialway','atlas:views':['infrastructure','electrification'],
    'atlas:settings':[],'atlas:initial-hidden':true,'atlas:base-map':false,'atlas:hide-backgrounds':['carto']};
  const base={type:'line',source:'openmaptiles','source-layer':'transportation',minzoom:12,metadata,layout:{'line-join':'round'}};
  const of=kind=>['all',['==',['get','class'],'aerialway'],['match',['coalesce',['get','subclass'],''],[...kind.subclasses],true,false]];
  return AERIALWAY_KINDS.flatMap(kind=>[
    {...base,id:`aerialway-${kind.id}-cable`,filter:of(kind),paint:{'line-color':AERIALWAY_CABLE,'line-width':1}},
    {...base,id:`aerialway-${kind.id}-ticks`,filter:of(kind),paint:{'line-color':AERIALWAY_TICK,'line-width':kind.tickWidth,'line-dasharray':[...kind.dash]}},
  ]);
}
