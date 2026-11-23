// Pixel camera for the Canvas 2D renderer. CSS pixels, fractional zoom and the
// 512 px world at z0 match the normal flat map's camera conventions.
const WORLD = 512;
const RAD = Math.PI / 180;
const MAX_LAT = Math.atan(Math.sinh(Math.PI)) / RAD;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const mod = (v, n) => ((v % n) + n) % n;
const lngLatToWorld = ([lng, lat]) => [
  (lng + 180) / 360,
  (1 - Math.asinh(Math.tan(clamp(lat, -MAX_LAT, MAX_LAT) * RAD)) / Math.PI) / 2,
];
const worldToLngLat = ([x, y]) => [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * clamp(y, 0, 1)))) / RAD];

export function flatCamera({center, zoom, width, height, bearing = 0}) {
  if (!Array.isArray(center) || center.length !== 2 ||
      ![...center, zoom, width, height, bearing].every(Number.isFinite) ||
      width <= 0 || height <= 0 || zoom < -3 || zoom > 26) {
    throw new RangeError('Invalid flat map camera');
  }
  const lng = mod(center[0], 360);
  const [cx, cy] = lngLatToWorld([lng >= 180 ? lng - 360 : lng, center[1]]);
  const scale = WORLD * 2 ** zoom;
  const c = Math.cos(bearing * RAD), s = Math.sin(bearing * RAD);
  const mx = width / 2, my = height / 2;
  const pointToWorld = ([x, y]) => [cx + ((x - mx) * c - (y - my) * s) / scale,
    cy + ((x - mx) * s + (y - my) * c) / scale];
  const worldToPoint = ([x, y]) => [mx + ((x - cx) * c + (y - cy) * s) * scale,
    my + (-(x - cx) * s + (y - cy) * c) * scale];
  const project = (lngLat, {nearestWorld = true} = {}) => {
    const [x, y] = lngLatToWorld(lngLat);
    return worldToPoint([nearestWorld ? x + Math.round(cx - x) : x, y]);
  };
  const unproject = point => worldToLngLat(pointToWorld(point));
  const zoomAt = (nextZoom, point) => {
    const [x, y] = pointToWorld(point), factor = 2 ** (zoom - nextZoom);
    return flatCamera({center: worldToLngLat([x - (x - cx) * factor, y - (y - cy) * factor]),
      zoom: nextZoom, bearing, width, height});
  };
  const panBy = ([dx, dy]) => flatCamera({center: unproject([mx + dx, my + dy]), zoom, bearing, width, height});

  // Canonical x goes to data sources, while worldX stays unwrapped for drawing
  // separate copies on either side of the antimeridian. Y never wraps.
  const visibleTiles = (z, limit = 512) => {
    if (!Number.isInteger(z) || z < 0 || z > 26 || !Number.isSafeInteger(limit) || limit < 1)
      throw new RangeError('Invalid flat map tile parameters');
    const n = 2 ** z;
    const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(pointToWorld);
    const xs = corners.map(([x]) => x * n), ys = corners.map(([, y]) => y * n);
    const left = Math.floor(Math.min(...xs)), right = Math.ceil(Math.max(...xs)) - 1;
    const top = Math.max(0, Math.floor(Math.min(...ys))), bottom = Math.min(n - 1, Math.ceil(Math.max(...ys)) - 1);
    if (bottom < top) return [];
    if ((right - left + 1) * (bottom - top + 1) > limit) throw new RangeError('Flat map tile budget exceeded');
    const tiles = [];
    for (let y = top; y <= bottom; y++) for (let worldX = left; worldX <= right; worldX++) {
      tiles.push({z, x: mod(worldX, n), y, worldX});
    }
    return tiles;
  };
  return {center: worldToLngLat([cx, cy]), zoom, bearing, width, height, project, unproject, panBy, zoomAt, visibleTiles};
}
