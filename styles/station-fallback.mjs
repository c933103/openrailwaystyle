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

const CURATED_STATION_FILTER = ['all', ['==', ['get', 'feature'], 'station'], ['has', 'tier']];
const stationSource = zoom => zoom >= 8 ? 'stations' : zoom >= 7 ? 'stationMed' : null;
const coordinate = event => event?.tile?.tileID?.canonical || event?.coord?.canonical;
const tileKey = c => `${c.z}/${c.x}/${c.y}`;
const validCoordinate = c => c && Number.isInteger(c.z) && c.z >= 0 && c.z <= 30 &&
  Number.isInteger(c.x) && c.x >= 0 && c.x < 2 ** c.z &&
  Number.isInteger(c.y) && c.y >= 0 && c.y < 2 ** c.z;
const descendant = (child, parent) => validCoordinate(child) && child.z > parent.z &&
  Math.floor(child.x / 2 ** (child.z - parent.z)) === parent.x &&
  Math.floor(child.y / 2 ** (child.z - parent.z)) === parent.y;
const sameWorld = (a, b) => (a?.tileID?.wrap ?? 0) === (b?.tileID?.wrap ?? 0);
const tilePolygon = c => {
  const n = 2 ** c.z, latitude = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  const west = c.x / n * 360 - 180, east = (c.x + 1) / n * 360 - 180;
  const north = latitude(c.y), south = latitude(c.y + 1);
  return [[[west, south], [east, south], [east, north], [west, north], [west, south]]];
};

// Presentation tracks retryable AND nonretryable errors independently of retry
// scheduling. A healthy neighboring tile cannot clear another tile's failure or
// acquire fallback markers. Metadata failure is the only source-wide fallback.
export function createStationFallbackState(map) {
  const failed = new Map(), observed = new Map();
  function remember(id, source, tile) {
    if (!tile) return;
    let evidence = observed.get(id);
    if (!evidence || evidence.source !== source || evidence.url !== source.url) {
      evidence = {source, url: source.url, tiles: new WeakSet()};observed.set(id, evidence);
    }
    evidence.tiles.add(tile);
  }
  function onScreen(c) {
    if (!c || !map.getBounds) return true;
    const bounds = map.getBounds();
    if (!bounds?.getWest) return true;
    const n = 2 ** c.z, latitude = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    if (latitude(c.y) < bounds.getSouth?.() || latitude(c.y + 1) > bounds.getNorth?.()) return false;
    const west = bounds.getWest(), east = bounds.getEast?.();
    // Unknown longitude cannot establish exclusion; known latitude still can.
    if (!Number.isFinite(west) || !Number.isFinite(east)) return true;
    let width = east - west;
    if (!Number.isFinite(width)) return true;
    if (width >= 360) return true;
    if (width < 0) width = (width % 360 + 360) % 360; // antimeridian bounds
    const start = (west % 360 + 360) % 360;
    const left = c.x / n * 360 - 180, right = (c.x + 1) / n * 360 - 180;
    // An integer world offset must place the tile across this interval.
    return Math.ceil((start - right) / 360) <= Math.floor((start + width - left) / 360);
  }
  function selectionFor(source) {
    const zoom = map.getZoom?.();
    if (!Number.isFinite(zoom)) return null;
    // Compatibility fallback when the pinned renderer's active inventory is
    // unavailable. Vector sources use 512px tiles and floor camera zoom.
    const max = Number.isFinite(source?.maxzoom) ? source.maxzoom : 22;
    return `${stationSource(zoom)}:${Math.min(Math.max(0, Math.floor(zoom)), max)}`;
  }
  function activeTiles(id, source) {
    // Read the pinned MapLibre inventory, including errored/non-renderable
    // tiles. Camera zoom alone cannot identify the active mixed-LOD selection.
    const manager = map.style?.tileManagers?.[id];
    if (typeof manager?.getIds !== 'function' || typeof manager.getTileByID !== 'function' ||
        typeof manager.getSource !== 'function' || manager.getSource() !== source) return null;
    return manager.getIds().map(key => manager.getTileByID(key)).filter(Boolean);
  }
  function stateFor(id) {
    const source = map.getSource(id);
    let state = failed.get(id), evidence = observed.get(id);
    if (state && (state.source !== source || state.url !== source?.url)) { failed.delete(id);state = null; }
    if (evidence && (evidence.source !== source || evidence.url !== source?.url)) { observed.delete(id);evidence = null; }
    if (!state && !evidence) return null;
    const selection = selectionFor(source), inventory = activeTiles(id, source);
    // An expired retry can enter MapLibre's out-of-view cache and fail there.
    // Reusing that object emits no new error event. Keep weak identity evidence,
    // but restore presentation only while the same unresolved tile is active.
    if (evidence && stationSource(map.getZoom?.()) === id) for (const tile of inventory || []) {
      if (!evidence.tiles.has(tile)) continue;
      if (tile.aborted || ['loaded', 'unloaded'].includes(tile.state)) { evidence.tiles.delete(tile);continue; }
      const c = tile.tileID?.canonical;
      if (!validCoordinate(c) || !onScreen(c)) continue;
      if (!state) { state = {source, url: source.url, metadata: false, tiles: new Map()};failed.set(id, state); }
      const key = tileKey(c), previous = state.tiles.get(key);
      const instances = [...new Set([...(previous?.instances || (previous?.tile ? [previous.tile] : [])), tile])];
      state.tiles.set(key, {coordinate: {...c}, fromCoordinate: true, selection: `${id}:${c.z}`,
        ...previous, tile: instances[0], instances});
    }
    if (!state) return null;
    for (const [key, record] of state.tiles) {
      if (record.instances) {
        record.instances = record.instances.filter(tile => (!inventory || inventory.includes(tile)) &&
          !tile.aborted && !['loaded', 'unloaded'].includes(tile.state));
        record.tile = record.instances[0];
        if (!record.instances.length) { state.tiles.delete(key); continue; }
      }
      const zoom = map.getZoom?.();
      const inactive = record.fromCoordinate && Number.isFinite(zoom) && stationSource(zoom) !== id;
      const obsolete = inactive || (record.fromCoordinate && inventory !== null
        ? !inventory.includes(record.tile)
        : !record.tile && record.selection !== null && selection !== null && record.selection !== selection);
      if (obsolete || record.tile?.aborted || ['unloaded', 'loaded'].includes(record.tile?.state) || !onScreen(record.coordinate)) state.tiles.delete(key);
    }
    if (!state.metadata && !state.tiles.size) { failed.delete(id); return null; }
    return state;
  }
  return {
    noteError(event) {
      if (!['stations', 'stationMed'].includes(event?.sourceId) || event.error?.name === 'AbortError') return;
      const c = coordinate(event);
      // An unlocated tile failure is not evidence of a whole-source outage.
      if (('tile' in event || 'coord' in event) && !validCoordinate(c)) return;
      const source = map.getSource(event.sourceId);
      if (!source) return;
      if (c) remember(event.sourceId, source, event.tile);
      const state = stateFor(event.sourceId) || {source, url: source.url, metadata: false, tiles: new Map()};
      if (c) {
        let tile = event.tile, instances;
        const fromCoordinate = !tile;
        const selection = `${event.sourceId}:${c.z}`;
        if (fromCoordinate) {
          const zoom = map.getZoom?.();
          if (Number.isFinite(zoom) && stationSource(zoom) !== event.sourceId) return true;
          const inventory = activeTiles(event.sourceId, source);
          if (inventory !== null) {
            // A delayed error for a removed parent must not be stamped with
            // the new camera selection. Prefer a failed world copy if present.
            const matches = inventory.filter(candidate => {
              const canonical = candidate.tileID?.canonical;
              return validCoordinate(canonical) && tileKey(canonical) === tileKey(c);
            });
            const eligible = matches.filter(candidate => !candidate.aborted && !['loaded', 'unloaded'].includes(candidate.state));
            const errored = eligible.filter(candidate => candidate.state === 'errored');
            instances = errored.length ? errored : eligible;
            tile = instances[0];
            if (!tile) return true;
          } else {
            const current = selectionFor(source);
            if (current !== null && current !== selection) return true;
          }
        }
        if (tile) {
          const previous = state.tiles.get(tileKey(c));
          // A new coordinate-only notification must also preserve failures
          // already retrying in expired/reloading states on other world copies.
          instances = [...new Set([...(previous?.instances || (previous?.tile ? [previous.tile] : [])), ...(instances || [tile])])];
          tile = instances[0];
          for (const instance of instances) remember(event.sourceId, source, instance);
        }
        state.tiles.set(tileKey(c), {coordinate: {...c}, tile, instances, fromCoordinate, selection});
      } else state.metadata = true;
      failed.set(event.sourceId, state);
      return true;
    },
    noteSourceData(event) {
      if (event?.tile && (event.tile.aborted || ['loaded', 'unloaded'].includes(event.tile.state)))
        observed.get(event.sourceId)?.tiles.delete(event.tile);
      const state = failed.get(event?.sourceId);
      if (!state) return false;
      let changed = false;
      const previousSize = state.tiles.size;
      if (state.metadata && event.sourceDataType === 'metadata') { state.metadata = false; changed = true; }
      // Native source-content updates can reload/remove healthy descendants
      // before bubbling here, without a tile or coordinate on the event.
      if (event.sourceDataType === 'content' && state.tiles.size) changed = true;
      const c = coordinate(event);
      if (validCoordinate(c) && event.tile?.state === 'loaded') {
        const record = state.tiles.get(tileKey(c));
        // An unrelated healthy wrapped copy cannot clear active failed copies.
        if (record?.instances) {
          const previous = record.instances.length;
          record.instances = record.instances.filter(tile => tile !== event.tile);
          changed = record.instances.length !== previous || changed;
        } else changed = state.tiles.delete(tileKey(c)) || changed;
      }
      // Descendant lifecycle events can add OR remove healthy coverage without
      // settling the failed ancestor. Refresh even after removal from inventory:
      // the already-installed filter can still contain that child's old hole.
      if (validCoordinate(c) && event.tile)
        changed = [...state.tiles.values()].some(record => descendant(c, record.coordinate) &&
          record.instances?.some(tile => sameWorld(tile, event.tile))) || changed;
      return !stateFor(event.sourceId) || changed || state.tiles.size !== previousSize;
    },
    area(zoom) {
      const id = stationSource(zoom), state = id && stateFor(id);
      if (!state) return null;
      if (state.metadata) return true;
      const records = [...state.tiles.values()];
      const area = {type: 'MultiPolygon', coordinates: records.map(record => tilePolygon(record.coordinate))};
      const healthy = (activeTiles(id, state.source) || []).filter(tile => tile.state === 'loaded' && !tile.aborted);
      const masks = records.flatMap(record => (record.instances || [record.tile]).map(tile => ({
        failed: {type: 'Polygon', coordinates: tilePolygon(record.coordinate)},
        covered: {type: 'MultiPolygon', coordinates: healthy.filter(candidate =>
          sameWorld(tile, candidate) && descendant(candidate.tileID?.canonical, record.coordinate))
          .map(candidate => tilePolygon(candidate.tileID.canonical))},
      })));
      // MapLibre retains failed ancestors while looking for replacement data.
      // Their rectangles must not add fallback over a healthy finer tile.
      // Keep masks per failed instance: another world's success cannot erase
      // this world's failure, and a finer failure remains independently visible.
      if (masks.some(mask => mask.covered.coordinates.length)) area.tileMasks = masks;
      return area;
    },
    hasSourceFailure: id => Boolean(stateFor(id)),
  };
}

export function stationFallbackFilter(id, area) {
  const base = id === STATION_FALLBACK_IDS[1] ? CURATED_STATION_FILTER : STATION_BASEMAP_POI_FILTER;
  // Use boolean geometry instead of subdividing rectangles: `within` excludes
  // polygon boundaries, so subdivision would introduce gaps along new seams.
  const mask = area?.tileMasks ? ['any', ...area.tileMasks.map(({failed, covered}) =>
    covered.coordinates.length ? ['all', ['within', failed], ['!', ['within', covered]]] : ['within', failed])]
    : area ? ['within', area] : ['literal', false];
  return area === true ? base : ['all', base, mask];
}

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
      minzoom: 7, filter: CURATED_STATION_FILTER,
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
  const requiredSource=stationSource(zoom);
  return Boolean(requiredSource && stationsEnabled && background!=='satellite' &&
    failedSources?.has?.(requiredSource)===true);
}
export function stationFallbackNamesEnabled(options) {
  return options.zoom>=8 && stationFallbackMarkersEnabled(options);
}

export function shouldRefreshCuratedStationSource({ready,stationsEnabled,background,zoom}) {
  // The camera's raw maximum zoom depends on the More detail setting.
  // Curated geometry remains reusable at every zoom once activated at z3.
  return Boolean(ready && stationsEnabled && background!=='satellite' &&
    Number.isFinite(zoom) && zoom>=3);
}
