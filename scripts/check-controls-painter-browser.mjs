// One controlled pair, never retried. Compare the pinned original painter
// with the actual application guard; keep the accepted controls checker,
// provider budget and deadline unchanged.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launchBrowser} from './browser.mjs';
import {BROWSER_ARGS} from './browser.mjs';
import {createRequestLifecycle} from './request-lifecycle.mjs';
import {waitUntil} from './wait-until.mjs';
import {clickVisibleControl} from './click-visible-control.mjs';
import {readMapRenderState} from './map-render-state.mjs';
import {installControlsFetchProbe,controlsMapIdle,controlsTerrainNaturalEquivalent} from './controls-painter-probe.mjs';
import {controlsPainterManifest,installControlsPainterFixtures,nonemptyPainterStyle,comparePixelBytes} from './controls-painter-fixture.mjs';
import {MAPLIBRE_BACKPORT} from '../styles/map-controls.mjs';

const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const address=new URL(base);
assert.ok(address.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(address.hostname),'This experiment is loopback-only');
assert.equal(process.env.BROWSER_WS_ENDPOINT,undefined,'Each arm needs a fresh, identically configured browser process');
await mkdir('browser-review',{recursive:true});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=await controlsPainterManifest(),report={manifest,arms:[],comparisons:[],causation:'Original intermittent timeout remains unresolved; a single pair is diagnostic, not a statistical speed claim.'};
const pixelBuffers=new Map(),terrainPixelBuffers=new Map();
const save=()=>writeFile('browser-review/controls-painter-comparison.json',JSON.stringify(report,null,2));
const deadline=setTimeout(()=>{void save().finally(()=>process.exit(1));},12*60*1000);deadline.unref();
async function boundedRead(page,fn,timeout=2000){let timer;try{return await Promise.race([page.evaluate(fn).catch(()=>({unavailable:true})),new Promise(resolve=>{timer=setTimeout(()=>resolve({unavailable:true,timeout}),timeout);})]);}finally{clearTimeout(timer);}}
async function idle(page){return waitUntil(page,controlsMapIdle,undefined,{timeout:60000});}
async function attachMap(page){await page.evaluate(async()=>{globalThis.controlsMap=(await import(document.querySelector('script[type="module"]').src)).map;});}
async function ready(page){await page.waitForSelector('body[data-map-ready="true"]');await page.locator('.maplibregl-ctrl-scale').waitFor();await attachMap(page);await idle(page);}
async function installProbe(page,guard){return page.evaluate(async({base,guard})=>{
 const {installControlsPainterProbe}=await import(base+'__controls-painter-probe.mjs');
 const {installHiddenTileMaskGuard}=await import(base+'map-controls.mjs');
 const painter=controlsMap.painter,original=Object.getPrototypeOf(painter)._renderTileClippingMasks;
 if(typeof original!=='function')throw new Error('Pinned original painter unavailable');
 // Only this diagnostic removes the app's instance wrapper for its baseline.
 // Both arms use the same original method and the candidate uses the real
 // production installer, not the historical experimental wrapper.
 painter._renderTileClippingMasks=original;
 if(guard)installHiddenTileMaskGuard(controlsMap);
 const observation=installControlsPainterProbe(controlsMap,{guard:false});
 globalThis.controlsProbe={...observation,snapshot:()=>({...observation.snapshot(),productionGuard:guard})};
 return original.toString();
},{base,guard});}
async function detail(page,next){
 await clickVisibleControl(page,'button.atlas-ctrl[title^="More detail:"]');
 await waitUntil(page,expected=>{const map=document.querySelector('#map'),button=document.querySelector('button.atlas-ctrl[title^="More detail:"]');const level=map.classList.contains('detail-2')?2:map.classList.contains('detail')?1:0;return level===expected&&button.title.startsWith(`More detail: map drawn at ${100/2**expected}%.`);},next,{timeout:20000});
 await page.waitForFunction(expected=>{try{return JSON.parse(decodeURIComponent(document.cookie.match(/(?:^|; )atlas_settings=([^;]*)/)?.[1]||'%7B%7D')).detail===expected;}catch{return false;}},next);
}
async function longStatus(page){await page.evaluate(()=>{document.querySelector('#map-status').textContent='Some map data could not load. Check your connection or reload to retry. A longer status message must wrap without covering the ruler or coordinates.';});}
async function originalTransition(page,guard,result){
 // Same startup/background/reload/settings actions in each arm, using the
 // current application during preparation. Only the measured transition
 // selects original versus guarded masks; historical scheduling is not replayed.
 await page.goto(base+'?mode=infrastructure&relief=0&inactive=0#7/34/129',{waitUntil:'domcontentloaded'});await ready(page);
 await page.evaluate(()=>document.documentElement.style.setProperty('--map-safe-bottom','24px'));
 let info=page.locator('.maplibregl-ctrl-attrib-button');await info.click();
 await page.reload({waitUntil:'domcontentloaded',timeout:30000});await ready(page);
 for(const background of ['carto','satellite','hybrid','map'])await page.locator(`[data-background="${background}"]`).click();
 info=page.locator('.maplibregl-ctrl-attrib-button');await info.focus();await page.keyboard.press('Space');
 await page.reload({waitUntil:'domcontentloaded',timeout:30000});await ready(page);
 info=page.locator('.maplibregl-ctrl-attrib-button');await info.focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');
 await page.setViewportSize({width:1365,height:900});
 await page.evaluate(()=>{document.documentElement.style.setProperty('--map-safe-left','18px');document.documentElement.style.setProperty('--map-safe-right','12px');document.documentElement.style.setProperty('--map-safe-bottom','24px');window.dispatchEvent(new Event('resize'));});
 if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();
 await page.locator('#readout').evaluate(e=>{e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));});
 await idle(page);await longStatus(page);await detail(page,1);await idle(page);await longStatus(page);
 result.productionGuardInstalled=await page.evaluate(()=>controlsMap.painter._renderTileClippingMasks!==Object.getPrototypeOf(controlsMap.painter)._renderTileClippingMasks);
 assert.equal(result.productionGuardInstalled,true,'The real application must install its instance guard');
 result.originalMaskSha256=digest(await installProbe(page,guard));
 await page.evaluate(()=>controlsProbe.arm());const start=Date.now();
 try{await detail(page,2);await idle(page);result.settled=true;}
 catch(error){result.settled=false;result.failure='first-detail-2-action-or-settlement';throw error;}
 finally{
  result.nodeActionAndSettlementMs=Date.now()-start;
  result.probe=await boundedRead(page,()=>{controlsProbe.stop();return controlsProbe.snapshot();});
 }
}

const pixelCases=[
 {name:'mercator-hidden',view:{zoom:3,center:[0,0],bearing:0,pitch:0}},
 {name:'mercator-shown',toggle:'visible',expectRed:true},
 {name:'mercator-hidden-again',toggle:'none'},
 {name:'mercator-zoom4',view:{zoom:4,center:[0,0],bearing:0,pitch:0}},
 {name:'mercator-pitched',view:{zoom:4,center:[0,0],bearing:23,pitch:45}},
 {name:'globe',projection:'globe',view:{zoom:2,center:[0,0],bearing:0,pitch:0}},
 {name:'terrain',projection:'mercator',terrain:true,view:{zoom:3,center:[0,0],bearing:23,pitch:45}},
];
async function pixelChecks(page,guard,arm){
 await page.setViewportSize({width:512,height:512});
 await page.goto(base+'__controls-painter-pixels');
 await page.addScriptTag({url:base+MAPLIBRE_BACKPORT.target});
 await page.evaluate(style=>{globalThis.controlsMap=new maplibregl.Map({container:'map',style,center:[0,0],zoom:3,pixelRatio:.25,fadeDuration:0,attributionControl:false,interactive:false,canvasContextAttributes:{preserveDrawingBuffer:true}});},nonemptyPainterStyle(base));
 await idle(page);
 const methodHash=digest(await installProbe(page,guard));
 if(arm.transition.originalMaskSha256)assert.equal(methodHash,arm.transition.originalMaskSha256,'Both maps use the same original pinned painter');
 arm.pixelOriginalMaskSha256=methodHash;
 for(const entry of pixelCases){
  await page.evaluate(entry=>{controlsProbe.arm();if(entry.toggle)controlsMap.setLayoutProperty('hidden-toggle','visibility',entry.toggle);if(entry.projection)controlsMap.setProjection({type:entry.projection});if(entry.terrain)controlsMap.setTerrain({source:'dem',exaggeration:1.5});if(entry.view)controlsMap.jumpTo(entry.view);},entry);
  await idle(page);
  const probe=await boundedRead(page,()=>{controlsProbe.stop();return controlsProbe.snapshot();});
  assert.ok(!probe.unavailable&&!probe.dispatchTruncated,'Pixel-case observations must be complete');
  const pixels=await readPixels(page);
  const bytes=Buffer.from(pixels.rgba,'base64');delete pixels.rgba;
  assert.equal(bytes.length,512*512*4);assert.ok(pixels.ink>1000&&pixels.features>0,'A blank render cannot establish equivalence');
  if(entry.expectRed)assert.ok(pixels.red>20,'Showing the hidden layer must visibly change the image');
  else if(entry.name.includes('hidden'))assert.equal(pixels.red,0,'Hidden red layer must not paint');
  pixelBuffers.set(`${arm.name}:${entry.name}`,bytes);
  const record={case:entry.name,sha256:digest(bytes),...pixels,probe};arm.pixels.push(record);
  await save(); // Preserve the natural result even if controlled sampling fails.
  if(entry.terrain){
   record.terrainSamples=[];
   for(const cache of ['cold','warm']){
    const sampledPixels=await readPixels(page,cache),{sample}=sampledPixels,sampledBytes=Buffer.from(sampledPixels.rgba,'base64');
    sample.sha256=digest(sampledBytes);sample.naturalChangedBytes=comparePixelBytes(bytes,sampledBytes);
    terrainPixelBuffers.set(`${arm.name}:${cache}`,sampledBytes);record.terrainSamples.push(sample);
    await save();
    assert.equal(sample.naturalChangedBytes,0,`${cache} redraw must preserve the natural terrain image`);
   }
  }
  await page.screenshot({path:`browser-review/controls-painter-${arm.name}-${entry.name}.png`});
  await save();
 }
}
async function readPixels(page,cache){
 return page.evaluate(async({base,cache})=>{
   let sample;
   if(cache){
    const {sampleControlsTerrainFrame}=await import(base+'__controls-painter-probe.mjs');
    sample=sampleControlsTerrainFrame(controlsMap,controlsProbe,{cache});
   }
   const canvas=controlsMap.getCanvas(),copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;
   if(copy.width!==512||copy.height!==512)throw new Error('Unexpected bounded pixel dimensions');
   const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);const data=ctx.getImageData(0,0,512,512).data;
   let ink=0,blue=0,red=0;for(let i=0;i<data.length;i+=4){const[r,g,b,a]=data.slice(i,i+4);if(a&&Math.min(r,g,b)<240)ink++;if(a&&b>r+20&&b>g+20)blue++;if(a&&r>g+30&&r>b+30)red++;}
   const chunks=[];for(let i=0;i<data.length;i+=8192)chunks.push(String.fromCharCode(...data.subarray(i,i+8192)));
   return {sample,rgba:btoa(chunks.join('')),ink,blue,red,features:controlsMap.queryRenderedFeatures({layers:['lines']}).length};
  },{base,cache});
}

try{
 for(const guard of [false,true]){
  const arm={name:guard?'hidden-mask-guard':'baseline',guard,transition:{},pixels:[],errors:[]};report.arms.push(arm);
  const browser=await launchBrowser({headless:true,args:BROWSER_ARGS});arm.browserVersion=browser.version();
  const context=await browser.newContext({viewport:{width:1365,height:900},deviceScaleFactor:1,serviceWorkers:'block'});
  const lifecycle=createRequestLifecycle();arm.fixtureCounts=await installControlsPainterFixtures(context,base,lifecycle);
  await context.addInitScript(installControlsFetchProbe);
  const page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('request',r=>lifecycle.start(r));page.on('response',r=>lifecycle.responded(r));page.on('requestfinished',r=>lifecycle.finished(r));page.on('requestfailed',r=>lifecycle.failed(r));
  page.on('pageerror',()=>arm.errors.push('pageerror'));
  try{
   try{await originalTransition(page,guard,arm.transition);}catch(error){
    arm.transition.failure??='prefix-failed';console.error(`${arm.name}: controls transition failed`,error.message);
    arm.transition.sourceState=await readMapRenderState(page);
    await page.screenshot({path:`browser-review/controls-painter-${arm.name}-transition-failure.png`,timeout:5000}).catch(()=>{});
   }
   arm.transition.requestsAtStop=lifecycle.snapshot();
   await page.close();
   // This independent rendering acceptance uses another page, never retries
   // a failed controls transition and cannot convert that failure to success.
   const pixels=await context.newPage();pixels.setDefaultTimeout(30000);pixels.on('pageerror',()=>arm.errors.push('pixel-pageerror'));
   try{await pixelChecks(pixels,guard,arm);}catch(error){arm.pixelFailure=String(error.message).slice(0,200);console.error(`${arm.name}: pixel comparison setup failed`,error.message);}
   await pixels.close();
  }finally{arm.requests=lifecycle.snapshot();await save();await browser.close();}
 }
 const [baseline,guarded]=report.arms;
 assert.equal(baseline.browserVersion,guarded.browserVersion);
 assert.equal(baseline.pixelOriginalMaskSha256,guarded.pixelOriginalMaskSha256,'Original method identity must match across arms');
 for(const entry of pixelCases){
  const original=pixelBuffers.get(`baseline:${entry.name}`),candidate=pixelBuffers.get(`hidden-mask-guard:${entry.name}`);
  assert.ok(original&&candidate,`Both arms must complete ${entry.name}`);
  const changedBytes=comparePixelBytes(original,candidate);
  const a=baseline.pixels.find(p=>p.case===entry.name),b=guarded.pixels.find(p=>p.case===entry.name);
  const naturalDispatchEqual=JSON.stringify(a.probe.lastVisibleDispatch)===JSON.stringify(b.probe.lastVisibleDispatch);
  const terrainSamples=entry.terrain?['cold','warm'].map(cache=>{
   const x=a.terrainSamples?.find(sample=>sample.cache===cache),y=b.terrainSamples?.find(sample=>sample.cache===cache);
   assert.ok(x&&y,`Both arms must complete ${cache} terrain sampling`);
   return {cache,changedBytes:comparePixelBytes(terrainPixelBuffers.get(`baseline:${cache}`),terrainPixelBuffers.get(`hidden-mask-guard:${cache}`)),
    identityEqual:JSON.stringify(x.identity)===JSON.stringify(y.identity),
    dispatchEqual:JSON.stringify(x.probe.lastVisibleDispatch)===JSON.stringify(y.probe.lastVisibleDispatch)};
  }):undefined;
  const naturalTerrainEqual=!entry.terrain||controlsTerrainNaturalEquivalent(a.probe,b.probe);
  const dispatchEqual=naturalDispatchEqual&&naturalTerrainEqual&&(!terrainSamples||terrainSamples.every(sample=>sample.changedBytes===0&&sample.identityEqual&&sample.dispatchEqual));
  report.comparisons.push({case:entry.name,changedBytes,dispatchEqual,naturalDispatchEqual,naturalTerrainEqual,terrainSamples,baselineMaskDraws:a.probe.maskDraws,guardedMaskDraws:b.probe.maskDraws});
 }
 await save();
 assert.ok(report.comparisons.every(c=>c.changedBytes===0&&c.dispatchEqual),'Pixel bytes and visible dispatch must match exactly');
 assert.notEqual(baseline.pixels[0].sha256,baseline.pixels[1].sha256,'Visibility sensitivity control must change actual pixels');
 assert.equal(baseline.pixels[0].sha256,baseline.pixels[2].sha256,'Hiding restores the original image');
 assert.ok(baseline.pixels.some(p=>p.probe.stencilClears>1),'Nonempty fixtures exercise stencil-ID resets');
 assert.ok(report.arms.every(a=>a.transition.settled&&!a.pixelFailure&&!a.errors.length),'Every original transition and rendering case must pass; failure is not waived');
 assert.ok(report.arms.every(a=>!a.transition.probe?.unavailable),'A missing transition observation is explicit failure');
 console.log('PASS: one fixture-only controls A/B pair; seven exact nonempty pixel/dispatch comparisons; original timeout causation remains unproven.');
}finally{clearTimeout(deadline);await save();}
