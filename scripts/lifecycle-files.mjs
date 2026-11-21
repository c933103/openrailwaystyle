// The worldwide lifecycle snapshot, written the same way whether its ways came
// from Overpass (build-snapshot.mjs) or from the Geofabrik extracts
// (build-extract-lifecycle.mjs): manifest.json, the ODbL source table
// lifecycle.geojson.gz, and tiles.jsonl (zoom 5–10, one gzipped vector tile
// per line), which scripts/pack-snapshot.py packs into lifecycle.pmtiles.
import {writeFile, mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {gzipSync} from 'node:zlib';
import geojsonvt from 'geojson-vt';
import {encodeLifecycleTile} from './lifecycle-tile.mjs';
import '../styles/pbf-utf8.mjs'; // names beyond U+1FFFF intact
import {STATES} from './lifecycle.mjs';

// The regression the site's data check reads: 남부내륙선 (the Southern
// Inland Line in Korea) present and spanning more than a degree.
export function lifecycleRegression(features) {
  const nambu = features.filter(f => /남부내륙/.test(f.properties.name));
  if (!nambu.length) throw new Error('Regression: 남부내륙선 missing from worldwide snapshot');
  const coordinates = nambu.flatMap(f => f.geometry.type==='LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat());
  const bbox = [Math.min(...coordinates.map(p=>p[0])), Math.min(...coordinates.map(p=>p[1])), Math.max(...coordinates.map(p=>p[0])), Math.max(...coordinates.map(p=>p[1]))];
  if (bbox[3]-bbox[1] < 1) throw new Error('Regression: 남부내륙선 extent appears incomplete');
  return {name:'남부내륙선',ways:nambu.length,bbox,ids:nambu.map(f=>f.id)};
}

export const stateCounts = features => Object.fromEntries(STATES.map(s=>[s,features.filter(f=>f.properties.state===s).length]));

// data: the FeatureCollection; manifest: written as given. Returns the
// number of tiles written.
export async function writeLifecycleSnapshot(dir, data, manifest) {
  await mkdir(dir, {recursive:true});
  await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest,null,2)+'\n');
  // Source dump makes the derived ODbL database reusable independently of renderer.
  await writeFile(`${dir}/lifecycle.geojson.gz`,gzipSync(JSON.stringify(data)));
  const index = geojsonvt(data,{maxZoom:10,indexMaxZoom:4,indexMaxPoints:100000,tolerance:1,extent:4096,buffer:128});
  const stream=createWriteStream(`${dir}/tiles.jsonl`); let tileCount=0;
  async function visit(z,x,y) {
    const tile=index.getTile(z,x,y);
    if (!tile?.features.length) return;
    const encoded = z>=5 ? encodeLifecycleTile(tile) : null;
    if(encoded) {
      const bytes=gzipSync(encoded);
      if(!stream.write(JSON.stringify([z,x,y,bytes.toString('base64')])+'\n')) await once(stream,'drain');
      tileCount++;
    }
    if(z<10) for(let dy=0;dy<2;dy++) for(let dx=0;dx<2;dx++) await visit(z+1,x*2+dx,y*2+dy);
  }
  await visit(0,0,0); stream.end(); await once(stream,'finish');
  return tileCount;
}
