// Aerialways have no alternate geometry source. Never publish an empty substitute
// for a missing/incomplete snapshot: a failed build leaves the last site intact.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';

export async function validateAerialwaySnapshot(root) {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  const index = JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8'));
  if (!Number.isInteger(manifest.features) || manifest.features < 5000 || manifest.zoom !== 12)
    throw new Error('Incomplete aerialway manifest: expected at least 5000 features at zoom 12');
  if (!Array.isArray(index.tiles) || !index.tiles.length || manifest.tiles !== index.tiles.length || new Set(index.tiles).size !== index.tiles.length)
    throw new Error('Incomplete aerialway index: expected unique nonempty tiles matching the manifest');
  for (const key of index.tiles) {
    if (typeof key !== 'string' || !/^12\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/.test(key) || key.split('/').slice(1).some(n => Number(n) >= 4096))
      throw new Error('Invalid aerialway tile coordinate');
    const bytes = gunzipSync(await readFile(resolve(root, `${key}.pbf.gz`)));
    const tile = new VectorTile(new Pbf(bytes));
    if (!tile.layers.aerialways?.length) throw new Error(`Missing aerialway geometry: ${key}`);
  }
  return {features: manifest.features, tiles: index.tiles.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validateAerialwaySnapshot(process.argv[2] || 'styles/data/aerialways');
  console.log(`Validated aerialway snapshot: ${result.features} features, ${result.tiles} tiles`);
}
