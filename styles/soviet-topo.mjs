import {gridSize, series} from './soviet-coverage.mjs?v=20261127-board-event-1';

const empty = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const transparent = () => ({data: empty.slice().buffer});
const attribution = '<a href="https://github.com/ramSeraph/russian_world_topo_maps">Indian Open Maps</a> · Vlasenko, Mapstor Archive, Genshtab scans on the Internet Archive, Satmaps, University of Wisconsin–Milwaukee Libraries, State Library of Western Australia · reproduced with permission from <a href="http://redatlasbook.com">redatlasbook.com</a>';
const coverage = new Map(Object.entries(series).map(([scale, entry]) => [scale, atob(entry.cells)]));
const unitY = lat => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2;
const unitX = lon => (lon + 180) / 360;

function hasCoverage(scale, x, y, n) {
  const cells = coverage.get(scale);
  for (let row = Math.floor(y * gridSize / n); row < Math.ceil((y + 1) * gridSize / n); row++) {
    for (let col = Math.floor(x * gridSize / n); col < Math.ceil((x + 1) * gridSize / n); col++) {
      const cell = row * gridSize + col;
      if (cells.charCodeAt(cell >> 3) & (1 << (cell & 7))) return true;
    }
  }
  return false;
}

// Mosaics can include a later edition adjacent to a Soviet sheet. Clip those
// footprints at tile edges without erasing dated sheets on the same tile.
function excludedAreas(entry, x, y, n) {
  return entry.excluded.map(([west, south, east, north]) => [
    Math.max(0, unitX(west) * n - x), Math.max(0, unitY(north) * n - y),
    Math.min(1, unitX(east) * n - x), Math.min(1, unitY(south) * n - y),
  ]).filter(([l, t, r, b]) => r > l && b > t);
}

export async function sovietTile({url}, {signal}, fetcher = fetch) {
  const match = /^atlassoviet:\/\/(1m|500k|200k|100k|50k|25k)\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
  if (!match) throw new Error('Invalid historical tile');
  const [,scale] = match;
  const [z, x, y] = match.slice(2).map(Number);
  const n = 2 ** z, entry = series[scale];
  if (z > entry.maxzoom || x >= n || y >= n) throw new Error('Invalid historical tile coordinates');
  if (!hasCoverage(scale, x, y, n)) return transparent();
  const masks = excludedAreas(entry, x, y, n);
  if (masks.some(([l,t,r,b]) => l === 0 && t === 0 && r === 1 && b === 1)) return transparent();
  const response = await fetcher(`https://indianopenmaps.com/world/topo/russian/${scale}/gs/${z}/${x}/${y}.webp`, {signal, credentials:'omit'});
  if (response.status === 404 || response.status === 204) return transparent();
  if (!response.ok) throw new Error(`Historical tile service returned ${response.status}`);
  const cacheControl = response.headers.get('Cache-Control');
  if (!masks.length) return {data: await response.arrayBuffer(), cacheControl};
  const bitmap = await createImageBitmap(await response.blob());
  try {
    signal.throwIfAborted();
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    for (const [l,t,r,b] of masks) {
      const left = Math.floor(l * canvas.width), top = Math.floor(t * canvas.height);
      ctx.clearRect(left, top, Math.ceil(r * canvas.width) - left, Math.ceil(b * canvas.height) - top);
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return {data: await blob.arrayBuffer(), cacheControl};
  } finally { bitmap.close(); }
}

export function installSovietStyle(style) {
  // Existing basemap and bathymetry stay below scan pixels. Rail and station
  // layers and localized place names remain above them.
  const firstRail = style.layers.findIndex(layer => layer.metadata?.['atlas:group'] === 'railway');
  if (firstRail < 0) return;
  for (const layer of style.layers.slice(firstRail)) {
    if (layer.metadata?.['atlas:base-map'] && (layer.type !== 'symbol' || !layer.metadata['atlas:localize'])) {
      layer.metadata = {...layer.metadata, 'atlas:hide-backgrounds':[...(layer.metadata['atlas:hide-backgrounds'] || []), 'soviet']};
    }
  }
  const layers = [];
  for (const [key, entry] of Object.entries(series)) {
    const id = 'soviet-' + key;
    style.sources[id] = {type:'raster', tileSize:256, maxzoom:entry.maxzoom, bounds:entry.bounds,
      tiles:[`atlassoviet://${key}/{z}/{x}/{y}`], attribution};
    layers.push({id, type:'raster', source:id, layout:{visibility:'none'}, paint:{'raster-fade-duration':0},
      metadata:{'atlas:semantics-version':1, 'atlas:background':'soviet'}});
  }
  style.layers.splice(firstRail, 0, ...layers);
}
