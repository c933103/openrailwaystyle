const mercatorX = longitude => (longitude + 180) / 360;
const mercatorY = latitude => (180 - (180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)))) / 360;

// Apply the pinned MapLibre flat-camera policy to resolved source metadata
// (including TileJSON bounds). No URL is constructed or request issued here.
export function planFlatSourceTiles(camera, {
  type, tileSize = 512, minzoom = 0, maxzoom = 22, bounds, active = true,
} = {}, limit = 512) {
  if (!active) return [];
  if (!['raster','raster-dem','vector'].includes(type) ||
      !Number.isFinite(tileSize) || tileSize <= 0 ||
      !Number.isInteger(minzoom) || !Number.isInteger(maxzoom) ||
      minzoom < 0 || maxzoom < minzoom || maxzoom > 26) {
    throw new RangeError('Invalid flat tile source options');
  }
  const adjusted = camera.zoom + Math.log2(512 / tileSize);
  const desired = Math.max(0, type === 'vector' ? Math.floor(adjusted) : Math.round(adjusted));
  if (desired < minzoom) return [];
  const z = Math.min(desired,maxzoom);
  const n = 2 ** z;
  let west = 0, east = n, north = 0, south = n;
  if (bounds != null) {
    if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) ||
        bounds[0] >= bounds[2] || bounds[1] >= bounds[3] ||
        bounds[0] >= 180 || bounds[2] <= -180 || bounds[1] >= 90 || bounds[3] <= -90)
      throw new RangeError('Invalid flat tile source bounds');
    west = Math.floor(mercatorX(Math.max(-180,bounds[0])) * n);
    east = Math.ceil(mercatorX(Math.min(180,bounds[2])) * n);
    north = bounds[3] >= 90 ? 0 : Math.floor(mercatorY(bounds[3]) * n);
    south = bounds[1] <= -90 ? n : Math.ceil(mercatorY(bounds[1]) * n);
  }
  const unique = new Map();
  for (const tile of camera.visibleTiles(z,limit)) {
    const {x,y} = tile;
    if (x < west || x >= east || y < north || y >= south) continue;
    const key = `${z}/${x}/${y}`;
    if (!unique.has(key)) unique.set(key,{key,canonical:{z,x,y},copies:[]});
    unique.get(key).copies.push(tile);
  }
  return [...unique.values()];
}
