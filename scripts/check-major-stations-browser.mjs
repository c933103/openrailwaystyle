import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chooseName} from '../styles/map-model.mjs';
const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const beforeTiers=JSON.parse(await readFile(new URL('../tests/fixtures/stations-before-density.json',import.meta.url),'utf8'));
const beforeProvider=JSON.parse(await readFile(new URL('../tests/fixtures/stations-before-curation.json',import.meta.url),'utf8'));
const densityData=JSON.parse(await readFile(new URL('../styles/major-stations.geojson',import.meta.url),'utf8'));
for(const f of densityData.features)Object.assign(f.properties,{atlas_name:chooseName(f.properties,'en'),atlas_language:'en'});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
await mkdir('browser-review',{recursive:true});
try{for(const [kind,width,height] of [['desktop',1365,900],['mobile',412,915]]){
 const context=await browser.newContext({viewport:{width,height},hasTouch:kind==='mobile',deviceScaleFactor:kind==='mobile'?2.625:1,serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Both maps receive identical provider bytes, including the underzoomed
 // zoom-7 children used at zoom 6. Fetch only tiles the test views request.
 const stationResponses=new Map();
 await context.route(/\/standard_railway_text_stations_(?:low|med)(?:\/|$)/,async route=>{
  const url=route.request().url();
  if(!stationResponses.has(url))stationResponses.set(url,route.fetch().then(async r=>({status:r.status(),headers:r.headers(),body:await r.body()})));
  try {await route.fulfill(await stationResponses.get(url));}
  catch(error){console.error('Station tile unavailable:',url,error.message);await route.abort().catch(()=>{});}
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
 const result=await snapshot.jsonValue();assert.equal(result.projection,'globe');assert.equal(result.tokyo,'Tōkyō');assert.ok(!result.sourceQids.includes('Q801447'));assert.ok(result.tiers.every(t=>t===3));
 await page.screenshot({path:`browser-review/stations-${kind}-globe.png`});
 // Compare placed labels using the same loaded source data and viewport.
 // Keep the original globe selection at 3. At 4–6 compare against the
 // complete provider layers before curation, not the reduced inventory
 // introduced by the first curated-station PR. No ranking API is involved.
 const density=[],baseline=await page.context().newPage();baseline.setDefaultTimeout(120000);
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
  await p.evaluate(async({center,zoom})=>{const m=window.reviewMap;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{m.off('idle',done);reject(new Error('Station comparison did not settle'));},60000),done=()=>{clearTimeout(timer);resolve();};m.once('idle',done);m.jumpTo({center,zoom});m.triggerRepaint();});},{center,zoom});
  await p.waitForTimeout(500);
  const value=await p.waitForFunction(()=>{
   try {const m=window.reviewMap;if(!m.areTilesLoaded())return false;return {count:new Set(m.queryRenderedFeatures().filter(f=>f.layer.id.startsWith('station-')&&f.layer.type==='symbol').map(f=>f.properties.wikidata||f.properties.id||f.properties.osm_id||f.properties.name)).size};}catch{return false;}
  },undefined,{timeout:60000});return (await value.jsonValue()).count;
 };
 for(const [region,center] of [['Europe',[12,50]],['Japan',[139,36]],['US',[-88,40]]])for(const zoom of [3,4,5,6]){
  const before=await count(baseline,center,zoom),after=await count(page,center,zoom);density.push({region,zoom,before,after});
  console.log('DENSITY_SAMPLE',kind,region,zoom,before,after);
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
 await page.evaluate(()=>window.reviewMap.jumpTo({center:[141.35,43.07],zoom:4}));
 const target=await page.waitForFunction(()=>{const map=window.reviewMap,f=map.queryRenderedFeatures().find(f=>f.source==='stationMajor'&&f.properties.wikidata==='Q801404');if(!f)return false;const p=map.project(f.geometry.coordinates);return {x:p.x,y:p.y,osm:f.properties.osm_id};},undefined,{timeout:60000});const hit=await target.jsonValue();await page.locator('#map canvas').click({position:{x:hit.x,y:hit.y}});await page.waitForSelector('#details:not([hidden])');assert.match(await page.locator('#detail-content').innerText(),/Sapporo/);assert.ok(await page.locator(`#detail-content a[href="https://www.openstreetmap.org/node/${hit.osm}"]`).count());
 await page.locator('#details-close').click();if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();await page.selectOption('#language','ja');
 await page.waitForFunction(()=>window.reviewMap.queryRenderedFeatures().some(f=>f.source==='stationMajor'&&f.properties.wikidata==='Q801404'&&f.properties.atlas_name==='札幌'),undefined,{timeout:60000});
 await page.evaluate(()=>window.reviewMap.jumpTo({center:[20,80],zoom:3}));
 await page.waitForFunction(()=>window.reviewMap.getCenter().lat===80&&!window.reviewMap.isMoving());
 await page.screenshot({path:`browser-review/stations-${kind}-polar.png`});assert.deepEqual(errors,[]);console.log('PASS',kind,JSON.stringify(result));await context.close();
}}finally{await browser.close();}
