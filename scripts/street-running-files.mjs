// The street-running snapshot, made the same way whether the elements came
// from Overpass (build-street-running.mjs) or from the Geofabrik extracts
// (build-extract-street-running.mjs): the selection, the conversion, and the
// files (elements.json.gz, street-running.geojson.gz, 12/x/y.pbf.gz tiles,
// manifest.json and index.json).
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import '../styles/pbf-utf8.mjs'; // names beyond U+1FFFF intact
import {streetRunning} from '../styles/street-running.mjs';

export const STREET_QUERY = '[out:json][timeout:600][maxsize:536870912];(way[embedded=yes];way[embedded_rails];);out tags geom;';

export const streetFeatures = elements => elements.flatMap(e => {
  if (e.type !== undefined && e.type !== 'way') return [];
  const description = streetRunning(e.tags || {});
  if (!description || e.geometry?.length < 2) return [];
  if (!e.geometry.every(p => Number.isFinite(p.lon) && Number.isFinite(p.lat))) throw new Error(`Incomplete geometry for ${e.id}`);
  return [{type: 'Feature', id: e.id, properties: {...e.tags, osm_id: e.id, evidence: description}, geometry: {type: 'LineString', coordinates: e.geometry.map(p => [p.lon, p.lat])}}];
});

// head: the manifest's leading fields (generated, osmBase, update); tail: the
// fields after the counts (source, query, license, description, ...).
export async function writeStreetSnapshot(root, {elements, features, head, tail}) {
  await mkdir(root, {recursive: true});
  await writeFile(join(root, 'elements.json.gz'), gzipSync(JSON.stringify(elements), {level: 9}));
  await writeFile(join(root, 'street-running.geojson.gz'), gzipSync(JSON.stringify({type: 'FeatureCollection', features}), {level: 9}));
  const z = 12, n = 2 ** z, extent = 8192;
  const index = geojsonvt({type: 'FeatureCollection', features}, {maxZoom: z, indexMaxZoom: 5, tolerance: 0.5, extent, buffer: 128});
  const keys = new Set(), tileXY = ([lng, lat]) => [(lng + 180) / 360 * n, (1 - Math.asinh(Math.tan(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180)) / Math.PI) / 2 * n];
  for (const f of features) {
    const points = f.geometry.coordinates.map(tileXY);
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    // Include tile buffers so a line doesn't disappear at an edge.
    for (let x = Math.max(0, Math.floor(Math.min(...xs) - 128 / extent)); x <= Math.min(n - 1, Math.floor(Math.max(...xs) + 128 / extent)); x++)
      for (let y = Math.max(0, Math.floor(Math.min(...ys) - 128 / extent)); y <= Math.min(n - 1, Math.floor(Math.max(...ys) + 128 / extent)); y++) keys.add(`${z}/${x}/${y}`);
  }
  const tiles = [];
  for (const key of keys) {
    const [tz, x, y] = key.split('/').map(Number), tile = index.getTile(tz, x, y);
    if (!tile?.features.length) continue;
    await mkdir(join(root, String(tz), String(x)), {recursive: true});
    await writeFile(join(root, `${key}.pbf.gz`), gzipSync(vtpbf.fromGeojsonVt({street_running: tile}, {extent}), {level: 9}));
    tiles.push(key);
  }
  const manifest = {...head, features: features.length, tiles: tiles.length, ...tail};
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(root, 'index.json'), JSON.stringify({tiles: tiles.sort()}));
  return manifest;
}
