import {getLayerSemantics} from './layer-semantics.mjs?v=20261119-soviet-sheet-preview-2';

export const SOVIET_SOURCE = 'soviet-topo';
export const isSovietSource = id => id === SOVIET_SOURCE || id?.startsWith(`${SOVIET_SOURCE}-`);
const SCHEME = 'atlassoviet://';
const TRANSPARENT = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));

export function installSovietProtocol(maplibre, load) {
  maplibre.addProtocol('atlassoviet', async (params, controller) => {
    const result = await load({...params, url: `pmtiles://${params.url.slice(SCHEME.length)}`}, controller);
    if (params.type === 'json') {
      const tiles = result.data.tiles.map(url => url.replace(/^pmtiles:\/\//, SCHEME));
      return {...result, data: {...result.data, tiles}};
    }
    // MapLibre's image queue needs decodable bytes to finish a request.
    // PMTiles returns null where an archive has no raster tile at all.
    return result.data === null ? {...result, data: TRANSPARENT.slice()} : result;
  });
}

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
    // Items are ordered from the overview to finer scales. Each scale keeps its
    // own source maxzoom, so the browser can overzoom a coarse sheet at a gap.
    const groups = config.version === 2 ? config.groups : config.version === 1
      ? [{archives: [config.archive], sheets: config.sheets}] : null;
    if (!Array.isArray(groups) || !groups.length || !groups.every(group =>
      Array.isArray(group?.archives) && group.archives.length && group.archives.every(name =>
        typeof name === 'string' && /^[a-f0-9]{64}\.pmtiles$/.test(name))
      && Array.isArray(group.sheets) && group.sheets.length && group.sheets.every(validSheet))) return null;
    const filenames = groups.flatMap(group => group.archives);
    if (filenames.length !== new Set(filenames).size) return null;
    const archives = await Promise.all(filenames.map(async name => {
      const url = new URL(name, dataRoot).href, archive = createArchive(url);
      const header = await archive.getHeader();
      // Both formats preserve alpha at cutlines and around sparse coverage.
      if (![2, 4].includes(header.tileType) || !Number.isInteger(header.minZoom) || !Number.isInteger(header.maxZoom)
          || header.minZoom < 0 || header.minZoom > header.maxZoom || header.maxZoom > 13)
        throw new Error('Invalid historical raster archive');
      return {url, archive};
    }));
    return {archives, sheets: groups.flatMap(group => group.sheets)};
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
  const layers = preview.archives.map(({url}, index) => {
    const id = index ? `${SOVIET_SOURCE}-${index}` : SOVIET_SOURCE;
    style.sources[id] = {
      type: 'raster', url: `${SCHEME}${url}`, tileSize: 256,
      attribution: `Historical Soviet military topographic maps · ${credits}`,
    };
    return {
      id, type: 'raster', source: id,
      metadata: {'atlas:semantics-version': 1, 'atlas:background': 'soviet'},
      paint: {'raster-fade-duration': 0, 'raster-resampling': 'linear'},
    };
  });
  style.layers.splice(overlays, 0, ...layers);
  return true;
}

export function sovietCoverage(preview, lng, lat, tileZoom = Infinity) {
  const longitude = ((lng + 180) % 360 + 360) % 360 - 180;
  let best;
  for (const sheet of preview.sheets) {
    const [west, south, east, north] = sheet.bounds;
    const withinLongitude = (longitude >= west && longitude <= east) || (longitude === -180 && east === 180);
    if (tileZoom < (sheet.minzoom ?? 0) || lat < south || lat > north || !withinLongitude) continue;
    if (!best || sheet.scale <= best.scale) best = sheet;
  }
  return best;
}
