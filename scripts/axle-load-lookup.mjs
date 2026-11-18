// The axle-load lookup, made the same way whether its rows came from Overpass
// (build-axle-load-list.mjs) or from the Geofabrik extracts
// (build-extract-axle-load.mjs): one value per way, the way's axle_load,
// maxaxleload and railway:track_class, trimmed, plus which axle system its
// track class follows (Finland's own, or the European one).
import {encodeLoadingGauges} from '../styles/loading-gauge-list.mjs';

export const AXLE_RAILWAYS = ['rail', 'narrow_gauge', 'light_rail', 'subway', 'monorail', 'funicular'];
// The Overpass filter for those railway values.
export const AXLE_RAIL_FILTER = `[railway~"^(${AXLE_RAILWAYS.join('|')})$"]`;

// rows: [way id, axle_load, maxaxleload, railway:track_class], each value a
// string ('' for none); finnish: the ids of the ways with a track class in
// Finland. Returns the published lookup.
export function axleLookup(rows, finnish, {updated, source}) {
  const values = rows.map(([id, capacity, maximum, category]) => [id, JSON.stringify({...(capacity && {axle_load: capacity}),
    ...(maximum && {maxaxleload: maximum}), ...(category && {track_class: category}), axle_system: finnish.has(id) ? 'fi' : 'en'})]);
  return {...encodeLoadingGauges(values), updated, ways: values.length, finnishWays: finnish.size, source};
}
