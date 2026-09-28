import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const deadline=setTimeout(()=>{console.error('Planning checks exceeded ten minutes');process.exit(1);},600000);deadline.unref();
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});page.setDefaultTimeout(60000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')console.log('RESOURCE',m.text());});
await page.addInitScript(()=>{const f=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(k,o){return f.call(this,k,/^webgl2?$/.test(k)?{...o,preserveDrawingBuffer:true}:o);};});
const evaluate=(fn,arg)=>page.evaluate(async({fn,arg})=>{const {map}=await import(document.querySelector('script[type="module"]').src);return (0,eval)('('+fn+')')(map,arg);},{fn:fn.toString(),arg});
async function waitLayer(id){await page.waitForFunction(async id=>{const {map}=await import(document.querySelector('script[type="module"]').src);return map?.getLayer(id)&&map.queryRenderedFeatures({layers:[id]}).length>0;},id);}
async function move(center,zoom){await evaluate((map,{center,zoom})=>map.jumpTo({center,zoom}),{center,zoom});await page.waitForTimeout(1000);}
async function screenshot(name){await page.waitForTimeout(1800);await evaluate(async map=>{await new Promise(r=>{map.once('render',r);map.triggerRepaint();});map.getCanvas().getContext('webgl2')?.finish();});const b=await page.screenshot({path:`browser-review/planning-${name}.jpg`,type:'jpeg',quality:65});console.log(`PLANNING_${name}_START`+b.toString('base64')+`PLANNING_${name}_END`);}
await mkdir('browser-review',{recursive:true});
try {
 const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
 await page.goto(base+'?language=en&relief=0&inactive=1#16/48.853/2.348',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('body[data-map-ready="true"]',{state:'attached'});
 for(const id of ['road-local','road-walk','context-transport-bus-stop-label','context-transport-bike-rental-label','context-transport-taxi-label','context-constraints-religious-label'])await waitLayer(id);
 console.log('PASS: Paris surface roads, paths, bus stops, taxi stands, bike rental and religious sites');
 await screenshot('STREET');
 await move([-120.58,46.3],9);
 await waitLayer('context-constraints-indigenous-edge');
 console.log('INDIGENOUS',JSON.stringify(await evaluate(map=>map.queryRenderedFeatures({layers:['context-constraints-indigenous-edge']}).slice(0,6).map(f=>f.properties))));
 await screenshot('JURISDICTION');
 await move([-110.58,44.60],8);await waitLayer('context-constraints-protected-edge');
 console.log('PASS: real Indigenous jurisdictions and conservation boundaries render separately');
 await move([-0.78,51.28],13);await waitLayer('context-constraints-military-area');
 console.log('PASS: military grounds');
 await page.locator('[data-mode="infrastructure"]').click();
 await move([139.488,35.309],16);
 await waitLayer('infrastructure-level-crossings');await waitLayer('infrastructure-street-running');
 console.log('STREET_RUNNING',JSON.stringify(await evaluate(map=>map.queryRenderedFeatures({layers:['infrastructure-street-running']}).slice(0,5).map(f=>f.properties))));
 const point=await evaluate(map=>{const f=map.queryRenderedFeatures({layers:['infrastructure-level-crossings']}).find(f=>map.project(f.geometry.coordinates).x>430);if(!f)return null;const p=map.project(f.geometry.coordinates);return[p.x,p.y];});
 assert.ok(point);await page.mouse.click(...point);await page.waitForSelector('#details:not([hidden])');
 assert.match(await page.locator('#detail-content').innerText(),/level crossing/i);
 await page.locator('#details-close').click();await screenshot('RAIL');
 await page.locator('[data-mode="speed"]').click();
 assert.ok(await evaluate(map=>['infrastructure-level-crossings','infrastructure-street-running'].every(id=>map.getLayoutProperty(id,'visibility')==='none')));
 console.log('PASS: explicit street-running data, crossing rendering and inspection, infrastructure mode isolation');
 assert.deepEqual(errors,[]);
} catch(error) {
 console.log('PLANNING_DIAGNOSTIC',JSON.stringify(await evaluate(map=>({center:map.getCenter(),zoom:map.getZoom(),sourceData:['poi','park','boundary','landuse','transportation'].map(sourceLayer=>({sourceLayer,classes:[...new Set(map.querySourceFeatures('openmaptiles',{sourceLayer}).map(f=>f.properties.class+':'+f.properties.subclass))]})),rendered:[...new Set(map.queryRenderedFeatures().map(f=>f.layer.id))]})).catch(String)));
 await screenshot('FAILURE');throw error;
}finally{await browser.close();}
