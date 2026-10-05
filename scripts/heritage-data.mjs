// Maintenance only: worldwide historic areas for the planning context. The
// basemap's park layer holds only nature reserves and protected areas named
// by their protection title, so historic sites, battlefields, historic
// districts, cultural protected areas (protect_class=22) and World Heritage
// areas come from this snapshot. Visitors read static tiles, never Overpass.
import geojsonvt from 'geojson-vt';
import {gzipSync} from 'node:zlib';
import vtpbf from 'vt-pbf';
import '../styles/pbf-utf8.mjs'; // names beyond U+1FFFF intact
import {closedRings} from './polar-features.mjs';
import {LANGUAGES, labelExpression} from '../styles/map-model.mjs';
import {encodeBundle, bundleKey} from '../styles/tile-bundles.mjs';

export const HERITAGE_MIN_ZOOM = 10;
export const HERITAGE_MAX_ZOOM = 12;
// Tiles are published in bundles of one zoom-8 tile each (tile-bundles.mjs):
// about 3,100 files for the world rather than about 140,000 single tiles.
export const HERITAGE_BUNDLE_ZOOM = 8;
export const HERITAGE_LAYER = 'heritage';
const HISTORIC = ['archaeological_site','battlefield','district'];

export function heritageQuery([south,west,north,east]) {
  const box = `${south},${west},${north},${east}`, rel = '[type~"^(multipolygon|boundary)$"]';
  const filters = [`[historic~"^(${HISTORIC.join('|')})$"]`, '[protect_class=22]', '[heritage=1]'];
  return `[out:json][timeout:300];(${filters.map(f => `way${f}(${box});rel${f}${rel}(${box});`).join('')});out geom;`;
}

// The name keys any label language reads, taken from the label expression
// itself so the tiles keep exactly what the map can show.
export const NAME_KEYS = [...new Set(LANGUAGES.flatMap(([code]) => JSON.stringify(labelExpression(code)).match(/"name(:[^"]+)?"/g).map(key => JSON.parse(key))))];

export function heritageKind(tags) {
  if (HISTORIC.includes(tags.historic)) return tags.historic === 'district' ? 'historic_district' : tags.historic;
  return tags.heritage === '1' ? 'world_heritage' : 'cultural_protected_area';
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1];
function inside([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
// A ring crossing the antimeridian continues past ±180° so it stays one
// shape; geojson-vt wraps coordinates outside the world into the other side.
function unwrap(ring) {
  const out = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const [lon, lat] = ring[i], prev = out[i - 1][0];
    out.push([lon + 360 * Math.round((prev - lon) / 360), lat]);
  }
  return out;
}

// Outer rings each own the inner rings that lie inside them; inner rings
// that fit no outer ring are dropped rather than drawn as filled areas.
export function heritageGeometry(element) {
  const outer = element.type === 'way'
    ? closedRings([element])
    : closedRings((element.members || []).filter(m => m.type === 'way' && m.role !== 'inner'));
  if (!outer.length) return null;
  const inner = element.type === 'way' ? [] : closedRings((element.members || []).filter(m => m.type === 'way' && m.role === 'inner'));
  const polygons = outer.map(unwrap).map(ring => [ring]);
  for (const ring of inner.map(unwrap)) {
    const owner = polygons.find(([shell]) => inside(ring[0], shell) || inside([ring[0][0] + 360, ring[0][1]], shell) || inside([ring[0][0] - 360, ring[0][1]], shell));
    if (owner) {
      const shift = 360 * Math.round((owner[0][0][0] - ring[0][0]) / 360);
      owner.push(shift ? ring.map(([lon, lat]) => [lon + shift, lat]) : ring);
    }
  }
  return polygons.length === 1 ? {type:'Polygon', coordinates:polygons[0]} : {type:'MultiPolygon', coordinates:polygons};
}

export function heritageFeatures(json) {
  // Overpass can return HTTP 200 with partial elements and a timeout remark.
  if (json?.remark || !Array.isArray(json?.elements)) throw new Error(`Incomplete heritage response: ${json?.remark || 'no elements array'}`);
  const features = [];
  for (const element of json.elements) {
    if (!['way','relation'].includes(element.type) || !element.tags) continue;
    if (element.type === 'way' && !(element.geometry?.length >= 4 && same([element.geometry[0].lon, element.geometry[0].lat], [element.geometry.at(-1).lon, element.geometry.at(-1).lat]))) continue;
    const geometry = heritageGeometry(element);
    if (!geometry) continue;
    const id = `${element.type[0]}${element.id}`, tags = element.tags;
    const properties = {id, kind:heritageKind(tags)};
    if (tags.heritage === '1') properties.world_heritage = true;
    for (const key of NAME_KEYS) if (tags[key]) properties[key] = tags[key];
    // The OSM id stays a property: vector tile feature ids must be integers.
    features.push({type:'Feature', properties, geometry});
  }
  return features;
}

// Tiles for zooms 10–12; the map overzooms the z12 tiles beyond that.
export function heritageTiles(features) {
  const index = geojsonvt({type:'FeatureCollection', features}, {maxZoom:HERITAGE_MAX_ZOOM, indexMaxZoom:HERITAGE_MAX_ZOOM, indexMaxPoints:0, tolerance:2, extent:4096, buffer:64});
  const tiles = new Map();
  for (const {z, x, y} of index.tileCoords) {
    if (z < HERITAGE_MIN_ZOOM) continue;
    const tile = index.getTile(z, x, y);
    if (tile?.features.length) tiles.set(`${z}/${x}/${y}`, Buffer.from(vtpbf.fromGeojsonVt({[HERITAGE_LAYER]:tile}, {version:2})));
  }
  return tiles;
}

// Bundles of the tiles above: bundle path (zoom/x/y) to gzip-compressed bytes.
export function heritageBundles(tiles, zoom = HERITAGE_BUNDLE_ZOOM) {
  const groups = new Map();
  for (const [key, data] of tiles) {
    const [z, x, y] = key.split('/').map(Number), bundle = bundleKey(z, x, y, zoom);
    if (!bundle) throw new Error(`Tile ${key} is above the bundle zoom ${zoom}`);
    if (!groups.has(bundle)) groups.set(bundle, []);
    groups.get(bundle).push([key, data]);
  }
  const bundles = new Map();
  for (const [bundle, entries] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    bundles.set(`${zoom}/${bundle}`, gzipSync(encodeBundle(entries.sort(([a], [b]) => a.localeCompare(b))), {level:9}));
  }
  return bundles;
}

// What to do after a failed Overpass request (attempt counts from 0): wait
// HERITAGE_RETRY_DELAYS[attempt] and try again, split the region into
// quarters, or give up. Only failures of the request itself are retried, as
// the builder labels them: `Network:` (no response), `Invalid response:` (a
// cut-off body), `Incomplete heritage response:` (an Overpass remark) and
// HTTP 5xx or 429. A query that timed out or ran out of memory is split at
// once; a server that keeps failing is given smaller queries, which it may
// still manage, rather than failing the whole monthly run. A rate limit that
// outlasts the retries fails: smaller queries would only add requests to a
// limit that applies to the whole endpoint. Anything else (a
// rejected query, the download budget, a local error) fails the run.
export const HERITAGE_RETRY_DELAYS = [30000, 60000, 120000];
export function heritageFailure(message, attempt, depth, maxDepth = 6) {
  const status = Number(/^HTTP (\d+):/.exec(message)?.[1]);
  const request = /^(Network|Invalid response|Incomplete heritage response):/.test(message);
  // An executed query that ran out of time or memory, reported in a remark or
  // an HTTP 5xx body ("runtime error: Query timed out ...", "... out of
  // memory"), or one the client stopped waiting for. Retrying it would run
  // the same heavy query again; an admission error ("Gateway timeout") or a
  // server fault ("runtime error: open64") is retried.
  const tooHeavy = /runtime error[^]*?(timed? ?out|out of memory)/i.test(message) || /^Network: .*timeout/i.test(message);
  if ((request || status >= 500) && tooHeavy) return depth < maxDepth ? 'split' : 'fail';
  if (!request && !(status >= 500 || status === 429)) return 'fail';
  if (attempt < HERITAGE_RETRY_DELAYS.length) return 'retry';
  return depth < maxDepth && status !== 429 ? 'split' : 'fail';
}
