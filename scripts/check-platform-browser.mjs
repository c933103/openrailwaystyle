import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {launchBrowser} from './browser.mjs';
import {ormVectorFixture} from './orm-vector-fixture.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import geojsonvt from 'geojson-vt';
const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/platform-edge.json',import.meta.url)));
const edges=geojsonvt({type:'FeatureCollection',features:[fixture.feature]},{maxZoom:22,indexMaxZoom:17,extent:4096});
// An empty, valid basemap keeps this focused check independent of planet
// downloads. Platform geometry still travels through the real vector source
// and its tile/render events, which drive the application's length lookup.
const archive=Buffer.alloc(130);archive.write('PMTiles');archive[7]=3;
for(const [offset,value] of [[8,127],[16,1],[24,128],[32,2],[40,130],[56,130]])archive.writeBigUInt64LE(BigInt(value),offset);
archive[96]=1;archive[97]=archive[98]=archive[99]=1;archive[101]=22;
for(const [offset,value] of [[102,-1800000000],[106,-850000000],[110,1800000000],[114,850000000]])archive.writeInt32LE(value,offset);
archive.write('{}',128);
const glyphFile=process.env.ATLAS_BROWSER_GLYPHS;
const browser=await launchBrowser({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');await mkdir('browser-review',{recursive:true});
try{for(const [kind,width,height] of [['desktop',1365,900],['mobile',412,915]]){
 // The app gives up on a provider request after 5 s and tries again 30 s
 // later (platform-length.mjs); a busy runner can delay this check's own
 // answer past 5 s, so the length waits cover one such retry and request
 // counts are compared from the moment the length arrived.
 const page=await browser.newPage({viewport:{width,height},hasTouch:kind==='mobile',deviceScaleFactor:kind==='mobile'?2.625:1,serviceWorkers:'block'});let requests=0;
 // MapLibre can throw from queryRenderedFeatures while it swaps tiles
 // ("Out of bounds"); such a poll answers "not yet" and tries again.
 const settle=(predicate,options)=>page.waitForFunction(`(()=>{try{return (${predicate})();}catch{return false;}})()`,undefined,options);
  await installEmptyMapProviders(page.context(),base,{firstParty:'network'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')console.error(kind,message.text());});
 await page.addInitScript(()=>{const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){return getContext.call(this,kind,/^webgl2?$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);};});
 await page.route('https://tuiles.enliberte.fr/planet.pmtiles',route=>route.fulfill({body:archive,contentType:'application/octet-stream'}));
 if(glyphFile)await page.route('https://tuiles.enliberte.fr/fonts/**',async route=>route.fulfill({body:await readFile(glyphFile),contentType:'application/x-protobuf'}));
 await page.route('**/data/**/index.json',route=>route.fulfill({json:{tiles:[]}}));
 await page.route('https://openrailwaymap.app/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const direct=ormVectorFixture(path,{'standard_railway_platform_edges':edges});
  if(direct)return route.fulfill(direct);
  if(path.startsWith('/api/feature/')){
   if(path.includes('standard_railway_platform_edges/')&&path.split('/').at(-1)==='349685435'){requests++;await route.fulfill({json:fixture.response});}
   else await route.fulfill({status:404,body:''});
  }else await route.fulfill({json:{tilejson:'3.0.0',tiles:[`${base}review-platform-tiles${path}/{z}/{x}/{y}.pbf`],minzoom:0,maxzoom:22}});
 });
 await page.route('**/review-platform-tiles/**',route=>{
  const response=ormVectorFixture(new URL(route.request().url()).pathname.split('/review-platform-tiles')[1],{'standard_railway_platform_edges':edges});
  assert.ok(response,'Recognized local fixture tile URL');
  return route.fulfill(response);
 });
 await page.goto(base+'?mode=infrastructure&relief=0&stations=0&names=0&trackCounts=0&transport=0&destinations=0&constraints=0#18/35.6815/139.7664',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('body[data-map-ready="true"]',{state:'attached',timeout:90000});
 await page.evaluate(async()=>{window.reviewMap=(await import(document.querySelector('script[type="module"]').src)).map;});
 await settle(()=>window.reviewMap.queryRenderedFeatures({layers:['platform-lengths']}).some(f=>f.properties.ref==='1'));
 if(await page.locator('#controls').isVisible())await page.locator('#collapse').click();const first=await page.evaluate(()=>{const map=window.reviewMap,label=map.queryRenderedFeatures({layers:['platform-lengths']}).find(f=>f.properties.ref==='1'),p=map.project(label.geometry.coordinates);return {x:p.x,y:p.y};});await page.locator('#map canvas').click({position:first});await page.waitForSelector('#details:not([hidden])');assert.ok(!(await page.locator('#detail-content').innerText()).includes('Boarding edge length'));assert.equal(requests,0,'references appear before the length lookup threshold');await page.evaluate(()=>window.reviewMap.jumpTo({zoom:19}));await page.waitForFunction(()=>document.querySelector('#detail-content').textContent.includes('247 m'),undefined,{timeout:45000});await page.locator('#details-close').click();
 const ready=()=>settle(()=>{const map=window.reviewMap;return map.queryRenderedFeatures({layers:['platform-lengths']}).some(f=>Math.abs(f.properties.platform_length-246.86183810409128)<.001);},{timeout:45000});await ready();const fetched=requests;assert.ok(fetched===1||fetched===2,`one length request, or one and its retry: ${fetched}`);
 if(await page.locator('#controls').isHidden()){const open=page.locator('#controls-open');if(await open.count())await open.click();else await page.locator('#collapse').click();}
 assert.equal(await page.locator('#units').evaluate(e=>e.closest('#main-view')!==null&&e.parentElement.previousElementSibling?.classList.contains('language-picker')),true);
 await page.selectOption('#units','imperial');await page.waitForFunction(()=>{const map=window.reviewMap;return JSON.stringify(map.getLayoutProperty('platform-lengths','text-field')).includes(' ft');});await ready();
 assert.equal(requests,fetched,'changing units reuses the full mapped length');
 await page.evaluate(()=>window.reviewMap.setLayoutProperty('platform-lengths','visibility','none'));
 const hit=await page.evaluate(()=>{const map=window.reviewMap,p=map.project([139.7663502,35.6815449]);return {x:p.x,y:p.y};});if(await page.locator('#controls').isVisible())await page.locator('#collapse').click();
 await page.locator('#map canvas').click({position:hit});await page.waitForSelector('#details:not([hidden])');assert.match(await page.locator('#detail-content').innerText(),/810 ft/);assert.equal(await page.locator('#detail-content a[href="https://www.openstreetmap.org/way/349685435"]').count(),1);await page.locator('#details-close').click();
 await page.evaluate(()=>window.reviewMap.setLayoutProperty('platform-lengths','visibility','visible'));
 if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();
 await page.locator('#collapse').click();await page.screenshot({path:`browser-review/platform-${kind}-imperial.png`});
 if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();
 await page.selectOption('#units','metric');await page.evaluate(async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);map.jumpTo({zoom:18});});
 await settle(()=>{const features=window.reviewMap.queryRenderedFeatures({layers:['platform-lengths']});return features.some(f=>f.properties.ref==='1')&&features.every(f=>!('platform_length' in f.properties));});assert.equal(requests,fetched,'below zoom 19 the length is not fetched again');console.log(`PASS: ${kind} platform reference, length, unit conversion/cache and threshold`);
 await page.locator('[data-mode="axle"]').click();
 await page.evaluate(()=>{const map=window.reviewMap;map.jumpTo({center:[10,50],zoom:5});for(const l of map.getStyle().layers)if(l.id.startsWith('axle-')&&l.id!=='axle-overview')map.setLayoutProperty(l.id,'visibility','none');const layer={...map.getStyle().layers.find(l=>l.id==='axle-overview')};map.removeLayer(layer.id);delete layer['source-layer'];layer.source='reviewAxle';map.addSource('reviewAxle',{type:'geojson',data:{type:'FeatureCollection',features:[{type:'Feature',properties:{axle_load:'22500 kg',axle_tonnes:22.5},geometry:{type:'LineString',coordinates:[[9,50],[11,50]]}},{type:'Feature',properties:{axle_load:'50000 lb',axle_tonnes:22.6796185},geometry:{type:'LineString',coordinates:[[9,50.5],[11,50.5]]}}]}});map.addLayer(layer);map.fire('moveend');});
 await settle(()=>window.reviewMap.queryRenderedFeatures({layers:['axle-overview']}).filter(f=>f.source==='reviewAxle').length===2);await page.evaluate(()=>window.reviewMap.fire('moveend'));
 await page.waitForFunction(()=>[...document.querySelectorAll('#legend .legend-item')].some(e=>e.textContent==='22,500 kg')&&document.querySelector('#legend').textContent.includes('22.68 t (50,000 lb)'));
 await page.screenshot({path:`browser-review/axle-${kind}-native-metric.png`});
 await page.selectOption('#units','imperial');assert.ok((await page.locator('#legend .legend-item').allTextContents()).includes('50,000 lb'),'native pounds need no same-system conversion');assert.match(await page.locator('#legend').innerText(),/24.8 short tons \(22,500 kg\)/,'only metric data converts in Imperial');
 await page.screenshot({path:`browser-review/axle-${kind}-native-imperial.png`});
 await page.selectOption('#units','metric');assert.ok((await page.locator('#legend .legend-item').allTextContents()).includes('22,500 kg'),'native kilograms need no same-system conversion');assert.match(await page.locator('#legend').innerText(),/22.68 t \(50,000 lb\)/,'only imperial data converts in Metric');
 assert.deepEqual(errors,[]);console.log(`PASS: ${kind} kg/lb axle legend updates immediately`);await page.close();
}}finally{await browser.close();}
