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
  const zoomAt = (nextZoom, point, nextBearing = bearing) => {
    const [x, y] = pointToWorld(point), factor = 2 ** (zoom - nextZoom);
    if(nextBearing===bearing)return flatCamera({
      center: worldToLngLat([x - (x - cx) * factor, y - (y - cy) * factor]),
      zoom: nextZoom, bearing, width, height});
    const [dx,dy]=[point[0]-mx,point[1]-my], nextScale=WORLD*2**nextZoom;
    const nc=Math.cos(nextBearing*RAD),ns=Math.sin(nextBearing*RAD);
    return flatCamera({center:worldToLngLat([x-(dx*nc-dy*ns)/nextScale,y-(dx*ns+dy*nc)/nextScale]),
      zoom:nextZoom,bearing:nextBearing,width,height});
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
  // Affine transformation from a normalized local tile (0..1) to CSS
  // screen pixels. Keep the unwrapped x to place copies at the date line.
  const tileTransform = ({z, x, y, worldX = x}) => {
    const n = 2 ** z;
    if (!Number.isInteger(z) || z < 0 || z > 26 || !Number.isSafeInteger(worldX) ||
        !Number.isInteger(y) || y < 0 || y >= n) throw new RangeError('Invalid flat map tile');
    const [tx, ty] = worldToPoint([worldX / n, y / n]);
    const sc = scale / n;
    return [c * sc, -s * sc, s * sc, c * sc, tx, ty];
  };
  return {center: worldToLngLat([cx, cy]), zoom, bearing, width, height,
    project, unproject, panBy, zoomAt, visibleTiles, tileTransform};
}

// Local ground resolution at the centre of the Mercator camera. Use CSS
// pixels (not device pixels); bearing does not change Mercator's local scale.
export function flatScaleBar(camera, units, maxWidth = 100) {
  const width = Math.min(maxWidth, camera.width - 20);
  if (!(width >= 12)) return null;
  const metresPerPixel = 2 * Math.PI * 6371008.8 * Math.cos(camera.center[1] * RAD) / (WORLD * 2 ** camera.zoom);
  const metres = width * metresPerPixel;
  const [factor, unit] = units === 'imperial'
    ? (metres >= 1609.344 ? [1609.344, 'mi'] : [.3048, 'ft'])
    : (metres >= 1000 ? [1000, 'km'] : [1, 'm']);
  const available = metres / factor, order = 10 ** Math.floor(Math.log10(available));
  const value = Number(([5,2,1,.5].find(n => n * order <= available) * order).toPrecision(8));
  return {value, unit, width: value * factor / metresPerPixel};
}

// A provider's geographic bounding box may cross the antimeridian. Fit the
// rectangle in world space, including the current map rotation and padding.
export function fitFlatBounds(camera, [[west,south],[east,north]], {padding=40,maxZoom=15,minZoom=-0.5}={}) {
  if (![west,south,east,north].every(Number.isFinite) || south>=north ||
      west < -180 || west > 180 || east < -180 || east > 180 || south < -90 || north > 90)
    return null;
  if (east<west) east+=360;
  const [x0,y0]=lngLatToWorld([west,north]),[x1,y1]=lngLatToWorld([east,south]);
  const w=x1-x0,h=y1-y0;
  const c=Math.abs(Math.cos(camera.bearing*RAD)),s=Math.abs(Math.sin(camera.bearing*RAD));
  const availableX=Math.max(1,camera.width-2*Math.min(padding,camera.width/4));
  const availableY=Math.max(1,camera.height-2*Math.min(padding,camera.height/4));
  const span=Math.min(availableX/(w*c+h*s),availableY/(w*s+h*c))/WORLD;
  const zoom=clamp(Math.log2(span),minZoom,maxZoom);
  return flatCamera({center:worldToLngLat([(x0+x1)/2,(y0+y1)/2]),zoom,width:camera.width,height:camera.height,bearing:camera.bearing});
}
