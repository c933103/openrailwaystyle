import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';

export const RAIL_PROVIDER = 'https://openrailwaymap.app';

export function providerVectorTileEndpoint(address, provider = RAIL_PROVIDER) {
  try {
    const url = new URL(address), root = new URL(provider);
    if (url.origin !== root.origin || url.username || url.password) return null;
    const match = /^\/([^/]+)\/\d+\/\d+\/\d+(?:\.pbf)?$/.exec(url.pathname);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

// HTTP success is not sufficient evidence that a provider tile is usable.
// A non-empty MVT must parse and contain the source layer advertised by the
// provider endpoint. Empty successful bodies remain valid empty tiles.
export function validProviderVectorTile(address, status, data, provider = RAIL_PROVIDER) {
  const endpoint = providerVectorTileEndpoint(address, provider);
  if (status !== 200 || !endpoint || !data?.byteLength) return true;
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    return Boolean(new VectorTile(new Pbf(bytes)).layers[endpoint]);
  } catch {
    return false;
  }
}
