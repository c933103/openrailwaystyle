import {CJKV, CHINESE, AREAS} from './han-region-data.mjs';
// Areas whose place names may borrow Han-character names:
// 'cjkv' — China, Taiwan, Hong Kong, Macau, Japan, the Koreas and Vietnam
//          (Chinese and Japanese labels);
// 'zh'   — Singapore, Malaysia and the Russian Far East (Chinese labels only);
// 'none' — everywhere else.
// Coastal points slightly outside the simplified outline (piers, reclaimed
// land) count as inside; points beyond a land border never do.
const COAST_KM = 6, CELL = 4, PAD = 0.1;
function index(polygons) {
  const bands = new Map(), cells = new Map();
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  // Latitude bands serve ray casting; padded cells serve distance queries.
  const segment = (a, b, border) => {
    const s = [a[0],a[1],b[0],b[1],border];
    const [south, north] = [Math.min(a[1],b[1]), Math.max(a[1],b[1])];
    for (let y = Math.floor(south*CELL); y <= Math.floor(north*CELL); y++) add(bands, y, s);
    const padX = PAD/Math.cos(Math.min(85, Math.max(Math.abs(south), Math.abs(north))+PAD)*Math.PI/180);
    for (let x = Math.floor((Math.min(a[0],b[0])-padX)*CELL); x <= Math.floor((Math.max(a[0],b[0])+padX)*CELL); x++)
      for (let y = Math.floor((south-PAD)*CELL); y <= Math.floor((north+PAD)*CELL); y++) add(cells, `${x},${y}`, s);
  };
  for (const [line, spans] of polygons) {
    const ring = []; let x = 0, y = 0;
    for (let i = 0; i < line.length; i += 2) { x += line[i]; y += line[i+1]; ring.push([x/1000, y/1000]); }
    const border = new Uint8Array(ring.length);
    for (let i = 0; i < spans.length; i += 2) border.fill(1, spans[i]+1, spans[i+1]+1);
    // border[i] marks the edge ending at point i as a land border.
    for (let i = 1; i < ring.length; i++) segment(ring[i-1], ring[i], border[i] === 1);
  }
  return {bands, cells, uniform: new Map()};
}
function distance(lon, lat, [ax,ay,bx,by]) {
  const k = Math.cos(lat*Math.PI/180);
  ax = (ax-lon)*k; bx = (bx-lon)*k; ay -= lat; by -= lat;
  const dx = bx-ax, dy = by-ay, t = dx||dy ? Math.max(0, Math.min(1, -(ax*dx+ay*dy)/(dx*dx+dy*dy))) : 0;
  return Math.hypot(ax+t*dx, ay+t*dy)*111.2;
}
function inside(zone, lon, lat) {
  let odd = false;
  for (const [xi,yi,xj,yj] of zone.bands.get(Math.floor(lat*CELL)) || [])
    if ((yi > lat) !== (yj > lat) && lon < (xj-xi)*(lat-yi)/(yj-yi)+xi) odd = !odd;
  return odd;
}
// Distance in km to the zone: 0 inside, the coastal margin within it,
// Infinity outside.
function reach(zone, lon, lat) {
  const key = `${Math.floor(lon*CELL)},${Math.floor(lat*CELL)}`, near = zone.cells.get(key);
  // A cell with no outline nearby has one answer throughout.
  if (!near) {
    if (!zone.uniform.has(key)) zone.uniform.set(key, inside(zone, lon, lat) ? 0 : Infinity);
    return zone.uniform.get(key);
  }
  if (inside(zone, lon, lat)) return 0;
  let coast = Infinity, border = Infinity;
  for (const s of near) {
    const d = distance(lon, lat, s);
    if (s[4]) border = Math.min(border, d); else coast = Math.min(coast, d);
  }
  return coast <= COAST_KM && border > coast + 0.01 ? coast : Infinity;
}
const contains = (zone, lon, lat) => reach(zone, lon, lat) < Infinity;
let zones, areas;
const normalize = lon => ((lon + 180) % 360 + 360) % 360 - 180;
export function hanRegion(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -5 || lat > 85) return 'none';
  lon = normalize(lon);
  zones ||= {cjkv: index(CJKV), zh: index(CHINESE)};
  return contains(zones.cjkv, lon, lat) ? 'cjkv' : contains(zones.zh, lon, lat) ? 'zh' : 'none';
}
// Which of mainland China ('CN'), Taiwan ('TW'), Hong Kong ('HK') or Macau
// ('MO') a point is in, or '' elsewhere. OSM Chinese name keys are used
// differently in each. A point in two coastal margins goes to the nearer.
export function chineseArea(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < 15 || lat > 55) return '';
  lon = normalize(lon);
  if (lon < 70 || lon > 136) return '';
  areas ||= Object.entries(AREAS).map(([code, polygons]) => [code, index(polygons)]);
  let best = '', nearest = Infinity;
  for (const [code, zone] of areas) {
    const d = reach(zone, lon, lat);
    if (d < nearest) { best = code; nearest = d; }
  }
  return best;
}
