const ACTIVE_RAIL=['rail','tram','light_rail','narrow_gauge'];
const ROAD=['motorway','trunk','primary','secondary','tertiary','residential','unclassified','living_street','service','road','track','busway','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link'];
export function streetRunning(tags) {
  const transitAllowed=['bus','psv','taxi'].some(key=>['yes','designated','permissive','destination','private'].includes(tags[key]));
  if((tags.motor_vehicle==='no' && !transitAllowed) || tags.area==='yes') return null;
  if(ACTIVE_RAIL.includes(tags.railway) && tags.embedded==='yes') return 'Railway tagged embedded=yes';
  if(ROAD.includes(tags.highway) && ACTIVE_RAIL.some(t=>(tags.embedded_rails||'').split(';').map(value=>value.trim()).includes(t))) return 'Road tagged embedded_rails='+tags.embedded_rails;
  return null;
}
