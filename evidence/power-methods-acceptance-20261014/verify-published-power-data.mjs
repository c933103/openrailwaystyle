import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {validatePowerMethodsSnapshot} from '../../scripts/build-power-methods.mjs';
import {powerFacility} from '../../styles/power-facilities.mjs';
const root=process.argv[2],body=await readFile(`${root}/power-methods.geojson`),manifest=JSON.parse(await readFile(`${root}/methods-manifest.json`)),data=JSON.parse(body);
validatePowerMethodsSnapshot(data,manifest);
const hash=createHash('sha256').update(body).digest('hex');
if(hash!==manifest.sha256)throw new Error('Raw delivered GeoJSON digest mismatch');
if(!gunzipSync(await readFile(`${root}/power-methods.geojson.gz`),{maxOutputLength:120_000_000}).equals(body))throw new Error('Gzip differs from published GeoJSON');
const counts={},samples={};
for(const f of data.features) {
  const p=f.properties;
  const points=f.geometry.type==='Point'?[f.geometry.coordinates]:f.geometry.coordinates;
  if(!Array.isArray(points)||!points.length||points.some(c=>!Array.isArray(c)||c.length!==2||!c.every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>90))throw new Error('Invalid delivered coordinates');
  const coordinates=f.geometry.type==='Point'?[f.geometry.coordinates]:f.geometry.coordinates;
  if(!Array.isArray(coordinates)||coordinates.some(c=>!Array.isArray(c)||c.length!==2||!c.every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>90))throw new Error('Invalid published coordinate');
  if(f.geometry.type==='LineString'&&coordinates.length<2)throw new Error('Incomplete conductor geometry');
  if(f.id!==`${p.osm_type}-${p.osm_id}`)throw new Error(`Object identity mismatch: ${f.id}`);
  if(p.power_kind==='charging_station') {
    if(powerFacility(p)?.kind!=='charging_station'||f.geometry.type!=='Point')throw new Error('Charger lacks explicit tag evidence');
    counts.charging_station=(counts.charging_station||0)+1;samples.charging_station??={id:f.id,tags:p,geometry:f.geometry};
  }else {
    if(f.geometry.type!=='LineString')throw new Error('Conductor rail lacks line geometry');
    if(typeof p.power_method!=='string'||!p.power_method)throw new Error('Missing conductor supply method');
    for(const method of p.power_method.split(';')) {
      if(!['rail','4th_rail','ground-level_power_supply'].includes(method))throw new Error('Unsupported supply method');
      counts[method]=(counts[method]||0)+1;samples[method]??={id:f.id,tags:p,geometry:f.geometry};
    }
  }
}
console.log(JSON.stringify({built:manifest.built,sha256:hash,features:data.features.length,counts,coverage:manifest.coverage.length,coverageTimestamps:[...new Set(manifest.coverage.map(c=>c.timestamp))],requests:manifest.requests,downloadedBytes:manifest.downloadedBytes,samples},null,2));
