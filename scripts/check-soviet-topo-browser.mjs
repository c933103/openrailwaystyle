// A genuinely independent raster-background browser test. All third-party
// imagery is fixture data: this never contacts NaKarte or OpenRailwayMap.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {checkSovietStackingPixels} from './soviet-stacking-pixels.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
const base='http://127.0.0.1:4173/';
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1050,height:740}});
const requests=[];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64');
const locations=[['Alps',9.54,47.15],['Japan',139.77,35.68],['India',72.88,19.07],['North America',-87.63,41.88],['Ocean',-140,-20]];
let page;
try {
 await installEmptyMapProviders(context,base);
 await context.route('https://tiles.nakarte.me/topomapper/**',route=>{
   const url=new URL(route.request().url());
   assert.match(url.pathname,/^\/topomapper\/\d{1,2}\/\d{1,5}\/\d{1,5}$/);
   requests.push(url.pathname);
   return route.fulfill({status:200,contentType:'image/png',body:png});
 });
 page=await context.newPage();
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'?background=soviet&autoGlobe=0#5/0/0');
 await page.waitForSelector('body[data-map-ready="true"]',{timeout:60000});
 assert.equal(await page.locator('[data-background="soviet"]').isVisible(),false,'selector hidden without explicit preview');
 assert.equal(await page.locator('[data-background="soviet"]').isEnabled(),false,'selector disabled without explicit preview');
 const held=await page.evaluate(async()=>{
  const {map}=await import(document.querySelector('script[type="module"]').src);
  return {source:Boolean(map.getSource('sovietTopo')),layer:Boolean(map.getLayer('soviet-topo'))};
 });
 assert.deepEqual(held,{source:false,layer:false},'held source must not be installed by query settings');
 assert.equal(requests.length,0,'held URL must not request historical tiles');
 await page.goto(base+'?sovietPreview=1&background=map&mode=infrastructure&autoGlobe=0&relief=1&stations=1#5/0/0');
 await page.waitForSelector('body[data-map-ready="true"]',{timeout:60000});
 await page.waitForFunction(async()=>{
   const {map}=await import(document.querySelector('script[type="module"]').src);
   return Boolean(map?.getLayer('soviet-topo')&&map?.getLayer('station-major-dots'));
 },null,{timeout:30000});
 const state=()=>page.evaluate(async()=>{
   const {map}=await import(document.querySelector('script[type="module"]').src);
   const vis=id=>map.getLayer(id)?map.getLayoutProperty(id,'visibility'):null;
   return {soviet:vis('soviet-topo'),bathymetry:vis('terrain-bathymetry'),
     station:vis('station-major-dots'),rail:vis('infrastructure-overview'),
     original:vis('place_label_city'),source:Boolean(map.getSource('sovietTopo'))};
 });
 assert.equal((await state()).soviet,'none','scan must not load by default');
 assert.equal(requests.length,0,'no historical tiles before opt-in');
 await page.locator('[data-background="soviet"]').click();
 await page.waitForFunction(async()=>{
   const {map}=await import(document.querySelector('script[type="module"]').src);
   return map.getLayoutProperty('soviet-topo','visibility')==='visible';
 },null,{timeout:30000});
 const pixelChecks=await checkSovietStackingPixels(context,base);
 const checks=[];
 for(const [name,lon,lat] of locations){
   const before=requests.length;
   await page.evaluate(async({lon,lat})=>{
     const {map}=await import(document.querySelector('script[type="module"]').src);
     map.jumpTo({center:[lon,lat],zoom:5});
   },{lon,lat});
   await page.waitForFunction(async({lon,lat})=>{
     const {map}=await import(document.querySelector('script[type="module"]').src);
     const c=map.getCenter();
     return Math.abs(c.lng-lon)<.001&&Math.abs(c.lat-lat)<.001&&
       map.isSourceLoaded('sovietTopo')&&!map.isMoving();
   },{lon,lat},{timeout:30000});
   assert.ok(requests.length>before,`no Soviet raster tile requested at ${name}`);
   const result=await state();
   assert.equal(result.soviet,'visible',name);
   assert.equal(result.bathymetry,'visible',name);
   assert.equal(result.rail,'visible',name);
   assert.equal(result.station,'visible',name);
   assert.equal(result.original,'none',name);
   checks.push({name,result,requestsSincePrevious:requests.length-before});
 }
 assert.ok(requests.length,'historic tile requests must be made only after selection');
 await page.locator('[data-background="map"]').click();
 assert.equal((await state()).soviet,'none','switch back must hide external imagery');
 await page.evaluate(async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);map.fire('error',{sourceId:'sovietTopo',error:new Error('Synthetic hidden raster failed')});});
 await page.locator('[data-background="carto"]').click();
 assert.equal((await state()).soviet,'none');
 assert.deepEqual(errors,[]);
 await mkdir('browser-review',{recursive:true});
 await writeFile('browser-review/soviet-topo-fixture.json',JSON.stringify({scope:'fixture-only, no external-provider access',requests:requests.length,checks,pixelChecks},null,2)+'\n');
 console.log('PASS: five historical raster locations, source isolation, ocean/rail/station overlays and return to ordinary map');
} finally {await browser.close();}
