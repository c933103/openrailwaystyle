import test from 'node:test';
import assert from 'node:assert/strict';
import {browserImageryConfig} from '../scripts/configure-imagery.mjs';
import {createAdminController,createGoogleTileSourceSpec,createGoogleTileLayerSpec,googleLongitudeBounds} from '../styles/google-maps.mjs';
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

test('Google imagery remains eligible at the highest map zoom, retaining the upstream source ceiling',()=>{
  assert.equal(createGoogleTileSourceSpec().maxzoom,22);
  assert.ok(createGoogleTileLayerSpec().maxzoom>22,'layer maxzoom is exclusive');
});

test('Google viewport requests preserve narrow dateline crossings, not an entire world',()=>{
  for(const [w,e] of [[170,190],[-190,-170],[170,-170],[530,550]]) {
    assert.deepEqual(googleLongitudeBounds(w,e),{west:170,east:-170});
  }
  assert.deepEqual(googleLongitudeBounds(-180,180),{west:-180,east:180});
  assert.deepEqual(googleLongitudeBounds(-205,210),{west:-180,east:180});
  assert.deepEqual(googleLongitudeBounds(10,20),{west:10,east:20});
});

test('Google attribution follows the newest viewport and ignores responses after switching away',async()=>{
  const stored={atlas_admin_session:{token:'fixture-token',expiresAt:Date.now()+60000},atlas_admin_prefs:{mapSource:'google'}};
  const copy={textContent:''}, requests=[];
  let bounds={zoom:21,north:1,south:-1,west:-1,east:1};
  let background='satellite';
  const controller=createAdminController({
    window:{addEventListener(){},sessionStorage:{getItem:k=>JSON.stringify(stored[k])}},
    document:{getElementById:id=>id==='gmaps-copyright'?copy:null},
    getSettings:()=>({background,language:'en'}),
    getViewportBounds:()=>bounds,
    fetcher:async url=>{
      const u=new URL(url,'https://fixture.invalid');
      if(u.pathname.endsWith('/session'))return Response.json({unlocked:true,mode:'tiles'});
      assert.ok(u.pathname.endsWith('/viewport'));
      return await new Promise(resolve=>requests.push({resolve,params:u.searchParams}));
    },
  });
  await controller.ensureGoogleSourceReady();
  bounds={...bounds,...googleLongitudeBounds(170,190)};
  controller.onViewportChange(true);
  assert.equal(requests.length,2);
  assert.equal(requests[1].params.get('west'),'170');
  assert.equal(requests[1].params.get('east'),'-170');
  const respond=async (index,copyright)=>{
    requests[index].resolve(Response.json({copyright}));
    await new Promise(resolve=>setImmediate(resolve));
  };
  await respond(1,'New attribution');
  assert.equal(copy.textContent,'New attribution');
  await respond(0,'Old attribution');
  assert.equal(copy.textContent,'New attribution');
  controller.onViewportChange(true);
  background='osm';
  await respond(2,'After leaving Google');
  assert.equal(copy.textContent,'New attribution');
});
