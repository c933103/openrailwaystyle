import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/platform-edge.json',import.meta.url)));
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');await mkdir('browser-review',{recursive:true});
try{for(const [kind,width,height] of [['desktop',1365,900],['mobile',412,915]]){
 const page=await browser.newPage({viewport:{width,height},hasTouch:kind==='mobile',deviceScaleFactor:kind==='mobile'?2.625:1});let requests=0;
 await page.addInitScript(()=>{const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){return getContext.call(this,kind,/^webgl2?$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);};});
 await page.route('https://openrailwaymap.app/api/feature/openrailwaymap_standard/standard_railway_platform_edges/**',async r=>{const id=r.request().url().split('/').at(-1);if(id==='349685435'){requests++;await r.fulfill({json:fixture.response});}else await r.fulfill({status:404,body:''});});
 await page.goto(base+'?relief=0&stations=0&names=0&trackCounts=0&transport=0&destinations=0&constraints=0#19/35.6815/139.7664',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('body[data-map-ready="true"]',{state:'attached',timeout:90000});
 await page.evaluate(async f=>{const {map}=await import(document.querySelector('script[type="module"]').src);window.reviewMap=map;const layer={...map.getStyle().layers.find(l=>l.id==='platform-edges')};map.removeLayer('platform-edges');map.removeSource('platformEdges');map.addSource('platformEdges',{type:'geojson',data:f});delete layer['source-layer'];map.addLayer(layer,'platform-lengths');map.triggerRepaint();},fixture.feature);
 const ready=()=>page.waitForFunction(()=>{const map=window.reviewMap;return map.queryRenderedFeatures({layers:['platform-lengths']}).some(f=>Math.abs(f.properties.platform_length-246.86183810409128)<.001);},undefined,{timeout:30000});await ready();
 if(await page.locator('#controls').isHidden()){const open=page.locator('#controls-open');if(await open.count())await open.click();else await page.locator('#collapse').click();}
 assert.equal(await page.locator('#units').evaluate(e=>e.closest('#main-view')!==null&&e.parentElement.previousElementSibling?.classList.contains('language-picker')),true);
 await page.selectOption('#units','imperial');await page.waitForFunction(()=>{const map=window.reviewMap;return JSON.stringify(map.getLayoutProperty('platform-lengths','text-field')).includes(' ft');});await ready();
 assert.equal(requests,1,'changing units reuses the full mapped length');await page.locator('#collapse').click();await page.screenshot({path:`browser-review/platform-${kind}-imperial.png`});
 await page.selectOption('#units','metric');await page.evaluate(async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);map.jumpTo({zoom:18});});
 await page.waitForFunction(()=>{const map=window.reviewMap;return map.queryRenderedFeatures({layers:['platform-lengths']}).length===0;});assert.equal(requests,1);console.log(`PASS: ${kind} platform length, unit conversion/cache and threshold`);await page.close();
}}finally{await browser.close();}
