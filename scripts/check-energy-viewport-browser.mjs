// Fixture-only default. Optional ENERGY_NETWORK_CANDIDATE reads local candidate
// files; no provider acquisition. This samples renderer demand, not all world views.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {BROWSER_LIBRARIES} from './browser-libraries.mjs';
import {validateEnergyNetwork} from './validate-energy-network.mjs';
import {ENERGY_VIEWPORTS,ENERGY_CAMERAS,energyCandidateCameras,energyAcceptanceStyle,energyFixtureFiles,energyResponseRecord,assertEnergyDemand,assertEnergyFixturePixels} from './energy-viewport-acceptance.mjs';
const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const candidate=process.env.ENERGY_NETWORK_CANDIDATE?resolve(process.env.ENERGY_NETWORK_CANDIDATE):null;
if(candidate)await validateEnergyNetwork(candidate);
const files=candidate?null:energyFixtureFiles(),world=JSON.parse(await readFile('styles/world.style.json','utf8'));
const cameras=candidate?[...ENERGY_CAMERAS,...await energyCandidateCameras(candidate)]:ENERGY_CAMERAS;
const expectedSamples=ENERGY_VIEWPORTS.length*(cameras.length+1);
const renderer=BROWSER_LIBRARIES.find(l=>l.package==='maplibre-gl'&&l.target.endsWith('.js'));
const browser=await launchBrowser(),samples=[];
const watchdog=setTimeout(()=>{console.error('Energy viewport acceptance exceeded 15 minutes');process.exit(1);},900000);
try{
 for(const viewport of ENERGY_VIEWPORTS)for(const [index,camera] of [...cameras,cameras[0]].entries()){
  // Every sample owns a fresh HTTP cache, protocol cache and renderer.
  const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:viewport.deviceScaleFactor});
  const requests=[],errors=[];let page,observed;
  try{
   await installEmptyMapProviders(context,base);
   await context.route('**/data/energy-network/**',async route=>{
    const path=new URL(route.request().url()).pathname.split('/data/energy-network/')[1];
    try{
     // Validate path before any filesystem read; bytes remain local.
     energyResponseRecord(path,Buffer.alloc(0));
     const body=candidate?await readFile(join(candidate,path)):files.get(path);
     if(!body)throw new Error('Missing energy fixture '+path);
     requests.push(energyResponseRecord(path,body));
     await route.fulfill({status:200,contentType:path.endsWith('.json')?'application/json':'application/gzip',body});
    }catch(error){errors.push(error.message);await route.fulfill({status:500,body:'energy fixture failed'});}
   });
   const active=index!==cameras.length;
   const style={...energyAcceptanceStyle(world,active),projection:{type:camera.projection}};
   await context.route(`${base}energy-viewport.html`,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>html,body,#map{margin:0;width:100%;height:100%}</style><div id="map"></div><script src="${new URL(renderer.target,base).href}"></script><script type="module">
    import {createEnergyNetworkProtocol} from './energy-network.mjs';
    import {HIGH_PITCH_TILE_CACHE_LIMIT,HIGH_PITCH_THRESHOLD,HIGH_PITCH_LOD,TERRAIN_3D_MAX_PITCH} from './terrain-3d.mjs';
    window.energyCalls=[];window.energyPending=0;window.energyErrors=[];window.energyIdle=false;
    const protocol=createEnergyNetworkProtocol({root:new URL('./data/energy-network/',location.href),active:()=>${active}});
    maplibregl.addProtocol('energynetwork',async(p,c)=>{energyCalls.push(p.url);energyPending++;try{return await protocol(p,c);}finally{energyPending--;}});
    const map=window.energyMap=new maplibregl.Map({container:'map',style:${JSON.stringify(style)},center:${JSON.stringify(camera.center)},zoom:${camera.zoom},bearing:${camera.bearing},pitch:${camera.pitch},maxPitch:TERRAIN_3D_MAX_PITCH,maxTileCacheSize:HIGH_PITCH_TILE_CACHE_LIMIT,fadeDuration:0,attributionControl:false});
    map.on('style.load',()=>map.setSourceTileLodParams(...(${camera.pitch}>HIGH_PITCH_THRESHOLD?HIGH_PITCH_LOD.general:HIGH_PITCH_LOD.normal)));
    map.on('error',e=>energyErrors.push(e.error?.message||String(e)));map.on('idle',()=>energyIdle=true);
   </script>`}));
   page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.goto(`${base}energy-viewport.html`,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.energyIdle&&window.energyMap?.loaded()&&energyMap.areTilesLoaded()&&energyPending===0,{},{timeout:60000});
   observed=await page.evaluate(()=>({protocolRequests:energyCalls,errors:energyErrors,center:energyMap.getCenter().toArray(),zoom:energyMap.getZoom(),pitch:energyMap.getPitch(),bearing:energyMap.getBearing(),projection:energyMap.getProjection().type,rendered:energyMap.queryRenderedFeatures().length}));
   assert.ok(observed.center.every((value,i)=>Math.abs(value-camera.center[i])<1e-6),'camera centre changed');assert.ok(Math.abs(observed.zoom-camera.zoom)<1e-6,'camera zoom changed');assert.ok(Math.abs(observed.pitch-camera.pitch)<1e-6,'camera pitch changed');assert.ok(Math.abs(observed.bearing-camera.bearing)<1e-6,'camera bearing changed');assert.equal(observed.projection,camera.projection);
   // Feature picking can return zero above the horizon even when the
   // framebuffer contains geometry. Read actual pixels inside the render event.
   const requestsBeforeCapture=requests.length;
   observed.energyPixels=await page.evaluate(()=>new Promise((resolve,reject)=>{
    let count;
    const cleanup=()=>{clearTimeout(timer);energyMap.off('render',capture);energyMap.off('idle',settle);};
    const capture=()=>{try{
     const gl=energyMap.getCanvas().getContext('webgl2'),pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
     gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
     count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>0&&pixels[i]>pixels[i+1]+8&&pixels[i]>pixels[i+2]+8)count++;
    }catch(error){cleanup();reject(error);}};
    const settle=()=>{
     if(count===undefined||!energyMap.loaded()||!energyMap.areTilesLoaded()||energyPending!==0)return;
     cleanup();resolve(count);
    };
    const timer=setTimeout(()=>{cleanup();reject(new Error('pixel capture did not reach a fresh settled frame'));},15000);
    // render dispatch precedes MapLibre's transition bookkeeping. Wait for a new
    // idle from this repaint, not the sticky flag from the initial load.
    energyMap.once('render',capture);energyMap.on('idle',settle);energyMap.triggerRepaint();
   }));
   observed.afterCapture=await page.evaluate(()=>({loaded:energyMap.loaded(),styleDirty:energyMap._styleDirty,sourcesDirty:energyMap._sourcesDirty,styleLoaded:energyMap.style?.loaded(),styleInitialized:energyMap.style?._loaded,updatedSources:Object.keys(energyMap.style?._updatedSources||{}),imagesLoaded:energyMap.style?.imageManager?.isLoaded(),tilesLoaded:energyMap.areTilesLoaded(),pending:energyPending,protocolRequests:[...energyCalls],errors:[...energyErrors]}));
   assert.ok(observed.afterCapture.loaded&&observed.afterCapture.tilesLoaded&&observed.afterCapture.pending===0,'pixel capture must retain settled tile demand');
   assert.deepEqual(observed.afterCapture.protocolRequests,observed.protocolRequests,'pixel capture changed protocol demand');
   assert.equal(requests.length,requestsBeforeCapture,'pixel capture fetched another fixture response');
   observed.protocolRequests=await page.evaluate(()=>energyCalls);observed.errors=await page.evaluate(()=>energyErrors);
   if(!candidate)assertEnergyFixturePixels(observed.energyPixels,active);
   if(camera.expectedBundle&&active)assert.ok(requests.some(r=>r.path===camera.expectedBundle),'candidate hotspot bundle was not fetched');
   const summary=assertEnergyDemand({requests,protocolRequests:observed.protocolRequests,active,errors:[...errors,...observed.errors]});
   samples.push({viewport,camera,active,observed,...summary,responses:requests});
   console.log(`energy viewport ${viewport.width} case ${index}: ${summary.bytes} bytes / ${summary.requests} responses`);
  }catch(error){samples.push({viewport,camera,requests,errors,observed,failure:error.message});await mkdir('browser-review',{recursive:true});if(page)await page.screenshot({path:`browser-review/energy-viewport-failure-${viewport.width}-${index}.png`}).catch(()=>{});throw error;}
  finally{await context.close();}
 }
}finally{
 clearTimeout(watchdog);
 let browserClosed=false;
 try{await browser.close();browserClosed=true;}finally{
 await mkdir('browser-review',{recursive:true});
 await writeFile('browser-review/energy-viewport-budget.json',JSON.stringify({schema:1,passed:browserClosed&&samples.length===expectedSamples&&samples.every(sample=>!sample.failure),kind:candidate?'local candidate camera samples':'synthetic camera acceptance',worldwideBudgetVerified:false,expectedSamples:expectedSamples,scope:'cold production energy sources/layers and protocol; isolated renderer, no terrain or other overlays; response body bytes include metadata and repeated compressed bundles, exclude HTTP headers',samples},null,2));
 }
}
