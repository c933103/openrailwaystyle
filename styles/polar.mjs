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
// Compact storage: coordinates in tens of metres, each line's points as
// differences from the previous point.
export const QUANTUM = 0.01; // km
export function encodeLine(points) {
  const out = []; let px = 0, py = 0;
  for (const [x, y] of points) {
    const qx = Math.round(x / QUANTUM), qy = Math.round(y / QUANTUM);
    out.push(qx - px, qy - py); px = qx; py = qy;
  }
  return out;
}
export function decodeLine(values, start = 0, end = values.length) {
  const out = []; let x = 0, y = 0;
  for (let i = start; i < end; i += 2) { x += values[i]; y += values[i + 1]; out.push([x * QUANTUM, y * QUANTUM]); }
  return out;
}
