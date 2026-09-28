const ACTIVE_RAIL=['rail','tram','light_rail','narrow_gauge'];
const ROAD=['motorway','trunk','primary','secondary','tertiary','residential','unclassified','living_street','service','road','track','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link'];
export function streetRunning(tags) {
  if(['no','private'].includes(tags.motor_vehicle) || tags.area==='yes') return null;
  if(ACTIVE_RAIL.includes(tags.railway) && tags.embedded==='yes') return 'Railway tagged embedded=yes';
  if(ROAD.includes(tags.highway) && ACTIVE_RAIL.some(t=>(tags.embedded_rails||'').split(';').includes(t))) return 'Road tagged embedded_rails='+tags.embedded_rails;
  if(ROAD.includes(tags.highway) && ACTIVE_RAIL.includes(tags.railway)) return 'The same way is tagged as a road and railway';
  return null;
}
