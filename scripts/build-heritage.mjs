// Maintenance only. Build the worldwide historic-area tiles (heritage-data.mjs)
// from Overpass, region by region. Run: node scripts/build-heritage.mjs
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {heritageQuery, heritageFeatures, heritageFailure, HERITAGE_RETRY_DELAYS, heritageTiles, heritageBundles, HERITAGE_MIN_ZOOM, HERITAGE_MAX_ZOOM, HERITAGE_BUNDLE_ZOOM} from './heritage-data.mjs';
import {BUNDLE_FORMAT} from '../styles/tile-bundles.mjs';

const api = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const output = process.env.HERITAGE_OUTPUT || 'heritage-data';
const cache = '.snapshot-cache';
// Version 2: tiles published in bundles (tile-bundles.mjs) instead of one
// file per tile.
const VERSION = 2;
const regions = [];
for (let south = -90; south < 90; south += 45) for (let west = -180; west < 180; west += 45) regions.push([south, west, south + 45, west + 45]);
await mkdir(cache, {recursive:true});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let requests = 0, downloaded = 0;
const features = new Map(), coverage = [];

async function collect(box, depth = 0) {
  const query = heritageQuery(box), file = `${cache}/heritage-v${VERSION}-${box.join('_')}.json`;
  let json;
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    if (saved.query === query && process.env.HERITAGE_REFRESH !== '1') json = saved.response;
  } catch {}
  let split = false;
  if (!json) for (let attempt = 0; ; attempt++) {
    await sleep(attempt ? HERITAGE_RETRY_DELAYS[attempt - 1] : requests ? 10000 : 0);
    requests++;
    let failure;
    try {
      console.log('Fetching historic areas', box.join(','), 'attempt', attempt + 1);
      let response, text;
      try {
        response = await fetch(api, {method:'POST', body:new URLSearchParams({data:query}),
          headers:{'User-Agent':'RailwayAtlas-heritage/1.0 (+https://github.com/c933103/openrailwaystyle)'}, signal:AbortSignal.timeout(360000)});
        text = await response.text();
      } catch (error) { throw new Error(`Network: ${error.message}`); }
      downloaded += Buffer.byteLength(text);
      if (downloaded > 1_500_000_000) throw new Error('Historic area download budget exceeded');
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`);
        // Keep the budget-checked body for classification, non-enumerable so
        // logging an uncaught error does not dump the full response.
        Object.defineProperty(error, 'responseBody', {value:text});
        throw error;
      }
      try { json = JSON.parse(text); } catch (error) { throw new Error(`Invalid response: ${error.message}`); }
      heritageFeatures(json);
    } catch (error) { failure = error; }
    if (!failure) {
      // Outside the retry policy: a cache that cannot be written fails the run.
      await writeFile(file, JSON.stringify({query, response:json}));
      break;
    }
    json = undefined;
    console.warn(box.join(','), failure.message);
    const next = heritageFailure(failure, attempt, depth);
    if (next === 'fail') throw failure;
    if (next === 'split') { split = true; break; }
  }
  if (split) {
    console.log('Splitting historic area region', box.join(','));
    const [s, w, n, e] = box, lat = (s + n) / 2, lon = (w + e) / 2;
    for (const child of [[s, w, lat, lon], [s, lon, lat, e], [lat, w, n, lon], [lat, lon, n, e]]) await collect(child, depth + 1);
    return;
  }
  const found = heritageFeatures(json);
  // An area crossing a region edge comes back from both regions.
  for (const feature of found) features.set(feature.properties.id, feature);
  coverage.push({bbox:box, timestamp:json.osm3s?.timestamp_osm_base || null, features:found.length});
  console.log('Historic area region', box.join(','), found.length, 'areas');
}
for (const box of regions) await collect(box);
if (!features.size) throw new Error('Refusing to publish an empty worldwide historic area snapshot');

const tiles = heritageTiles([...features.values()]);
const bundles = heritageBundles(tiles);
await rm(output, {recursive:true, force:true});
let bytes = 0;
for (const [path, data] of bundles) {
  await mkdir(`${output}/${path.slice(0, path.lastIndexOf('/'))}`, {recursive:true});
  await writeFile(`${output}/${path}.bundle.gz`, data);
  bytes += data.length;
}
const counts = {};
for (const feature of features.values()) counts[feature.properties.kind] = (counts[feature.properties.kind] || 0) + 1;
await writeFile(`${output}/index.json`, JSON.stringify({format:BUNDLE_FORMAT, zoom:HERITAGE_BUNDLE_ZOOM, minzoom:HERITAGE_MIN_ZOOM, maxzoom:HERITAGE_MAX_ZOOM,
  bundles:[...bundles.keys()].map(path => path.slice(path.indexOf('/') + 1))}));
await writeFile(`${output}/manifest.json`, JSON.stringify({version:VERSION, built:new Date().toISOString(), source:'OpenStreetMap via Overpass', license:'ODbL-1.0',
  complete:true, format:BUNDLE_FORMAT, minzoom:HERITAGE_MIN_ZOOM, maxzoom:HERITAGE_MAX_ZOOM, bundleZoom:HERITAGE_BUNDLE_ZOOM, areas:features.size, counts, tiles:tiles.size, bundles:bundles.size, bytes, coverage, downloadedBytes:downloaded,
  selection:'Areas tagged historic=archaeological_site, historic=battlefield or historic=district, protect_class=22, or heritage=1.'}, null, 2) + '\n');
console.log('Worldwide historic areas:', features.size, counts, tiles.size, 'tiles in', bundles.size, 'bundles,', bytes, 'bytes');
