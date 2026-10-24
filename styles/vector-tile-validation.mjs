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
    // Martin composite URLs are a set of independent source layers. A tile
    // containing only a supplementary layer (e.g. a kilometre marker or station
    // entrance) is valid even when the requested logical layer has no features.
    // Reject malformed tiles and nonempty responses lacking *all* advertised
    // layers; an HTTP 200 HTML error page must never enter the byte cache.
    const layers = new VectorTile(new Pbf(bytes)).layers;
    return endpoint.split(',').some(layer => Object.hasOwn(layers, layer));
  } catch {
    return false;
  }
}
