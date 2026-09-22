import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const deadline=setTimeout(()=>{console.error('Browser validation exceeded ten minutes');process.exit(1);},600000);deadline.unref();
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
page.setDefaultTimeout(120000);
const errors=[],requests=[];
page.on('pageerror', e=>errors.push(e.message));
page.on('request',req=>requests.push(req.url()));
page.on('console',msg=>{if(msg.type()==='error') console.log('Browser resource:',msg.text());});
await mkdir('browser-review',{recursive:true});
try{
  await page.goto('http://127.0.0.1:4173/?mapLanguage=en&stationLanguage=ko#7/34.229/129.245');
  await page.waitForSelector('body[data-map-ready="true"]',{state:'attached',timeout:120000});
  await page.waitForFunction(()=>+document.querySelector('#map-status').dataset.renderedTracks>0,undefined,{timeout:120000});
  // Pan northwest at the SAME zoom before any visit to zoom 8.
  await page.evaluate(()=>location.hash='#7/35.65/128.1');
  await page.waitForFunction(()=>document.querySelector('#map-status').dataset.lifecycleNames?.includes('남부내륙'),undefined,{timeout:120000});
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
  const shot=await page.screenshot({path:'browser-review/korea-z7.jpg',type:'jpeg',quality:45});
  console.log('REVIEW_IMAGE_START'+shot.toString('base64')+'REVIEW_IMAGE_END');
  await page.locator('#collapse').click();
  await page.selectOption('#stationLanguage','en');
  await page.selectOption('#lineLanguage','en');
  await page.evaluate(()=>location.hash='#10/35.17/128.12');
  await page.waitForFunction(()=>+document.querySelector('#map-status').dataset.renderedRailNames>0,undefined,{timeout:120000});
  console.log('PASS: railway names rendered at zoom 10');
  await page.screenshot({path:'browser-review/korea-z10.jpg',type:'jpeg',quality:65});
  console.log('Checking display controls');
  await page.locator('.display-options summary').click();
  await page.locator('#inactive').uncheck();
  await page.waitForFunction(()=>+document.querySelector('#map-status').dataset.renderedConstruction===0,undefined,{timeout:30000});
  await page.locator('#inactive').check();
  await page.locator('#relief').uncheck();
  await page.locator('#relief').check();
  assert.equal(await page.locator('#region').count(),0);
  assert.ok(requests.some(url=>url.includes('terrarium')),'Relief source requested');
  assert.ok(requests.some(url=>url.includes('standard_railway_text_stations')&&url.includes('lang=en')),'Translated station tiles requested');
  console.log('Checking China regional map');
  await page.selectOption('#mapLanguage','zh-Hans');
  await page.selectOption('#stationLanguage','zh-Hans');
  await page.evaluate(()=>location.hash='#7/30.5/116.4');
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return !map.isMoving() && map.isSourceLoaded('stationMed') && map.queryRenderedFeatures().some(f=>f.layer.id.startsWith('station-'));
  },undefined,{timeout:120000});
  await page.locator('#collapse').click();
  const china=await page.screenshot({path:'browser-review/china-z7.jpg',type:'jpeg',quality:45});
  console.log('CHINA_IMAGE_START'+china.toString('base64')+'CHINA_IMAGE_END');
  assert.deepEqual(errors,[]);
  console.log('PASS: languages, names, relief and lifecycle controls; no JavaScript exceptions');
} catch(error) {
  const failure=await page.screenshot({path:'browser-review/failure.jpg',type:'jpeg',quality:45});
  console.log('FAIL_IMAGE_START'+failure.toString('base64')+'FAIL_IMAGE_END');
  throw error;
} finally {await browser.close();}
