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
    const catalogue = new URL('index.json', dataRoot);
    const response = await fetcher(catalogue, {redirect: 'error', signal: AbortSignal.timeout(6000)});
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
    return {archives, catalogue, sheets: groups.flatMap(group => group.sheets)};
  } catch { return null; }
}

// The first-party catalogue records the footprints of both historical series.
const XYZ_ROOT = 'soviet/';
const XYZ_SCHEME = 'atlassovietxyz://';
const XYZ_SERIES = [
  {key: '1m', scale: 1000000, maxZoom: 10, credit: 'Indian Open Maps · Petro Vlasenko and Mapstor Archive'},
  {key: '500k', scale: 500000, maxZoom: 11, credit: 'Indian Open Maps · Petro Vlasenko, Mapstor Archive and University of Wisconsin–Milwaukee Libraries'},
];

export async function loadSovietTiles({catalogue, fetcher, restrictedFetch}) {
  const get = async (url, request) => {
    const response = await request(url, {redirect: 'error', signal: AbortSignal.timeout(6000)});
    if (!response.ok) throw new Error(`Historical map metadata returned HTTP ${response.status}`);
    return response.json();
  };
  try {
    const [footprints, ...metadata] = await Promise.all([
      get(catalogue, fetcher), ...XYZ_SERIES.map(({key}) => get(`${XYZ_ROOT}${key}/tiles.json`, restrictedFetch)),
    ]);
    const sheets = [];
    const tileSources = XYZ_SERIES.map(({key, scale, maxZoom, credit}, i) => {
      const {minzoom, maxzoom} = metadata[i] ?? {};
      const template = `${XYZ_ROOT}${key}/{z}/{x}/{y}`;
      if (!Number.isInteger(minzoom) || !Number.isInteger(maxzoom) ||
          minzoom < 0 || maxzoom < minzoom || maxzoom > maxZoom) throw new Error('Unexpected historical tile configuration');
      const group = footprints?.[scale]?.map(([id, date, bounds]) => ({
        id, name: id, bounds, date: date === 'unknown' ? 'Date unknown' : `Catalogue date ${date}`,
        scale, source: `https://github.com/ramSeraph/russian_world_topo_maps/releases/tag/${key}-gs-pmtiles`,
        credit, alignment: 'Published catalogue footprint. Alignment accuracy varies.', minzoom,
      }));
      if (!group?.length || !group.every(validSheet)) throw new Error('Missing historical coverage catalogue');
      sheets.push(...group);
      return {key, template, minzoom, maxzoom, sheets: group};
    });
    return {catalogue, sheets, archives: [], tileSources};
  } catch { return null; }
}

export function installSovietXYZProtocol(maplibre, tileSources, fetcher) {
  const sources = new Map(tileSources.map(source => [source.key, source]));
  const tileLatitude = (row, n) => 180 / Math.PI * Math.atan(Math.sinh(Math.PI * (1 - 2 * row / n)));
  let retryAt = 0;
  maplibre.addProtocol('atlassovietxyz', async ({url}, controller) => {
    const match = /^(1m|500k)\/(\d+)\/(\d+)\/(\d+)$/.exec(url.slice(XYZ_SCHEME.length));
    if (!match || !sources.has(match[1])) throw new Error('Unexpected historical tile URL');
    const source = sources.get(match[1]);
    const [z, x, y] = match.slice(2).map(Number);
    const width = 2 ** z;
    if (z < source.minzoom || z > source.maxzoom || x >= width || y >= width) throw new Error('Invalid historical tile coordinates');
    const west = 360 * x / width - 180, east = 360 * (x + 1) / width - 180;
    const north = tileLatitude(y, width), south = tileLatitude(y + 1, width);
    if (!source.sheets.some(({bounds}) => bounds[2] > west && bounds[0] < east && bounds[3] > south && bounds[1] < north))
      return {data: TRANSPARENT.slice()};
    if (performance.now() < retryAt) throw new Error('Historical tile service asked the browser to pause');
    const target = source.template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    const response = await fetcher(target, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]), redirect: 'error'});
    if (response.status === 404) return {data: TRANSPARENT.slice()};
    if (response.status === 429 || response.status === 503) {
      const retry = response.headers.get('Retry-After')?.trim();
      const wait = /^\d+$/.test(retry ?? '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
      retryAt = Math.max(retryAt, performance.now() + (Number.isFinite(wait) && wait >= 0 ? wait : 30_000));
    }
    if (!response.ok || !/^image\/webp(?:;|$)/i.test(response.headers.get('Content-Type') ?? ''))
      throw new Error(`Historical tile could not load (HTTP ${response.status})`);
    return {data: await response.arrayBuffer()};
  });
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
  const credits = [...new Set(preview.sheets.map(sheet => (
    `<a href="${escapeHTML(sheet.source)}">${escapeHTML(sheet.credit)}</a>`
  )))].join(' · ');
  const definitions = preview.tileSources?.map(({key, minzoom, maxzoom}) => ({
    tiles: [`${XYZ_SCHEME}${key}/{z}/{x}/{y}`], minzoom, maxzoom,
  })) ?? preview.archives.map(({url}) => ({url: `${SCHEME}${url}`}));
  const layers = definitions.map((definition, index) => {
    const id = index ? `${SOVIET_SOURCE}-${index}` : SOVIET_SOURCE;
    style.sources[id] = {
      type: 'raster', ...definition, tileSize: 256,
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
