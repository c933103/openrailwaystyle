// Shared railway filters. Source data and zoom thresholds are unchanged.
export const present = ['==', ['coalesce', ['get', 'state'], 'present'], 'present'];
export const notFerry = ['!=', ['get', 'feature'], 'ferry'];
export const hasService = ['!=',['coalesce',['get','service'],''],''];
// Metro tracks from zoom 7; light rail, monorail, tram, funicular and
// miniature tracks from zoom 10 (the detailed tiles hold light rail main and
// branch lines from 9, metro from 10).
const URBAN_FEATURES = ['light_rail', 'monorail', 'tram', 'funicular', 'miniature'];
export const byKindZoom = ['case',
  ['==', ['get', 'feature'], 'subway'], ['>=', ['zoom'], 7],
  ['match', ['get', 'feature'], URBAN_FEATURES, true, false], ['>=', ['zoom'], 10],
  true];
