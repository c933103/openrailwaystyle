// Shared by the style builder and reference-only status diagnostics. Keep the
// type thresholds in one place so expected zoom suppression is never an outage.
const KIND_ZOOMS = [
  {kinds: ['subway'], minzoom: 7},
  {kinds: ['light_rail', 'monorail', 'tram', 'funicular', 'miniature'], minzoom: 10},
];

export const byKindZoom = ['case', ...KIND_ZOOMS.flatMap(({kinds, minzoom}) => [
  kinds.length === 1 ? ['==', ['get', 'feature'], kinds[0]] : ['match', ['get', 'feature'], kinds, true, false], ['>=', ['zoom'], minzoom],
]), true];

export function referenceDetailEligible(feature, zoom, layer) {
  if (!layer || layer.type !== 'line' || layer.layout?.visibility === 'none' ||
      zoom < (layer.minzoom ?? 0) || zoom >= (layer.maxzoom ?? 24)) return false;
  // Reference features have already passed the basemap railway filter. A rail
  // subclass omitted by older basemap tiles means ordinary rail, as in the style.
  const kind = feature.properties?.subclass || 'rail';
  return zoom >= (KIND_ZOOMS.find(rule => rule.kinds.includes(kind))?.minzoom ?? 0);
}
