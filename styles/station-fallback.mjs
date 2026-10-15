// Independent station fallback presentation using the already-loaded basemap.
// It neither downloads deeper tiles nor treats mapped POIs as a complete inventory.
// ORM's individual station circles and labels retain their normal sources.
// Fall back only on an actual relevant station-source error: double marker
// locations are not safe to publish when both providers have geometry.
export const STATION_BASEMAP_POI_FILTER = [
  'all',
  ['==', ['get', 'class'], 'railway'],
  ['match', ['get', 'subclass'], ['station', 'halt', 'tram_stop', 'subway'], true, false],
];

export const STATION_FALLBACK_IDS = Object.freeze([
  'station-basemap-fallback-dots',
  'station-curated-fallback-dots',
  'station-basemap-fallback-names',
]);

export function stationFallbackLayers(labelExpression) {
  if (typeof labelExpression !== 'function') throw new TypeError('Station labels require a language expression');
  const priority = ['match', ['get', 'subclass'], 'station', 0, 'subway', 1, 'halt', 2, 'tram_stop', 3, 4];
  return [
    {
      id: STATION_FALLBACK_IDS[0], type: 'circle', source: 'openmaptiles', 'source-layer': 'poi',
      minzoom: 8, filter: STATION_BASEMAP_POI_FILTER,
      layout: {'circle-sort-key': ['-', 4, priority]},
      paint: {
        'circle-color': '#ffa323', 'circle-stroke-color': '#123e52', 'circle-stroke-width': 1,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.6, 12, 2.5, 17, 3.4],
      },
      metadata: {'atlas:base-map': false},
    },
    {
      // These already vetted hubs can be displayed after a station-tile failure
      // above z7 without duplicating normal ORM station markers.
      id: STATION_FALLBACK_IDS[1], type: 'circle', source: 'stationMajor',
      minzoom: 7, filter: ['all', ['==', ['get', 'feature'], 'station'], ['has', 'tier']],
      paint: {
        'circle-color': '#ffa323', 'circle-stroke-color': '#123e52',
        'circle-stroke-width': 1.2,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2.4, 12, 3.5, 18, 4],
      },
      metadata: {'atlas:base-map': false},
    },
    {
      // The regular station names outrank these; show this label layer only
      // when the currently relevant ORM station tile source has failed.
      id: STATION_FALLBACK_IDS[2], type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi',
      minzoom: 8, filter: STATION_BASEMAP_POI_FILTER,
      layout: {
        visibility: 'none', 'text-field': labelExpression('local'),
        'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 15, 13],
        'symbol-sort-key': priority, 'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
        'text-radial-offset': 0.7, 'text-max-width': 9, 'text-padding': 3,
        'text-allow-overlap': false,
      },
      paint: {'text-color': '#0865c0', 'text-halo-color': '#fffef8', 'text-halo-width': 2},
      metadata: {'atlas:base-map': false},
    },
  ];
}

export function addStationFallbackLayers(style, {annotateLayers, labelExpression}) {
  if (!style || !Array.isArray(style.layers) || !style.sources?.openmaptiles || !style.sources?.stationMajor)
    throw new TypeError('Station fallback requires the existing basemap and curated sources');
  if (typeof annotateLayers !== 'function') throw new TypeError('Station fallback requires layer metadata');
  const existing = STATION_FALLBACK_IDS.filter(id => style.layers.some(layer => layer.id === id));
  if (existing.length === STATION_FALLBACK_IDS.length) return style;
  if (existing.length) throw new Error('Partially installed station fallback');
  const layers = annotateLayers(stationFallbackLayers(labelExpression));
  const insertBefore = (anchor, additions) => {
    const index = style.layers.findIndex(layer => layer.id === anchor);
    if (index < 0) throw new Error('Missing station layer-order anchor: ' + anchor);
    style.layers.splice(index, 0, ...additions);
  };
  // Both marker sources draw above crossings, but below ORM station dots.
  insertBefore('station-stationLow-dots', layers.slice(0, 2));
  // This placement also gives ORM station names higher collision priority.
  insertBefore('station-stationLow-mover-names', layers.slice(2));
  return style;
}

export function stationFallbackMarkersEnabled({zoom, stationsEnabled, background, failedSources}) {
  const requiredSource=zoom>=8?'stations':zoom>=7?'stationMed':null;
  return Boolean(requiredSource && stationsEnabled && background!=='satellite' &&
    failedSources?.has?.(requiredSource)===true);
}
export function stationFallbackNamesEnabled(options) {
  return options.zoom>=8 && stationFallbackMarkersEnabled(options);
}
