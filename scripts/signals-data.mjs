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
// One download for both signal supplements: every signal without a direction
// (this supplement) and every electrification signal (the Power view's
// snapshot, electricity-signal-data.mjs). Electrification signals without a
// direction are in the first set already, so only those with one are added.
const ELECTRIC_WITH_DIRECTION = '[railway=signal]["railway:signal:direction"]["railway:signal:electricity"]["railway:signal:electricity"!="no"]';
export function combinedSignalQuery(box) {
  return `[out:json][timeout:180][maxsize:268435456];(node[railway=signal][!"railway:signal:direction"](${box.join(',')});node${ELECTRIC_WITH_DIRECTION}(${box.join(',')}););out body;`;
}
// What changed in the combined set of a region since `since` (an OSM base
// timestamp): Overpass augmented diff. The server answers diff and adiff
// queries only in XML (its JSON output refuses them).
export function signalChangesQuery(box, since) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(since || '')) throw new Error('Invalid signal change start');
  return `[out:xml][timeout:180][maxsize:268435456][adiff:"${since}"];(node[railway=signal][!"railway:signal:direction"](${box.join(',')});node${ELECTRIC_WITH_DIRECTION}(${box.join(',')}););out meta;`;
}

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
const unescape = text => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code) =>
  code[0] !== '#' ? ENTITIES[code.toLowerCase()] : String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))));
const attributes = text => Object.fromEntries([...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, unescape(value)]));
function xmlNode(text) {
  const match = /<node\s([^>]*?)(\/>|>([\s\S]*?)<\/node>)/.exec(text || '');
  if (!match) return null;
  const attrs = attributes(match[1]), tags = {};
  for (const [, tag] of (match[3] || '').matchAll(/<tag\s([^>]*?)\/>/g)) { const {k, v} = attributes(tag); if (k !== undefined) tags[k] = v ?? ''; }
  return {attrs, tags};
}

// Changes from an augmented-diff response: nodes created or changed (their
// new state, as Overpass JSON elements) and node ids that were deleted or no
// longer match the query. A response that did not run to completion throws.
export function parseSignalChanges(xml) {
  if (typeof xml !== 'string' || !/<\/osm>\s*$/.test(xml)) throw new Error('Incomplete signal change response');
  const remark = /<remark>([\s\S]*?)<\/remark>/.exec(xml);
  if (remark) throw new Error(unescape(remark[1].trim()));
  const timestamp = /<meta\s[^>]*osm_base="([^"]+)"/.exec(xml)?.[1];
  if (!timestamp) throw new Error('Signal change response without a database timestamp');
  const upserts = [], deletes = [];
  for (const [, type, body] of xml.matchAll(/<action type="(create|modify|delete)">([\s\S]*?)<\/action>/g)) {
    const node = xmlNode(type === 'create' ? body : /<new>([\s\S]*?)<\/new>/.exec(body)?.[1]);
    if (!node) continue; // ways and relations are not part of this set
    const id = Number(node.attrs.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Signal change without a node id');
    if (type === 'delete') { deletes.push(id); continue; }
    const lat = Number(node.attrs.lat), lon = Number(node.attrs.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Signal change node ${id} without coordinates`);
    upserts.push({type: 'node', id, lat, lon, tags: node.tags});
  }
  return {timestamp, upserts, deletes};
}

// Apply changes to a region's stored elements, by node id.
export function applySignalChanges(elements, {upserts, deletes}) {
  const byId = new Map(elements.map(element => [element.id, element]));
  for (const id of deletes) byId.delete(id);
  for (const element of upserts) byId.set(element.id, element);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

// The part of the combined set missing from a region answered by signalQuery
// alone (direction responses cached before the two downloads were combined).
export function electricWithDirectionQuery(box) {
  return `[out:json][timeout:180][maxsize:134217728];node${ELECTRIC_WITH_DIRECTION}(${box.join(',')});out body;`;
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
