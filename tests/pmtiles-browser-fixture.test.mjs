import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {emptyPmtiles,pmtilesFixtureResponse} from '../scripts/pmtiles-browser-fixture.mjs';

test('deterministic archive has a v3 header, root entry, metadata and empty gzip MVT',()=>{
  assert.equal(emptyPmtiles.subarray(0,7).toString(),'PMTiles');assert.equal(emptyPmtiles[7],3);
  const offset=n=>Number(emptyPmtiles.readBigUInt64LE(n));
  assert.deepEqual([...emptyPmtiles.subarray(offset(8),offset(8)+offset(16))],[1,0,1,20,1]);
  assert.deepEqual(JSON.parse(emptyPmtiles.subarray(offset(24),offset(24)+offset(32))),{vector_layers:[]});
  assert.equal(gunzipSync(emptyPmtiles.subarray(offset(56),offset(56)+offset(64))).length,0);
});
test('Range responses clamp the header probe, slice exact tile bytes and keep a stable ETag',()=>{
  const whole=pmtilesFixtureResponse(),probe=pmtilesFixtureResponse('bytes=0-16383'),slice=pmtilesFixtureResponse('bytes=8-15');
  assert.equal(whole.status,200);assert.equal(probe.status,206);assert.deepEqual(probe.body,emptyPmtiles);
  assert.equal(probe.headers['content-range'],`bytes 0-${emptyPmtiles.length-1}/${emptyPmtiles.length}`);
  assert.equal(probe.headers['content-length'],String(emptyPmtiles.length));assert.equal(slice.headers.etag,probe.headers.etag);
  assert.deepEqual(slice.body,emptyPmtiles.subarray(8,16));assert.equal(slice.headers['content-length'],'8');
  assert.deepEqual(pmtilesFixtureResponse('bytes=127-').body,emptyPmtiles.subarray(127));
});
test('invalid or unsatisfiable ranges fail without pretending to return an archive',()=>{
  for(const range of ['bytes=99999-','bytes=9-3','bytes=0-1,3-4','garbage']){
    const r=pmtilesFixtureResponse(range);assert.equal(r.status,416);assert.equal(r.headers['content-range'],`bytes */${emptyPmtiles.length}`);
  }
});
