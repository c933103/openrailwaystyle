// Build-time extract. Browsers never query Overpass for escalators or lifts.
import {conveying} from '../styles/conveying.mjs';
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
      properties: {osm_id: String(element.id), kind: found.kind, arrows}});
  }
  return {type: 'FeatureCollection', features: features.sort((a, b) => a.id - b.id)};
}
