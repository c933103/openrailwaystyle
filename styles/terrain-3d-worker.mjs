// Worker-only rendering of combined land and seabed elevations into the
// MapLibre raster-dem Terrarium format. The basemap water polygon holes are
// preserved, and malformed heights fail rather than becoming flat ground.
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {oceanMask, composeTerrainHeights, encodeTerrainPng} from './terrain-3d.mjs';

self.onmessage = async ({data: message}) => {
  const {id, fine, coarse, tile, water} = message;
  try {
    const mask = water?.byteLength
      ? oceanMask(new VectorTile(new Pbf(new Uint8Array(water))))
      : null;
    const data = await encodeTerrainPng(composeTerrainHeights(fine, coarse, tile, mask));
    self.postMessage({id, data}, [data]);
  } catch (error) {
    self.postMessage({id, error: error?.message || String(error)});
  }
};
