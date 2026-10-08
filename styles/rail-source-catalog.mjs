// Atlas's verified provider contract. These are the zoom ranges consumed by
// scripts/style/sources/railway.mjs, not a promise of provider availability.
// The provider's documented XYZ endpoint convention needs no network TileJSON
// request for every hidden thematic source. Actual tile failures remain errors.
// Unknown endpoints still use the provider's TileJSON, rather than guessing.
export const RAIL_TILE_RANGES = Object.freeze({
  standard_railway_line_low: [0, 6],
  speed_railway_line_low: [0, 6],
  electrification_railway_line_low: [0, 6],
  signals_railway_line_low: [0, 6],
  track_railway_line_low: [0, 6],
  operator_railway_line_low: [0, 6],
  railway_line_high: [7, 16],
  standard_railway_platforms: [17, 22],
  standard_railway_platform_edges: [17, 22],
  railway_signals: [13, 22],
  electrification_substation: [13, 22],
  standard_station_entrances: [16, 22],
  standard_railway_text_stations_low: [4, 6],
  standard_railway_text_stations_med: [7, 7],
  standard_railway_text_stations: [8, 16],
  points_of_interest: [15, 18],
});

export function railTileMetadata(address, provider = 'https://openrailwaymap.app') {
  const url = new URL(address), root = new URL(provider);
  if (url.origin !== root.origin || url.username || url.password || url.search || url.hash) return null;
  const endpoint = url.pathname.replace(/^\//, '');
  const range = Object.hasOwn(RAIL_TILE_RANGES, endpoint) && RAIL_TILE_RANGES[endpoint];
  if (!range) return null;
  return {tilejson: '3.0.0', scheme: 'xyz', minzoom: range[0], maxzoom: range[1],
    tiles: [`${url.href}/{z}/{x}/{y}`], vector_layers: [{id: endpoint, fields: {}}]};
}

// A missing fragment parameter is not zero: Number(null) used to accidentally
// turn the ordinary station sources into zoom-0-only sources.
export function zoomOverrides(fragment) {
  const options = new URLSearchParams(fragment), result = {};
  for (const key of ['minzoom', 'maxzoom', 'underzoom']) {
    const raw = options.get(key);
    if (raw === null || raw.trim() === '') continue;
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 0 && value <= 24) result[key] = value;
  }
  return result;
}

// These rail tiles have no text layer at their display zoom. Loading fonts
// for every string-valued attribute cannot affect their geometry or labels.
export function railTileNeedsGlyphs(address) {
  const url = new URL(address);
  const match = /^\/([^/]+)\/(\d+)\/\d+\/\d+(?:\.pbf)?$/.exec(url.pathname);
  if (!match) return true;
  const [, endpoint, zoom] = match;
  if (endpoint.endsWith('_railway_line_low') && Object.hasOwn(RAIL_TILE_RANGES, endpoint)) return false;
  return endpoint !== 'railway_line_high' || Number(zoom) >= 9;
}
