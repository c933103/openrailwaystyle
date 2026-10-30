// Build-time extract. Browsers never query Overpass for escalators or lifts.
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {conveying, viewValues} from '../styles/conveying.mjs';
import {ownerColor, AERIALWAY_KINDS} from '../styles/map-model.mjs';
// Tiles at the zoom the lines first draw, at full precision: 8192 units span
// about 0.3 m at the equator, and no simplification drops a short piece.
// (MapLibre rounds tile coordinates to its own 8192 grid, so a lower zoom
// would lose short pieces for good, even when overzoomed.)
export const CONVEYING_ZOOM = 14, CONVEYING_EXTENT = 8192;
export const CONVEYING_QUERY = '[out:json][timeout:900][maxsize:1073741824];(way[conveying][conveying!=no];way[highway=elevator];);out tags geom;';
// A backward escalator is stored reversed, so every arrow points along its line.
// Tiles carry only what is drawn: kind and arrow direction (one_way, two_way).
export function conveyingGeoJSON(json) {
  if (json?.remark || !Array.isArray(json?.elements)) throw new Error(json?.remark || 'Incomplete conveying response');
  const features = [];
  for (const element of json.elements) {
    if (element.type !== 'way' || !Number.isSafeInteger(element.id)) continue;
    const found = conveying(element.tags || {});
    if (!found) continue;
    const coordinates = element.geometry?.map(p => [p.lon, p.lat]);
    if (!coordinates || coordinates.length < 2 || coordinates.some(p => !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw new Error(`Incomplete geometry for conveying way-${element.id}`);
    if (found.direction === 'backward') coordinates.reverse();
    const arrows = found.direction === 'reversible' ? 'two_way' : found.direction ? 'one_way' : '';
    features.push({type: 'Feature', id: element.id, geometry: {type: 'LineString', coordinates},
      properties: {osm_id: String(element.id), kind: found.kind, arrows, ...viewValues(element.tags, ownerColor)}});
  }
  return {type: 'FeatureCollection', features: features.sort((a, b) => a.id - b.id)};
}
// Aerial cableways and lifts: long lines, so zoom-12 tiles (where they first
// draw) are precise enough. They carry name tags for the inspector and the
// values the thematic views colour by.
export const AERIALWAY_ZOOM = 12;
const AERIALWAY_SUBCLASSES = AERIALWAY_KINDS.flatMap(kind => kind.subclasses);
export const AERIALWAY_QUERY = `[out:json][timeout:900][maxsize:1073741824];way[aerialway~"^(${AERIALWAY_SUBCLASSES.join('|')})$"];out tags geom;`;
export function aerialwaysGeoJSON(json) {
  if (json?.remark || !Array.isArray(json?.elements)) throw new Error(json?.remark || 'Incomplete aerialway response');
  const features = [];
  for (const element of json.elements) {
    if (element.type !== 'way' || !Number.isSafeInteger(element.id)) continue;
    const tags = element.tags || {}, subclass = String(tags.aerialway ?? '').trim().toLowerCase();
    const kind = AERIALWAY_KINDS.find(k => k.subclasses.includes(subclass));
    if (!kind) continue;
    const coordinates = element.geometry?.map(p => [p.lon, p.lat]);
    if (!coordinates || coordinates.length < 2 || coordinates.some(p => !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw new Error(`Incomplete geometry for aerialway way-${element.id}`);
    const names = Object.fromEntries(Object.entries(tags).filter(([key]) => key === 'name' || key.startsWith('name:')));
    features.push({type: 'Feature', id: element.id, geometry: {type: 'LineString', coordinates},
      properties: {...names, osm_id: String(element.id), kind: kind.id, aerialway: subclass, ...viewValues(tags, ownerColor)}});
  }
  return {type: 'FeatureCollection', features: features.sort((a, b) => a.id - b.id)};
}
// Every tile any piece (with its buffer) touches, as encoded vector tiles.
export function conveyingTiles(features, {z = CONVEYING_ZOOM, layer = 'conveying'} = {}) {
  const n = 2 ** z, extent = CONVEYING_EXTENT, buffer = 128;
  const index = geojsonvt({type: 'FeatureCollection', features}, {maxZoom: z, indexMaxZoom: 5, tolerance: 0, extent, buffer});
  const keys = new Set(), tileXY = ([lng, lat]) => [(lng + 180) / 360 * n, (1 - Math.asinh(Math.tan(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180)) / Math.PI) / 2 * n];
  for (const f of features) {
    const points = f.geometry.coordinates.map(tileXY), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    for (let x = Math.max(0, Math.floor(Math.min(...xs) - buffer / extent)); x <= Math.min(n - 1, Math.floor(Math.max(...xs) + buffer / extent)); x++)
      for (let y = Math.max(0, Math.floor(Math.min(...ys) - buffer / extent)); y <= Math.min(n - 1, Math.floor(Math.max(...ys) + buffer / extent)); y++) keys.add(`${z}/${x}/${y}`);
  }
  const tiles = new Map();
  for (const key of [...keys].sort()) {
    const [tz, x, y] = key.split('/').map(Number), tile = index.getTile(tz, x, y);
    if (tile?.features.length) tiles.set(key, Buffer.from(vtpbf.fromGeojsonVt({[layer]: tile}, {extent})));
  }
  return tiles;
}
