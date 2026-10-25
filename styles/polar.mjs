// The polar caps: the two circles within 4.95° (about 550 km) of the poles
// that Web Mercator tiles, and so MapLibre's sources, stop short of
// (85.051129°). Their map data is prepared separately
// (scripts/build-polar.mjs) in a polar azimuthal equidistant projection:
// x, y in kilometres from the pole, the distance from the pole true to
// scale. North: longitude 0° points down (−y); south: longitude 0° points
// up (+y). Drawn on the globe by polar-layer.mjs.
export const MERCATOR_LIMIT = 85.051129;
export const KM_PER_DEGREE = 6371.0088 * Math.PI / 180;
export const CAP_RADIUS = (90 - MERCATOR_LIMIT) * KM_PER_DEGREE; // ≈ 550.3 km
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
export function toPolar(cap, [lng, lat]) {
  const r = (cap === 'north' ? 90 - lat : 90 + lat) * KM_PER_DEGREE, a = rad(lng);
  return cap === 'north' ? [r * Math.sin(a), -r * Math.cos(a)] : [r * Math.sin(a), r * Math.cos(a)];
}
export function fromPolar(cap, [x, y]) {
  const r = Math.hypot(x, y), d = r / KM_PER_DEGREE;
  const lng = r ? deg(cap === 'north' ? Math.atan2(x, -y) : Math.atan2(x, y)) : 0;
  return [lng, cap === 'north' ? 90 - d : d - 90];
}
// Contours are prepared for three zoom bands, as elsewhere on the map
// (map-model.mjs): the coarsest below zoom 9, then 9–10, then from 11.
// Levels are [interval, emphasised interval]. Seabed contours below zoom 9
// are only drawn above −200 m (continental shelves), as on the rest of the map.
export const POLAR_BANDS = {
  metric: [
    {from: 0, land: [200, 1000], seabed: [50, 250], shelfOnly: true},
    {from: 9, land: [100, 500], seabed: [20, 100]},
    {from: 11, land: [50, 250], seabed: [10, 50]},
  ],
  imperial: [
    {from: 0, land: [500, 2500], seabed: [150, 750], shelfOnly: true},
    {from: 9, land: [250, 1000], seabed: [50, 250]},
    {from: 11, land: [100, 500], seabed: [25, 100]},
  ],
};
export const FEET = 3.28084;
export const bandFor = zoom => zoom >= 11 ? 2 : zoom >= 9 ? 1 : 0;
// Both drawn backgrounds follow the map's fine contour bands. Imagery
// keeps coarse/no-data caps; clamp for older snapshots with fewer bands.
export const polarBandFor = (zoom, background, count) =>
  Math.min(background === 'map' || background === 'carto' ? bandFor(zoom) : 0, count - 1);
export const POLAR_DETAIL_ZOOM = 10;
// Published detail polygons are clipped to a 4×4 grid and the 720-sided
// cap mask. Their closing cut edges are not original building outlines.
// Old snapshots cannot distinguish a genuine edge exactly on that mask;
// omit coincident edges conservatively rather than inventing a dark seam.
export function detailOutlineLines(polygons, bounds, quantum = 0.001) {
  const lines = [], tolerance = quantum / 2 + 1e-9, step = 2 * Math.PI / 720;
  const capDistance = CAP_RADIUS * Math.cos(step / 2);
  const innerSquared = (capDistance - quantum / Math.SQRT2 - 1e-9) ** 2;
  const cut = (a, b) => {
    if ([bounds[0],bounds[2]].some(x=>Math.abs(a[0]-x)<=tolerance&&Math.abs(b[0]-x)<=tolerance) ||
        [bounds[1],bounds[3]].some(y=>Math.abs(a[1]-y)<=tolerance&&Math.abs(b[1]-y)<=tolerance)) return true;
    if (a[0]*a[0]+a[1]*a[1]<innerSquared || b[0]*b[0]+b[1]*b[1]<innerSquared) return false;
    const side = Math.floor(Math.atan2(a[1],a[0]) / step);
    for (let k = side - 1; k <= side + 1; k++) {
      const angle = (k + 0.5) * step, x = Math.cos(angle), y = Math.sin(angle);
      const onEdge = p => Math.abs(p[0]*x+p[1]*y-capDistance) <= quantum / Math.SQRT2 + 1e-9;
      if (onEdge(a) && onEdge(b)) return true;
    }
    return false;
  };
  for (const rings of polygons) for (const ring of rings) {
    let line = [];
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      if (cut(a,b)) { if (line.length > 1) lines.push(line); line = []; }
      else { if (!line.length) line.push(a); line.push(b); }
    }
    if (line.length > 1) lines.push(line);
  }
  return lines;
}
// Compact storage: coordinates in tens of metres, each line's points as
// differences from the previous point.
export const QUANTUM = 0.01; // km
export function encodeLine(points, quantum = QUANTUM) {
  const out = []; let px = 0, py = 0;
  for (const [x, y] of points) {
    const qx = Math.round(x / quantum), qy = Math.round(y / quantum);
    out.push(qx - px, qy - py); px = qx; py = qy;
  }
  return out;
}
export function decodeLine(values, start = 0, end = values.length, quantum = QUANTUM) {
  const out = []; let x = 0, y = 0;
  for (let i = start; i < end; i += 2) { x += values[i]; y += values[i + 1]; out.push([x * quantum, y * quantum]); }
  return out;
}
