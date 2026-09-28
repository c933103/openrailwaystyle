// Adds atlas_tracks (running tracks side by side, for the details panel)
// to railway tile lines, and a layer of label points, atlas_track_counts
// ({tracks, tunnel}), once per bundle and stretch; runs in a worker
// (track-worker.mjs). stations: [{x, y, radius}], x and y as fractions of
// the tile, radius in metres: no labels there, as tracks through a station
// spread around platforms and sidings, and the count either side of it
// tells more.
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import encode from 'vt-pbf';
import {countTracks, trackLines, unitMetres, MIN_ZOOM} from './track-count.mjs';
export const COUNT_LAYER = 'atlas_track_counts';
export function annotateTracks(data, z, y, stations = []) {
  if (z < MIN_ZOOM || !data?.byteLength) return data;
  const tile = new VectorTile(new Pbf(new Uint8Array(data)));
  const layers = {...tile.layers};
  for (const layer of Object.values(tile.layers)) {
    const features = Array.from({length: layer.length}, (_, i) => layer.feature(i));
    layer.feature = i => features[i];
    const lines = trackLines(features), index = [], input = [];
    lines.forEach((line, i) => { if (line) { index.push(i); input.push(line); } });
    if (!input.length) continue;
    const metres = unitMetres(z, y, layer.extent), {lines: counted, points} = countTracks(input, metres);
    counted.forEach(({tracks}, k) => { if (tracks) features[index[k]].properties.atlas_tracks = tracks; });
    // Points in the tile's buffer belong to the neighbouring tile.
    const inside = points.filter(p => p.x >= 0 && p.y >= 0 && p.x < layer.extent && p.y < layer.extent &&
      !stations.some(st => Math.hypot(p.x - st.x * layer.extent, p.y - st.y * layer.extent) * metres < st.radius));
    if (inside.length && !layers[COUNT_LAYER]) layers[COUNT_LAYER] = {
      name: COUNT_LAYER, version: 2, extent: layer.extent, length: inside.length,
      feature: i => ({type: 1, properties: {tracks: inside[i].tracks, ...(inside[i].group.endsWith('-tunnel') && {tunnel: true})},
        loadGeometry: () => [[{x: Math.round(inside[i].x), y: Math.round(inside[i].y)}]]}),
    };
  }
  const result = encode({layers});
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
}
