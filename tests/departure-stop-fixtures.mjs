// Convert test-domain candidates into the provider's documented Place shape.
// Non-array envelopes still reach the production error path unchanged.
export const asMapStops = input => Array.isArray(input) ? input
  .filter(item=>!item || item.type==='STOP').map(item=>item && ({
    stopId:item.id,name:item.name,lat:item.lat,lon:item.lon,modes:item.modes,vertexType:'TRANSIT',
  })) : input;
