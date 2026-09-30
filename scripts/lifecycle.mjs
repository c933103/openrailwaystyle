export const STATES = ['proposed', 'construction', 'disused', 'abandoned', 'razed', 'demolished', 'removed'];
const TRACKS = ['rail', 'narrow_gauge', 'light_rail', 'subway', 'tram', 'monorail', 'funicular'];
// Recorded limit in km/h: the lifecycle-prefixed tag first (e.g. a planned
// construction:maxspeed), then maxspeed, then the larger directional one.
// Values such as 'none' or 'signals' are not numeric and are left out.
export function parseMaxspeed(tags, state) {
  const kmh = value => {
    const speeds = String(value ?? '').split(';').map(part => {
      const m = /^\s*(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph|knots)?\s*$/i.exec(part);
      if (!m) return NaN;
      const n = Number(m[1]), unit = (m[2] || '').toLowerCase();
      return unit === 'mph' ? n * 1.609344 : unit === 'knots' ? n * 1.852 : n;
    }).filter(Number.isFinite);
    return speeds.length ? Math.max(...speeds) : NaN;
  };
  for (const prefix of [`${state}:`, '']) {
    const direct = kmh(tags[`${prefix}maxspeed`]);
    if (Number.isFinite(direct)) return Math.round(direct);
    // Either direction alone counts (Math.max with a missing one is NaN).
    const directional = [kmh(tags[`${prefix}maxspeed:forward`]), kmh(tags[`${prefix}maxspeed:backward`])].filter(Number.isFinite);
    if (directional.length) return Math.round(Math.max(...directional));
  }
  return undefined;
}
const structure = value => value !== undefined && value !== 'no';
export function toGeoJSON(json) {
  if (json.remark || !Array.isArray(json.elements)) throw new Error('Incomplete regional railway response');
  const features = [];
  for (const way of json.elements) {
    if (way.type !== 'way') continue;
    const tags = way.tags || {};
    // Active track with an old lifecycle tag must not be drawn as closed.
    if (TRACKS.includes(tags.railway)) continue;
    const state = STATES.includes(tags.railway) ? tags.railway : STATES.find(s => TRACKS.includes(tags[`${s}:railway`]));
    if (!state) continue;
    const kind = tags[`${state}:railway`] || tags[state];
    if (kind && !TRACKS.includes(kind) && kind !== 'yes') continue;
    const lines = []; let line = [];
    for (const point of way.geometry || []) {
      if (point && Number.isFinite(point.lon) && Number.isFinite(point.lat)) line.push([point.lon, point.lat]);
      else { if (line.length > 1) lines.push(line); line = []; }
    }
    if (line.length > 1) lines.push(line);
    if (!lines.length) continue;
    features.push({ type: 'Feature', id: way.id, properties: {
      id: way.id, osm_id: way.id, state, feature: TRACKS.includes(kind) ? kind : 'rail',
      name: tags.name || tags['name:en'] || '', ref: tags.ref || '',
      ...Object.fromEntries(Object.entries(tags).filter(([key]) => key.startsWith('name:'))),
      usage: tags.usage || '', service: tags.service || '', operator: tags.operator || '',
      ...(parseMaxspeed(tags, state) !== undefined && {maxspeed: parseMaxspeed(tags, state)}),
      ...(structure(tags.bridge) && {bridge: true}), ...(structure(tags.tunnel) && {tunnel: true}),
    }, geometry: lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines } });
  }
  return { type: 'FeatureCollection', features };
}
