// The historic-area snapshot, written the same way whether the features came
// from Overpass (build-heritage.mjs) or from the Geofabrik extracts
// (build-extract-heritage.mjs): the tile bundles, index.json and
// manifest.json. The Overpass build adds its per-region elements/ folder.
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {heritageTiles, heritageBundles, HERITAGE_MIN_ZOOM, HERITAGE_MAX_ZOOM, HERITAGE_BUNDLE_ZOOM} from './heritage-data.mjs';
import {BUNDLE_FORMAT} from '../styles/tile-bundles.mjs';

export const HERITAGE_SELECTION = 'Areas tagged historic=archaeological_site, historic=battlefield or historic=district, protect_class=22, or heritage=1.';

// head: the manifest's leading fields (version, built, source, license,
// complete); tail: the fields after the counts (coverage, ...). Replaces the
// output directory, through the caller's file functions when given (the
// Overpass build's own, which its tests replace).
const FILES = {mkdir, rm, writeFile};
export async function writeHeritageSnapshot(output, features, {head, tail}, {mkdir, rm, writeFile} = FILES) {
  const tiles = heritageTiles(features);
  const bundles = heritageBundles(tiles);
  await rm(output, {recursive:true, force:true});
  // Made here too: a partial world with no areas has no bundle to make it.
  await mkdir(output, {recursive:true});
  let bytes = 0;
  for (const [path, data] of bundles) {
    await mkdir(`${output}/${path.slice(0, path.lastIndexOf('/'))}`, {recursive:true});
    await writeFile(`${output}/${path}.bundle.gz`, data);
    bytes += data.length;
  }
  const counts = {};
  for (const feature of features) counts[feature.properties.kind] = (counts[feature.properties.kind] || 0) + 1;
  await writeFile(`${output}/index.json`, JSON.stringify({format:BUNDLE_FORMAT, zoom:HERITAGE_BUNDLE_ZOOM, minzoom:HERITAGE_MIN_ZOOM, maxzoom:HERITAGE_MAX_ZOOM,
    bundles:[...bundles.keys()].map(path => path.slice(path.indexOf('/') + 1))}));
  const manifest = {...head, format:BUNDLE_FORMAT, minzoom:HERITAGE_MIN_ZOOM, maxzoom:HERITAGE_MAX_ZOOM, bundleZoom:HERITAGE_BUNDLE_ZOOM,
    areas:features.length, counts, tiles:tiles.size, bundles:bundles.size, bytes, ...tail};
  await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
