import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
await mkdir('browser-review',{recursive:true});
try{for(const [kind,width,height] of [['desktop',1365,900],['mobile',412,915]]){
 const page=await browser.newPage({viewport:{width,height},hasTouch:kind==='mobile',deviceScaleFactor:kind==='mobile'?2.625:1,serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){return getContext.call(this,kind,/^webgl2?$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);};});
 await page.goto(base+'?language=en&relief=0&names=0&inactive=0#3/35.681/139.767',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('body[data-map-ready="true"]',{state:'attached',timeout:90000});
 await page.evaluate(async()=>{window.reviewMap=(await import(document.querySelector('script[type="module"]').src)).map;});
 await page.waitForFunction(()=>window.reviewMap.queryRenderedFeatures().some(f=>f.source==='stationMajor'&&f.properties.wikidata==='Q283196'),undefined,{timeout:60000});
 const result=await page.evaluate(()=>{const m=window.reviewMap,f=m.queryRenderedFeatures().filter(f=>f.source==='stationMajor'),p=m.project([139.767,35.6812546]);return {projection:m.getProjection().type,names:f.map(x=>x.properties.atlas_name),qids:f.map(x=>x.properties.wikidata),point:{x:p.x,y:p.y}};});
 assert.equal(result.projection,'globe');assert.ok(result.names.includes('Tōkyō'));assert.ok(!result.qids.includes('Q801447'));
 await page.screenshot({path:`browser-review/stations-${kind}-globe.png`});
 await page.waitForTimeout(1500);const hit=await page.evaluate(()=>{const f=window.reviewMap.queryRenderedFeatures().find(f=>f.source==='stationMajor'&&f.properties.wikidata==='Q801404');if(!f)return null;const p=window.reviewMap.project(f.geometry.coordinates);return {x:p.x,y:p.y,osm:f.properties.osm_id};});assert.ok(hit,'Sapporo label rendered after basemap collision placement');await page.locator('#map canvas').click({position:{x:hit.x,y:hit.y}});await page.waitForSelector('#details:not([hidden])');assert.match(await page.locator('#detail-content').innerText(),/Sapporo/);assert.ok(await page.locator(`#detail-content a[href="https://www.openstreetmap.org/node/${hit.osm}"]`).count());
 await page.locator('#details-close').click();if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();await page.selectOption('#language','ja');
 await page.waitForFunction(()=>window.reviewMap.queryRenderedFeatures().some(f=>f.source==='stationMajor'&&f.properties.wikidata==='Q801404'&&f.properties.atlas_name==='札幌'),undefined,{timeout:60000});
 await page.evaluate(()=>window.reviewMap.jumpTo({center:[20,80],zoom:3}));
 await page.waitForFunction(()=>window.reviewMap.getCenter().lat===80&&!window.reviewMap.isMoving());
 await page.screenshot({path:`browser-review/stations-${kind}-polar.png`});assert.deepEqual(errors,[]);console.log('PASS',kind,JSON.stringify(result));await page.close();
}}finally{await browser.close();}
