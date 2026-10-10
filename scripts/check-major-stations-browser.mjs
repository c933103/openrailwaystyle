import {launchBrowser} from './browser.mjs';
import {createResponseCache} from './browser-response-cache.mjs';
import {measureStationDensity, resetStationSources, stationFailureCount} from './station-density-comparison.mjs';
import {fetchLoopbackNoRedirect, localOrmAuditTarget} from './browser.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chooseName} from '../styles/map-model.mjs';
const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const beforeTiers=JSON.parse(await readFile(new URL('../tests/fixtures/stations-before-density.json',import.meta.url),'utf8'));
const beforeProvider=JSON.parse(await readFile(new URL('../tests/fixtures/stations-before-curation.json',import.meta.url),'utf8'));
const densityData=JSON.parse(await readFile(new URL('../styles/major-stations.geojson',import.meta.url),'utf8'));
for(const f of densityData.features)Object.assign(f.properties,{atlas_name:chooseName(f.properties,'en'),atlas_language:'en'});
if (!process.env.ATLAS_TEST_ORM_URL) throw new Error('The full station-density check requires a self-hosted OpenRailwayMap instance (ATLAS_TEST_ORM_URL); it must not fetch public tiles in automation');
await mkdir('browser-review',{recursive:true});
// A reused output directory must never attribute an earlier run's discarded
// pairs to this run, including a clean run or a browser-launch failure.
await writeFile('browser-review/stations-desktop-density-invalidated.json','[]\n');
const browser=await launchBrowser({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{for(const [kind,width,height] of [['desktop',1365,900],['mobile',412,915]]){
 const context=await browser.newContext({viewport:{width,height},hasTouch:kind==='mobile',deviceScaleFactor:kind==='mobile'?2.625:1,serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const reportResource=msg=>{if(['warning','error'].includes(msg.type()))console.log('STATION_RESOURCE',msg.text().slice(0,1200));};
 page.on('console',reportResource);
 const pendingRequests=new Set();
 // Terminated count workers can leave a startup request without an end event.
 context.on('request',r=>{if(!/\/vendor\/track-worker\.js(?:\?|$)/.test(r.url()))pendingRequests.add(r);});
 context.on('requestfinished',r=>pendingRequests.delete(r));
 context.on('requestfailed',r=>pendingRequests.delete(r));
 // Both maps receive identical responses from the explicitly configured local
 // provider. Never fetch public provider tiles directly, even on a cache miss.
 const stationResponse=createResponseCache();
 let stationRouteFailures=0;
 await context.route(/\/standard_railway_text_stations_(?:low|med)(?:\/|$)/,async route=>{
  const url=route.request().url();
  try {
   // Public provider URLs are rewritten to the configured local instance,
   // while TileJSON-advertised loopback URLs remain direct local requests.
   const target=localOrmAuditTarget(url);
   await route.fulfill(await stationResponse(target,()=>fetchLoopbackNoRedirect(route,target)));
  } catch(error){stationRouteFailures++;console.error('Station tile unavailable:',url,error.message);await route.abort().catch(()=>{});}
 });
 // Match the other WebGL checks' capture budget. The touch viewport renders
 // at DPR 2.625 and can still be finishing real tiles after label placement.
 page.setDefaultTimeout(120000);
 await page.addInitScript(()=>{const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){return getContext.call(this,kind,/^webgl2?$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);};});
 // An old installed worker can cache the style but cannot cache this new
 // standalone file. The overview must work from the style's bundled copy.
 await page.route(base+'major-stations.geojson**',r=>r.abort());
 await page.goto(base+'?language=en&relief=0&names=0&inactive=0#3/35.681/125',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('body[data-map-ready="true"]',{state:'attached',timeout:90000});
 await page.evaluate(async()=>{window.reviewMap=(await import(document.querySelector('script[type="module"]').src)).map;});
 // Country labels keep their existing collision priority. Check Tokyo's
 // localized source data independently of placement. The globe band
 // must only place tier-3 candidates.
 const snapshot=await page.waitForFunction(()=>{const m=window.reviewMap,source=m.querySourceFeatures('stationMajor'),f=m.queryRenderedFeatures().filter(f=>f.source==='stationMajor'),tokyo=source.find(f=>f.properties.wikidata==='Q283196');if(!tokyo||tokyo.properties.atlas_language!=='en'||!f.length)return false;return {projection:m.getProjection().type,names:f.map(x=>x.properties.atlas_name),tiers:f.map(x=>x.properties.tier),qids:f.map(x=>x.properties.wikidata),tokyo:tokyo.properties.atlas_name,sourceQids:source.map(x=>x.properties.wikidata)};},undefined,{timeout:60000});
  const result=await snapshot.jsonValue();assert.equal(result.projection,'globe');assert.ok(result.tokyo);assert.ok(!result.sourceQids.includes('Q801447'));assert.ok(result.tiers.every(t=>t===3));assert.equal(await page.evaluate(()=>window.reviewMap.querySourceFeatures('stationMajor').find(f=>f.properties.wikidata==='Q283196')?.properties.atlas_name_source),'provider');
 await page.screenshot({path:`browser-review/stations-${kind}-globe.png`});
 // Compare placed labels using the same loaded source data and viewport.
 // Keep the original globe selection at 3. At 4–6 compare against the
 // complete provider layers before curation, not the reduced inventory
 // introduced by the first curated-station PR. No ranking API is involved.
 // The density comparison runs on the desktop viewport only: the same
 // provider data and placement rules apply on both, and the mobile pass
 // doubled the check's time. Mobile keeps the label, click, language and
 // polar checks below.
 if(kind==='desktop'){
 const density=[],invalidated=[],baseline=await page.context().newPage();baseline.setDefaultTimeout(120000);baseline.on('console',reportResource);
 const baselineData=structuredClone(densityData);baselineData.features=baselineData.features.filter(f=>beforeTiers[f.id]).map(f=>({...f,properties:{...f.properties,tier:beforeTiers[f.id]}}));
 await baseline.route(base+'world.style.json**',async route=>{
  const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url),'utf8'));
  style.sources.stationMajor.data=baselineData;
  style.layers=style.layers.flatMap(l=>{
   if(l.source==='stationLow'||l.source==='stationMed')return beforeProvider.layers.find(b=>b.id===l.id)||[];
   if(l.source==='stationMajor')return l.id==='station-major-3-names'?{...l,maxzoom:4,layout:{...l.layout,'text-padding':14}}:[];
   return l;
  });
  await route.fulfill({contentType:'application/json',body:JSON.stringify(style)});
 });
 await baseline.goto(base+'?language=en&relief=0&names=0&inactive=0#3/35.681/125',{waitUntil:'domcontentloaded'});
 await baseline.waitForSelector('body[data-map-ready="true"]',{state:'attached',timeout:90000});
 await baseline.evaluate(async()=>{window.reviewMap=(await import(document.querySelector('script[type="module"]').src)).map;});
 const count=async(p,center,zoom)=>{
  await p.bringToFront();
  const active=await p.evaluate(({center,zoom})=>{
   const m=window.reviewMap;window.densityFrame=false;m.once('render',()=>window.densityFrame=true);
   if(!window.densityRenders){window.densityRenders=1;m.on('render',()=>window.densityRenders++);}
   m.jumpTo({center,zoom});m.triggerRepaint();delete window.densityPlacement;
   // isSourceLoaded can still describe the previous camera until this frame
   // updates the tile cover. Measure the view only after that update.
   const layers=m.getStyle().layers.filter(l=>l.id.startsWith('station-')&&l.type==='symbol'&&l.layout?.visibility!=='none'&&zoom>=(l.minzoom??0)&&zoom<(l.maxzoom??Infinity));
   return {layers:layers.map(l=>l.id),sources:[...new Set(layers.map(l=>l.source))]};
  },{center,zoom});
  assert.ok(active.layers.length,'station layers must be active');
  // Cancelled hidden sources can retain loading flags. Require the visible
  // station sources, their glyphs, and a quiet network; keep all density tests.
  try {await p.waitForFunction(sources=>window.densityFrame&&sources.every(id=>window.reviewMap.isSourceLoaded(id)),active.sources,{timeout:120000});}
  catch(error){console.error('DENSITY_NOT_READY',await p.evaluate(sources=>({zoom:window.reviewMap.getZoom(),rendered:window.densityFrame,sources:sources.map(id=>[id,window.reviewMap.isSourceLoaded(id)])}),active.sources));throw error;}
  // Station labels compete for space with the basemap's, so every source
  // with visible labels must have loaded, and the glyphs being fetched with
  // them. Other requests (relief, hidden views) do not decide placement.
  const labelSources=await p.evaluate(zoom=>[...new Set(window.reviewMap.getStyle().layers.filter(l=>l.type==='symbol'&&l.source&&l.layout?.visibility!=='none'&&zoom>=(l.minzoom??0)&&zoom<(l.maxzoom??Infinity)).map(l=>l.source))],zoom);
  try {await p.waitForFunction(sources=>sources.every(id=>window.reviewMap.isSourceLoaded(id)),labelSources,{timeout:120000});}
  catch(error){console.error('LABEL_SOURCES_NOT_READY',await p.evaluate(sources=>sources.map(id=>[id,window.reviewMap.isSourceLoaded(id)]),labelSources));throw error;}
  const glyphs=()=>[...pendingRequests].filter(r=>/glyph|\/fonts\//.test(r.url()));
  let quietSince;const until=Date.now()+60000;
  while(Date.now()<until){if(!glyphs().length){quietSince??=Date.now();if(Date.now()-quietSince>=300)break;}else quietSince=undefined;await p.waitForTimeout(100);}
  assert.ok(quietSince&&Date.now()-quietSince>=300,'label glyphs must load: '+glyphs().map(r=>r.url()).join(', '));
  await p.evaluate(()=>new Promise(resolve=>{const m=window.reviewMap,timer=setTimeout(()=>{m.off('idle',done);resolve();},10000),done=()=>{clearTimeout(timer);resolve();};m.once('idle',done);m.triggerRepaint();}));
  // Labels are placed again only as frames are drawn; without them the count
  // can still be the previous zoom's (zoom 6 read as zoom 5's 28 + 23). Keep
  // frames coming and require some drawn while the count holds.
  const value=await p.waitForFunction(layers=>{
   window.reviewMap.triggerRepaint();
   const count=new Set(window.reviewMap.queryRenderedFeatures({layers}).map(f=>f.properties.wikidata||f.properties.id||f.properties.osm_id||f.properties.name)).size,now=Date.now();
   if(window.densityPlacement?.count!==count)window.densityPlacement={count,since:now,renders:window.densityRenders};
   return now-window.densityPlacement.since>=1000&&window.densityRenders-window.densityPlacement.renders>=10?{count}:false;
  },active.layers,{polling:100,timeout:60000});const result=(await value.jsonValue()).count;await value.dispose();
  console.log('DENSITY_STATE',kind,p===baseline?'before':'after',await p.evaluate(active=>{
   const m=window.reviewMap,features=m.queryRenderedFeatures({layers:active.layers}),style=m.getStyle();
   return {zoom:m.getZoom(),tilesLoaded:m.areTilesLoaded(),sources:active.sources.map(id=>{
    const sourceLayers=[...new Set(style.layers.filter(l=>active.layers.includes(l.id)&&l.source===id).map(l=>l['source-layer']).filter(Boolean))];
    const source=sourceLayers.length?sourceLayers.flatMap(sourceLayer=>m.querySourceFeatures(id,{sourceLayer})):m.querySourceFeatures(id);
    return {id,loaded:m.isSourceLoaded(id),available:source.length,placed:features.filter(f=>f.source===id).length};
   })};
  },active));return result;
 };
 for(const [region,center] of [['Europe',[12,50]],['Japan',[139,36]],['US',[-88,40]]])for(const zoom of [3,4,5,6]){
  const {before,after}=await measureStationDensity({
   failureCount:async()=>{
    const pageFailures=await Promise.all([baseline,page].map(p=>p.evaluate(stationFailureCount)));
    return stationResponse.failureCount()+stationRouteFailures+pageFailures.reduce((sum,count)=>sum+count,0);
   },
   reset:async()=>{
    const resets=await Promise.allSettled([baseline,page].map(p=>p.evaluate(resetStationSources)));
    const failed=resets.find(result=>result.status==='rejected');if(failed)throw failed.reason;
   },
   measure:async()=>({before:await count(baseline,center,zoom),after:await count(page,center,zoom)}),
   onDiscard:async sample=>{
    invalidated.push({region,zoom,...sample});console.log('DENSITY_INVALIDATED',kind,region,zoom,JSON.stringify(sample));
    await writeFile(`browser-review/stations-${kind}-density-invalidated.json`,JSON.stringify(invalidated,null,2)+'\n');
   },
  });
  density.push({region,zoom,before,after});
  console.log('DENSITY_SAMPLE',kind,region,zoom,before,after);
  await writeFile(`browser-review/stations-${kind}-density.json`,JSON.stringify(density,null,2)+'\n');
  if(region==='Europe'&&zoom>=4)await page.screenshot({path:`browser-review/stations-${kind}-density-${zoom}.png`});
 }
 await baseline.close();
 for(const sample of density){
  assert.ok(sample.after>=sample.before-Math.max(1,Math.floor(sample.before*.05)),`${kind} ${sample.region} zoom ${sample.zoom} retains previous density: ${sample.before} -> ${sample.after}`);
 }
 for(const zoom of [3,4,5,6]){
  const band=density.filter(x=>x.zoom===zoom),before=band.reduce((n,x)=>n+x.before,0),after=band.reduce((n,x)=>n+x.after,0);
  assert.ok(before>0,`baseline labels must render at zoom ${zoom}`);
  assert.ok(after>=before*.95,`zoom ${zoom} must retain approximately the previous placed-label density: ${before} -> ${after}`);
 }
 await writeFile(`browser-review/stations-${kind}-density.json`,JSON.stringify(density,null,2)+'\n');
 console.log('DENSITY',kind,JSON.stringify(density));
 }
 await page.evaluate(()=>window.reviewMap.jumpTo({center:[141.35,43.07],zoom:4}));
  const target=await page.waitForFunction(()=>{const map=window.reviewMap,f=map.queryRenderedFeatures().find(f=>f.source==='stationMajor'&&f.properties.wikidata==='Q801404');if(!f?.properties.atlas_name)return false;const p=map.project(f.geometry.coordinates);return {x:p.x,y:p.y,osm:f.properties.osm_id,name:f.properties.atlas_name};},undefined,{timeout:60000});const hit=await target.jsonValue();await page.locator('#map canvas').click({position:{x:hit.x,y:hit.y}});await page.waitForSelector('#details:not([hidden])');assert.ok((await page.locator('#detail-content').innerText()).includes(hit.name));assert.ok(await page.locator(`#detail-content a[href="https://www.openstreetmap.org/node/${hit.osm}"]`).count());
 await page.locator('#details-close').click();if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();await page.selectOption('#language','ja');
  await page.waitForFunction(()=>window.reviewMap.queryRenderedFeatures().some(f=>f.source==='stationMajor'&&f.properties.wikidata==='Q801404'&&f.properties.atlas_language==='ja'&&f.properties.atlas_name&&f.properties.atlas_name_source==='provider'),undefined,{timeout:60000});
 await page.evaluate(()=>window.reviewMap.jumpTo({center:[20,80],zoom:3}));
 await page.waitForFunction(()=>window.reviewMap.getCenter().lat===80&&!window.reviewMap.isMoving());
 await page.screenshot({path:`browser-review/stations-${kind}-polar.png`});assert.deepEqual(errors,[]);console.log('PASS',kind,JSON.stringify(result));await context.close();
}}finally{await browser.close();}
