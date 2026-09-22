export const STATES = ['proposed', 'construction', 'disused', 'abandoned', 'razed', 'demolished', 'removed'];
const TRACKS = ['rail', 'narrow_gauge', 'light_rail', 'subway', 'tram', 'monorail', 'funicular'];
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
    }, geometry: lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines } });
  }
  return { type: 'FeatureCollection', features };
}
