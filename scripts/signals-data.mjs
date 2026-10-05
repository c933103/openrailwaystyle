// OpenRailwayMap's signal tile view joins its direction table, which omits
// mapped signals without railway:signal:direction. Neutral Atlas location
// markers do not require a direction: this published supplement fills that
// specific gap without visitors querying an editing API.
import vtpbf from 'vt-pbf';
import '../styles/pbf-utf8.mjs'; // names beyond U+1FFFF intact

export const SIGNAL_OVERVIEW_ZOOM = 12, SIGNAL_ZOOM = 16, SIGNAL_EXTENT = 8192;
const BUFFER = 128;
const CATEGORIES = {
  main:'main', combined:'main', main_repeated:'main', distant:'distant',
  speed_limit:'speed', speed_limit_distant:'speed', train_protection:'train_protection',
  electricity:'electricity', radio:'radio', shunting:'shunting', shunting_route:'shunting',
  departure:'station', stop:'station', stop_demand:'station', station_distant:'station',
};

export function signalQuery(box) {
  return `[out:json][timeout:180][maxsize:268435456];node[railway=signal][!"railway:signal:direction"](${box.join(',')});out body;`;
}

export function signalFeature(element) {
  const tags = element.tags || {};
  if (element.type !== 'node' || tags.railway !== 'signal' || tags['railway:signal:direction'] !== undefined) return null;
  if (!Number.isSafeInteger(element.id) || element.id <= 0 || !Number.isFinite(element.lat) || !Number.isFinite(element.lon)) throw new Error('Incomplete railway signal node');
  const properties = {id:element.id, railway:'signal'};
  for (const key of ['ref', 'name']) if (typeof tags[key] === 'string' && tags[key]) properties[key === 'name' ? 'caption' : key] = tags[key];
  let component = 0;
  for (const [type, category] of Object.entries(CATEGORIES)) {
    if (!tags[`railway:signal:${type}`] || tags[`railway:signal:${type}`] === 'no') continue;
    properties[`category${component}`] = category;
    if (tags[`railway:signal:${type}:deactivated`] === 'yes') properties[`deactivated${component}`] = true;
    if (++component === 12) break;
  }
  if (!component) properties.category0 = 'other';
  return {type:'Feature', id:element.id, properties, geometry:{type:'Point', coordinates:[element.lon, element.lat]}};
}

export function signalFeatures(response) {
  if (response?.remark || !Array.isArray(response?.elements)) throw new Error(response?.remark || 'Incomplete signal response');
  return response.elements.flatMap(element => {
    const feature = signalFeature(element);
    return feature ? [feature] : [];
  });
}

// The overview is sufficient for 13–15; native z16 keeps dots on their
// mapped track through z22 instead of magnifying metre-scale z12 rounding.
// Point buffers wrap across the antimeridian and ordinary tile edges.
export function buildSignalTiles(features, z = SIGNAL_ZOOM) {
  const n = 2 ** z, tiles = new Map();
  for (const feature of features) {
    const [lon, lat] = feature.geometry.coordinates, clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const fx = (lon + 180) / 360 * n;
    const fy = (1 - Math.asinh(Math.tan(clamped * Math.PI / 180)) / Math.PI) / 2 * n;
    const tx = Math.floor(fx), ty = Math.min(n - 1, Math.max(0, Math.floor(fy)));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = Math.round((fx - tx - dx) * SIGNAL_EXTENT), y = Math.round((fy - ty - dy) * SIGNAL_EXTENT);
      if (ty + dy < 0 || ty + dy >= n || x < -BUFFER || x > SIGNAL_EXTENT + BUFFER || y < -BUFFER || y > SIGNAL_EXTENT + BUFFER) continue;
      const key = `${z}/${((tx + dx) % n + n) % n}/${ty + dy}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push({type:1, id:feature.id, geometry:[[x,y]], tags:feature.properties});
    }
  }
  return new Map([...tiles].map(([key, features]) => [key, vtpbf.fromGeojsonVt({railway_signals:{features}}, {version:2, extent:SIGNAL_EXTENT})]));
}
