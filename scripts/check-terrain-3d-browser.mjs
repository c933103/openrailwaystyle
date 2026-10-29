// Deterministic native MapLibre terrain check. No external provider traffic:
// every DEM, water polygon and contour is synthetic, but the production
// atlas-terrain protocol, Terrarium encode and renderer are real.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {TERRAIN_3D_BROWSER_FIXTURE as fixture,captureTerrain3DFailure,terrain3DWaterFixture} from './terrain-3d-browser-fixture.mjs';

// Real MVT bytes: the worker must decode ocean polygons itself rather than
// falling back to the page. Both paths decode the same validated bytes.
const MASK_MVT = Buffer.from(terrain3DWaterFixture()).toString('base64');

const base=(process.env.ATLAS_FIXTURE_BASE_URL||process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const browser=await launchBrowser({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:fixture.width,height:fixture.height},serviceWorkers:'block'});
const page=await context.newPage(), failures=[];
await mkdir('browser-review',{recursive:true});
page.on('pageerror',error=>failures.push(error.message));
try {
  await page.route('**/*', route => {
    if(new URL(route.request().url()).origin!==new URL(base).origin)
      return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.route('**/atlas-terrain-test.html',route=>route.fulfill({
    contentType:'text/html',
    body:`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body,#map{margin:0;width:100%;height:100%}
    </style></head><body><div id="map"></div>
    <script src="vendor/maplibre-gl-5.24.0-atlas.1.js"></script>
    <script type="module">
      import {installTerrain3D,syncTerrain3D,syncHighPitchTileBudget} from './terrain-3d.mjs';
      import {readTile} from './vendor/tile-labels.js';
      const {tileSize:SIZE,demZoom:z,tileX:x,tileY:y}=${JSON.stringify(fixture)},n=2**z;
      const lng=(fraction)=>(x+fraction)/n*360-180;
      const lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+0.5)/n)))*180/Math.PI;
      const makeTile=(coarse)=>{
        const data=new Float32Array(SIZE*SIZE);
        for(let iy=0;iy<SIZE;iy++)for(let ix=0;ix<SIZE;ix++){
          // One prominent land summit makes visual deformation measurable.
          // The original sea/land sampling locations stay -875/340 m.
          const dx=(ix-160)/12,dy=(iy-128)/28;
          const peak=1100*Math.exp(-dx*dx-dy*dy);
          data[iy*SIZE+ix]=coarse?-875:(ix<128?0:340+peak);
        }
        return {width:SIZE,height:SIZE,data};
      };
      const counts=window.terrainCounts={fine:0,coarse:0,water:0};
      window.requestedDems=[];
      window.terrainErrors=[];
      const waterBytes=Uint8Array.from(atob('${MASK_MVT}'),c=>c.charCodeAt(0)).buffer;
      window.workerReplies=[];
      window.workerErrors=[];
      installTerrain3D(maplibregl,{getDemTile:async (z,x,y)=>{
        counts[z<=10?'coarse':'fine']++;
        window.requestedDems.push({z,x,y});
        return makeTile(z<=10);
      }},{waterTile:async()=>{counts.water++;return {data:waterBytes.slice(0)};},
         readTile,
         createWorker:()=>{
           const worker=new Worker('./vendor/terrain-3d-worker.js');
           worker.addEventListener('message',event=>window.workerReplies.push({
             encoded:Boolean(event.data?.data),error:event.data?.error||null
           }));
           worker.addEventListener('error',event=>window.workerErrors.push(event.message));
           return worker;
         }});
      const map=window.fixtureMap=new maplibregl.Map({
        container:'map',center:[lng(0.5),lat],zoom:${fixture.cameraZoom},pitch:${fixture.pitch},maxPitch:85,maxTileCacheSize:96,
        canvasContextAttributes:{preserveDrawingBuffer:true},
        style:{version:8,sources:{
          terrain3d:{type:'raster-dem',tiles:['atlas-terrain://{z}/{x}/{y}'],
            tileSize:256,maxzoom:11,encoding:'terrarium'},
          ground:{type:'geojson',data:{type:'FeatureCollection',features:[{
            type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[
              [[-1,-1],[-1,1],[1,1],[1,-1],[-1,-1]]
            ]}
          }]}},
          seaSurface:{type:'geojson',data:{type:'FeatureCollection',features:[{
            type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[
              [lng(-1),lat-1],[lng(0.5),lat-1],[lng(0.5),lat+1],[lng(-1),lat+1],[lng(-1),lat-1]
            ]]},
          }]}},
          visualContours:{type:'geojson',data:{type:'FeatureCollection',
            features:Array.from({length:9},(_,i)=>({
              type:'Feature',properties:{ele:i<4?-875:340},
              geometry:{type:'LineString',coordinates:[[lng(i/8),lat-1],[lng(i/8),lat+1]]}
            }))
          }}
        },layers:[
          {id:'background',type:'background',paint:{'background-color':'#f2e9d4'}},
          {id:'ground',type:'fill',source:'ground',paint:{'fill-color':'#d6cfb9'}},
          {id:'ocean-fixture',type:'fill',source:'seaSurface',paint:{'fill-color':'#b9d9e8'}},
          {id:'contours-fixture',type:'line',source:'visualContours',
            layout:{'line-join':'round'},paint:{
              'line-color':['case',['<',['get','ele'],0],'#49768c','#927b5a'],
              'line-width':3
            }}
        ]}
      });
      map.on('error',event=>window.terrainErrors.push({sourceId:event.sourceId||null,
        message:event.error?.message||String(event.error)}));
      const points={sea:[lng(0.25),lat],land:[lng(0.75),lat],summit:[lng(160/256),lat]};
      window.terrainState=()=>({points,pitch:map.getPitch(),
        source:map.getTerrain()?.source||null,counts,
        sea:map.queryTerrainElevation(points.sea),
        land:map.queryTerrainElevation(points.land),
        summit:map.queryTerrainElevation(points.summit)});
      map.on('load',()=>{syncHighPitchTileBudget(map);syncTerrain3D(map,true);window.terrainLoaded=true;});
      map.on('pitch',()=>syncHighPitchTileBudget(map));
    </script></body></html>`
  }));
  await page.goto(base+'atlas-terrain-test.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.terrainLoaded,null,{timeout:30000});
  await page.waitForFunction(()=>{
    const s=window.terrainState();
    return s.source==='terrain3d'&&s.sea!==null&&s.land!==null
      &&s.sea < -750&&s.land > 250&&s.summit > s.land+600;
  },null,{timeout:45000});
  const terrain=await page.evaluate(()=>window.terrainState());
  const workerReplies=await page.evaluate(()=>window.workerReplies);
  assert.ok(workerReplies.some(reply=>reply.encoded),'the native terrain worker must encode real decoded ocean MVT');
  assert.ok(workerReplies.every(reply=>!reply.error),JSON.stringify(workerReplies));
  assert.equal(terrain.source,'terrain3d');
  assert.ok(terrain.sea < -750,JSON.stringify(terrain));
  assert.ok(terrain.land > 250,JSON.stringify(terrain));
  assert.ok(terrain.summit > terrain.land+600,'a real hill must rise above its surroundings');
  assert.ok(terrain.counts.fine>0&&terrain.counts.coarse>0&&terrain.counts.water>0,
    'the browser must recover real negative ocean mesh cells');
  await page.screenshot({path:'browser-review/terrain-3d-seabed-synthetic.png'});
  // Renderer acceptance, not merely source/query acceptance: use the real
  // WebGL output and compare pixels at the SAME pitch, centre and zoom.
  // Synthetic sea fill and signed contour strokes provide visible reference
  // geometry that must follow the 3D mesh rather than stay on a flat plane.
  // Keep the framebuffer bytes inside the browser: crossing the process
  // boundary would serialize several million RGBA values twice.
  const captureFrame = async (store3D) => page.evaluate(async ({store3D}) => {
    const map=window.fixtureMap;
    await new Promise(resolve=>{map.once('render',resolve);map.triggerRepaint();});
    const source=map.getCanvas(),frame=document.createElement('canvas');
    frame.width=source.width; frame.height=source.height;
    const context=frame.getContext('2d',{willReadFrequently:true});
    context.drawImage(source,0,0);
    const pixels=context.getImageData(0,0,frame.width,frame.height).data;
    if(store3D) {window.terrain3DFrame=pixels;return {pixels:pixels.length/4};}
    const original=window.terrain3DFrame;
    if(!original||original.length!==pixels.length)throw new Error('Mismatched 3D/flat frame dimensions');
    let changed=0,significant=0;
    for(let i=0;i<pixels.length;i+=4) {
      const delta=Math.abs(original[i]-pixels[i])+
        Math.abs(original[i+1]-pixels[i+1])+
        Math.abs(original[i+2]-pixels[i+2]);
      if(delta>6)changed++;
      if(delta>48)significant++;
    }
    return {changed,significant,total:pixels.length/4};
  },{store3D});
  await captureFrame(true);
  await page.evaluate(()=>window.fixtureMap.setTerrain(null));
  await page.waitForFunction(()=>window.fixtureMap.getTerrain()===null);
  const visual={...await captureFrame(false),pitch:terrain.pitch,sea:terrain.sea,land:terrain.land};
  console.log('Native 3D vs flat map at identical pitch:',visual);
  await writeFile('browser-review/terrain-3d-pixel-difference.json',JSON.stringify(visual,null,2)+'\n');
  assert.ok(visual.significant>=300,'3D mesh must visibly deform the coastline and contour strokes, not just report numeric heights: '+JSON.stringify(visual));
  await page.screenshot({path:'browser-review/terrain-flat-same-pitch-synthetic.png'});
  // A second, stricter control keeps the *same* terrain source and renderer
  // enabled, but flattens only its heights. This rules out a false positive
  // caused solely by the renderer switching from direct to terrain drawing.
  await page.evaluate(()=>window.fixtureMap.setTerrain({source:'terrain3d',exaggeration:0}));
  await page.waitForFunction(()=>window.fixtureMap.getTerrain()?.exaggeration===0);
  const flattened={...await captureFrame(false),pitch:terrain.pitch,sea:terrain.sea,land:terrain.land};
  console.log('1× DEM vs 0× DEM with terrain renderer still on:',flattened);
  await writeFile('browser-review/terrain-3d-height-only-difference.json',JSON.stringify(flattened,null,2)+'\n');
  assert.ok(flattened.significant>=300,'Real height displacement must change the render even when both images use terrain mode: '+JSON.stringify(flattened));
  await page.screenshot({path:'browser-review/terrain-zero-height-same-pitch-synthetic.png'});
  // Restore the genuine 1× DEM before testing the original overhead release.
  await page.evaluate(()=>window.fixtureMap.setTerrain({source:'terrain3d',exaggeration:1}));
  await page.waitForFunction(()=>window.fixtureMap.getTerrain()?.exaggeration===1);
  // User-visible relief strength: same source, same camera, same 3D renderer.
  // A 3× surface must produce a different framebuffer from the true 1×
  // surface. Test this independently from the existing 1× vs 0× gate.
  await page.evaluate(()=>window.fixtureMap.setTerrain({source:'terrain3d',exaggeration:3}));
  await page.waitForFunction(()=>window.fixtureMap.getTerrain()?.exaggeration===3);
  const boosted={...await captureFrame(false),pitch:terrain.pitch,sea:terrain.sea,land:terrain.land};
  console.log('Enhanced 3× vertical relief vs true-scale 1× terrain:',boosted);
  await writeFile('browser-review/terrain-3d-exaggeration-pixels.json',JSON.stringify(boosted,null,2)+'\n');
  assert.ok(boosted.significant>=300,'3× vertical scale must change actual mountain and seabed geometry: '+JSON.stringify(boosted));
  const boostedHeights=await page.evaluate(()=>window.terrainState());
  assert.ok(boostedHeights.summit>terrain.summit*2.5,'MapLibre returns visually exaggerated DEM values');
  assert.ok(boostedHeights.sea<terrain.sea*2.5,'negative seabed values are visually exaggerated as well');
  await page.screenshot({path:'browser-review/terrain-enhanced-3x-same-pitch-synthetic.png'});
  await page.evaluate(()=>window.fixtureMap.setTerrain({source:'terrain3d',exaggeration:1}));
  await page.waitForFunction(()=>window.fixtureMap.getTerrain()?.exaggeration===1);

  // Native MapLibre 5.24 acceptance at near-horizontal camera pitch.
  // Its tile LOD policy must pick coarser terrain *toward* the horizon,
  // without fabricating flat or missing PNG tiles. Verify the real source
  // functions were installed by the production helper, not just a mock.
  const highPitch=await page.evaluate(() => {
    const map=window.fixtureMap;
    map.setPitch(82);
    const terrain=map.getSource('terrain3d');
    const basemap=map.getSource('ground');
    const terrainZoom=terrain.calculateTileZoom;
    const baseZoom=basemap.calculateTileZoom;
    return {
      pitch:map.getPitch(),
      maxPitch:map.getMaxPitch(),
      terrainLod:typeof terrainZoom,
      basemapLod:typeof baseZoom,
      near:terrainZoom?.(11,0,0.1,0.1,35),
      far:terrainZoom?.(11,1,0.1,0.1,35),
      // Some MapLibre styles use the implicit default projection, for
      // which getProjection() is undefined despite valid 3D rendering.
      // Projection is diagnostic only; the tests below assert actual mesh.
      projection:map.getProjection?.()?.type ?? 'implicit-default',
    };
  });
  assert.equal(highPitch.maxPitch,85,'native map accepts greater than the default 60°');
  assert.ok(highPitch.pitch>=81.9,'the map can tilt to at least 82°');
  assert.equal(highPitch.terrainLod,'function','near-horizon terrain uses native tile LOD');
  assert.equal(highPitch.basemapLod,'function','horizon load budget also governs ordinary map tiles');
  assert.ok(Number.isFinite(highPitch.near)&&Number.isFinite(highPitch.far)
    &&highPitch.far<highPitch.near-2,
    'a distant horizon tile must be requested at a lower LOD: '+JSON.stringify(highPitch));
  console.log('Native high-pitch bounded LOD:',highPitch);
  // A station source installed *after* the high-angle policy must not use
  // the default high-detail horizon requests until the camera is tilted
  // across 65° again. Source-specific LOD works with MapLibre itself.
  const lateSource=await page.evaluate(async()=>{
    const {syncHighPitchTileBudget}=await import('./terrain-3d.mjs');
    const map=window.fixtureMap, id='stationWorldLate';
    map.addSource(id,{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    const first=syncHighPitchTileBudget(map,id);
    const fn=map.getSource(id).calculateTileZoom;
    const again=syncHighPitchTileBudget(map,id);
    return {first,again,hasNativeLod:typeof fn==='function',
      near:fn?.(11,0,0.1,0.1,35),far:fn?.(11,1,0.1,0.1,35)};
  });
  assert.equal(lateSource.first,true,'new source at 82° must receive LOD without pitching again');
  assert.equal(lateSource.again,false,'repeated metadata must not reconfigure a loaded source');
  assert.equal(lateSource.hasNativeLod,true);
  assert.ok(Number.isFinite(lateSource.near)&&Number.isFinite(lateSource.far)
    &&lateSource.far<lateSource.near-2,
    'late-created source must request a coarser horizon: '+JSON.stringify(lateSource));
  console.log('Late station source high-pitch tile LOD:',lateSource);

  await writeFile('browser-review/terrain-high-pitch-lod.json',JSON.stringify(highPitch,null,2)+'\n');
  for (const pitch of [82,85]) {
    await page.evaluate(pitch=>window.fixtureMap.setPitch(pitch),pitch);
    await page.waitForFunction(() => {
      const heights=window.terrainState?.();
      return heights && heights.sea < -700 && heights.land > 200;
    },null,{timeout:45000});
    const atHorizon=await page.evaluate(()=>window.terrainState());
    assert.ok(atHorizon.sea < -700 && atHorizon.land > 200,
      'even with coarser horizon tiles, land and seabed retain their sign near the camera');
    await page.screenshot({path:`browser-review/terrain-high-pitch-${pitch}deg.png`});
    // The higher angle must also render genuine height displacement rather
    // than merely let the camera tilt over a flat ground plane.
    await captureFrame(true);
    await page.evaluate(()=>window.fixtureMap.setTerrain({source:'terrain3d',exaggeration:0}));
    await page.waitForFunction(()=>window.fixtureMap.getTerrain()?.exaggeration===0);
    const horizonDifference=await captureFrame(false);
    assert.ok(horizonDifference.significant>=200,
      `at ${pitch}° pitch the rendered 3D surface must differ from zero-height terrain: `+JSON.stringify(horizonDifference));
    await writeFile(`browser-review/terrain-high-pitch-${pitch}-pixels.json`,JSON.stringify(horizonDifference,null,2)+'\n');
    await page.evaluate(()=>window.fixtureMap.setTerrain({source:'terrain3d',exaggeration:1}));
    await page.waitForFunction(()=>window.fixtureMap.getTerrain()?.exaggeration===1);
  }


  await page.evaluate(async()=>{
    // evaluate runs outside the fixture module's lexical scope. Import the
    // production helper here too; do not accidentally replace terrain checks
    // with a ReferenceError after the signed-height assertions pass.
    const {syncTerrain3D}=await import('./terrain-3d.mjs');
    const map=window.fixtureMap;map.setPitch(0);syncTerrain3D(map,true);
  });
  await page.waitForFunction(()=>window.fixtureMap.getTerrain()===null);
  assert.equal(await page.evaluate(()=>window.fixtureMap.queryTerrainElevation([0,0])),null);
  assert.deepEqual(failures,[]);
  console.log('3D native terrain: signed sea and land elevations, overhead release',terrain);
} catch(error) {
  // Preserve the unchanged 45-second predicate's actual state before cleanup.
  // Every input is synthetic; this adds evidence, never a retry or waiver.
  const diagnostics=await page.evaluate(captureTerrain3DFailure)
    .catch(diagnosticError=>({unavailable:diagnosticError.message}));
  const evidence={error:error.message,pageErrors:failures,...diagnostics};
  console.error('3D terrain failure diagnostics:',JSON.stringify(evidence));
  await writeFile('browser-review/terrain-3d-failure.json',JSON.stringify(evidence,null,2)+'\n')
    .catch(saveError=>console.error('Cannot save terrain diagnostics:',saveError.message));
  await page.screenshot({path:'browser-review/terrain-3d-failure.png'})
    .catch(saveError=>console.error('Cannot save terrain failure screenshot:',saveError.message));
  throw error;
} finally {await context.close();await browser.close();}
