import {flatVectorTile} from './flat-vector.mjs';

const tiledTypes = new Set(['vector', 'raster', 'raster-dem']);
const fields = ['tiles', 'minzoom', 'maxzoom', 'tileSize', 'bounds', 'scheme', 'attribution', 'encoding'];
const http = url => /^https?:\/\//i.test(url);
const scheme = url => /^[a-z][a-z0-9+.-]*:\/\//i.test(url);

function absoluteTemplate(template, base) {
  if (scheme(template)) return template;
  if (!http(base)) throw new Error('Tile provider must return absolute templates');
  // URL escapes literal braces in paths, but the addressing tokens must remain
  // available until the tile coordinate is known.
  let prefix = '__atlas_tile_field_';
  while (template.includes(prefix) || base.includes(prefix)) prefix += '_';
  const fields = [];
  const marked = template.replace(/\{[^{}]+\}/g, field => prefix + (fields.push(field) - 1) + '__');
  return new URL(marked, base).href.replace(new RegExp(prefix + '(\\d+)__', 'g'), (_, i) => fields[Number(i)]);
}

export function flatTileURL(source, {z,x,y}, {pixelRatio = 1} = {}) {
  const n = 2 ** z;
  if (!Number.isInteger(z) || z < 0 || z > 26 || !Number.isInteger(x) ||
      !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n)
    throw new RangeError('Invalid flat tile coordinates');
  const template = source.tiles[(x+y) % source.tiles.length];
  const reversedY = n-1-y;
  const halfWorld = Math.PI * 6378137;
  const resolution = 2 * halfWorld / n;
  const merc = value => value * resolution - halfWorld;
  let quadkey = '';
  for (let bit = 2 ** (z-1); bit >= 1; bit >>= 1)
    quadkey += (x & bit ? 1 : 0) + (y & bit ? 2 : 0);
  const values = {
    z,x,y:source.scheme === 'tms' ? reversedY : y,ratio:pixelRatio > 1 ? '@2x' : '',
    prefix:(x % 16).toString(16)+(y % 16).toString(16),quadkey,
    'bbox-epsg-3857':[merc(x),merc(reversedY),merc(x+1),merc(reversedY+1)].join(','),
  };
  return template.replace(/\{([^{}]+)\}/g, (_, key) => {
    if (!Object.hasOwn(values,key)) throw new Error('Unsupported tile template field: '+key);
    return String(values[key]);
  });
}

// All custom schemes pass through the app's existing registry. In particular
// a PMTiles archive URL is metadata, not an implied tile URL or HTTP endpoint.
export function createFlatSourceLoader({protocols, fetcher = fetch, decodeRaster = bytes => createImageBitmap(new Blob([bytes]))}) {
  const request = async (url, type, controller) => {
    controller.signal.throwIfAborted();
    if (!http(url)) {
      const result = await protocols.read({url,type},controller);
      controller.signal.throwIfAborted();
      if (result?.data == null) throw new Error('Tile provider did not return '+type);
      return {data:result.data,url};
    }
    const result = await fetcher(url,{signal:controller.signal});
    if (!result.ok) throw new Error('Tile '+type+' returned '+result.status);
    const data = await (type === 'json' ? result.json() : result.arrayBuffer());
    controller.signal.throwIfAborted();
    return {data,url:result.url || url};
  };

  return {
    async resolve(source, {baseURL, controller}) {
      if (!tiledTypes.has(source.type)) throw new Error('Not a tiled Canvas source');
      const styleBase = String(baseURL);
      const target = source.url == null ? null : scheme(source.url) ? source.url : new URL(source.url,styleBase).href;
      const metadata = target ? await request(target,'json',controller) : {data:{},url:styleBase};
      if (!metadata.data || typeof metadata.data !== 'object' || Array.isArray(metadata.data))
        throw new Error('Invalid tile metadata');
      const selected = {type:source.type};
      for (const key of fields) {
        const value = source[key] ?? metadata.data[key];
        if (value != null) selected[key] = value;
      }
      if (!Array.isArray(selected.tiles) || !selected.tiles.length || selected.tiles.some(t => typeof t !== 'string' || !t))
        throw new Error('Tile source has no usable templates');
      if (selected.scheme && !['xyz','tms'].includes(selected.scheme)) throw new Error('Unsupported tile scheme');
      selected.tiles = selected.tiles.map(t => absoluteTemplate(t,source.tiles != null ? styleBase : metadata.url));
      return selected;
    },
    async load(source, tile, {controller, pixelRatio}) {
      const {data} = await request(flatTileURL(source,tile,{pixelRatio}),'arrayBuffer',controller);
      if (source.type === 'vector') return {vector:flatVectorTile(data)};
      const image = await decodeRaster(data);
      if (controller.signal.aborted) {
        image.close?.();
        controller.signal.throwIfAborted();
      }
      return {image};
    },
  };
}
