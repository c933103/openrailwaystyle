// Track-count label points for one tile of the track-count source; runs in
// a worker (track-worker.mjs).
// - Counts are always made on railway tiles of COUNT_ZOOM, whatever zoom is
//   shown, so a place gives the same number at every zoom: the source's
//   zoom-13 tiles are the four zoom-14 results put together, and MapLibre
//   enlarges zoom-14 tiles beyond.
// - The tile's eight neighbours are read too, so tracks near its edges are
//   counted with the tracks beside them; each way's pieces from the nine
//   tiles are joined by its ID.
// - No labels in stations: inside the provider's station areas (the extent
//   of each group of station elements, whatever the station's size), as
//   tracks there spread around platforms, and the count either side tells
//   more. An area holding only subway stations leaves surface tracks
//   labelled (a subway station can lie beneath a surface line). Where a
//   station has no area, BARE_STATION metres around its point are left.
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {countTracks, trackLines, unitMetres} from './track-count.mjs';
export const COUNT_LAYER = 'atlas_track_counts';
export const COUNT_ZOOM = 14;
const BARE_STATION = 100;   // metres around a station point with no area
const DOMINATED = 60;       // metres: a smaller group's label this near a larger group's is left out
const REPEAT = 200;         // metres: a label repeating a count this near is left out

const read = data => data?.byteLength ? new VectorTile(new Pbf(new Uint8Array(data))) : null;
const layersOf = tile => tile ? Object.values(tile.layers) : [];

// Station areas (rings, and whether they hold a surface station) and the
// station points outside every area, in the tile's units (extent). areas:
// the station-area tile of this tile; stations: its station tile.
const insideRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
function stationZones(areas, stations, extent) {
  const points = [], zones = [];
  for (const layer of layersOf(read(stations))) {
    const scale = extent / layer.extent;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i), p = f.properties;
      // Tram stops are frequent and seldom mapped as station areas: left out.
      if (f.type !== 1 || (p.state && p.state !== 'present') || /tram/.test(`${p.feature} ${p.station}`)) continue;
      for (const ring of f.loadGeometry()) for (const q of ring) points.push({x: q.x * scale, y: q.y * scale, subway: p.station === 'subway'});
    }
  }
  for (const layer of layersOf(read(areas))) {
    const scale = extent / layer.extent;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      const rings = f.loadGeometry().map(ring => ring.map(q => [q.x * scale, q.y * scale]));
      const inside = (x, y) => rings.reduce((n, ring) => n + (insideRing(x, y, ring) ? 1 : 0), 0) % 2 === 1;
      const held = points.filter(p => inside(p.x, p.y));
      for (const p of held) p.inArea = true;
      // Without a station point in this tile, taken as holding a surface one.
      zones.push({inside, surface: !held.length || held.some(p => !p.subway)});
    }
  }
  return {zones, bare: points.filter(p => !p.inArea)};
}

// tiles: [{dx, dy, data}], the railway tile at (x, y) of COUNT_ZOOM (dx = dy
// = 0) and those around it; y: its row (for the scale); areas, stations:
// its station-area and station tiles. Returns {extent, points: [{x, y,
// tracks, tunnel}]} in the tile's units.
export function countTile({tiles, areas = null, stations = null}, y) {
  const centre = tiles.find(t => !t.dx && !t.dy);
  const extent = layersOf(read(centre?.data))[0]?.extent || 4096;
  const byId = new Map(), lines = [];
  for (const {dx, dy, data} of tiles) for (const layer of layersOf(read(data))) {
    const features = Array.from({length: layer.length}, (_, i) => layer.feature(i)), scale = extent / layer.extent;
    trackLines(features).forEach((line, i) => {
      if (!line) return;
      const parts = line.parts.map(part => part.map(([px, py]) => [(dx * layer.extent + px) * scale, (dy * layer.extent + py) * scale]));
      const id = features[i].properties.id ?? features[i].id;
      const known = id != null && byId.get(id);
      if (known) { known.parts.push(...parts); return; }
      const merged = {...line, parts, inside: false};
      if (id != null) byId.set(id, merged);
      lines.push(merged);
    });
  }
  for (const line of lines) line.inside = line.parts.some(part => part.some(([px, py]) => px >= 0 && py >= 0 && px < extent && py < extent));
  const metres = unitMetres(COUNT_ZOOM, y, extent);
  const {points} = countTracks(lines, metres, {probe: i => lines[i].inside});
  const {zones, bare} = stationZones(areas, stations, extent), radius = BARE_STATION / metres, dominated = DOMINATED / metres, repeat = REPEAT / metres;
  return {extent, points: points.filter(p => {
    if (p.x < 0 || p.y < 0 || p.x >= extent || p.y >= extent) return false;
    const tunnel = p.group.endsWith('-tunnel');
    return !zones.some(zone => (tunnel || zone.surface) && zone.inside(p.x, p.y)) &&
      !bare.some(st => (tunnel || !st.subway) && Math.hypot(p.x - st.x, p.y - st.y) <= radius);
  })
    .map(p => ({x: p.x, y: p.y, tracks: p.tracks, tunnel: p.group.endsWith('-tunnel')}))
    // Where two groups run close by (a track a little further off than the
    // gap allows), the smaller one's label would read as a separate line:
    // only the larger is labelled there.
    .filter((p, _, all) => !all.some(q => q.tunnel === p.tunnel && q.tracks > p.tracks && Math.hypot(q.x - p.x, q.y - p.y) <= dominated))
    // The same count again close by (short ways in loops and junctions each
    // give one) adds nothing: the first is kept.
    .filter((p, k, all) => !all.slice(0, k).some(q => q.tunnel === p.tunnel && q.tracks === p.tracks && Math.hypot(q.x - p.x, q.y - p.y) <= repeat))};
}
