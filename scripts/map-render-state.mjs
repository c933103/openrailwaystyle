// Failure-only observations: no repaint, source mutation or settlement retry.
// Self-contained so Playwright can serialize this function into the page;
// tests can pass a map double without importing the browser application.
export async function captureMapRenderState(map) {
  if (!map) ({map} = await import(document.querySelector('script[type="module"]').src));
  const unavailable = [];
  const read = (label, observe) => {
    try {
      const value = observe();
      if (value !== undefined && value !== null) return value;
    } catch {}
    unavailable.push(label);
    return null;
  };
  const canvas = read('canvas', () => map.getCanvas());
  const container = read('container', () => map.getContainer());
  const sources = read('sourceIds', () => Object.keys(map.getStyle().sources));
  const sourceState = {};
  // Public source IDs/load state remain useful when renderer internals change.
  for (const id of (sources || []).slice(0, 200)) {
    sourceState[id] = {loaded: read(`source:${id}:loaded`, () => map.isSourceLoaded(id))};
    // MapLibre 5.24 replaced sourceCaches/_tiles with tileManagers/InViewTiles.
    // Optional, bounded detail must never erase the public observations above.
    sourceState[id].tiles = read(`source:${id}:tiles`, () => {
      const tiles = map.style?.tileManagers?.[id]?._inViewTiles?.getAllTiles();
      if (!Array.isArray(tiles)) return null;
      const states = {};
      for (const tile of tiles.slice(0, 2000)) {
        const state = ['loading', 'loaded', 'errored', 'unloaded', 'expired', 'reloading'].includes(tile?.state) ? tile.state : 'unknown';
        states[state] = (states[state] || 0) + 1;
      }
      return {states, total: tiles.length, truncated: tiles.length > 2000};
    });
  }
  return {
    loaded: read('loaded', () => map.loaded()),
    tilesLoaded: read('tilesLoaded', () => map.areTilesLoaded()),
    moving: read('moving', () => map.isMoving()),
    zoom: read('zoom', () => map.getZoom()),
    canvas: {
      width: read('canvas.width', () => canvas.width),
      height: read('canvas.height', () => canvas.height),
      clientWidth: read('container.clientWidth', () => container.clientWidth),
      clientHeight: read('container.clientHeight', () => container.clientHeight),
      pixelRatio: read('pixelRatio', () => map.getPixelRatio()),
    },
    renderer: {
      styleDirty: read('styleDirty', () => map._styleDirty),
      sourcesDirty: read('sourcesDirty', () => map._sourcesDirty),
      placementDirty: read('placementDirty', () => map._placementDirty),
      frameScheduled: read('frameScheduled', () => '_frameRequest' in map ? Boolean(map._frameRequest) : null),
      repaint: read('repaint', () => map._repaint),
      contextLost: read('contextLost', () => map.painter?.context?.gl?.isContextLost()),
      drawingBufferWidth: read('drawingBufferWidth', () => map.painter?.context?.gl?.drawingBufferWidth),
      drawingBufferHeight: read('drawingBufferHeight', () => map.painter?.context?.gl?.drawingBufferHeight),
    },
    sources: sourceState,
    sourcesTruncated: Boolean(sources && sources.length > 200),
    unavailable,
  };
}

export async function readMapRenderState(page, timeout = 5000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => page.evaluate(captureMapRenderState)).catch(() => ({unavailable: ['page evaluation']})),
      new Promise(resolve => { timer = setTimeout(() => resolve({unavailable: ['page evaluation timed out'], timeout}), timeout); }),
    ]);
  } finally { clearTimeout(timer); }
}
