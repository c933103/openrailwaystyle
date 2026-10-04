// Draws the sea depth tiles (bathymetry.mjs) off the page's main thread:
// decoding the basemap's water polygons, colouring the depths and encoding
// the PNG. The page only fetches the tiles and hands them over.
// Messages: {id, key, water} → {id, ocean} (whether the tile holds any sea;
// its polygons are kept for the paint that follows), {id, key, heights,
// tile} → {id, data} (the PNG), {key, drop: true} (a tile no longer wanted).
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {colourPixels, oceanPolygons, maskOcean, encodePng} from './bathymetry.mjs';

// Active masks belong to individual tile requests. Paint or cancellation
// releases them; an insertion-order cache limit must not evict live work.
const polygons = new Map();
self.onmessage = async ({data: message}) => {
  const {id, key} = message;
  if (message.drop) { polygons.delete(key); return; }
  try {
    if (message.water) {
      const found = message.water.byteLength ? oceanPolygons(new VectorTile(new Pbf(new Uint8Array(message.water)))) : [];
      if (found.length) polygons.set(key, found);
      self.postMessage({id, ocean: found.length > 0});
      return;
    }
    const found = polygons.get(key);
    polygons.delete(key);
    if (!found) throw new Error('Depth tile without water polygons');
    const image = new OffscreenCanvas(256, 256), context = image.getContext('2d');
    context.putImageData(new ImageData(colourPixels(message.heights, message.tile), 256, 256), 0, 0);
    maskOcean(context, found, 256);
    const data = await encodePng(image);
    self.postMessage({id, data}, [data]);
  } catch (error) {
    self.postMessage({id, error: error?.message || String(error)});
  }
};
