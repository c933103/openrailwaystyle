import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
page.setDefaultTimeout(90000);
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',msg=>{if(msg.type()==='error') { console.log('Browser resource:',msg.text()); if(/DataCloneError|already detached/.test(msg.text())) errors.push(msg.text()); }});
await page.addInitScript(()=>{
  const original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(kind,options){return original.call(this,kind,/^webgl2?$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);};
});
const evaluate=async(fn,arg)=>page.evaluate(async({source,arg})=>{
  const {map}=await import(document.querySelector('script[type="module"]').src);
  return await (0,eval)('('+source+')')(map,arg);
},{source:fn.toString(),arg});
async function waitContext(group) {
  await page.waitForFunction(async group=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return map.queryRenderedFeatures().some(f=>f.layer.id.startsWith('context-'+group+'-')&&f.layer.type==='symbol');
  },group,{timeout:90000});
}
async function settleContext() {
  // Source/layer replacement can give one populated frame followed by an
  // empty one while workers finish. Require several consecutive ready frames.
  let stable=0;
  for (let attempt=0;attempt<180;attempt++) {
    const ready=await evaluate(map=>map.getSource('openmaptiles') && map.isSourceLoaded('openmaptiles') &&
      map.queryRenderedFeatures().filter(f=>f.layer.id.startsWith('context-')).length>5);
    stable=ready?stable+1:0;
    if(stable>=4)return;
    await page.waitForTimeout(500);
  }
  throw new Error('Context tiles did not finish rendering');
}
async function screenshot(name) {
  await page.waitForTimeout(1800);
  await evaluate(async map=>{await new Promise(r=>{map.once('render',r);map.triggerRepaint();});const c=map.getCanvas();(c.getContext('webgl2')||c.getContext('webgl'))?.finish();});
  const bytes=await page.screenshot({path:`browser-review/context-${name}.jpg`,type:'jpeg',quality:65});
  console.log(`CONTEXT_${name.toUpperCase()}_START`+bytes.toString('base64')+`CONTEXT_${name.toUpperCase()}_END`);
}
await mkdir('browser-review',{recursive:true});
try {
  const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
  await page.goto(base+'?v=20261002-53&mode=speed&language=en&relief=0&inactive=0#14/22.299/114.172',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('body[data-map-ready="true"]',{state:'attached'});
  await waitContext('transport');await waitContext('destinations');await settleContext();
  console.log('CONTEXT_DATA',JSON.stringify(await evaluate(map=>({
    rendered:map.queryRenderedFeatures().filter(f=>f.layer.id.startsWith('context-')).map(f=>({layer:f.layer.id,name:f.properties.atlas_name,class:f.properties.class,subclass:f.properties.subclass})).slice(0,70),
    poiClasses:[...new Set(map.querySourceFeatures('openmaptiles',{sourceLayer:'poi'}).map(f=>f.properties.class+':'+f.properties.subclass))],
  }))));
  assert.ok(await evaluate(map=>map.queryRenderedFeatures().some(f=>f.layer.id.startsWith('context-destinations-')&&f.layer.type==='fill')),'destination areas render');
  await page.waitForFunction(async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);return map.queryRenderedFeatures().some(f=>f.layer.id.startsWith('station-'));});
  await screenshot('hongkong');
  // A feature panel uses destination semantics, never railway speed/status.
  const point=await evaluate(map=>{
    const f=map.queryRenderedFeatures().find(f=>f.layer.id.startsWith('context-destinations-')&&f.geometry.type==='Point'&&map.project(f.geometry.coordinates).x>430);
    if(!f)return null; const p=map.project(f.geometry.coordinates);return [p.x,p.y];
  });
  assert.ok(point,'a destination can be inspected');await page.mouse.click(...point);
  await page.waitForSelector('#details:not([hidden])');
  assert.match(await page.locator('#detail-content').innerText(),/PASSENGER DESTINATION/);
  await page.locator('#details-close').click();
  const stationPoint=await evaluate(async map=>{
    const {nearbyTransport}=await import(new URL('./context.mjs',document.querySelector('script[type="module"]').src));
    const facilities=map.querySourceFeatures('openmaptiles',{sourceLayer:'poi'}).map(f=>({id:f.id,properties:f.properties,geometry:f.geometry,sourceLayer:'poi'}));
    const station=map.queryRenderedFeatures().find(f=>f.layer.id.startsWith('station-')&&f.geometry.type==='Point'&&map.project(f.geometry.coordinates).x>430&&nearbyTransport(f.geometry.coordinates,facilities,500,map.getZoom()).length);
    if(!station)return null;const p=map.project(station.geometry.coordinates);return [p.x,p.y];
  });
  assert.ok(stationPoint,'a rail station has a nearby mapped interchange');
  await page.mouse.click(...stationPoint);
  await page.waitForSelector('#nearby-transport li');
  assert.match(await page.locator('#nearby-transport').innerText(),/not verified/);
  console.log('PASS: real station interchange context',await page.locator('#nearby-transport').innerText());
  await screenshot('interchange');
  await page.locator('#details-close').click();
  await page.locator('#settings-open').click();
  await page.locator('#transport').uncheck();await page.locator('#destinations').uncheck();await page.locator('#constraints').uncheck();
  assert.ok(await evaluate(map=>map.getStyle().layers.filter(l=>l.id.startsWith('context-')).every(l=>l.layout?.visibility==='none')),'both context groups are disabled');
  await page.waitForFunction(async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);return !map.queryRenderedFeatures().some(f=>f.layer.id.startsWith('context-'));});
  assert.ok(await evaluate(map=>map.queryRenderedFeatures({layers:['building-footprints']}).length>0),'ordinary buildings remain visible with destinations disabled');
  await page.locator('#transport').check();await page.locator('#destinations').check();await page.locator('#constraints').check();
  await page.locator('#settings-close').click();
  await page.locator('#language').selectOption('zh-Hant');
  await page.waitForFunction(async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);return map.queryRenderedFeatures().some(f=>f.layer.id.startsWith('context-')&&f.properties.atlas_language==='zh-Hant');});
  await waitContext('transport');await settleContext();
  console.log('PASS: Hong Kong transport, destination labels/areas, shared language, toggles and inspection');
  await evaluate(map=>map.jumpTo({center:[-0.4543,51.47],zoom:10}));
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return map.queryRenderedFeatures({layers:['context-transport-airport-label']}).some(f=>f.properties.iata==='LHR'||/Heathrow/.test(f.properties.name));
  });
  await settleContext();
  await screenshot('airport');
  console.log('PASS: regional airport label');
  assert.deepEqual(errors,[]);
} catch(error) {
  console.log('CONTEXT_FAILURE',await evaluate(map=>({zoom:map.getZoom(),layers:Object.keys(map.getStyle().sources),poi:map.querySourceFeatures('openmaptiles',{sourceLayer:'poi'}).slice(0,25).map(f=>f.properties),rendered:map.queryRenderedFeatures().filter(f=>f.layer.id.startsWith('context-')).slice(0,20).map(f=>({layer:f.layer.id,p:f.properties}))})).catch(e=>String(e)));
  await screenshot('failure');throw error;
} finally {await browser.close();}
