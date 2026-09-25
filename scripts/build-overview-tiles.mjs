// Site build step after unpack-snapshot.py: the snapshot tiles start at z5,
// so derive z0–4 tiles holding only railways under construction from its z5
// tiles. Run: node scripts/build-overview-tiles.mjs
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {gunzipSync, gzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
const OVERVIEW_STATES = ['construction'];
const root = new URL('../styles/data/lifecycle/', import.meta.url);
const index = JSON.parse(await readFile(new URL('index.json', root)));
const source = index.tiles.filter(key => key.startsWith('5/'));
if (!source.length) throw new Error('No z5 lifecycle tiles to derive overview tiles from');
const features = [];
for (const key of source) {
  const [z,x,y] = key.split('/').map(Number);
  const bytes = await readFile(new URL(`${key}.pbf.gz`, root));
  const layer = new VectorTile(new Pbf(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes)).layers.lifecycle;
  for (let i = 0; i < (layer?.length ?? 0); i++) {
    const feature = layer.feature(i);
    if (OVERVIEW_STATES.includes(feature.properties.state)) features.push(feature.toGeoJSON(x,y,z));
  }
}
const tiles = geojsonvt({type:'FeatureCollection',features},{maxZoom:4,indexMaxZoom:4,indexMaxPoints:0,tolerance:1,extent:4096,buffer:128});
const keys = [];
for (let z = 0; z <= 4; z++) for (let x = 0; x < 2**z; x++) for (let y = 0; y < 2**z; y++) {
  const tile = tiles.getTile(z,x,y);
  if (!tile?.features.length) continue;
  await mkdir(new URL(`${z}/${x}/`, root), {recursive:true});
  await writeFile(new URL(`${z}/${x}/${y}.pbf.gz`, root), gzipSync(vtpbf.fromGeojsonVt({lifecycle:tile}), {level:9}));
  keys.push(`${z}/${x}/${y}`);
}
index.tiles = [...keys, ...index.tiles.filter(key => Number(key.split('/')[0]) >= 5)];
await writeFile(new URL('index.json', root), JSON.stringify(index));
console.log(`Derived ${keys.length} overview tiles from ${features.length} construction features`);
