import test from 'node:test';
import assert from 'node:assert/strict';
import {browserImageryConfig} from '../scripts/configure-imagery.mjs';
import {createGoogleTileSourceSpec} from '../styles/google-maps.mjs';
import {createFlatSourceLoader} from '../styles/flat-source-loader.mjs';

test('Credential-free Pages build and public-only configuration',()=>{
  assert.deepEqual(browserImageryConfig({}),{});
  assert.deepEqual(browserImageryConfig({
    GOOGLE_MAPS_API_KEY:'private-server-key',GITHUB_CLIENT_SECRET:'secret',
    AUTH_BACKEND_ORIGIN:'https://auth.10671435.xyz',
    GITHUB_ADMIN_REPO:'c933103/openrailwaystyle',
  }),{authBackendOrigin:'https://auth.10671435.xyz',adminRepo:'c933103/openrailwaystyle'});
  assert.throws(()=>browserImageryConfig({AUTH_BACKEND_ORIGIN:'https://auth.example/path'}));
});
test('Current Canvas raster loader accepts the same Google tile protocol as WebGL',async()=>{
  const requests=[];
  const bytes=new Uint8Array([137,80,78,71]);
  const bitmap={width:256,height:256};
  const loader=createFlatSourceLoader({
    protocols:{read:async(url)=>{requests.push(url);return {data:bytes.buffer};}},
    fetcher:async()=>{throw Error('Direct fetch should not occur');},
    decodeRaster:async data=>{assert.deepEqual(new Uint8Array(data),bytes);return bitmap;},
  });
  const controller=new AbortController();
  const source=await loader.resolve(createGoogleTileSourceSpec('roadmap','en'),{baseURL:'https://10671435.xyz/world.style.json',controller});
  await loader.load(source,{z:3,x:2,y:4},{controller,pixelRatio:1});
  assert.equal(requests.length,1);
});
