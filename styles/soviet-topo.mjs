import {getLayerSemantics} from './layer-semantics.mjs?v=20261119-soviet-sheet-preview-1';

export const SOVIET_SOURCE = 'soviet-topo';

export function sovietPreviewAllowed(href) {
  let url;
  try { url = new URL(href); } catch { return false; }
  return ['http:', 'https:'].includes(url.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && url.searchParams.get('sovietPreview') === '1';
}

function validSheet(sheet) {
  const {bounds, source, scale} = sheet ?? {};
  if (!['id', 'name', 'date', 'credit', 'alignment'].every(key => typeof sheet?.[key] === 'string' && sheet[key].trim())
      || !Number.isInteger(scale) || scale <= 0 || !Array.isArray(bounds) || bounds.length !== 4
      || !bounds.every(Number.isFinite) || typeof source !== 'string') return false;
  const [west, south, east, north] = bounds;
  if (west < -180 || east > 180 || south < -85.051129 || north > 85.051129 || west >= east || south >= north) return false;
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

export async function loadSovietPreview({href, dataRoot, fetcher, createArchive}) {
  if (!sovietPreviewAllowed(href)) return null;
  try {
    const response = await fetcher(new URL('index.json', dataRoot), {redirect: 'error', signal: AbortSignal.timeout(6000)});
    if (!response.ok) return null;
    const config = await response.json();
    if (config.version !== 1 || typeof config.archive !== 'string' || !/^[a-f0-9]{64}\.pmtiles$/.test(config.archive)
        || !Array.isArray(config.sheets) || !config.sheets.length || !config.sheets.every(validSheet)) return null;
    const url = new URL(config.archive, dataRoot).href;
    const archive = createArchive(url);
    const header = await archive.getHeader();
    if (header.tileType !== 2 || !Number.isInteger(header.minZoom) || !Number.isInteger(header.maxZoom)
        || header.minZoom < 0 || header.minZoom > header.maxZoom || header.maxZoom > 13) return null;
    return {url, archive, sheets: config.sheets};
  } catch { return null; }
}

const escapeHTML = value => value.replace(/[&<>"']/g, character => (
  {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]
));

export function installSovietPreview(style, preview) {
  const bathymetry = style.layers.findIndex(layer => layer.id === 'terrain-bathymetry');
  // Place the raster above opaque basemap fills and below the first energy,
  // rail or station overlay. Those overlays and localized labels keep their order.
  const overlays = style.layers.findIndex(layer => layer.id === 'energy-overview-areas');
  if (bathymetry < 0 || overlays <= bathymetry || style.sources[SOVIET_SOURCE]) return false;
  for (const layer of style.layers.slice(overlays)) {
    const semantics = getLayerSemantics(layer);
    if (!semantics['atlas:terrain']) continue;
    // The modern seabed raster remains underneath the scan. Modern contours
    // and their labels must not cover contours or soundings printed on it.
    layer.metadata = {...semantics, 'atlas:hide-backgrounds': [...(semantics['atlas:hide-backgrounds'] || []), 'soviet']};
  }
  const credits = [...new Set(preview.sheets.map(sheet => (
    `<a href="${escapeHTML(sheet.source)}">${escapeHTML(sheet.credit)}</a>`
  )))].join(' · ');
  style.sources[SOVIET_SOURCE] = {
    type: 'raster', url: `pmtiles://${preview.url}`, tileSize: 256,
    attribution: `Historical Soviet military topographic maps · ${credits}`,
  };
  style.layers.splice(overlays, 0, {
    id: SOVIET_SOURCE, type: 'raster', source: SOVIET_SOURCE,
    metadata: {'atlas:semantics-version': 1, 'atlas:background': 'soviet'},
    paint: {'raster-fade-duration': 0, 'raster-resampling': 'linear'},
  });
  return true;
}

export function sovietCoverage(preview, lng, lat) {
  const longitude = ((lng + 180) % 360 + 360) % 360 - 180;
  return preview.sheets.find(({bounds: [west, south, east, north]}) =>
    longitude >= west && longitude <= east && lat >= south && lat <= north);
}
