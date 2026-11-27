import test from 'node:test';
import assert from 'node:assert/strict';
import {browserImageryConfig} from '../scripts/configure-imagery.mjs';
import {createAdminController,createGoogleTileSourceSpec,createGoogleTileLayerSpec,googleViewportHasProvenZoomLimit,googleWebGLTileZoom,googleLongitudeBounds} from '../styles/google-maps.mjs';
import {createFlatSourceLoader} from '../styles/flat-source-loader.mjs';
import {flatCamera} from '../styles/flat-camera.mjs';
import {planFlatSourceTiles} from '../styles/flat-source-plan.mjs';
import {layerVisibility} from '../styles/layer-semantics.mjs';

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

for (const obsolete of ['503','401','success','network failure','direct fallback']) {
  test(`A stale Google init (${obsolete}) cannot change a newer Satellite session`, async()=>{
    const stored={
      atlas_admin_session:{login:'fixture-owner',token:'fixture-token',expiresAt:Date.now()+60000},
      atlas_admin_prefs:{mapSource:'google'},
    };
    let background='map';
    const requests=[], states=[];
    const controller=createAdminController({
      window:{addEventListener(){},sessionStorage:{
        getItem:k=>JSON.stringify(stored[k]),setItem:(k,v)=>{stored[k]=JSON.parse(v);},
        removeItem:k=>{delete stored[k];},
      }},
      getSettings:()=>({background,language:'en'}),
      onStateChange:state=>states.push(state),
      deploymentConfig:{googleMapsKey:'fixture-browser-key'},
      fetcher:(url,options)=>{
        const u=new URL(url,'https://fixture.invalid');
        if(u.pathname.endsWith('/viewport')) return Promise.resolve(Response.json({}));
        return new Promise((resolve,reject)=>requests.push({resolve,reject,body:JSON.parse(options.body)}));
      },
    });
    const map=controller.ensureGoogleSourceReady();
    if(obsolete==='direct fallback'){
      requests[0].resolve(Response.json({}, {status:404}));
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(requests.length,2,'the still-current Map request began direct initialization');
    }
    background='satellite';
    const satellite=controller.ensureGoogleSourceReady();
    assert.equal(requests.at(-1).body.variant,'satellite');
    requests.at(-1).resolve(Response.json({unlocked:true,mode:'tiles'}));
    await satellite;
    assert.equal(controller.googleMode,'tiles');
    if(obsolete==='network failure') requests[0].reject(new Error('obsolete'));
    else if(obsolete==='success') requests[0].resolve(Response.json({unlocked:true,mode:'js-fallback',apiKey:'obsolete'}));
    else if(obsolete==='direct fallback') requests[1].resolve(Response.json({}, {status:503}));
    else requests[0].resolve(Response.json({error:'obsolete'},{status:Number(obsolete)}));
    await map;
    assert.equal(requests.length,obsolete==='direct fallback'?3:2);
    assert.equal(controller.isUnlocked,true);
    assert.equal(controller.mapSource,'google');
    assert.equal(controller.googleMode,'tiles');
    assert.equal(stored.atlas_admin_prefs.mapSource,'google');
    assert.equal(states.length,1);
  });
}

test('Google regional limit requires affirmative whole-view coverage, including the dateline',()=>{
  const viewport={north:1,south:-1,west:170,east:-170};
  const onlyLow={...viewport,maxZoom:9};
  assert.equal(googleViewportHasProvenZoomLimit([onlyLow],viewport,22),true);
  assert.equal(googleViewportHasProvenZoomLimit([onlyLow],viewport,9),false);
  assert.equal(googleViewportHasProvenZoomLimit([onlyLow,{...viewport,west:-180,maxZoom:22}],viewport,22),false);
  assert.equal(googleViewportHasProvenZoomLimit([{...onlyLow,west:179}],viewport,22),false);
  assert.equal(googleViewportHasProvenZoomLimit([{...onlyLow,maxZoom:null}],viewport,22),false);
  assert.equal(googleViewportHasProvenZoomLimit([{...onlyLow,maxZoom:22},{...onlyLow,west:-180,east:180}],viewport,22),false);
  assert.equal(googleViewportHasProvenZoomLimit([{...onlyLow,west:-180,east:180}],viewport,22),true);
});

test('Unavailable Google zoom restores the standard basemap and retries coverage without changing the chosen provider',async()=>{
  const stored={atlas_admin_session:{token:'fixture-token',expiresAt:Date.now()+60000},atlas_admin_prefs:{mapSource:'google'}};
  const source=createGoogleTileSourceSpec();
  const camera=flatCamera({zoom:20,center:[179,0],width:750,height:500});
  const requestedZoom=detail=>planFlatSourceTiles(camera,source,512,detail)[0].canonical.z;
  assert.equal(requestedZoom(0),21);
  assert.equal(requestedZoom(2),22);
  let bounds={zoom:requestedZoom(2),north:1,south:-1,west:170,east:-170};
  const body={dataset:{}}, copy={textContent:''}, attribution={hidden:true};
  const viewportRequests=[], tileRequests=[];
  const settings={background:'satellite',language:'en'};
  const googleLayer=createGoogleTileLayerSpec();
  const standardSatellite={id:'satellite-test',type:'raster',metadata:{'atlas:semantics-version':1,'atlas:background':'satellite'}};
  const controller=createAdminController({
    window:{addEventListener(){},sessionStorage:{getItem:k=>JSON.stringify(stored[k])}},
    document:{body,getElementById:id=>({'gmaps-copyright':copy,'gmaps-attribution':attribution})[id]??null},
    getSettings:()=>settings,
    getViewportBounds:()=>bounds,
    onStateChange:state=>Object.assign(settings,state),
    fetcher:async url=>{
      const u=new URL(url,'https://fixture.invalid');
      if(u.pathname.endsWith('/session'))return Response.json({unlocked:true,mode:'tiles'});
      if(u.pathname.endsWith('/viewport'))return await new Promise(resolve=>viewportRequests.push(resolve));
      tileRequests.push(u.pathname);
      return new Response(new Uint8Array([1,2,3]));
    },
  });
  const tile={url:'atlasgmaps://satellite/22/4136059/2097152?lang=en'};
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  await controller.ensureGoogleSourceReady();
  viewportRequests[0](Response.json({copyright:'Limited',maxZoomRects:[{...bounds,maxZoom:21}]}));
  await settle();
  assert.equal(controller.googleMode,null);
  assert.equal(controller.mapSource,'google');
  assert.equal(layerVisibility(googleLayer,settings),false);
  assert.equal(layerVisibility(standardSatellite,settings),true);
  assert.equal(attribution.hidden,true);
  await assert.rejects(controller.fetchTile(tile),/not available for this viewport/);
  assert.equal(tileRequests.length,0);
  bounds={...bounds,zoom:requestedZoom(0)};
  controller.onViewportChange(true);
  assert.equal(viewportRequests.length,2,'coverage probes continue while fallback is visible');
  viewportRequests[1](Response.json({copyright:'Available',maxZoomRects:[{...bounds,maxZoom:22}]}));
  await settle();
  assert.equal(controller.googleMode,'tiles');
  assert.equal(layerVisibility(googleLayer,settings),true);
  assert.equal(layerVisibility(standardSatellite,settings),false);
  assert.equal(attribution.hidden,false);
  assert.equal(copy.textContent,'Available');
  await controller.fetchTile(tile);
  assert.deepEqual(tileRequests,['/api/gmaps/tiles/satellite/22/4136059/2097152']);
});

test('WebGL coverage uses the canonical tile level, not overscaled zoom',()=>{
  const terrain={id:'fixture-terrain'};
  const map={terrain,coveringTiles:options=>{
    assert.deepEqual(options,{tileSize:256,minzoom:0,maxzoom:22,roundZoom:true,terrain});
    return [{canonical:{z:20}},{canonical:{z:22},overscaledZ:23}];
  }};
  assert.equal(googleWebGLTileZoom(map),22);
  assert.equal(googleWebGLTileZoom({coveringTiles:()=>[]}),undefined);
});
