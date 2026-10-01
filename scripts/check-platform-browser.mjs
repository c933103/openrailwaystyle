import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/platform-edge.json',import.meta.url)));
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');await mkdir('browser-review',{recursive:true});
try{for(const [kind,width,height] of [['desktop',1365,900],['mobile',412,915]]){
 const page=await browser.newPage({viewport:{width,height},hasTouch:kind==='mobile',deviceScaleFactor:kind==='mobile'?2.625:1});let requests=0,releaseLength;const lengthReady=new Promise(resolve=>releaseLength=resolve);
 await page.addInitScript(()=>{const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){return getContext.call(this,kind,/^webgl2?$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);};});
 await page.route('https://openrailwaymap.app/api/feature/openrailwaymap_standard/standard_railway_platform_edges/**',async r=>{const id=r.request().url().split('/').at(-1);if(id==='349685435'){requests++;await lengthReady;await r.fulfill({json:fixture.response});}else await r.fulfill({status:404,body:''});});
 await page.goto(base+'?relief=0&stations=0&names=0&trackCounts=0&transport=0&destinations=0&constraints=0#19/35.6815/139.7664',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('body[data-map-ready="true"]',{state:'attached',timeout:90000});
 await page.evaluate(async f=>{const {map}=await import(document.querySelector('script[type="module"]').src);window.reviewMap=map;const layer={...map.getStyle().layers.find(l=>l.id==='platform-edges')};map.removeLayer('platform-edges');map.removeSource('platformEdges');map.addSource('platformEdges',{type:'geojson',data:f});delete layer['source-layer'];map.addLayer(layer,'platform-lengths');map.triggerRepaint();},fixture.feature);
 await page.waitForFunction(()=>window.reviewMap.queryRenderedFeatures({layers:['platform-edges']}).length>0);
 if(await page.locator('#controls').isVisible())await page.locator('#collapse').click();const first=await page.evaluate(()=>{const p=window.reviewMap.project([139.7663502,35.6815449]);return {x:p.x,y:p.y};});await page.locator('#map canvas').click({position:first});await page.waitForSelector('#details:not([hidden])');assert.ok(!(await page.locator('#detail-content').innerText()).includes('Boarding edge length'));releaseLength();await page.waitForFunction(()=>document.querySelector('#detail-content').textContent.includes('247 m'));await page.locator('#details-close').click();
 const ready=()=>page.waitForFunction(()=>{const map=window.reviewMap;return map.queryRenderedFeatures({layers:['platform-lengths']}).some(f=>Math.abs(f.properties.platform_length-246.86183810409128)<.001);},undefined,{timeout:30000});await ready();
 if(await page.locator('#controls').isHidden()){const open=page.locator('#controls-open');if(await open.count())await open.click();else await page.locator('#collapse').click();}
 assert.equal(await page.locator('#units').evaluate(e=>e.closest('#main-view')!==null&&e.parentElement.previousElementSibling?.classList.contains('language-picker')),true);
 await page.selectOption('#units','imperial');await page.waitForFunction(()=>{const map=window.reviewMap;return JSON.stringify(map.getLayoutProperty('platform-lengths','text-field')).includes(' ft');});await ready();
 assert.equal(requests,1,'changing units reuses the full mapped length');
 await page.evaluate(()=>window.reviewMap.setLayoutProperty('platform-lengths','visibility','none'));
 const hit=await page.evaluate(()=>{const map=window.reviewMap,p=map.project([139.7663502,35.6815449]);return {x:p.x,y:p.y};});if(await page.locator('#controls').isVisible())await page.locator('#collapse').click();
 await page.locator('#map canvas').click({position:hit});await page.waitForSelector('#details:not([hidden])');assert.match(await page.locator('#detail-content').innerText(),/810 ft/);assert.equal(await page.locator('#detail-content a[href="https://www.openstreetmap.org/way/349685435"]').count(),1);await page.locator('#details-close').click();
 await page.evaluate(()=>window.reviewMap.setLayoutProperty('platform-lengths','visibility','visible'));
 if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();
 await page.locator('#collapse').click();await page.screenshot({path:`browser-review/platform-${kind}-imperial.png`});
 if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();
 await page.selectOption('#units','metric');await page.evaluate(async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);map.jumpTo({zoom:18});});
 await page.waitForFunction(()=>{const map=window.reviewMap;return map.queryRenderedFeatures({layers:['platform-lengths']}).length===0;});assert.equal(requests,1);console.log(`PASS: ${kind} platform length, unit conversion/cache and threshold`);
 await page.locator('[data-mode="axle"]').click();
 await page.evaluate(()=>{const map=window.reviewMap;map.jumpTo({center:[10,50],zoom:5});for(const l of map.getStyle().layers)if(l.id.startsWith('axle-')&&l.id!=='axle-overview')map.setLayoutProperty(l.id,'visibility','none');const layer={...map.getStyle().layers.find(l=>l.id==='axle-overview')};map.removeLayer(layer.id);delete layer['source-layer'];layer.source='reviewAxle';map.addSource('reviewAxle',{type:'geojson',data:{type:'FeatureCollection',features:[{type:'Feature',properties:{axle_load:'22500 kg',axle_tonnes:22.5},geometry:{type:'LineString',coordinates:[[9,50],[11,50]]}},{type:'Feature',properties:{axle_load:'50000 lb',axle_tonnes:22.6796185},geometry:{type:'LineString',coordinates:[[9,50.5],[11,50.5]]}}]}});map.addLayer(layer);map.fire('moveend');});
 await page.waitForFunction(()=>window.reviewMap.queryRenderedFeatures({layers:['axle-overview']}).filter(f=>f.source==='reviewAxle').length===2);await page.evaluate(()=>window.reviewMap.fire('moveend'));
 await page.waitForFunction(()=>[...document.querySelectorAll('#legend .legend-item')].some(e=>e.textContent==='22,500 kg')&&document.querySelector('#legend').textContent.includes('22.68 t (50,000 lb)'));
 await page.screenshot({path:`browser-review/axle-${kind}-native-metric.png`});
 await page.selectOption('#units','imperial');assert.ok((await page.locator('#legend .legend-item').allTextContents()).includes('50,000 lb'),'native pounds need no same-system conversion');assert.match(await page.locator('#legend').innerText(),/24.8 short tons \(22,500 kg\)/,'only metric data converts in Imperial');
 await page.screenshot({path:`browser-review/axle-${kind}-native-imperial.png`});
 await page.selectOption('#units','metric');assert.ok((await page.locator('#legend .legend-item').allTextContents()).includes('22,500 kg'),'native kilograms need no same-system conversion');assert.match(await page.locator('#legend').innerText(),/22.68 t \(50,000 lb\)/,'only imperial data converts in Metric');
 console.log(`PASS: ${kind} kg/lb axle legend updates immediately`);await page.close();
}}finally{await browser.close();}
