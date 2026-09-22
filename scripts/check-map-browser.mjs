import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const deadline=setTimeout(()=>{console.error('Browser validation exceeded ten minutes');process.exit(1);},600000);deadline.unref();
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
page.setDefaultTimeout(120000);
// Retain completed WebGL frames for reliable headless screenshots.
await page.addInitScript(()=>{
  const getContext=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(kind,options){
    return getContext.call(this,kind,/^webgl2?$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);
  };
});
async function finishFrame(){
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return map.areTilesLoaded();
  },undefined,{timeout:120000});
  await page.evaluate(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    await new Promise(resolve=>{map.once('render',resolve);map.triggerRepaint();});
    const canvas=map.getCanvas();
    (canvas.getContext('webgl2')||canvas.getContext('webgl'))?.finish();
  });
  await page.waitForTimeout(1000); // Finish label fades before visual review.
}
async function moveTo(zoom,lng,lat){
  await page.evaluate(async({zoom,lng,lat})=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    map.jumpTo({zoom,center:[lng,lat]});
  },{zoom,lng,lat});
}
const errors=[],requests=[];
page.on('pageerror', e=>errors.push(e.message));
page.on('request',req=>requests.push(req.url()));
page.on('console',msg=>{if(msg.type()==='error') console.log('Browser resource:',msg.text());});
await mkdir('browser-review',{recursive:true});
try{
  await page.goto((process.env.MAP_BASE_URL || 'http://127.0.0.1:4173/').replace(/\/?$/,'/')+'?v=20260922-3&mapLanguage=en&stationLanguage=ko#7/34.229/129.245');
  await page.waitForSelector('body[data-map-ready="true"]',{state:'attached',timeout:120000});
  await page.waitForFunction(()=>+document.querySelector('#map-status').dataset.renderedTracks>0,undefined,{timeout:120000});
  // Pan northwest at the SAME zoom before any visit to zoom 8.
  await moveTo(7,128.1,35.65);
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return Math.abs(map.getCenter().lng-128.1)<0.01 && map.isSourceLoaded('inactiveRegional') && document.querySelector('#map-status').dataset.lifecycleNames?.includes('남부내륙');
  },undefined,{timeout:120000});
  console.log('PASS: 남부내륙선 rendered after pan at zoom 7, before visiting zoom 8');
  console.log('Inspecting rendered line extent, stations and borders');
  const rendered = await page.evaluate(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const features=map.queryRenderedFeatures();
    const nambu=features.filter(f=>f.source==='inactiveRegional' && /남부내륙/.test(f.properties.name));
    const coordinates=nambu.flatMap(f=>f.geometry.type==='LineString'?f.geometry.coordinates:f.geometry.coordinates.flat());
    return {nambuWays:new Set(nambu.map(f=>f.properties.osm_id)).size,bbox:[Math.min(...coordinates.map(p=>p[0])),Math.min(...coordinates.map(p=>p[1])),Math.max(...coordinates.map(p=>p[0])),Math.max(...coordinates.map(p=>p[1]))],stations:features.filter(f=>f.layer.id.startsWith('station-')).length,borders:features.filter(f=>f.layer.id==='regional-borders').length};
  });
  console.log('Zoom7 rendered coverage',JSON.stringify(rendered));
  assert.ok(rendered.bbox[3]-rendered.bbox[1]>1,'The line must span its full regional extent at zoom 7');
  assert.ok(rendered.stations>0,'Selected regional stations must render');
  assert.ok(rendered.borders>0,'Subnational borders must render');
  assert.equal(requests.some(url=>url.includes('overpass')),false,'Panning must not query Overpass');
  // Hide panel to assess railway/station/boundary prominence on the full map.
  await page.locator('#collapse').click();
  await finishFrame();
  const shot=await page.screenshot({path:'browser-review/korea-z7.jpg',type:'jpeg',quality:45});
  console.log('REVIEW_IMAGE_START'+shot.toString('base64')+'REVIEW_IMAGE_END');
  await page.locator('#collapse').click();
  await page.selectOption('#stationLanguage','en');
  await page.selectOption('#lineLanguage','en');
  await moveTo(10,128.12,35.17);
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return Math.abs(map.getZoom()-10)<0.01 && map.isSourceLoaded('railway') && map.queryRenderedFeatures().some(f=>f.layer.id.endsWith('-names') && !f.layer.id.startsWith('station-'));
  },undefined,{timeout:45000});
  console.log('PASS: railway names rendered at zoom 10');
  await finishFrame();
  const detail=await page.screenshot({path:'browser-review/korea-z10.jpg',type:'jpeg',quality:55});
  console.log('DETAIL_IMAGE_START'+detail.toString('base64')+'DETAIL_IMAGE_END');
  console.log('Checking display controls');
  await page.locator('.display-options summary').click();
  await page.locator('#inactive').uncheck();
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return map.getLayoutProperty('inactive-regional','visibility')==='none' && !map.queryRenderedFeatures().some(f=>f.source==='inactiveRegional');
  },undefined,{timeout:30000});
  await page.locator('#inactive').check();
  await page.locator('#relief').uncheck();
  await page.locator('#relief').check();
  assert.equal(await page.locator('#region').count(),0);
  assert.ok(requests.some(url=>url.includes('terrarium')),'Relief source requested');
  assert.ok(requests.some(url=>url.includes('standard_railway_text_stations')&&url.includes('lang=en')),'Translated station tiles requested');
  console.log('Checking China regional map');
  await page.selectOption('#mapLanguage','zh-Hans');
  await page.selectOption('#stationLanguage','zh-Hans');
  await moveTo(7,116.4,30.5);
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return Math.abs(map.getCenter().lng-116.4)<0.01 && Math.abs(map.getZoom()-7)<0.01 && !map.isMoving() && ['stationMed','openmaptiles','railway','relief'].every(id=>map.isSourceLoaded(id)) && map.queryRenderedFeatures().filter(f=>f.layer.id.startsWith('station-') && f.geometry.type==='Point' && f.geometry.coordinates[0]>110 && f.geometry.coordinates[0]<125).length>5;
  },undefined,{timeout:120000});
  await page.locator('#collapse').click();
  await finishFrame();
  const china=await page.screenshot({path:'browser-review/china-z7.jpg',type:'jpeg',quality:45});
  console.log('CHINA_IMAGE_START'+china.toString('base64')+'CHINA_IMAGE_END');
  assert.deepEqual(errors,[]);
  console.log('PASS: languages, names, relief and lifecycle controls; no JavaScript exceptions');
} catch(error) {
  console.log('Failure diagnostics',await page.evaluate(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return {zoom:map.getZoom(),status:document.querySelector('#map-status').dataset, layers:map.getStyle().layers.filter(l=>l.id.endsWith('-names') && !l.id.startsWith('station-')), named:map.queryRenderedFeatures().filter(f=>['inactiveRegional','railway'].includes(f.source)&&f.properties.name).slice(0,12).map(f=>({layer:f.layer.id,name:f.properties.name}))};
  }));
  const failure=await page.screenshot({path:'browser-review/failure.jpg',type:'jpeg',quality:45});
  console.log('FAIL_IMAGE_START'+failure.toString('base64')+'FAIL_IMAGE_END');
  throw error;
} finally {await browser.close();}
