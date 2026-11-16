import test from 'node:test';
import assert from 'node:assert/strict';
import {polarSatelliteURL,validatePolarSatellite,fetchPolarSatellite,POLAR_SATELLITE} from '../scripts/polar-satellite.mjs';
import {polarSatelliteXY} from '../styles/polar.mjs';
import {PolarLayer} from '../styles/polar-layer.mjs';
// Structural JPEG envelope for parser tests, never used as a browser image.
const envelope=Buffer.from([255,216,255,192,0,8,8,4,0,4,0,0,255,217]);
test('NASA URLs select the proper stereographic CRS and bounded timeless composite',()=>{
  for(const [cap,epsg] of [['north',3413],['south',3031]]) {
    const u=new URL(polarSatelliteURL(cap));assert.equal(u.hostname,'gibs.earthdata.nasa.gov');
    assert.equal(u.searchParams.get('SRS'),`EPSG:${epsg}`);assert.equal(u.searchParams.get('WIDTH'),'1024');
    assert.equal(u.searchParams.get('LAYERS'),'BlueMarble_NextGeneration');assert.equal(u.searchParams.get('BBOX'),'-1048576,-1048576,1048576,1048576');
  }
  assert.throws(()=>polarSatelliteURL('other'));
});
test('polar satellite projection matches independent PROJ EPSG reference coordinates',()=>{
  // pyproj 3.8.0, Transformer.from_crs(4326,3413/3031,always_xy=True).
  for(const [cap,point,expected] of [
    ['north',[0,85.051129],[379304.80856571964,-379304.8085657197]],
    ['north',[45,87],[325053.2271348774,0]],
    ['north',[120,89],[28037.85670975669,104638.7057761478]],
    ['south',[0,-85.051129],[0,538027.9488127622]],
    ['south',[45,-87],[230537.17894014693,230537.17894014696]],
    ['south',[120,-89],[94098.06725064397,-54327.544457382784]],
    ['north',[0,90],[0,0]],['south',[0,-90],[0,0]],
  ])polarSatelliteXY(cap,point).forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<0.001,`${cap} ${point} axis${i}`));
});
test('satellite acquisition rejects wrong dimensions, errors and oversized bodies without retries',async()=>{
  assert.equal(validatePolarSatellite(envelope),envelope);
  for(const broken of [envelope.subarray(0,12),Buffer.from('<error/>'),Buffer.from([...envelope.slice(0,8),1,...envelope.slice(9)])])assert.throws(()=>validatePolarSatellite(broken));
  let calls=0;
  const fetcher=async()=>{calls++;return new Response(envelope,{headers:{'content-type':'image/jpeg'}});};
  assert.deepEqual(await fetchPolarSatellite('north',{fetcher}),envelope);assert.equal(calls,1);
  await assert.rejects(fetchPolarSatellite('north',{fetcher:async()=>new Response('busy',{status:429})}),/HTTP 429/);
  await assert.rejects(fetchPolarSatellite('north',{fetcher:async()=>new Response(new Uint8Array(8*1024*1024+1),{headers:{'content-type':'image/jpeg'}})}),/8 MiB/);
});
test('optional satellite texture is lazy, validated, reused and cannot survive removal',async()=>{
  const layer=new PolarLayer({});let requests=0,resolve;const deleted=[];
  layer.onAdd({triggerRepaint(){}},{deleteTexture:t=>deleted.push(t),deleteProgram(){},deleteBuffer(){}});
  layer.image=()=>{requests++;return new Promise(r=>resolve=r);};
  const state=layer.caps.north;
  layer.ensureSatellite('north',state);assert.equal(requests,0,'legacy index needs no image');
  state.index={satellite:{...POLAR_SATELLITE,projection:'EPSG:3413'}};
  layer.ensureSatellite('north',state);layer.ensureSatellite('north',state);assert.equal(requests,1);
  layer.onRemove();resolve('texture');await Promise.resolve();assert.deepEqual(deleted,['texture']);
  const invalid={index:{satellite:{...POLAR_SATELLITE,projection:'EPSG:3031'}}};
  layer.ensureSatellite('north',invalid);assert.equal(requests,1);assert.equal(invalid.satelliteFailed,true);
});
