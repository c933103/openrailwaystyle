// Worldwide OSM railway station-point snapshot primitives.
//
// No browser calls Overpass. A separate budgeted maintenance job collects OSM
// nodes/ways/relations, keeps stable object identities and publishes complete
// static vector tiles. This module is pure: it can be tested with fixtures
// without network access. Source data is ODbL, credited in the final atlas.
export const SNAPSHOT_VERSION = 1;
export const ZOOMS = Object.freeze([3, 4, 5, 6, 7]);
export const EXTENT = 8192;
export const BUFFER = 128;
export const MERCATOR_LIMIT = 85.0511287798066;
export const RAILWAY_KINDS = Object.freeze(['station', 'halt', 'tram_stop']);
const TYPES = Object.freeze({node: 1, way: 2, relation: 3});
const RETIRED = new Set(['yes', 'true', '1']);
const osmKey = e => `${e.type}/${e.id}`;
const validCoord = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const scrub = value => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240)
  : '';
export function initialRegions() {
  const regions = [];
  // Half-open rectangles avoid claiming a station twice along any seam.
  for (let lat = -90; lat < 90; lat += 45)
    for (let lon = -180; lon < 180; lon += 45)
      regions.push([lat, lon, lat + 45, lon + 45]);
  return regions;
}
export function validateBox(box) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) throw new Error('Invalid geographic bounding box');
  const [south,west,north,east] = box;
  if (!(south >= -90 && north <= 90 && west >= -180 && east <= 180 &&
    south < north && west < east)) throw new Error('Invalid geographic bounding-box extents');
  return box;
}
export function quarters(box) {
  const [s,w,n,e] = validateBox(box), lat = (s + n) / 2, lon = (w + e) / 2;
  return [[s,w,lat,lon],[s,lon,lat,e],[lat,w,n,lon],[lat,lon,n,e]];
}
export function inBox(box, lat, lon) {
  const [s,w,n,e] = validateBox(box);
  return lat >= s && lat < n && lon >= w && lon < e ||
    // The globe closes at +90/+180; retain such coordinates in the last box.
    (lat === 90 && n === 90 && lon >= w && lon <= e) ||
    (lon === 180 && e === 180 && lat >= s && lat < n);
}
export function stationQuery(box) {
  validateBox(box);
  const bbox = box.join(',');
  // No recursive traversal of all member nodes: this is a bounded search for
  // objects tagged railway=station/halt/tram_stop themselves. 'out center'
  // retains the object type and id; large ways/relations use their bbox centre.
  return `[out:json][timeout:180][maxsize:268435456];(nwr["railway"~"^(station|halt|tram_stop)$"](${bbox}););out center;`;
}
export function normalizeElement(element) {
  if (!element || !Object.hasOwn(TYPES, element.type) ||
      !Number.isSafeInteger(element.id) || element.id <= 0) return null;
  const tags = element.tags || {};
  if (!RAILWAY_KINDS.includes(tags.railway)) return null;
  if ([tags.disused, tags.abandoned, tags.demolished, tags.ruins, tags.proposed].some(v => RETIRED.has(String(v).toLowerCase()))) return null;
  const lat = element.type === 'node' ? element.lat : element.center?.lat;
  const lon = element.type === 'node' ? element.lon : element.center?.lon;
  if (!validCoord(lat, lon)) throw new Error(`Station ${osmKey(element)} has no valid geographical location`);
  const mode = ['subway', 'light_rail', 'monorail', 'tram', 'funicular', 'miniature']
    .includes(tags.station) ? tags.station : tags.railway === 'tram_stop' ? 'tram' : 'train';
  return {
    id: osmKey(element), osm_type: element.type, osm_id: element.id,
    lat, lon, feature: tags.railway, station: mode, state: 'present',
    name: scrub(tags.name), ...(scrub(tags['name:en']) ? {'name:en': scrub(tags['name:en'])} : {}),
  };
}
export function validateResponse(payload) {
  if (!payload || !Array.isArray(payload.elements) || payload.remark || payload.error)
    throw new Error('Incomplete or invalid Overpass station response');
  const out = new Map();
  for (const element of payload.elements) {
    const record = normalizeElement(element);
    if (!record) {
      if (element?.tags && RAILWAY_KINDS.includes(element.tags.railway))
        throw new Error('Invalid OSM station element in provider response');
      continue;
    }
    if (out.has(record.id)) throw new Error(`Repeated OSM identity in one response: ${record.id}`);
    out.set(record.id, record);
  }
  return out;
}
export function replaceRegion(table, box, next) {
  validateBox(box);
  // Validate a complete replacement before mutating old published data.
  if (!(table instanceof Map) || !(next instanceof Map)) throw new Error('Expected station record maps');
  for (const value of next.values()) {
    if (!inBox(box, value.lat, value.lon)) throw new Error(`Out-of-region OSM station: ${value.id}`);
  }
  for (const [id,p] of table) if (inBox(box,p.lat,p.lon)) table.delete(id);
  for (const [id,p] of next) table.set(id,p);
  return table;
}
export function writeTable(table) {
  const values = [...table.values()].sort((a,b) => a.id.localeCompare(b.id));
  return values.map(record => JSON.stringify(record)).join('\n') + (values.length ? '\n' : '');
}
export function readTable(text) {
  const records = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (!record || typeof record.id !== 'string' ||
        !/^(node|way|relation)\/[1-9]\d*$/.test(record.id) ||
        !validCoord(record.lat,record.lon) || !RAILWAY_KINDS.includes(record.feature))
      throw new Error('Malformed worldwide station record');
    if (records.has(record.id)) throw new Error('Duplicate station identity in saved data');
    records.set(record.id,record);
  }
  return records;
}
export function tilePosition(lat, lon, z) {
  const n = 2 ** z, adjustedLat = Math.max(-MERCATOR_LIMIT,Math.min(MERCATOR_LIMIT,lat));
  const phi = adjustedLat * Math.PI / 180;
  const x = Math.min(1 - Number.EPSILON, (lon + 180) / 360) * n;
  const y = Math.max(0, Math.min(1 - Number.EPSILON,
    (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2)) * n;
  return [x,y];
}
function morton(x,y) {
  // Integer Morton order reduces delta-coded MVT size without reordering
  // semantic station IDs or dropping coincident but distinct objects.
  let result = 0;
  for (let b = 0; b < 14; b++) result += ((x >> b & 1) * 2 ** (2*b)) + ((y >> b & 1) * 2 ** (2*b+1));
  return result;
}
export function pointTiles(table, zoom) {
  if (!ZOOMS.includes(zoom)) throw new Error('Unsupported station overview zoom');
  const n = 2 ** zoom, tiles = new Map();
  function insert(tx,ty,point) {
    if (ty < 0 || ty >= n) return;
    const key = `${zoom}/${(tx+n)%n}/${ty}`;
    if (!tiles.has(key)) tiles.set(key,[]);
    tiles.get(key).push(point);
  }
  for (const p of table.values()) {
    if (!validCoord(p.lat,p.lon)) throw new Error('Unlocated station cannot be tiled');
    const [fx,fy] = tilePosition(p.lat,p.lon,zoom), tx = Math.floor(fx), ty = Math.floor(fy);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++) {
      const x = Math.round((fx-tx-dx)*EXTENT), y = Math.round((fy-ty-dy)*EXTENT);
      if(x < -BUFFER || x > EXTENT+BUFFER || y < -BUFFER || y > EXTENT+BUFFER) continue;
      insert(tx+dx,ty+dy,{...p,x,y});
    }
  }
  for (const points of tiles.values()) points.sort((a,b) =>
    morton(a.x+BUFFER,a.y+BUFFER)-morton(b.x+BUFFER,b.y+BUFFER) || a.id.localeCompare(b.id));
  return tiles;
}
export function mvtFeatures(points) {
  return points.map(p => ({
    type:1, geometry:[[p.x,p.y]],
    tags:{id:p.id,osm_type:p.osm_type,osm_id:String(p.osm_id),
      feature:p.feature,station:p.station,state:'present',name:p.name,
      ...(p['name:en'] ? {'name:en':p['name:en']} : {})},
  }));
}
