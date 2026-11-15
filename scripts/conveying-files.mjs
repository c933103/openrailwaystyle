// The snapshot layout of the escalator and aerialway builds, written the same
// way whether the elements came from Overpass (build-conveying.mjs,
// build-aerialways.mjs) or from the Geofabrik extracts
// (build-extract-conveying.mjs): elements.json.gz (the elements converted),
// <file>.geojson.gz (the ODbL extract), z/x/y.pbf.gz tiles, manifest.json and
// index.json.
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {conveyingTiles} from './conveying-data.mjs';

// head: the manifest's leading fields (generated, osmBase, update); tail: the
// fields after the counts (source, query, license, description, ...).
export async function writeLineSnapshot(root, {elements, features, file, layer, zoom, kindIds, head, tail}) {
  await mkdir(root, {recursive: true});
  await writeFile(join(root, 'elements.json.gz'), gzipSync(JSON.stringify(elements), {level: 9}));
  await writeFile(join(root, `${file}.geojson.gz`), gzipSync(JSON.stringify({type: 'FeatureCollection', features}), {level: 9}));
  const tiles = [];
  for (const [key, bytes] of conveyingTiles(features, {z: zoom, layer})) {
    const [z, x] = key.split('/');
    await mkdir(join(root, z, x), {recursive: true});
    await writeFile(join(root, `${key}.pbf.gz`), gzipSync(bytes, {level: 9}));
    tiles.push(key);
  }
  const kinds = Object.fromEntries(kindIds.map(kind => [kind, features.filter(f => f.properties.kind === kind).length]));
  const manifest = {...head, features: features.length, kinds, zoom, tiles: tiles.length, ...tail};
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(root, 'index.json'), JSON.stringify({tiles: tiles.sort()}));
  return manifest;
}
