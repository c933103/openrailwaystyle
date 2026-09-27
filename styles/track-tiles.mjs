// Adds atlas_tracks (tracks side by side) and atlas_tracks_label to railway
// tiles; runs in a worker (track-worker.mjs).
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import encode from 'vt-pbf';
import {countTracks, trackLines, unitMetres, MIN_ZOOM} from './track-count.mjs';
export function annotateTracks(data, z, y) {
  if (z < MIN_ZOOM || !data?.byteLength) return data;
  const tile = new VectorTile(new Pbf(new Uint8Array(data)));
  for (const layer of Object.values(tile.layers)) {
    const features = Array.from({length: layer.length}, (_, i) => layer.feature(i));
    layer.feature = i => features[i];
    const lines = trackLines(features), index = [], input = [];
    lines.forEach((line, i) => { if (line) { index.push(i); input.push(line); } });
    countTracks(input, unitMetres(z, y, layer.extent)).forEach(({tracks, label}, k) => {
      Object.assign(features[index[k]].properties, {atlas_tracks: tracks, atlas_tracks_label: label});
    });
  }
  const result = encode(tile);
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
}
